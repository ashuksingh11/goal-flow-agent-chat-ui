/**
 * ProgressRail — the horizontal phase rail: Interpreting → Grounding →
 * Confirm → Planning → Checking → Approval → Monitoring.
 *
 * Driven by `agent_event {event:"phase"}` frames plus task_status on
 * present_plan/status (see railPhaseFromStatus). The current phase pulses
 * (`rail-pulse` keyframe); completed phases render a check; the connector
 * fills left-to-right as phases complete. Future phases keep their slot but
 * render transparent until the monotonic phase reaches them.
 *
 */

import { useRef } from "react";
import type { CSSProperties } from "react";
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
  const currentOrder = phase === null ? -1 : RAIL_PHASES.findIndex((p) => p.id === phase);
  const reachedRef = useRef<Set<RailPhase>>(
    new Set(RAIL_PHASES.slice(0, currentOrder + 1).map((step) => step.id)),
  );
  if (phase === null && reachedRef.current.size > 0) {
    reachedRef.current.clear();
  }

  return (
    <nav
      className={phase === null ? "progress-rail progress-rail--idle" : "progress-rail"}
      aria-label="Agent progress"
    >
      {RAIL_PHASES.map((step, index) => {
        const state = stepState(step.id, phase);
        const reached = state !== "todo";
        const entering = reached && !reachedRef.current.has(step.id);
        if (entering) reachedRef.current.add(step.id);
        const connectorDone = index < currentOrder;
        return (
          <div
            key={step.id}
            className={`rail-step rail-step--${state} rail-step--${step.agent}${
              entering ? " rail-step--enter" : ""
            }`}
            style={{ "--i": index } as CSSProperties}
          >
            <span className="rail-marker">
              <span className="rail-dot" aria-hidden="true">
                {state === "done" ? "✓" : null}
              </span>
              <span className="rail-label">{step.label}</span>
            </span>
            {index < RAIL_PHASES.length - 1 ? (
              <span
                className={
                  connectorDone
                    ? "rail-connector rail-connector--done"
                    : "rail-connector"
                }
                aria-hidden="true"
              />
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
