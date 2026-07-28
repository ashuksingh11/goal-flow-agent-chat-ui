/**
 * WorkingColumn — the run, as one column (v5.1, Pencil "Option E").
 *
 * Replaces the old side-by-side pipeline + reasoning panel. There is exactly ONE thing
 * in focus at a time; everything above it is a receipt, everything below is a ghost,
 * and all of it hangs off a single spine:
 *
 *   ✓ Pre-Check Engine        intent clear      0.3s   ← receipt (resolved, permanent)
 *   ✓ Grounding               12 facts          6.1s
 *   ● Safety Policy Engine ─────────────────────────┐  ← focus card, and the live
 *     │ transcript + the tool calls it is making    │    transcript lives INSIDE it
 *   ○ Task Manager            queued                    ← ghost (not yet run)
 *
 * Two properties fall out of this shape:
 *
 * 1. IT CANNOT SCROLL. Height is conserved — each engine that resolves adds a fixed
 *    receipt row and the focus card (the only variable-height element) gives back
 *    exactly that much. The column's total height is invariant from first beat to last.
 *
 * 2. THE TAIL STOPS FLASHING PAST. Safety / Task Manager / Approval resolve in the same
 *    millisecond they light up (their real work happens earlier in the run), and in the
 *    old row-per-engine panel that was a blink. Here a 12ms engine still leaves a
 *    permanent receipt line carrying its verdict. The render floor in types/ui.ts is
 *    now polish rather than the only thing making those engines visible.
 *
 * The transcript belongs to the engine that produced it — proximity is the label, so
 * nobody has to work out which engine "said" this.
 */

import { useEffect, useRef, useState } from "react";

import { HARNESS_PIPELINE, formatEngineMs } from "../types/ui";
import type { AgentStreamEntry, HarnessState } from "../types/ui";
import { PLANNING_MESSAGES, PLANNING_ROTATE_MS, buildTranscript } from "../lib/reasoning";

/** `monitor_adapt` is a BOARD engine — it never fires during goal creation. */
const ENGINES = HARNESS_PIPELINE.filter((e) => e.id !== "monitor_adapt");

export interface WorkingColumnProps {
  harness: HarnessState;
  entries: AgentStreamEntry[];
  working: boolean;
  /**
   * The run is over and the plan is the hero: drop the focus card and keep the
   * receipts. The column shrinks, the outcome below grows — height still conserved.
   */
  compact?: boolean;
}

export function WorkingColumn({
  harness,
  entries,
  working,
  compact = false,
}: WorkingColumnProps) {
  const active = harness.activeModule;
  const activeCell = active ? harness.engines[active] : null;

  const chips = entries.filter(
    (e): e is Extract<AgentStreamEntry, { kind: "chip" }> => e.kind === "chip",
  );
  const cleared = ENGINES.filter((e) => {
    const s = harness.engines[e.id].status;
    return s === "done" || s === "blocked";
  }).length;

  // Per-engine, so a card never shows another engine's words.
  const transcript = buildTranscript(entries, active ?? undefined);
  const settling = !harness.settled; // beats still draining, or the settle window is open
  // `working` goes false the moment present_plan lands, which is BEFORE the last beats
  // have been read — so the settle window has to keep the card alive on its own, or
  // Approval (always the last engine) is torn down within a frame of resolving.
  const showFocus = !compact && (working || active !== null || settling);

  /**
   * Which engine holds the focus card. Normally the active one — but between beats
   * there is no active engine at all (the device resolves one and lights the next a
   * beat later, and the render floor widens that gap deliberately). Handing the card to
   * the next unresolved engine keeps it on screen through those gaps: without this the
   * column loses its only variable-height element for a second and everything below it
   * jumps. `pending` marks that borrowed state so it doesn't claim to be working.
   */
  const lastFired =
    [...ENGINES].reverse().find((e) => harness.engines[e.id].status !== "idle")?.id ?? null;
  const focusId = !showFocus
    ? null
    : (active ??
      ENGINES.find((e) => harness.engines[e.id].status === "idle")?.id ??
      // Everything has resolved: the LAST engine keeps the card through the settle window
      // rather than having it yanked the millisecond it finishes. Approval is always the
      // one this happens to, and measured at 57 ms it was effectively never seen.
      (settling ? lastFired : null));
  /** How the card is being held: by its own running engine, ahead of it, or after it. */
  const focusHold: "working" | "pending" | "settled" =
    focusId === null || focusId === active
      ? "working"
      : harness.engines[focusId].status === "idle"
        ? "pending"
        : "settled";
  const pending = focusHold !== "working";
  /**
   * Whether a focus card will actually render. It is the column's only stretchy
   * element, so with no card there is nothing to absorb slack — the column has to stop
   * claiming the space and hand it to the outcome below. (Without this the run kept its
   * full height while the plan was landing, leaving ~800px of white under the receipts.)
   */
  const hasFocus = showFocus && focusId !== null;

  // The transcript follows its own tail as it streams.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [transcript]);

  // Planning is one silent ~60-90s call — rotate a line so the card isn't frozen. Keyed
  // to the ENGINE holding the card, not to `phase`: phase frames are not paced, so by the
  // time Grounding is painted the phase has usually moved to planning and the card would
  // caption Grounding with the planner's words.
  const planning = focusId === "planner" && working;
  const [rotation, setRotation] = useState(0);
  useEffect(() => {
    if (!planning) {
      setRotation(0);
      return;
    }
    const id = window.setInterval(() => setRotation((r) => r + 1), PLANNING_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [planning]);

  // The focus card's own live clock, off the beat's ARRIVAL time (types/ui.ts stamps it
  // on the wire, not at paint, so this is the device's real elapsed — not our floor).
  const startedAt = activeCell?.startedAt ?? null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [startedAt]);

  return (
    <section className={hasFocus ? "run" : "run run--compact"} aria-label="Harness run">
      <header className="run__head">
        <span className="run__eyebrow">THE HARNESS, RUNNING</span>
        <span className="run__meta">
          {cleared} of {ENGINES.length} engines
          {chips.length > 0 ? ` · ${chips.length} tool calls` : ""}
        </span>
      </header>

      <ol className="run__list">
        {ENGINES.map((engine) => {
          const cell = harness.engines[engine.id];

          if (cell.status === "done" || cell.status === "blocked") {
            const blocked = cell.status === "blocked";
            const ms = formatEngineMs(cell.ms);
            return (
              <li key={engine.id} className={`run-row run-row--${blocked ? "blocked" : "done"}`}>
                <i className="run-dot" aria-hidden>
                  {blocked ? "!" : "✓"}
                </i>
                <span className="run-row__name">{engine.label}</span>
                <span className="run-row__verdict">{cell.verdict ?? (blocked ? "blocked" : "done")}</span>
                {/* No duration rather than a dishonest 0.0s — see HARNESS_MIN_TIMED_MS. */}
                <span className="run-row__ms">{ms ?? ""}</span>
              </li>
            );
          }

          if (engine.id === focusId && showFocus) {
            return (
              <li key={engine.id} className="run-row run-row--focus">
                <i
                  className={
                    focusHold === "working"
                      ? "run-dot run-dot--live"
                      : focusHold === "settled"
                        ? "run-dot"
                        : "run-dot run-dot--ghost"
                  }
                  aria-hidden
                >
                  {focusHold === "settled" ? "✓" : null}
                </i>
                <article
                  className={
                    focusHold === "working"
                      ? "focus"
                      : focusHold === "settled"
                        ? "focus focus--settled"
                        : "focus focus--pending"
                  }
                >
                  <header className="focus__head">
                    <span className="focus__tile" aria-hidden>
                      {engine.glyph}
                    </span>
                    <span className="focus__names">
                      <strong className="focus__name">{engine.label}</strong>
                      <span className="focus__sub">
                        {focusHold === "pending"
                          ? "up next"
                          : focusHold === "settled"
                            ? (cell.verdict ?? "done")
                            : "working"}
                        {focusHold === "working" && startedAt !== null
                          ? ` · ${((now - startedAt) / 1000).toFixed(1)}s`
                          : ""}
                      </span>
                    </span>
                    {cell.grade ? <span className="focus__grade">{cell.grade}</span> : null}
                  </header>

                  {cell.note ? <p className="focus__note">{cell.note}</p> : null}

                  {/* The phase frame is NOT paced, so while the card is only borrowed by
                      the next engine the phase has usually already moved on — showing its
                      status here would caption a queued engine with the next one's work.
                      Borrowed card: transcript only, no status. */}
                  {transcript || !pending ? (
                    <div className="focus__body" ref={bodyRef} aria-live="polite" aria-label="Reasoning">
                      {transcript ? (
                        <>
                          {transcript}
                          <span className="focus__caret" aria-hidden />
                        </>
                      ) : planning ? (
                        <span className="focus__waiting">
                          {PLANNING_MESSAGES[rotation % PLANNING_MESSAGES.length]}
                        </span>
                      ) : (
                        // No transcript from this engine: its own note (rendered above)
                        // already says what it is doing. A phase-derived line here would
                        // describe a different engine's work.
                        <span className="focus__waiting">{cell.note ? "" : "working…"}</span>
                      )}
                    </div>
                  ) : null}

                  {chips.length > 0 ? (
                    <div className="focus__calls" aria-label="Capability calls">
                      {chips.slice(-3).map((chip) => (
                        <span key={chip.id} className={`call call--${chip.state}`} title={chip.summary}>
                          <span aria-hidden>{chip.state === "done" ? "✓" : "…"}</span>
                          {chip.module} · {chip.fn}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </article>
              </li>
            );
          }

          return (
            <li key={engine.id} className="run-row run-row--ghost">
              <i className="run-dot run-dot--ghost" aria-hidden />
              <span className="run-row__name">{engine.label}</span>
              <span className="run-row__verdict">{cell.status === "active" ? "working…" : "queued"}</span>
              <span className="run-row__ms" />
            </li>
          );
        })}
      </ol>
    </section>
  );
}
