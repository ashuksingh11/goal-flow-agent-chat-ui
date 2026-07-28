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
 * Redact JSON the model interleaved with its prose.
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
    // A blob is REDACTED, not deleted. The device streams very little prose — one
    // narration burst at the top of grounding and then silence through the tool loop —
    // so the assembled context is most of what there is to see. Dropping it silently
    // left the card looking frozen, which reads as "the agent stopped thinking".
    // A marker naming what it gathered keeps the card alive and stays honest.
    if (end === -1) {
      out = appendMarker(out, "⟨context · still arriving…⟩");
      break; // unterminated: the rest is the blob, still streaming
    }
    out = appendMarker(out, describeBlob(text.slice(i, end)));
    // The marker already ends the line; swallow the newline the blob was followed by so
    // the redaction does not leave a blank line where the JSON used to be.
    i = end < text.length && text[end] === "\n" ? end + 1 : end;
  }
  return (
    out
      // Residue from a blob that began before this buffer did (e.g. after a reconnect):
      // a line starting with a quoted identifier-like key. Prose does not open a line
      // with `"snake_case":`.
      .replace(/^[\s,}\]]*"[A-Za-z_][\w]*"\s*:.*$/gm, "⟨context⟩")
      // Lines that are nothing but JSON punctuation left behind — taken out whole, so
      // they do not leave a blank line behind them. Requires at least one punctuation
      // character, so a genuine paragraph break is never eaten.
      .replace(/^[ \t]*[{}[\],][ \t{}[\],]*$\n?/gm, "")
      .replace(/[ \t]+$/gm, "")
      // One blob can leave several adjacent markers (its own, plus residue lines from
      // the same object). Keep the most informative and drop the rest — the reader
      // wants to know context WAS gathered, not how the parser saw it.
      .replace(/^(?:⟨context[^⟩]*⟩[ \t]*\n?)+/gm, (run) => {
        const best = run
          .trim()
          .split("\n")
          .reduce((a, b) => (b.length > a.length ? b : a));
        return run.endsWith("\n") ? `${best}\n` : best;
      })
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** Put a marker on its own line without inventing a blank one around it. */
function appendMarker(out: string, marker: string): string {
  const sep = out.length === 0 || out.endsWith("\n") ? "" : "\n";
  return `${out}${sep}${marker}\n`;
}

/**
 * One line standing in for a redacted blob, describing it from its own contents — the
 * top-level keys it carried, or how many entries. Nothing is inferred or invented; if it
 * will not parse (models emit near-JSON), the marker says only that context was gathered.
 */
function describeBlob(blob: string): string {
  try {
    const value: unknown = JSON.parse(blob);
    if (Array.isArray(value)) {
      return `⟨context · ${value.length} item${value.length === 1 ? "" : "s"}⟩`;
    }
    if (value && typeof value === "object") {
      const keys = Object.keys(value as Record<string, unknown>);
      if (keys.length === 0) return "⟨context⟩";
      const shown = keys.slice(0, 5).join(", ");
      return `⟨context · ${shown}${keys.length > 5 ? ", …" : ""}⟩`;
    }
  } catch {
    // near-JSON, or a fragment — fall through
  }
  return "⟨context⟩";
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
