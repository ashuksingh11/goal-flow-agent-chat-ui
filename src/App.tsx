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
import type { ApprovalDecision, UiInboundMessage } from "./types/contract";

export default function App() {
  const socketRef = useRef<GoalFlowSocket | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [messages, setMessages] = useState<ChatEntry[]>([]);

  useEffect(() => {
    const handleMessage = (message: UiInboundMessage) => {
      setMessages((current) => [...current, { kind: "agent", message }]);
    };

    const socket = createGoalFlowSocket({
      onMessage: handleMessage,
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
    socketRef.current?.send({
      type: "approval",
      goal_id: goalId,
      correlation_id: correlationId,
      payload: { decisions },
    });
  };

  return (
    <div className="app">
      <header>
        <div>
          <p className="eyebrow">GoalFlow</p>
          <h1>Family dinner planning</h1>
        </div>
        <span className={`connection-status connection-status--${connectionState}`}>
          <span aria-hidden="true" />
          {connectionState}
        </span>
      </header>
      <main>
        <ChatView
          messages={messages}
          onSendGoal={sendGoal}
          onApprove={sendApproval}
        />
      </main>
    </div>
  );
}
