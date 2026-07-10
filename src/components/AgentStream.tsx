/**
 * AgentStream — "watch it think": the live feed while the device works.
 *
 * Renders the reduced agent_event stream (types/ui.ts AgentStreamEntry):
 * - thinking entries: a soft, streaming reasoning line (typing caret while
 *   `active`; text arrives in fragments and appends — momentum, not prose).
 * - chip entries: tool-call CHIPS that pop in as the LLM calls capability
 *   functions — "Inventory.GetExpiringItems …" spins subtly while running,
 *   then flips to "✓ + summary" when the tool_result lands (`chip-pop` +
 *   state-flip transition).
 *
 * While `active` and the plan hasn't landed, the caller pairs this with
 * <Skeleton variant="plan-item" /> rows below (see App stage layout).
 *
 */

import type { AgentStreamEntry } from "../types/ui";

export interface AgentStreamProps {
  entries: AgentStreamEntry[];
  /** True while the device is still working (drives caret + running chips). */
  active: boolean;
}

export function AgentStream({ entries, active }: AgentStreamProps) {
  const latestThinking = [...entries]
    .reverse()
    .find((entry): entry is Extract<AgentStreamEntry, { kind: "thinking" }> => entry.kind === "thinking");
  const chips = entries
    .filter((entry): entry is Extract<AgentStreamEntry, { kind: "chip" }> => entry.kind === "chip")
    .slice(-10);

  return (
    <section
      className={active ? "agent-stream agent-stream--active" : "agent-stream"}
      aria-label="Agent activity"
      aria-live="polite"
    >
      <div className="agent-stream__header">
        <span className="agent-stream__pulse" aria-hidden="true" />
        <span>{active ? "Working" : "Ready for review"}</span>
      </div>

      {latestThinking ? (
        <p className="thinking-line">
          {/* Show only the tail — the reasoning model streams long blobs; a live
              ticker (last ~200 chars) reads as momentum, not a wall of JSON. */}
          {latestThinking.text.length > 200
            ? `…${latestThinking.text.slice(-200)}`
            : latestThinking.text}
          {active ? <span className="thinking-line__caret" aria-hidden="true" /> : null}
        </p>
      ) : (
        <p className="thinking-line thinking-line--empty">
          Setting up the task
          {active ? <span className="thinking-line__caret" aria-hidden="true" /> : null}
        </p>
      )}

      {chips.length > 0 ? (
        <div className="tool-chip-row" aria-label="Capability calls">
          {chips.map((entry) => (
          <span
            key={entry.id}
            className={`tool-chip tool-chip--${entry.state}`}
            title={entry.summary}
          >
            <span className="tool-chip__name">
              {entry.module} · {entry.fn}
            </span>
            <span className="tool-chip__status" aria-hidden="true">
              {entry.state === "done" ? "✓" : "…"}
            </span>
            {entry.state === "done" && entry.summary ? (
              <span className="tool-chip__summary">{entry.summary}</span>
            ) : null}
          </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
