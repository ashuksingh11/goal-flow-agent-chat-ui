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

import { useEffect, useRef, useState } from "react";

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

// While `phase === "planning"` the device makes a single ~60-90s NON-STREAMING LLM
// call — no incremental frames arrive, so a static line + spinner reads as frozen.
// Rotate a reassuring text-only message every ~3s so the stage visibly progresses.
const PLANNING_MESSAGES = [
  "Composing your plan…",
  "Balancing the week's meals…",
  "Checking budget & constraints…",
  "Finalizing…",
];
const PLANNING_ROTATE_MS = 3000;
const THOUGHT_MAX = 140;

function statusForPhase(phase: RailPhase | null, active: boolean): string {
  if (!active) return "Ready for review";
  return phase ? PHASE_STATUS[phase] : "Setting up the task...";
}

function truncate(text: string, max = THOUGHT_MAX): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** The latest PROSE thinking text (JSON blobs are dropped in the reducer already). */
function latestThought(entries: AgentStreamEntry[]): string {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.kind === "thinking" && entry.text.trim()) return entry.text;
  }
  return "";
}

export function AgentStream({ entries, active, phase, planPending = false }: AgentStreamProps) {
  const chips = entries
    .filter((entry): entry is Extract<AgentStreamEntry, { kind: "chip" }> => entry.kind === "chip")
    .slice(-10);
  const status = statusForPhase(phase, active);

  const thought = latestThought(entries);
  const isPlanning = phase === "planning" && active;
  // Grounding streams genuine prose thinking → show it live. Planning does NOT stream,
  // so any thinking entry visible during planning is stale grounding narration; ignore
  // it there and show the rotating planning indicator instead.
  const showThought = !isPlanning && thought.length > 0;
  const showPlanningIndicator = isPlanning;

  // Rotating message + elapsed-seconds counter — the only motion during the otherwise
  // silent planning call. Reset whenever we leave the planning indicator.
  const [rotation, setRotation] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const startedAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (!showPlanningIndicator) {
      startedAtRef.current = null;
      setRotation(0);
      setElapsed(0);
      return;
    }
    startedAtRef.current = Date.now();
    setElapsed(0);
    setRotation(0);
    const rotate = window.setInterval(() => setRotation((r) => r + 1), PLANNING_ROTATE_MS);
    const tick = window.setInterval(() => {
      if (startedAtRef.current != null) {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }
    }, 1000);
    return () => {
      window.clearInterval(rotate);
      window.clearInterval(tick);
    };
  }, [showPlanningIndicator]);

  const planningMessage = PLANNING_MESSAGES[rotation % PLANNING_MESSAGES.length];

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

      {showThought ? (
        <p className="agent-status__thought" aria-live="polite">
          {truncate(thought)}
        </p>
      ) : showPlanningIndicator ? (
        <p className="agent-status__thought agent-status__thought--planning" aria-live="polite">
          {planningMessage} · {elapsed}s
        </p>
      ) : planPending ? (
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
