/**
 * PresenterFeed — the "Show agent flow" side panel (presenter mode).
 *
 * Carried over from v1, refined for v2: every raw WS frame with direction
 * (▲ sent / ▼ recv), its `type`, and a terse human label. agent_event frames
 * are collapsed by default (they're high-volume) with a per-kind count;
 * expanding shows event kind + seq. Off by default → clean demo UX.
 *
 */

import type { FlowFrame } from "../types/ui";

export interface PresenterFeedProps {
  frames: FlowFrame[];
}

type FeedRow =
  | { kind: "frame"; frame: FlowFrame }
  | {
      kind: "burst";
      id: number;
      direction: FlowFrame["direction"];
      count: number;
      event: string;
      firstSeq: number;
      lastSeq: number;
    };

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

function compactFrames(frames: FlowFrame[]): FeedRow[] {
  const rows: FeedRow[] = [];
  for (const frame of frames) {
    const message = frame.message;
    const last = rows[rows.length - 1];
    if (
      message.type === "agent_event" &&
      message.event === "thinking" &&
      last?.kind === "burst" &&
      last.direction === frame.direction &&
      last.event === message.event
    ) {
      rows[rows.length - 1] = {
        ...last,
        count: last.count + 1,
        lastSeq: message.seq,
      };
      continue;
    }

    if (message.type === "agent_event" && message.event === "thinking") {
      rows.push({
        kind: "burst",
        id: frame.id,
        direction: frame.direction,
        count: 1,
        event: message.event,
        firstSeq: message.seq,
        lastSeq: message.seq,
      });
      continue;
    }

    rows.push({ kind: "frame", frame });
  }
  return rows;
}

export function PresenterFeed({ frames }: PresenterFeedProps) {
  const rows = compactFrames(frames);

  return (
    <aside className="presenter-feed" aria-label="Live WebSocket frame feed">
      <div className="presenter-feed__header">
        <span className="eyebrow">WS frames</span>
        <strong>{frames.length}</strong>
      </div>
      <ol className="presenter-feed__list">
        {rows.map((row) => {
          if (row.kind === "burst") {
            return (
              <li key={`burst-${row.id}`} className={`feed-frame feed-frame--${row.direction}`}>
                <span aria-hidden="true">{row.direction === "sent" ? "▲" : "▼"}</span>
                <strong>agent_event</strong>
                <p>
                  {row.event} burst · {row.count} frame{row.count === 1 ? "" : "s"} · seq{" "}
                  {row.firstSeq}-{row.lastSeq}
                </p>
              </li>
            );
          }
          return (
            <li
              key={row.frame.id}
              className={`feed-frame feed-frame--${row.frame.direction}`}
            >
              <span aria-hidden="true">{row.frame.direction === "sent" ? "▲" : "▼"}</span>
              <strong>{row.frame.message.type}</strong>
              <p>{describeFrame(row.frame)}</p>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
