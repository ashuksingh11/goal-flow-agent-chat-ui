/**
 * ChatView — the M1 chat surface.
 *
 * Renders the transcript (user goals, agent status notes, and PlanCards for
 * each present_plan) plus the input row (text field + send + MicButton).
 */

import { FormEvent, useEffect, useRef, useState } from "react";
import type { ApprovalDecision, UiInboundMessage } from "../types/contract";
import { PlanCard } from "./PlanCard";
import { MicButton } from "./MicButton";

/** One transcript entry: either something the user sent or an inbound frame. */
export type ChatEntry =
  | { kind: "user"; text: string }
  | { kind: "agent"; message: UiInboundMessage };

export interface ChatViewProps {
  messages: ChatEntry[];
  /** Send the typed/spoken goal as a `user_goal` frame. */
  onSendGoal: (text: string) => void;
  /** Send the user's decisions as an `approval` frame (the approval gate). */
  onApprove: (
    goalId: string,
    correlationId: string,
    decisions: ApprovalDecision[],
  ) => void;
}

export function ChatView({ messages, onSendGoal, onApprove }: ChatViewProps) {
  const [input, setInput] = useState("");
  const transcriptRef = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) {
      return;
    }
    onSendGoal(trimmed);
    setInput("");
  };

  return (
    <section className="chat-view">
      <ol className="transcript" ref={transcriptRef}>
        {messages.length === 0 ? (
          <li className="empty-state">
            Ask GoalFlow for a week of family dinners.
          </li>
        ) : null}
        {messages.map((entry, index) => (
          <li key={index} className={`transcript-entry transcript-entry--${entry.kind}`}>
            {entry.kind === "user" ? (
              <div className="bubble bubble--user">{entry.text}</div>
            ) : (
              <AgentMessage entry={entry} onApprove={onApprove} />
            )}
          </li>
        ))}
      </ol>
      <form className="input-row" onSubmit={submit}>
        <input
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="e.g. help my family eat healthier this week and reduce food waste"
        />
        <MicButton disabled />
        <button type="submit" disabled={!input.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}

interface AgentMessageProps {
  entry: Extract<ChatEntry, { kind: "agent" }>;
  onApprove: ChatViewProps["onApprove"];
}

function AgentMessage({ entry, onApprove }: AgentMessageProps) {
  const { message } = entry;

  switch (message.type) {
    case "present_plan":
      return (
        <PlanCard
          plan={message}
          onDecide={(decisions) => onApprove(message.goal_id, message.correlation_id, decisions)}
        />
      );
    case "status":
      return <div className="bubble bubble--agent">{message.payload.note}</div>;
    case "hello_ack":
      return (
        <div className="bubble bubble--agent">
          Connected as {message.role} session {message.session_id}
        </div>
      );
    case "proposal":
      return (
        <div className="bubble bubble--agent">
          New adaptation proposal received: {message.payload.detail}
        </div>
      );
  }
}
