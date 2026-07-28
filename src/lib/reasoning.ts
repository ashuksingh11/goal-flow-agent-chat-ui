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
 * Remove JSON the model interleaved with its prose.
 *
 * The grounding model narrates ("broke the goal into 7 steps: …") and then, in the same
 * stream, dumps the structured context it assembled. That blob is not a thought and must
 * not read as one.
 *
 * WHY THIS IS DONE ON THE WHOLE TEXT, NOT PER FRAME. The device streams the model token
 * chunk by token chunk, so a blob is spread across dozens of `thinking` frames. The old
 * defence tested each fragment for a leading `{` and dropped it — which deleted exactly
 * the chunks carrying the braces and kept everything between them, turning a JSON blob
 * into mangled pseudo-prose (`"time_window": "start": "2026-07-28",`). Filtering can only
 * work once the text is whole, which is here.
 *
 * The scan honours string literals, so a brace inside a quoted value cannot end a blob
 * early, and an unterminated blob (still arriving) is cut to the end.
 */
export function stripJsonBlobs(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch !== "{" && ch !== "[") {
      out += ch;
      i += 1;
      continue;
    }
    const end = scanBalanced(text, i);
    // Unterminated → the blob is still streaming; drop the rest and stop.
    if (end === -1) break;
    i = end;
  }
  return out
    // Residue from a blob that began before this buffer did (e.g. after a reconnect):
    // a line starting with a quoted identifier-like key. Prose does not open a line
    // with `"snake_case":`.
    .replace(/^[\s,}\]]*"[A-Za-z_][\w]*"\s*:.*$/gm, "")
    // Lines that are nothing but JSON punctuation left behind.
    .replace(/^[\s{}[\],]+$/gm, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Index just past the JSON value opening at `start`, or -1 if it never closes. */
function scanBalanced(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i += 1; // skip the escaped char
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * The full live reasoning transcript — every prose `thinking` fragment the device
 * streamed, in order, concatenated and cleaned. This is the real "watch it think": the
 * device streams the model's output chunk by chunk and it renders as one growing block
 * rather than a single truncated latest line.
 *
 * Fragments are accumulated VERBATIM by the reducer (the raw stream stays intact for the
 * presenter feed); the cleaning happens here, where the text is whole.
 */
export function buildTranscript(entries: AgentStreamEntry[]): string {
  return stripJsonBlobs(
    entries
      .filter((e): e is Extract<AgentStreamEntry, { kind: "thinking" }> => e.kind === "thinking")
      .map((e) => e.text)
      .join(""),
  );
}

/** The most recent complete sentence — the one-line summary shown when collapsed. */
export function lastSentence(transcript: string): string {
  const trimmed = transcript.trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/(?<=[.!?])\s+/);
  return parts[parts.length - 1] ?? trimmed;
}
