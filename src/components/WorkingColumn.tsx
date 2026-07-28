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
import type { AgentStreamEntry, HarnessState, RailPhase } from "../types/ui";
import {
  PLANNING_MESSAGES,
  PLANNING_ROTATE_MS,
  buildTranscript,
  statusForPhase,
} from "../lib/reasoning";

/** `monitor_adapt` is a BOARD engine — it never fires during goal creation. */
const ENGINES = HARNESS_PIPELINE.filter((e) => e.id !== "monitor_adapt");

export interface WorkingColumnProps {
  harness: HarnessState;
  entries: AgentStreamEntry[];
  working: boolean;
  phase: RailPhase | null;
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
  phase,
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

  const transcript = buildTranscript(entries);
  const showFocus = !compact && (working || active !== null);

  /**
   * Which engine holds the focus card. Normally the active one — but between beats
   * there is no active engine at all (the device resolves one and lights the next a
   * beat later, and the render floor widens that gap deliberately). Handing the card to
   * the next unresolved engine keeps it on screen through those gaps: without this the
   * column loses its only variable-height element for a second and everything below it
   * jumps. `pending` marks that borrowed state so it doesn't claim to be working.
   */
  const focusId =
    active ??
    (showFocus ? ENGINES.find((e) => harness.engines[e.id].status === "idle")?.id ?? null : null);
  const pending = active === null;
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

  // Planning is one silent ~60-90s call — rotate a line so the card isn't frozen.
  const planning = phase === "planning" && working;
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
                <i className={pending ? "run-dot run-dot--ghost" : "run-dot run-dot--live"} aria-hidden />
                <article className={pending ? "focus focus--pending" : "focus"}>
                  <header className="focus__head">
                    <span className="focus__tile" aria-hidden>
                      {engine.glyph}
                    </span>
                    <span className="focus__names">
                      <strong className="focus__name">{engine.label}</strong>
                      <span className="focus__sub">
                        {pending ? "up next" : "working"}
                        {!pending && startedAt !== null
                          ? ` · ${((now - startedAt) / 1000).toFixed(1)}s`
                          : ""}
                      </span>
                    </span>
                    {cell.grade ? <span className="focus__grade">{cell.grade}</span> : null}
                  </header>

                  {cell.note ? <p className="focus__note">{cell.note}</p> : null}

                  <div className="focus__body" ref={bodyRef} aria-live="polite" aria-label="Reasoning">
                    {transcript ? (
                      <>
                        {transcript}
                        <span className="focus__caret" aria-hidden />
                      </>
                    ) : (
                      <span className="focus__waiting">
                        {planning
                          ? PLANNING_MESSAGES[rotation % PLANNING_MESSAGES.length]
                          : statusForPhase(phase, working)}
                      </span>
                    )}
                  </div>

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
