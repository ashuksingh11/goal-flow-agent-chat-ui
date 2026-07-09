/**
 * ChatView — the M1 chat surface.
 *
 * Renders the transcript (user goals, agent status notes, and PlanCards for
 * each present_plan) plus the input row (text field + send + MicButton).
 */

import { FormEvent, useEffect, useRef, useState } from "react";
import type { ApprovalDecision, UiInboundMessage } from "../types/contract";
import type { ProposalStatusMap } from "../types/ui";
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
  proposalStatuses: ProposalStatusMap;
}

export function ChatView({ messages, onSendGoal, onApprove, proposalStatuses }: ChatViewProps) {
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
              <AgentMessage
                entry={entry}
                onApprove={onApprove}
                proposalStatuses={proposalStatuses}
              />
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
  proposalStatuses: ProposalStatusMap;
}

function AgentMessage({ entry, onApprove, proposalStatuses }: AgentMessageProps) {
  const { message } = entry;

  switch (message.type) {
    case "present_plan":
      return (
        <PlanCard
          plan={message}
          onDecide={(decisions) => onApprove(message.goal_id, message.correlation_id, decisions)}
          proposalStatuses={proposalStatuses}
        />
      );
    case "status":
      return <StatusBubble message={message} />;
    case "hello_ack":
      return (
        <div className="bubble bubble--agent">
          Connected as {message.role} session {message.session_id}
        </div>
      );
    case "proposal":
      return (
        <AdaptationCard
          message={message}
          onDecide={(approved) =>
            onApprove(message.goal_id, message.correlation_id, [
              { proposal_id: message.payload.proposal_id, approved },
            ])
          }
          status={proposalStatuses[message.payload.proposal_id]}
        />
      );
  }
}

function StatusBubble({ message }: { message: Extract<UiInboundMessage, { type: "status" }> }) {
  const executed = message.payload.executed ?? [];
  const fallback = message.payload.note || `Status: ${message.task_status}`;
  const dateLabel = formatStatusDate(message.payload.day, message.payload.sim_date);
  const isMaterial = message.payload.material === true || executed.length > 0;

  return (
    <div
      className={
        isMaterial
          ? "bubble bubble--agent status-bubble status-bubble--material"
          : "bubble bubble--agent status-bubble status-bubble--quiet"
      }
    >
      <div className="status-bubble__topline">
        <span>{dateLabel || formatTaskStatus(message.task_status)}</span>
        <strong>{isMaterial ? "updated" : "on track"}</strong>
      </div>
      {message.payload.note ? <p>{message.payload.note}</p> : null}
      {executed.length > 0 ? (
        <ul>
          {executed.map((item) => (
            <li key={`${item.proposal_id}-${item.action}`}>
              {item.detail || item.result || formatAction(item.action)}
            </li>
          ))}
        </ul>
      ) : message.payload.note ? null : (
        <p>{fallback}</p>
      )}
    </div>
  );
}

function AdaptationCard({
  message,
  onDecide,
  status,
}: {
  message: Extract<UiInboundMessage, { type: "proposal" }>;
  onDecide: (approved: boolean) => void;
  status: ProposalStatusMap[string] | undefined;
}) {
  const decisionSent = Boolean(status);

  return (
    <article className="adaptation-card">
      <div className="adaptation-card__header">
        <div>
          <p className="eyebrow">Adaptation</p>
          <h2>Schedule change caught</h2>
        </div>
        <span className="adaptation-chip">Judgment needed</span>
      </div>
      <div className="adaptation-trigger">
        <span>Trigger</span>
        <strong>{message.payload.trigger}</strong>
      </div>
      <p>{message.payload.detail}</p>
      <div className="adaptation-meta">
        Proposed action: <strong>{formatAction(message.payload.action)}</strong>
      </div>
      <div className="plan-actions">
        <button type="button" onClick={() => onDecide(true)} disabled={decisionSent}>
          {status?.approved ? "Adapt sent" : "Adapt"}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => onDecide(false)}
          disabled={decisionSent}
        >
          {status && !status.approved ? "Declined" : "Decline"}
        </button>
      </div>
      {status ? (
        <p
          className={`adaptation-status adaptation-status--${
            status.approved ? status.state : "declined"
          }`}
        >
          {formatAdaptationStatus(status)}
        </p>
      ) : null}
    </article>
  );
}

function formatAction(action: string) {
  return action.replaceAll("_", " ");
}

function formatStatusDate(day?: string, simDate?: string) {
  const date = formatSimDate(simDate);
  if (day && date) {
    return `${day} ${date}`;
  }
  return day || date;
}

function formatSimDate(value?: string) {
  if (!value) {
    return "";
  }

  const [, month, day] = value.match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? [];
  return month && day ? `${month}-${day}` : value;
}

function formatTaskStatus(status: string) {
  return status.replaceAll("_", " ");
}

function formatAdaptationStatus(status: ProposalStatusMap[string]) {
  if (!status.approved) {
    return "Adaptation declined.";
  }
  if (status.state === "pending") {
    return "Approval sent. Waiting for execution confirmation.";
  }
  return status.detail || "Adaptation executed.";
}
