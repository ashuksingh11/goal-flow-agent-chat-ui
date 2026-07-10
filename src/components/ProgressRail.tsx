/**
 * ProgressRail — the horizontal phase rail: Interpreting → Grounding →
 * Planning → Checking → Approval → Monitoring.
 *
 * Driven by `agent_event {event:"phase"}` frames plus task_status on
 * present_plan/status (see railPhaseFromStatus). The current phase pulses
 * (`rail-pulse` keyframe); completed phases render a check; the connector
 * fills left-to-right as phases complete.
 *
 * SKELETON — structure + states are final; motion polish is TODO.
 */

import { RAIL_PHASES } from "../types/ui";
import type { RailPhase } from "../types/ui";

export interface ProgressRailProps {
  /** Current phase; null before the first goal (rail renders dimmed/idle). */
  phase: RailPhase | null;
}

type StepState = "done" | "active" | "todo";

function stepState(step: RailPhase, current: RailPhase | null): StepState {
  if (current === null) {
    return "todo";
  }
  const order = RAIL_PHASES.findIndex((p) => p.id === step);
  const currentOrder = RAIL_PHASES.findIndex((p) => p.id === current);
  if (order < currentOrder) return "done";
  if (order === currentOrder) return "active";
  return "todo";
}

export function ProgressRail({ phase }: ProgressRailProps) {
  return (
    <nav className="progress-rail" aria-label="Agent progress">
      {RAIL_PHASES.map((step, index) => {
        const state = stepState(step.id, phase);
        return (
          <div key={step.id} className={`rail-step rail-step--${state}`}>
            {index > 0 ? <span className="rail-connector" aria-hidden="true" /> : null}
            <span className="rail-dot" aria-hidden="true">
              {/* TODO(M-impl): check icon when done, pulsing core when active */}
            </span>
            <span className="rail-label">{step.label}</span>
          </div>
        );
      })}
    </nav>
  );
}
