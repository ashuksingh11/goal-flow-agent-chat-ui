/**
 * The reasoning transcript — shared by whatever surface is currently showing the
 * agent thinking out loud.
 *
 * Lifted out of the old AgentStream component when v5.1 moved the transcript INSIDE
 * the running engine's focus card (see WorkingColumn): the text-shaping rules are the
 * same wherever it renders, the chrome around it is not.
 */

import type { HarnessModule } from "../types/contract";
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

/**
 * The INTERPRETATION window (v7.4) — from "the goal arrived" to "here is what I heard".
 *
 * The cloud spends 10-60s on one LLM call here, and it is the least explicable wait in
 * the product: the user has just spoken, and nothing on the device has started yet, so
 * there are no engines to light up and no tool calls to show. Until v7.4 the webview was
 * not even open for it. These lines describe what is genuinely happening — reading the
 * goal, checking it against what this home can do — and none of them claims a step that
 * has not begun.
 */
export const INTERPRETING_MESSAGES = [
  "Reading your goal…",
  "Working out what you're asking for…",
  "Checking it against what this home can do…",
  "Almost there…",
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
      // Unterminated — and two very different situations look identical here. Either the
      // blob genuinely IS the tail (still streaming), or it was CUT OFF mid-flight and
      // prose follows it: the grounding stream hit its budget deadline, or a transient
      // provider error rolled the model history back (RunGroundingPassAsync) and the
      // retry narrated afresh. Breaking out in that second case discarded the entire
      // remainder of the run — the rest of grounding and every later engine with it, so
      // the transcript ended permanently at "⟨context · still arriving…⟩".
      const resume = resumeAfterBlob(text, i);
      if (resume === -1) {
        out = appendMarker(out, CONTEXT_STREAMING);
        break; // unterminated AND last: the rest really is the blob, still streaming
      }
      out = appendMarker(out, CONTEXT_PARTIAL);
      i = resume;
      continue;
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
      .replace(/^[\s,}\]]*"[A-Za-z_][\w]*"\s*:.*$/gm, CONTEXT_DONE)
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
 * One line standing in for a redacted blob.
 *
 * v8.1 — IT NO LONGER NAMES THE KEYS. It used to list the blob's top-level fields, which
 * produced things like
 *
 *     ⟨context · constraints, inventory, expiring_items_within_3_days, busy_evenings, …⟩
 *
 * sitting inside a paragraph of prose. Two problems, and the brackets were the smaller
 * one. Those keys are the schema of an internal JSON object — `expiring_items_within_3_days`
 * is a field name, not something a person looked at — so the more faithfully the marker
 * reported them, the more it read as debug output that had escaped into the product.
 *
 * What the reader needs at that moment is one fact: the agent assembled the world context.
 * That is what survives. The marker is now one of three fixed tokens, and
 * {@link splitTranscriptText} turns them into a rendered element rather than leaving
 * angle brackets in the middle of a sentence.
 */
function describeBlob(_blob: string): string {
  return CONTEXT_DONE;
}

/** The redaction tokens. Internal sentinels — never shown raw; see splitTranscriptText. */
const CONTEXT_DONE = "⟨context⟩";
const CONTEXT_PARTIAL = "⟨context · partial⟩";
const CONTEXT_STREAMING = "⟨context · still arriving…⟩";

/** What each token says to a person. */
const CONTEXT_LABEL: Record<string, string> = {
  [CONTEXT_DONE]: "world context assembled",
  [CONTEXT_PARTIAL]: "world context assembled — partial",
  [CONTEXT_STREAMING]: "assembling world context…",
};

/** True for a line that is only a redaction marker. */
function contextLabel(line: string): string | null {
  return CONTEXT_LABEL[line.trim()] ?? null;
}

/** A rendered piece of an engine's prose: its own words, or a redacted context marker. */
export type TranscriptPart =
  | { kind: "prose"; text: string }
  | { kind: "context"; label: string };

/**
 * Split cleaned prose into what the model SAID and where a blob was taken out.
 *
 * The parsing lives here with the rest of the text handling, so the component stays a
 * renderer: it receives "prose" and "context" and decides only how each one looks.
 * Markers always occupy a whole line (see appendMarker), which is what makes this a
 * line split rather than a second parser.
 */
export function splitTranscriptText(text: string): TranscriptPart[] {
  const parts: TranscriptPart[] = [];
  let prose: string[] = [];
  const flush = () => {
    const joined = prose.join("\n").trim();
    if (joined) parts.push({ kind: "prose", text: joined });
    prose = [];
  };
  for (const line of text.split("\n")) {
    const label = contextLabel(line);
    if (label === null) {
      prose.push(line);
      continue;
    }
    flush();
    // Consecutive markers collapse: two redactions in a row are one fact, said twice.
    if (parts[parts.length - 1]?.kind !== "context") {
      parts.push({ kind: "context", label });
    }
  }
  flush();
  return parts;
}

/** The prose alone — markers dropped. What the one-line peek should read from. */
export function proseOnly(text: string): string {
  return splitTranscriptText(text)
    .filter((p): p is Extract<TranscriptPart, { kind: "prose" }> => p.kind === "prose")
    .map((p) => p.text)
    .join("\n");
}

/**
 * Where prose picks up again after a blob that never closed — or -1 if it never does,
 * which is the one case where consuming to the end is right.
 *
 * A JSON region is recognisable line by line (structure characters, quoted keys, quoted
 * or numeric values); the first line that is none of those — or a blank line, which is
 * how a model separates a dump from what it says next — is where the reader's text
 * resumes. Line-granular by necessity: a blob that never closes has no other end.
 */
function resumeAfterBlob(text: string, start: number): number {
  // The blob's own first line holds the opening brace, so scanning starts at the next one.
  let br = text.indexOf("\n", start);
  while (br !== -1) {
    const lineStart = br + 1;
    const nextBr = text.indexOf("\n", lineStart);
    const line = text.slice(lineStart, nextBr === -1 ? text.length : nextBr);
    if (!continuesBlob(line)) return lineStart;
    br = nextBr;
  }
  return -1;
}

/** Whether a line still belongs to the JSON dump rather than to the narration. */
function continuesBlob(line: string): boolean {
  const t = line.trim();
  if (t === "") return false; // a paragraph break ends the dump
  if (/^[{}[\],]/.test(t)) return true;
  if (/^-?\d[\d.eE+-]*,?$/.test(t)) return true;
  if (/^(?:true|false|null),?$/.test(t)) return true;
  // A quoted key, or a line of quoted values — but NOT prose that merely opens with a
  // quotation mark (`"That's odd," it said`), which ends on a word rather than a quote.
  return t.startsWith('"') && (/"\s*:/.test(t) || /"[,\]}]?$/.test(t));
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
 * raw stream); the cleaning happens here, where the text is whole.
 */
export function buildTranscript(entries: AgentStreamEntry[], engine?: HarnessModule): string {
  const thinking = entries.filter(
    (e): e is Extract<AgentStreamEntry, { kind: "thinking" }> => e.kind === "thinking",
  );
  // Scoped to one engine when asked: the device only narrates during grounding, so showing
  // the whole stream in every card made the Planner and Safety cards repeat grounding's
  // text as if they had said it. Unattributed text (it arrived before any engine fired)
  // belongs to the first engine that did fire.
  const firstAttributed = thinking.find((e) => e.engine)?.engine ?? null;
  const scoped =
    engine === undefined
      ? thinking
      : thinking.filter((e) => e.engine === engine || (!e.engine && engine === firstAttributed));
  return stripJsonBlobs(scoped.map((e) => e.text).join(""));
}

export interface TranscriptStep {
  id: number;
  step: string;
  detail?: string;
  tone: "step" | "notice";
}

export interface TranscriptBlock {
  engine: HarnessModule | null;
  /** v7: the labelled steps this engine reported, in order. */
  steps: TranscriptStep[];
  /** The model's own prose, accumulated and cleaned. Often empty, which is fine. */
  text: string;
}

/**
 * The transcript split by the engine that produced it, in the order it arrived.
 *
 * The drawer used to render one fused block: every engine's words concatenated with no
 * separator, so grounding's last line ran straight into whatever came next and there was
 * no way to tell which engine had said anything. Blocks also make SILENCE legible — the
 * planner deliberately never narrates (GoalAgent.ComposeModelPlanAsync keeps the raw plan
 * JSON off the thinking channel), and an unlabelled transcript made that read as a clip.
 *
 * v7 SPLITS EACH BLOCK IN TWO. `steps` are the labelled beats the device reports and are
 * the reason the planner is no longer blank; `text` is the model's own voice. They are
 * kept apart because only the prose needs cleaning — see below.
 *
 * Cleaning is per block and only ever touches `text`: a JSON blob only ever appears
 * inside a model's own narration, so no blob is split across a block boundary and no
 * step is ever at the mercy of the blob heuristics.
 *
 * A block survives if it has EITHER steps or prose. Through v6 it survived only on prose,
 * which meant a grounding burst that was entirely JSON cleaned to "" and the whole block
 * vanished — the engine looked like it had said nothing when in fact it had said the most.
 */
export function buildTranscriptBlocks(entries: AgentStreamEntry[]): TranscriptBlock[] {
  const spoken = entries.filter(
    (e): e is Extract<AgentStreamEntry, { kind: "thinking" | "step" }> =>
      e.kind === "thinking" || e.kind === "step",
  );
  const firstAttributed = spoken.find((e) => e.engine)?.engine ?? null;
  const blocks: TranscriptBlock[] = [];
  for (const entry of spoken) {
    const engine = entry.engine ?? firstAttributed;
    let last = blocks[blocks.length - 1];
    if (!last || last.engine !== engine) {
      last = { engine, steps: [], text: "" };
      blocks.push(last);
    }
    if (entry.kind === "step") {
      last.steps.push({ id: entry.id, step: entry.step, detail: entry.detail, tone: entry.tone });
    } else {
      last.text += entry.text;
    }
  }
  return blocks
    .map((b) => ({ engine: b.engine, steps: b.steps, text: stripJsonBlobs(b.text) }))
    .filter((b) => b.steps.length > 0 || b.text !== "");
}

/** The most recent complete sentence — the one-line summary shown when collapsed. */
export function lastSentence(transcript: string): string {
  const trimmed = transcript.trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/(?<=[.!?])\s+/);
  return parts[parts.length - 1] ?? trimmed;
}
