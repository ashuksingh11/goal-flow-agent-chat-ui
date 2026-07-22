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

function statusForPhase(phase: RailPhase | null, active: boolean): string {
  if (!active) return "Ready for review";
  return phase ? PHASE_STATUS[phase] : "Setting up the task...";
}

/**
 * The full live reasoning transcript — every prose `thinking` fragment the device
 * streamed during grounding, in order, concatenated and lightly cleaned (JSON blobs
 * are already dropped in the reducer). This is the real "watch it think": the device
 * streams the model's grounding output token-chunk by token-chunk, and here it renders
 * as one growing, auto-scrolling block rather than a single truncated latest line.
 */
function buildTranscript(entries: AgentStreamEntry[]): string {
  return entries
    .filter((e): e is Extract<AgentStreamEntry, { kind: "thinking" }> => e.kind === "thinking")
    .map((e) => e.text)
    .join("")
    .replace(/[ \t]+\n/g, "\n") // trailing spaces before newlines
    .replace(/\n{3,}/g, "\n\n") // collapse big gaps
    .trim();
}

export function AgentStream({ entries, active, phase, planPending = false }: AgentStreamProps) {
  const chips = entries
    .filter((entry): entry is Extract<AgentStreamEntry, { kind: "chip" }> => entry.kind === "chip")
    .slice(-10);
  const status = statusForPhase(phase, active);

  const transcript = buildTranscript(entries);
  const showTranscript = transcript.length > 0;
  const isPlanning = phase === "planning" && active;
  // Planning does NOT stream (one ~60-90s call), so keep the rotating reassurance —
  // but the grounding transcript captured before it stays visible above.
  const showPlanningIndicator = isPlanning;

  // Auto-scroll the transcript to the newest fragment as it streams in.
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
  }, [transcript]);

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

      {showTranscript ? (
        <div className="agent-thoughts" ref={transcriptRef} aria-live="polite" aria-label="Reasoning">
          {transcript}
          {active ? <span className="agent-thoughts__caret" aria-hidden="true" /> : null}
        </div>
      ) : null}

      {showPlanningIndicator ? (
        <p className="agent-status__thought agent-status__thought--planning" aria-live="polite">
          {planningMessage} · {elapsed}s
        </p>
      ) : !showTranscript && planPending ? (
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
