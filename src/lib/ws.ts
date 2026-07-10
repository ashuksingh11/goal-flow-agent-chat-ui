/**
 * WebSocket client wrapper for the GoalFlow cloud hub (CONTRACT v2).
 *
 * Lifecycle:
 *   1. open ONE outbound WS to VITE_WS_URL (default ws://localhost:8000/ws)
 *   2. on open, send `hello { role: "ui" }` and wait for `hello_ack`
 *   3. dispatch parsed inbound frames to a listener (hello_ack, capabilities,
 *      agent_event, present_plan, proposal, status)
 *   4. on drop, reconnect (backoff) and re-send `hello`
 *
 * Invariant: the UI talks ONLY to the cloud — never to the device.
 * TODO(M-impl): dedupe device-origin frames on correlation_id + agent_event.seq
 *               after a reconnect; queue outbound frames while closed.
 */

import type { UiInboundMessage, UiOutboundMessage } from "../types/contract";

export type ConnectionState = "connecting" | "open" | "closed";

const INBOUND_TYPES = new Set([
  "hello_ack",
  "capabilities",
  "agent_event",
  "present_plan",
  "proposal",
  "status",
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
  /** Open the connection and perform the hello handshake. */
  connect(): void;
  /** Serialize and send a frame (user_goal, approval, control). */
  send(message: UiOutboundMessage): void;
  /** Close deliberately (no auto-reconnect afterwards). */
  close(): void;
  readonly state: ConnectionState;
}

const DEFAULT_WS_URL = "ws://localhost:8000/ws";
const RECONNECT_DELAY_MS = 1_500;

function getConfiguredUrl() {
  const env = (import.meta as unknown as { env?: { VITE_WS_URL?: string } }).env;
  return env?.VITE_WS_URL || DEFAULT_WS_URL;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUiInboundMessage(value: unknown): value is UiInboundMessage {
  return isRecord(value) && typeof value.type === "string" && INBOUND_TYPES.has(value.type);
}

/** Create the singleton hub connection. */
export function createGoalFlowSocket(options: GoalFlowSocketOptions): GoalFlowSocket {
  const url = options.url || getConfiguredUrl();
  let socket: WebSocket | null = null;
  let reconnectTimer: number | undefined;
  let deliberatelyClosed = false;
  let currentState: ConnectionState = "closed";

  const setState = (state: ConnectionState) => {
    currentState = state;
    options.onStateChange?.(state);
  };

  const scheduleReconnect = () => {
    if (deliberatelyClosed || reconnectTimer !== undefined) {
      return;
    }

    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, RECONNECT_DELAY_MS);
  };

  const connect = () => {
    if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
      return;
    }

    deliberatelyClosed = false;
    setState("connecting");

    try {
      socket = new WebSocket(url);
    } catch (error) {
      console.error("Failed to create GoalFlow WebSocket", error);
      setState("closed");
      scheduleReconnect();
      return;
    }

    socket.addEventListener("open", () => {
      setState("open");
      const hello = { type: "hello", role: "ui" } satisfies UiOutboundMessage;
      socket?.send(JSON.stringify(hello));
      options.onSent?.(hello);
    });

    socket.addEventListener("message", (event) => {
      try {
        const parsed: unknown = JSON.parse(String(event.data));
        if (isUiInboundMessage(parsed)) {
          options.onMessage(parsed);
          return;
        }

        console.warn("Ignoring unsupported GoalFlow frame", parsed);
      } catch (error) {
        console.error("Failed to parse GoalFlow frame", error);
      }
    });

    socket.addEventListener("close", () => {
      socket = null;
      setState("closed");
      scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      socket?.close();
    });
  };

  const close = () => {
    deliberatelyClosed = true;
    if (reconnectTimer !== undefined) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
    socket?.close();
    socket = null;
    setState("closed");
  };

  return {
    connect,
    send(message) {
      if (socket?.readyState !== WebSocket.OPEN) {
        console.warn("GoalFlow socket is not open; dropping outbound frame", message);
        return;
      }
      socket.send(JSON.stringify(message));
      options.onSent?.(message);
    },
    close,
    get state() {
      return currentState;
    },
  };
}
