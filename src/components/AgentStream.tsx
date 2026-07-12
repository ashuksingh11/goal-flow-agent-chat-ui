/**
 * AgentStream — the clean live status while the device works.
 *
 * Renders the reduced agent_event stream (types/ui.ts AgentStreamEntry):
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
import type { RailPhase } from "../types/ui";

export interface AgentStreamProps {
  entries: AgentStreamEntry[];
  /** True while the device is still working (drives caret + running chips). */
  active: boolean;
  phase: RailPhase | null;
  planPending?: boolean;
}

const PHASE_STATUS: Record<RailPhase, string> = {
  interpreting: "Understanding your goal...",
  grounding: "Checking your pantry, calendar, and preferences...",
  confirming: "Confirming the details...",
  planning: "Composing your week...",
  checking: "Running the safety check...",
  awaiting_approval: "Preparing your review...",
  monitoring: "Watching for changes...",
};

function statusForPhase(phase: RailPhase | null, active: boolean): string {
  if (!active) return "Ready for review";
  return phase ? PHASE_STATUS[phase] : "Setting up the task...";
}

export function AgentStream({ entries, active, phase, planPending = false }: AgentStreamProps) {
  const chips = entries
    .filter((entry): entry is Extract<AgentStreamEntry, { kind: "chip" }> => entry.kind === "chip")
    .slice(-10);
  const status = statusForPhase(phase, active);

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

      <div className={active ? "agent-status agent-status--active" : "agent-status"}>
        <span className="agent-status__spinner" aria-hidden="true" />
        <p className="agent-status__text">{status}</p>
      </div>
      {planPending ? (
        <p className="agent-status__helper">This takes a few seconds...</p>
      ) : null}

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
