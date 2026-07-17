/**
 * WebSocket client wrapper for the GoalFlow cloud hub (CONTRACT v2).
 *
 * Lifecycle:
 *   1. open ONE outbound WS to VITE_WS_URL (default ws://localhost:8000/ws)
 *   2. on open, send `hello { role: "ui" }` and wait for `hello_ack`
 *   3. dispatch parsed inbound frames to subscribers (hello_ack, capabilities,
 *      agent_event, present_plan, proposal, status)
 *   4. on drop, reconnect (backoff) and re-send `hello`
 *
 * The underlying connection is a MODULE-LEVEL SINGLETON: however many times
 * React mounts the App (StrictMode dev double-mount, HMR, future extra
 * consumers), one browser tab holds exactly ONE socket. Each
 * createGoalFlowSocket() call returns a lightweight handle that subscribes
 * its callbacks to the shared connection; handle.close() detaches the
 * callbacks but deliberately leaves the shared socket open so an immediate
 * remount (StrictMode) reuses it instead of churning connect/disconnect.
 *
 * Invariant: the UI talks ONLY to the cloud — never to the device.
 * TODO(M-impl): dedupe device-origin frames on correlation_id + agent_event.seq
 *               after a reconnect; queue outbound frames while closed.
 */

import type { UiInboundMessage, UiOutboundMessage } from "../types/contract";

export type ConnectionState = "connecting" | "open" | "closed";

// THE ALLOWLIST IS A SILENT DROPPER: an unlisted frame is discarded with only a
// console warning, so a contract addition that misses this line fails at runtime and
// looks like nothing happened. (That is not hypothetical — the same class of gap in
// the Python mirror swallowed every task_update and left the board at 0%.)
// `verify_mirrors.py` in the cloud repo checks this list against CONTRACT.md.
const INBOUND_TYPES = new Set([
  "hello_ack",
  "capabilities",
  "agent_event",
  "understanding",
  "present_plan",
  "proposal",
  "status",
  "notice",
  "devices",
  // v3: the cloud broadcasts to EVERY ui bound to a session, so this surface also
  // receives the board's frames. It ignores them (Agent Board is its own app) — but
  // they are listed so they are ignored DELIBERATELY rather than dropped as unknown.
  "board_snapshot",
  "board_update",
  // v3: ties a submission to its goal_id. This UI runs one goal at a time and adopts
  // the id from `understanding`, so it is informational here — the board needs it.
  "goal_accepted",
]);

export interface GoalFlowSocketOptions {
  /** Defaults to import.meta.env.VITE_WS_URL. */
  url?: string;
  /** Called with every parsed inbound frame. */
  onMessage: (message: UiInboundMessage) => void;
  /** Called after an outbound frame is successfully written to the socket. */
  onSent?: (message: UiOutboundMessage) => void;
  /** Called on connection state changes (drives the header indicator). */
  onStateChange?: (state: ConnectionState) => void;
}

export interface GoalFlowSocket {
  /** Subscribe to the shared connection, opening it if needed. */
  connect(): void;
  /** Serialize and send a frame (user_goal, approval, control). */
  send(message: UiOutboundMessage): void;
  /** Detach this handle's callbacks (the shared socket stays up for reuse). */
  close(): void;
  readonly state: ConnectionState;
}

const DEFAULT_WS_PORT = "8000";
const FALLBACK_WS_URL = "ws://localhost:8000/ws";
const RECONNECT_DELAY_MS = 1_500;

/**
 * Resolve the cloud hub WebSocket URL.
 *
 * 1. `VITE_WS_URL` — explicit override (full ws/wss URL), wins if set.
 * 2. Otherwise derive it from the page's own origin: the same host that SERVED
 *    the UI, on `VITE_WS_PORT` (default 8000), path `/ws`, and wss when the page
 *    is https. This is what makes cross-machine deployment work — when a tablet
 *    loads the UI from `http://<ubuntu-ip>:5173`, it connects the socket to
 *    `ws://<ubuntu-ip>:8000/ws`, NOT to the tablet's own localhost.
 * 3. Fallback to localhost only when there is no browser `window` (tests/SSR).
 */
function getConfiguredUrl() {
  const env = (import.meta as unknown as { env?: { VITE_WS_URL?: string; VITE_WS_PORT?: string } }).env;
  if (env?.VITE_WS_URL) {
    return env.VITE_WS_URL;
  }
  if (typeof window !== "undefined" && window.location?.hostname) {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const port = env?.VITE_WS_PORT || DEFAULT_WS_PORT;
    return `${proto}://${window.location.hostname}:${port}/ws`;
  }
  return FALLBACK_WS_URL;
}

/**
 * The device_id this UI should pair with, from the `?device=<id>` query param
 * (a home = one device agent + N UIs). Empty ⇒ let the cloud auto-bind the sole
 * device, or (multiple) drive the picker. Query-param-based so it's per-tab and
 * platform-independent (works in the Tizen Hub browser and on a tablet alike).
 * `search` is injectable for testing.
 */
export function getDeviceId(search?: string): string {
  const query = search ?? (typeof window !== "undefined" ? window.location?.search : "") ?? "";
  try {
    return new URLSearchParams(query).get("device")?.trim() ?? "";
  } catch {
    return "";
  }
}

/**
 * A goal to rejoin, from `?goal=<id>` — how the Agent Board drills in.
 *
 * The board is read-mostly by design: it shows every goal at a glance and hands off
 * to this UI for anything that needs a person (confirming an understanding,
 * approving a proposal). That handoff is a plain link, so the two apps stay
 * independently deployable and this one needs no board-specific frame — it just asks
 * the hub for the goal's current state via `goal_state_get`.
 */
export function getGoalId(search?: string): string {
  const query = search ?? (typeof window !== "undefined" ? window.location?.search : "") ?? "";
  try {
    return new URLSearchParams(query).get("goal")?.trim() ?? "";
  } catch {
    return "";
  }
}

const REMEMBERED_DEVICE_KEY = "goalflow.device_id";

/**
 * The device this browser last paired with. Used to auto-pick out of the
 * `devices` list so the picker is a ONE-TIME click per browser — never sent in
 * `hello`, because a remembered device that is now OFFLINE would silently bind
 * to a dead session. The list only contains live devices, so matching against it
 * is self-healing.
 */
export function getRememberedDeviceId(): string {
  try {
    return window.localStorage?.getItem(REMEMBERED_DEVICE_KEY) ?? "";
  } catch {
    return ""; // storage disabled/unavailable — just show the picker
  }
}

export function rememberDeviceId(deviceId: string): void {
  try {
    window.localStorage?.setItem(REMEMBERED_DEVICE_KEY, deviceId);
  } catch {
    // non-fatal: the pick still applies to this session
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUiInboundMessage(value: unknown): value is UiInboundMessage {
  return isRecord(value) && typeof value.type === "string" && INBOUND_TYPES.has(value.type);
}

// ---------------------------------------------------------------------------
// Shared (module-level) connection state — the tab-wide singleton.
// ---------------------------------------------------------------------------

type Subscriber = Pick<GoalFlowSocketOptions, "onMessage" | "onSent" | "onStateChange">;

const subscribers = new Set<Subscriber>();
let sharedSocket: WebSocket | null = null;
let sharedUrl: string | null = null;
let reconnectTimer: number | undefined;
let currentState: ConnectionState = "closed";

function setState(state: ConnectionState) {
  currentState = state;
  for (const subscriber of subscribers) {
    subscriber.onStateChange?.(state);
  }
}

function scheduleReconnect() {
  if (reconnectTimer !== undefined || subscribers.size === 0) {
    return;
  }

  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined;
    openSharedSocket();
  }, RECONNECT_DELAY_MS);
}

function openSharedSocket() {
  if (subscribers.size === 0) {
    return; // nobody listening — do not hold a connection open
  }
  if (
    sharedSocket?.readyState === WebSocket.OPEN ||
    sharedSocket?.readyState === WebSocket.CONNECTING
  ) {
    return; // singleton: reuse the live socket instead of racing a second one
  }

  setState("connecting");

  let ws: WebSocket;
  try {
    ws = new WebSocket(sharedUrl ?? getConfiguredUrl());
  } catch (error) {
    console.error("Failed to create GoalFlow WebSocket", error);
    setState("closed");
    scheduleReconnect();
    return;
  }
  sharedSocket = ws;

  // Ignore events from a socket that is no longer the current one. Without
  // this, a stale socket's late close/error event would trigger a reconnect
  // on top of a healthy socket.
  const isCurrent = () => sharedSocket === ws;

  ws.addEventListener("open", () => {
    if (!isCurrent()) return;
    setState("open");
    const deviceId = getDeviceId();
    const hello = {
      type: "hello",
      role: "ui",
      ...(deviceId ? { device_id: deviceId } : {}),
    } satisfies UiOutboundMessage;
    ws.send(JSON.stringify(hello));
    for (const subscriber of subscribers) {
      subscriber.onSent?.(hello);
    }
  });

  ws.addEventListener("message", (event) => {
    if (!isCurrent()) return;
    try {
      const parsed: unknown = JSON.parse(String(event.data));
      if (isUiInboundMessage(parsed)) {
        for (const subscriber of subscribers) {
          subscriber.onMessage(parsed);
        }
        return;
      }

      console.warn("Ignoring unsupported GoalFlow frame", parsed);
    } catch (error) {
      console.error("Failed to parse GoalFlow frame", error);
    }
  });

  ws.addEventListener("close", (event) => {
    if (!isCurrent()) return; // a stale/replaced socket closing — not our concern
    sharedSocket = null;
    setState("closed");
    console.info(
      `GoalFlow socket closed code=${event.code} reason="${event.reason}" clean=${event.wasClean}`,
    );
    // 1012 = the cloud replaced this socket with a NEWER "ui" connection
    // (only single-ui-slot cloud builds do this). Reconnecting would evict
    // the newer socket right back → endless mutual-eviction storm. Let the
    // newest socket own the slot; reconnect only on other closes (1006 &c).
    if (event.code === 1012) {
      return;
    }
    scheduleReconnect();
  });

  // An `error` event is always followed by a `close` event — let close() drive
  // the single reconnect. Closing here as well raced the reconnect and, with a
  // spurious error event, produced a second socket that stormed.
  ws.addEventListener("error", () => {
    if (!isCurrent()) return;
    console.warn("GoalFlow socket error; awaiting close");
  });
}

/**
 * Create a handle onto the tab-wide singleton hub connection.
 *
 * Multiple handles (React StrictMode mounts both App instances in dev) share
 * ONE WebSocket — the cloud must never see two competing "ui" sockets from
 * the same tab.
 */
export function createGoalFlowSocket(options: GoalFlowSocketOptions): GoalFlowSocket {
  if (options.url) {
    sharedUrl = options.url;
  }
  const subscriber: Subscriber = {
    onMessage: options.onMessage,
    onSent: options.onSent,
    onStateChange: options.onStateChange,
  };
  let attached = false;

  return {
    connect() {
      if (!attached) {
        subscribers.add(subscriber);
        attached = true;
      }
      // A late subscriber (remount) must learn the CURRENT state immediately —
      // the open event it missed will not fire again.
      subscriber.onStateChange?.(currentState);
      openSharedSocket();
    },
    send(message) {
      if (sharedSocket?.readyState !== WebSocket.OPEN) {
        console.warn("GoalFlow socket is not open; dropping outbound frame", message);
        return;
      }
      sharedSocket.send(JSON.stringify(message));
      subscriber.onSent?.(message);
    },
    close() {
      if (attached) {
        subscribers.delete(subscriber);
        attached = false;
      }
      if (subscribers.size === 0 && reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      // Deliberately do NOT close sharedSocket: a StrictMode remount follows
      // immediately and reuses it; on real page teardown the browser closes it.
    },
    get state() {
      return currentState;
    },
  };
}
