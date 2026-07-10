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
 * SKELETON — entry shapes and states are final; render/motion is TODO.
 */

import type { AgentStreamEntry } from "../types/ui";

export interface AgentStreamProps {
  entries: AgentStreamEntry[];
  /** True while the device is still working (drives caret + running chips). */
  active: boolean;
}

export function AgentStream({ entries, active }: AgentStreamProps) {
  return (
    <section
      className={active ? "agent-stream agent-stream--active" : "agent-stream"}
      aria-label="Agent activity"
      aria-live="polite"
    >
      {entries.map((entry) =>
        entry.kind === "thinking" ? (
          <p key={entry.id} className="thinking-line">
            {entry.text}
            {/* TODO(M-impl): blinking caret on the LAST thinking line while active */}
          </p>
        ) : (
          <span
            key={entry.id}
            className={`tool-chip tool-chip--${entry.state}`}
            title={entry.summary}
          >
            <span className="tool-chip__name">
              {entry.module}.{entry.fn}
            </span>
            <span className="tool-chip__status" aria-hidden="true">
              {entry.state === "done" ? "✓" : "…"}
            </span>
            {/* TODO(M-impl): reveal entry.summary inline on done (slide-open) */}
          </span>
        ),
      )}
    </section>
  );
}
