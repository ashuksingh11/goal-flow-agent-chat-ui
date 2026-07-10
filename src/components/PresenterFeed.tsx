/**
 * PresenterFeed — the "Show agent flow" side panel (presenter mode).
 *
 * Carried over from v1, refined for v2: every raw WS frame with direction
 * (▲ sent / ▼ recv), its `type`, and a terse human label. agent_event frames
 * are collapsed by default (they're high-volume) with a per-kind count;
 * expanding shows event kind + seq. Off by default → clean demo UX.
 *
 * SKELETON — labeling map is final; collapse/virtualize behavior is TODO.
 */

import type { FlowFrame } from "../types/ui";

export interface PresenterFeedProps {
  frames: FlowFrame[];
}

function describeFrame(frame: FlowFrame): string {
  const { message } = frame;
  switch (message.type) {
    case "hello":
      return "UI → cloud handshake";
    case "hello_ack":
      return `session ${message.session_id}`;
    case "capabilities":
      return `${message.modules.length} modules advertised`;
    case "user_goal":
      return "goal → cloud";
    case "agent_event":
      return `${message.event} · seq ${message.seq}`;
    case "present_plan":
      return `plan · ${message.payload.plan.length} items · ${message.payload.proposals.length} proposals`;
    case "proposal":
      return `adapting · ${message.payload.trigger}`;
    case "approval":
      return `${message.payload.decisions.length} decision(s) → cloud`;
    case "control":
      return `${message.command} → cloud`;
    case "status":
      return `${message.task_status}${message.payload.material ? " · material" : ""}`;
  }
}

export function PresenterFeed({ frames }: PresenterFeedProps) {
  return (
    <aside className="presenter-feed" aria-label="Live WebSocket frame feed">
      <div className="presenter-feed__header">
        <span className="eyebrow">WS frames</span>
        <strong>{frames.length}</strong>
      </div>
      <ol className="presenter-feed__list">
        {frames.map((frame) => (
          <li key={frame.id} className={`feed-frame feed-frame--${frame.direction}`}>
            <span aria-hidden="true">{frame.direction === "sent" ? "▲" : "▼"}</span>
            <strong>{frame.message.type}</strong>
            <p>{describeFrame(frame)}</p>
          </li>
        ))}
      </ol>
      {/* TODO(M-impl): collapse agent_event bursts; auto-scroll pinned to tail */}
    </aside>
  );
}
