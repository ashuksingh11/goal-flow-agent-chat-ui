/**
 * App — root layout + composition.
 *
 * M1: a single tablet chat surface.
 *   App
 *   └── ChatView            (transcript + input; owns the message list state)
 *       ├── PlanCard        (rendered inline for each present_plan)
 *       └── MicButton       (STT via Web Speech API — deferred stub)
 *
 * App owns the hub connection (lib/ws.ts createGoalFlowSocket) and passes
 * send/state down. Deferred: /hub display surface; "Show agent flow"
 * presenter toggle (see docs/ARCHITECTURE.md).
 */

import { useEffect, useRef, useState } from "react";
import { ChatView } from "./components/ChatView";
import type { ChatEntry } from "./components/ChatView";
import { createGoalFlowSocket } from "./lib/ws";
import type { ConnectionState, GoalFlowSocket } from "./lib/ws";
import type {
  ApprovalDecision,
  ContractMessage,
  ControlCommand,
  Status,
  UiInboundMessage,
  UiOutboundMessage,
} from "./types/contract";
import type { ProposalStatusMap } from "./types/ui";

export interface FlowFrame {
  id: number;
  direction: "sent" | "recv";
  message: UiInboundMessage | UiOutboundMessage;
}

export default function App() {
  const socketRef = useRef<GoalFlowSocket | null>(null);
  const frameIdRef = useRef(0);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [frames, setFrames] = useState<FlowFrame[]>([]);
  const [proposalStatuses, setProposalStatuses] = useState<ProposalStatusMap>({});
  const [showAgentFlow, setShowAgentFlow] = useState(false);
  const [activeGoalId, setActiveGoalId] = useState<string | null>(null);
  const [currentTick, setCurrentTick] = useState<Status | null>(null);

  const recordFrame = (direction: FlowFrame["direction"], message: FlowFrame["message"]) => {
    const frame = { id: frameIdRef.current + 1, direction, message };
    frameIdRef.current = frame.id;
    setFrames((current) => [...current.slice(-79), frame]);
  };

  useEffect(() => {
    const handleMessage = (message: UiInboundMessage) => {
      recordFrame("recv", message);
      setMessages((current) => [...current, { kind: "agent", message }]);

      if ("goal_id" in message) {
        setActiveGoalId(message.goal_id);
      }

      if (message.type === "status") {
        setCurrentTick(message);
      }

      if (message.type === "status" && message.payload.executed) {
        setProposalStatuses((current) => {
          const next = { ...current };
          for (const executed of message.payload.executed ?? []) {
            const existing = next[executed.proposal_id];
            next[executed.proposal_id] = {
              state: "done",
              approved: existing?.approved ?? true,
              detail: executed.detail || executed.result,
            };
          }
          return next;
        });
      }
    };

    const socket = createGoalFlowSocket({
      onMessage: handleMessage,
      onSent: (message) => recordFrame("sent", message),
      onStateChange: setConnectionState,
    });

    socketRef.current = socket;
    socket.connect();

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, []);

  const sendGoal = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    setMessages((current) => [...current, { kind: "user", text: trimmed }]);
    socketRef.current?.send({ type: "user_goal", text: trimmed });
  };

  const sendApproval = (
    goalId: string,
    correlationId: string,
    decisions: ApprovalDecision[],
  ) => {
    setProposalStatuses((current) => {
      const next = { ...current };
      for (const decision of decisions) {
        next[decision.proposal_id] = {
          state: "pending",
          approved: decision.approved,
        };
      }
      return next;
    });

    socketRef.current?.send({
      type: "approval",
      goal_id: goalId,
      correlation_id: correlationId,
      payload: { decisions },
    });
  };

  const sendControl = (command: ControlCommand) => {
    if (!activeGoalId) {
      return;
    }

    if (command === "reset") {
      setCurrentTick(null);
    }

    socketRef.current?.send({
      type: "control",
      goal_id: activeGoalId,
      command,
      payload: {},
    });
  };

  return (
    <div className="app">
      <header>
        <div>
          <p className="eyebrow">GoalFlow</p>
          <h1>Family dinner planning</h1>
        </div>
        <div className="header-actions">
          <label className="agent-flow-toggle">
            <input
              type="checkbox"
              checked={showAgentFlow}
              onChange={(event) => setShowAgentFlow(event.target.checked)}
            />
            Show agent flow
          </label>
          <span className={`connection-status connection-status--${connectionState}`}>
            <span aria-hidden="true" />
            {connectionState}
          </span>
        </div>
      </header>
      {activeGoalId ? (
        <DemoControls currentTick={currentTick} onCommand={sendControl} />
      ) : null}
      <main className={showAgentFlow ? "main-layout main-layout--with-flow" : "main-layout"}>
        <ChatView
          messages={messages}
          onSendGoal={sendGoal}
          onApprove={sendApproval}
          proposalStatuses={proposalStatuses}
        />
        {showAgentFlow ? <AgentFlowPanel frames={frames} /> : null}
      </main>
    </div>
  );
}

function DemoControls({
  currentTick,
  onCommand,
}: {
  currentTick: Status | null;
  onCommand: (command: ControlCommand) => void;
}) {
  const currentDay = currentTick?.payload.day || "Mon";
  const currentDate = formatSimDate(currentTick?.payload.sim_date);
  const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri"];

  return (
    <section className="demo-controls" aria-label="Demo controls">
      <div className="demo-controls__label">
        <span className="eyebrow">Demo controls</span>
        <strong>
          {currentDay}
          {currentDate ? ` ${currentDate}` : ""}
        </strong>
      </div>
      <div className="demo-stepper" aria-label="Simulated week progress">
        {weekDays.map((day) => (
          <span
            key={day}
            className={day === currentDay ? "demo-step demo-step--active" : "demo-step"}
          >
            {day}
          </span>
        ))}
      </div>
      <div className="demo-controls__actions">
        <button type="button" onClick={() => onCommand("advance_day")}>
          Advance day ▶
        </button>
        <button type="button" className="secondary-button" onClick={() => onCommand("reset")}>
          Reset week
        </button>
      </div>
    </section>
  );
}

function AgentFlowPanel({ frames }: { frames: FlowFrame[] }) {
  return (
    <aside className="agent-flow-panel" aria-label="Live WebSocket message feed">
      <div className="agent-flow-panel__header">
        <p className="eyebrow">WS message feed</p>
        <strong>{frames.length} frames</strong>
      </div>
      {frames.length === 0 ? (
        <p className="agent-flow-empty">Waiting for traffic.</p>
      ) : (
        <ol className="agent-flow-list">
          {frames.map((frame) => (
            <li key={frame.id} className={`agent-flow-item agent-flow-item--${frame.direction}`}>
              <span aria-hidden="true">{frame.direction === "sent" ? "▲" : "▼"}</span>
              <div>
                <strong>{frame.message.type}</strong>
                <p>{describeFrame(frame)}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

function describeFrame(frame: FlowFrame) {
  const { message } = frame;

  switch (message.type) {
    case "hello":
      return "UI → cloud handshake";
    case "hello_ack":
      return `cloud → UI session ${message.session_id}`;
    case "user_goal":
      return "user_goal → cloud";
    case "present_plan":
      return "device → plan_ready → cloud → UI";
    case "proposal":
      return `proposal ▼ ${message.payload.action}: ${message.payload.trigger}`;
    case "approval":
      return approvalLabel(message);
    case "control":
      return `control ▲ ${message.command} → cloud`;
    case "status":
      return statusLabel(message);
    default:
      return `${(message as ContractMessage).type} frame`;
  }
}

function formatSimDate(value?: string) {
  if (!value) {
    return "";
  }

  const [, month, day] = value.match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? [];
  return month && day ? `${month}-${day}` : value;
}

function approvalLabel(message: Extract<UiOutboundMessage, { type: "approval" }>) {
  const approvedCount = message.payload.decisions.filter((decision) => decision.approved).length;
  const declinedCount = message.payload.decisions.length - approvedCount;
  if (approvedCount > 0 && declinedCount === 0) {
    return `approval ▲ adapt/approve ${approvedCount} → cloud`;
  }
  if (declinedCount > 0 && approvedCount === 0) {
    return `approval ▲ decline ${declinedCount} → cloud`;
  }
  return `approval ▲ ${approvedCount} approved, ${declinedCount} declined → cloud`;
}

function statusLabel(message: Extract<UiInboundMessage, { type: "status" }>) {
  const executedCount = message.payload.executed?.length ?? 0;
  if (executedCount > 0) {
    return `status ▼ ${executedCount} executed · ${message.task_status}`;
  }
  const day = message.payload.day ? `${message.payload.day} ` : "";
  const material = message.payload.material ? "material" : "quiet";
  return `status ▼ ${day}${message.task_status} · ${material}`;
}
