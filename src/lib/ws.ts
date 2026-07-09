/**
 * WebSocket client wrapper for the GoalFlow cloud hub.
 *
 * Lifecycle (Contract v0):
 *   1. open ONE outbound WS to VITE_WS_URL (default ws://localhost:8000/ws)
 *   2. on open, send `hello { role: "ui" }` and wait for `hello_ack`
 *   3. dispatch parsed inbound frames to a listener
 *   4. on drop, reconnect (backoff) and re-send `hello`
 *
 * Invariant: the UI talks ONLY to the cloud — never to the device.
 */

import type { UiInboundMessage, UiOutboundMessage } from "../types/contract";

export type ConnectionState = "connecting" | "open" | "closed";

export interface GoalFlowSocketOptions {
  /** Defaults to import.meta.env.VITE_WS_URL. */
  url?: string;
  /** Called with every parsed inbound frame (hello_ack, present_plan, proposal, status). */
  onMessage: (message: UiInboundMessage) => void;
  /** Called on connection state changes (drive a status indicator in the UI). */
  onStateChange?: (state: ConnectionState) => void;
}

export interface GoalFlowSocket {
  /** Open the connection and perform the hello handshake. */
  connect(): void;
  /** Serialize and send a frame (user_goal, approval). No-op TODO: queue while closed? (M2) */
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
  if (!isRecord(value) || typeof value.type !== "string") {
    return false;
  }

  return (
    value.type === "hello_ack" ||
    value.type === "present_plan" ||
    value.type === "proposal" ||
    value.type === "status"
  );
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
      socket?.send(JSON.stringify({ type: "hello", role: "ui" } satisfies UiOutboundMessage));
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
    },
    close,
    get state() {
      return currentState;
    },
  };
}
