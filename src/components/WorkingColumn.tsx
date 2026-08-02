/**
 * WorkingColumn — the run (v5.2 panel design, Pencil frame 2).
 *
 * Two parts, in this order:
 *
 *   ┌ Composing your plan…                              41s ┐   ← the focus card
 *   │ Grounding · assembling real-world context             │     (one live region)
 *   │ • finalizing the shortlist…                           │
 *   │ ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁                        │
 *   └ ⌄ Show details                                        ┘
 *
 *   PIPELINE                             3 of 7 engines cleared
 *   ✓ Pre-Check Engine                            intent clear
 *   ✓ Capability Manager                              18 tools
 *   ● Planner                                         working…
 *   ○ Safety Policy Engine                              queued
 *
 * Why this shape rather than v5.1's receipts-with-an-inline-focus-card: the pipeline is
 * the thing the demo exists to show, so it gets to be a stable, always-complete list —
 * seven rows from the first frame to the last, each one resolving in place. Nothing is
 * added or removed as the run proceeds, so the column's height is conserved by
 * construction and the tail engines (Safety / Task Manager / Approval, which resolve in
 * the same millisecond they light up — see types/ui.ts) leave a permanent verdict behind
 * instead of a blink.
 *
 * Colour carries state: GREEN = cleared, ACCENT = happening now, grey = not yet. Accent
 * appears exactly once per frame, on the engine currently working, which is the thing
 * worth watching.
 *
 * The transcript lives behind "Show details" — it is evidence, not the headline, and at
 * 60-90s of streaming it would otherwise dominate a panel whose job is to show progress.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { HARNESS_PIPELINE, formatEngineMs } from "../types/ui";
import type { AgentStreamEntry, HarnessState } from "../types/ui";
import {
  INTERPRETING_MESSAGES,
  PLANNING_MESSAGES,
  PLANNING_ROTATE_MS,
  buildTranscript,
  buildTranscriptBlocks,
  lastSentence,
  proseOnly,
  splitTranscriptText,
} from "../lib/reasoning";

/** `monitor_adapt` is a BOARD engine — it never fires during goal creation. */
const ENGINES = HARNESS_PIPELINE.filter((e) => e.id !== "monitor_adapt");

export interface WorkingColumnProps {
  harness: HarnessState;
  entries: AgentStreamEntry[];
  working: boolean;
  /**
   * The run is over and the plan is the hero: the pipeline folds into a single cleared
   * bar that can be opened again. The receipts stay reachable without competing with the
   * plan for the screen.
   */
  compact?: boolean;
}

/**
 * One line's worth of the tail, for the collapsed card.
 *
 * `lastSentence` splits on . ! ? — and the device's narration frequently has NO sentence
 * terminator at all (it separates steps with →), so it hands back the entire transcript.
 * That turned the peek into a second, full-height copy of the drawer's content. Fall back
 * to the last CLAUSE, and let the CSS ellipsis take it from there.
 */
function peek(text: string): string {
  // Markers never reach the one-liner: the collapsed card has room for one line, and
  // "⟨context⟩" spends it saying that something was hidden.
  const tail = lastSentence(proseOnly(text)).trim();
  if (tail.length <= 110) return tail;
  return tail.split(/\s*(?:→|;|\|)\s*/).filter(Boolean).pop() ?? tail;
}

/** A verdict that starts with a number ("18 tools") is a COUNT — a fact, not a judgement. */
function badgeTone(verdict: string): "count" | "good" {
  return /^\d/.test(verdict) ? "count" : "good";
}

export function WorkingColumn({
  harness,
  entries,
  working,
  compact = false,
}: WorkingColumnProps) {
  const active = harness.activeModule;
  const activeCell = active ? harness.engines[active] : null;
  const activeMeta = active ? ENGINES.find((e) => e.id === active) ?? null : null;

  const chips = entries.filter(
    (e): e is Extract<AgentStreamEntry, { kind: "chip" }> => e.kind === "chip",
  );
  const cleared = ENGINES.filter((e) => {
    const s = harness.engines[e.id].status;
    return s === "done" || s === "blocked";
  }).length;

  // Per-engine for the LIVE line, so the card never captions one engine with another's
  // words — but the whole run for "Show details", which is the record of the thinking and
  // must not reset every time the spotlight moves to the next engine.
  // Memoized for the same reason `blocks` is: this walks the whole transcript and
  // `stripJsonBlobs` scans it character by character, and the card re-renders on the run
  // clock. It was the one of the pair that never got the memo.
  const transcript = useMemo(() => buildTranscript(entries, active ?? undefined), [entries, active]);
  // Same reason. (The clock used to re-render this card ~10×/s; since v7.8 it only does so
  // when the displayed SECOND changes, but streaming chunks still rebuild both of these.)
  const blocks = useMemo(() => buildTranscriptBlocks(entries), [entries]);
  // Cheap identity for "has anything been added": the effect below only needs to know
  // that the text grew, not what it says.
  const transcriptSize = blocks.reduce((n, b) => n + b.text.length + b.steps.length, 0);
  // "Spoke" now means steps OR prose. Without the steps half, the planner — which since
  // v7 reports its work in steps and still never narrates — would keep claiming silence
  // directly above the three steps it had just reported.
  const activeSpoke =
    active !== null && blocks.some((b) => b.engine === active && (b.text !== "" || b.steps.length > 0));
  /** The newest step from whichever engine is live — the one-line peek when it has no prose. */
  const lastStep = blocks
    .filter((b) => active === null || b.engine === active)
    .flatMap((b) => b.steps)
    .at(-1);
  const settling = !harness.settled; // beats still draining, or the settle window is open
  // `working` goes false the moment present_plan lands, which is BEFORE the last beats have
  // been read — the settle window keeps the card alive on its own, or Approval (always the
  // last engine) is torn down within a frame of resolving.
  const showFocus = !compact && (working || active !== null || settling);

  /**
   * INTERPRETING (v7.4): the goal has arrived and the CLOUD is reading it, which happens
   * before the device is involved at all — so there is no active engine, no beat, no
   * transcript and nothing cleared. Every one of those is also true of a run that has
   * died, which is why this state has to name itself: for 10-60s the card otherwise sat
   * on "Composing your plan…" over an empty progress bar, describing a step that had not
   * started, and looking exactly like a hang.
   */
  const interpreting =
    working && active === null && cleared === 0 && entries.length === 0 && !settling;

  // Planning is one silent ~60-90s call, and interpretation is a silent 10-60s one —
  // rotate a line through both so the card is never frozen.
  const planning = active === "planner" && working;
  const rotating = planning || interpreting;
  const [rotation, setRotation] = useState(0);
  useEffect(() => {
    if (!rotating) {
      setRotation(0);
      return;
    }
    const id = window.setInterval(() => setRotation((r) => r + 1), PLANNING_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [rotating]);

  /**
   * Run elapsed, off the earliest beat ARRIVAL (types/ui.ts stamps it on the wire, not at
   * paint) — so this is the device's real elapsed, not our render floor. It is the run's
   * clock, not the engine's: it matches the "composed in Ns" the plan reports afterwards.
   */
  const runStartedAt = useMemo(() => {
    const stamps = ENGINES.map((e) => harness.engines[e.id].startedAt).filter(
      (t): t is number => typeof t === "number",
    );
    return stamps.length > 0 ? Math.min(...stamps) : null;
  }, [harness.engines]);
  /**
   * ELAPSED SECONDS, and it only re-renders when the SECOND changes.
   *
   * The interval still ticks at 100ms so the display never lags a boundary by more than
   * that — but it now stores the whole second, so nine ticks in ten are a no-op instead
   * of re-rendering the card. The card contains the transcript, and during grounding that
   * transcript is being rebuilt by streaming chunks at the same time; ten renders a second
   * on top of that is most of what "animating a lot" was.
   */
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (runStartedAt === null || !showFocus) return;
    const read = () => setElapsed(Math.round((Date.now() - runStartedAt) / 1000));
    read();
    const id = window.setInterval(read, 100);
    return () => window.clearInterval(id);
  }, [runStartedAt, showFocus]);

  /**
   * The transcript follows its own tail — WITHOUT animating, and only if the reader is
   * already at the tail.
   *
   * THE FLICKER. This used to run `scrollTo({behavior: "smooth"})` on every change of
   * `transcriptSize`, which during grounding means every streamed token chunk — dozens a
   * second. A smooth scroll takes a few hundred milliseconds, so each one was interrupted
   * and restarted from a new position long before it arrived: the drawer oscillated
   * instead of scrolling, which is what "flickering, mostly during grounding" is.
   *
   * A live log tail should not animate at all. It should stay pinned. So: instant, and
   * coalesced into one write per frame, so a burst of chunks moves the scroller once.
   *
   * And only when the reader is ALREADY within a line or two of the bottom — opening
   * "Show details" to read something and being yanked back down by the next chunk is the
   * same bug wearing a different face.
   */
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const NEAR_BOTTOM_PX = 48;
    const atTail = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
    if (!atTail) return;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      el.scrollTop = el.scrollHeight;
    });
  }, [transcriptSize]);
  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  // A real step beats a rotating placeholder: PLANNING_MESSAGES exists only because the
  // planner used to have nothing true to say for ~60-90s. It stays as the fallback for
  // the stretch before the first step lands.
  const live =
    peek(transcript) ||
    (lastStep ? (lastStep.detail ? `${lastStep.step} — ${lastStep.detail}` : lastStep.step) : "") ||
    (planning ? PLANNING_MESSAGES[rotation % PLANNING_MESSAGES.length] : "") ||
    (interpreting ? INTERPRETING_MESSAGES[rotation % INTERPRETING_MESSAGES.length] : "");
  // The drawer shows the same words in full — no reason to preview them at the same time.
  const [detailsOpen, setDetailsOpen] = useState(false);

  const pipeline = (
    <ol className="pipe__list">
      {ENGINES.map((engine) => {
        const cell = harness.engines[engine.id];
        const resolved = cell.status === "done" || cell.status === "blocked";
        const blocked = cell.status === "blocked";
        const state = blocked ? "blocked" : resolved ? "done" : cell.status === "active" ? "active" : "queued";
        const verdict = cell.verdict ?? (blocked ? "blocked" : "done");
        const ms = formatEngineMs(cell.ms);

        return (
          <li key={engine.id} className={`pipe-row pipe-row--${state}`}>
            <i className="pipe-dot" aria-hidden>
              {resolved ? (blocked ? "!" : "✓") : null}
            </i>
            <span className="pipe-row__name">{engine.label}</span>
            {resolved ? (
              <span className="pipe-row__end">
                {/* No duration rather than a dishonest 0.0s — see HARNESS_MIN_TIMED_MS. */}
                {ms ? <span className="pipe-row__ms">{ms}</span> : null}
                <span className={`pipe-badge pipe-badge--${blocked ? "blocked" : badgeTone(verdict)}`}>
                  {verdict}
                </span>
              </span>
            ) : state === "active" ? (
              <span className="pipe-row__working">
                <i className="pipe-row__pulse" aria-hidden />
                working…
              </span>
            ) : (
              <span className="pipe-row__queued">queued</span>
            )}
          </li>
        );
      })}
    </ol>
  );

  if (compact) {
    return (
      <section className="run run--compact" aria-label="Harness run">
        <details className="pipe-collapsed">
          <summary className="pipe-collapsed__bar">
            <i className="pipe-collapsed__mark" aria-hidden>
              ✓
            </i>
            <span className="pipe-collapsed__label">
              Pipeline · all {cleared} engines cleared
            </span>
            <span className="pipe-collapsed__chevron" aria-hidden />
          </summary>
          <div className="pipe pipe--inset">{pipeline}</div>
        </details>
      </section>
    );
  }

  return (
    <section className="run" aria-label="Harness run">
      {showFocus ? (
        <article className="focus">
          <header className="focus__head">
            <i className="focus__spinner" aria-hidden />
            <h2 className="focus__title">
              {interpreting ? "Reading your goal…" : working ? "Composing your plan…" : "Wrapping up…"}
            </h2>
            {runStartedAt !== null ? (
              <span className="focus__elapsed">{elapsed}s</span>
            ) : null}
          </header>

          {activeMeta ? (
            <p className="focus__phase">
              <strong>{activeMeta.label}</strong>
              {activeCell?.note ? <span> · {activeCell.note}</span> : null}
            </p>
          ) : null}

          {live && !detailsOpen ? (
            <p className="focus__live" aria-live="polite" title={live}>
              <i className="focus__livedot" aria-hidden />
              <span className="focus__livetext">{live}</span>
            </p>
          ) : null}

          <div
            className="focus__track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={ENGINES.length}
            aria-valuenow={cleared}
          >
            <span
              className="focus__fill"
              style={{ width: `${(cleared / ENGINES.length) * 100}%` }}
            />
          </div>

          <details
            className="focus__details"
            onToggle={(e) => setDetailsOpen((e.currentTarget as HTMLDetailsElement).open)}
          >
            <summary className="focus__summary">Show details</summary>
            <div className="focus__drawer">
              <div className="focus__transcript" ref={bodyRef} aria-label="Reasoning">
                {blocks.map((block, index) => (
                  <section key={`${block.engine ?? "unattributed"}:${index}`} className="focus__block">
                    <span className="panel-eyebrow focus__who">
                      {ENGINES.find((e) => e.id === block.engine)?.label ?? "Agent"}
                    </span>
                    {/* PROSE FIRST, steps under it. The narration is the engine SAYING
                        what it is about to do ("broke the goal into 8 steps: …") and the
                        steps are the receipt for it — printing the receipt above the
                        sentence that announces it reads backwards, and worse, it put the
                        steps of one engine directly under the previous engine's prose.
                        The caret still trails the prose, because that is what streams. */}
                    {/* Prose and REDACTIONS are different things and now look it. A blob
                        the model dumped mid-sentence used to be replaced by an
                        angle-bracket marker left inline in the paragraph, listing the
                        object's own field names — schema, in the middle of a sentence.
                        The fact worth keeping is that context was gathered; it gets a
                        row of its own and says so in words. */}
                    {splitTranscriptText(block.text).map((part, partIndex, parts) =>
                      part.kind === "context" ? (
                        <p key={`ctx-${partIndex}`} className="focus__ctx">
                          <i className="focus__ctx-mark" aria-hidden>
                            ▤
                          </i>
                          {part.label}
                        </p>
                      ) : (
                        <p key={`prose-${partIndex}`} className="focus__said">
                          {part.text}
                          {working &&
                          index === blocks.length - 1 &&
                          partIndex === parts.length - 1 &&
                          block.engine === active ? (
                            <span className="focus__caret" aria-hidden />
                          ) : null}
                        </p>
                      ),
                    )}
                    {block.steps.length > 0 ? (
                      <ol className="focus__steps">
                        {block.steps.map((s) => (
                          <li key={s.id} className={`focus__step focus__step--${s.tone}`}>
                            <span className="focus__step-mark" aria-hidden>
                              {s.tone === "notice" ? "!" : "✓"}
                            </span>
                            <span className="focus__step-body">
                              <strong className="focus__step-label">{s.step}</strong>
                              {s.detail ? <span className="focus__step-detail">{s.detail}</span> : null}
                            </span>
                          </li>
                        ))}
                      </ol>
                    ) : null}
                  </section>
                ))}
                {/* Silence is a fact about the engine, not a gap in the record — say so,
                    or an engine that never narrates reads as a transcript that got cut. */}
                {active !== null && !activeSpoke ? (
                  <p className="focus__silent">
                    <strong>{activeMeta?.label ?? "This engine"}</strong> ·{" "}
                    {active === "planner"
                      ? "composing in a single call — the model returns the finished plan rather than narrating its way there."
                      : "working without narration; it reports a verdict rather than its reasoning."}
                  </p>
                ) : null}
                {blocks.length === 0 && active === null ? (
                  <span className="focus__empty">
                    The agent's thinking will appear here as it works.
                  </span>
                ) : null}
              </div>
              <div className="focus__calls" aria-label="Capability calls">
                <span className="panel-eyebrow">
                  {chips.length > 0 ? `${chips.length} tool calls` : "No tool calls yet"}
                </span>
                {chips.slice(-12).map((chip) => (
                  <span key={chip.id} className={`call call--${chip.state}`} title={chip.summary}>
                    <span aria-hidden>{chip.state === "done" ? "✓ " : "… "}</span>
                    {chip.module} · {chip.fn}
                  </span>
                ))}
              </div>
            </div>
          </details>
        </article>
      ) : null}

      {/* The pipeline is the DEVICE's run, so it appears when the device has one.
          During interpretation it is seven grey rows all saying "queued" under a
          heading that counts nothing — a full screen of furniture below a card that
          is the only thing with news. Worse, it invites the reading that seven things
          are stuck, when the truth is that none of them has been asked to start. */}
      {interpreting ? null : (
        <section className="pipe" aria-label="Harness pipeline">
          <header className="pipe__head">
            <span className="panel-eyebrow">Pipeline</span>
            <span className="panel-meta">
              {cleared} of {ENGINES.length} engines cleared
              {chips.length > 0 ? ` · ${chips.length} tool calls` : ""}
            </span>
          </header>
          {pipeline}
        </section>
      )}
    </section>
  );
}
