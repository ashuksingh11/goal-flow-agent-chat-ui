/**
 * The reasoning transcript — shared by whatever surface is currently showing the
 * agent thinking out loud.
 *
 * Lifted out of the old AgentStream component when v5.1 moved the transcript INSIDE
 * the running engine's focus card (see WorkingColumn): the text-shaping rules are the
 * same wherever it renders, the chrome around it is not.
 */

import type { AgentStreamEntry, RailPhase } from "../types/ui";

/** The one-line "what is it doing" status, per rail phase. */
export const PHASE_STATUS: Record<RailPhase, string> = {
  interpreting: "Understanding your goal…",
  grounding: "Checking your pantry, calendar, and preferences…",
  confirming: "Confirming the details…",
  planning: "Composing your plan…",
  checking: "Running the safety check…",
  awaiting_approval: "Preparing your review…",
  monitoring: "Watching for changes…",
};

/**
 * While `phase === "planning"` the device makes a single ~60-90s NON-STREAMING LLM
 * call — no incremental frames arrive, so a static line reads as frozen. Rotate a
 * reassuring message so the stage visibly progresses.
 */
export const PLANNING_MESSAGES = [
  "Composing your plan…",
  "Balancing the week's shape…",
  "Checking budget & constraints…",
  "Finalizing…",
];

export const PLANNING_ROTATE_MS = 3000;

export function statusForPhase(phase: RailPhase | null, active: boolean): string {
  if (!active) return "Ready for review";
  return phase ? PHASE_STATUS[phase] : "Setting up the task…";
}

/**
 * The full live reasoning transcript — every prose `thinking` fragment the device
 * streamed, in order, concatenated and lightly cleaned (JSON blobs are already dropped
 * in the reducer). This is the real "watch it think": the device streams the model's
 * output chunk by chunk and it renders as one growing block rather than a single
 * truncated latest line.
 */
export function buildTranscript(entries: AgentStreamEntry[]): string {
  return entries
    .filter((e): e is Extract<AgentStreamEntry, { kind: "thinking" }> => e.kind === "thinking")
    .map((e) => e.text)
    .join("")
    .replace(/[ \t]+\n/g, "\n") // trailing spaces before newlines
    .replace(/\n{3,}/g, "\n\n") // collapse big gaps
    .trim();
}

/** The most recent complete sentence — the one-line summary shown when collapsed. */
export function lastSentence(transcript: string): string {
  const trimmed = transcript.trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/(?<=[.!?])\s+/);
  return parts[parts.length - 1] ?? trimmed;
}
