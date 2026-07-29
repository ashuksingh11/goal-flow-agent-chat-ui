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
import { PLANNING_MESSAGES, PLANNING_ROTATE_MS, buildTranscript, lastSentence } from "../lib/reasoning";

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
  const transcript = buildTranscript(entries, active ?? undefined);
  const fullTranscript = buildTranscript(entries);
  const settling = !harness.settled; // beats still draining, or the settle window is open
  // `working` goes false the moment present_plan lands, which is BEFORE the last beats have
  // been read — the settle window keeps the card alive on its own, or Approval (always the
  // last engine) is torn down within a frame of resolving.
  const showFocus = !compact && (working || active !== null || settling);

  // Planning is one silent ~60-90s call — rotate a line so the card isn't frozen.
  const planning = active === "planner" && working;
  const [rotation, setRotation] = useState(0);
  useEffect(() => {
    if (!planning) {
      setRotation(0);
      return;
    }
    const id = window.setInterval(() => setRotation((r) => r + 1), PLANNING_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [planning]);

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
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (runStartedAt === null || !showFocus) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [runStartedAt, showFocus]);

  // The transcript follows its own tail as it streams (only when opened).
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [fullTranscript]);

  const live = planning
    ? PLANNING_MESSAGES[rotation % PLANNING_MESSAGES.length]
    : lastSentence(transcript);

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
              {working ? "Composing your plan…" : "Wrapping up…"}
            </h2>
            {runStartedAt !== null ? (
              <span className="focus__elapsed">{Math.round((now - runStartedAt) / 1000)}s</span>
            ) : null}
          </header>

          {activeMeta ? (
            <p className="focus__phase">
              <strong>{activeMeta.label}</strong>
              {activeCell?.note ? <span> · {activeCell.note}</span> : null}
            </p>
          ) : null}

          {live ? (
            <p className="focus__live" aria-live="polite">
              <i className="focus__livedot" aria-hidden />
              {live}
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

          <details className="focus__details">
            <summary className="focus__summary">Show details</summary>
            <div className="focus__drawer">
              <div className="focus__transcript" ref={bodyRef} aria-label="Reasoning">
                {fullTranscript ? (
                  <>
                    {fullTranscript}
                    {working ? <span className="focus__caret" aria-hidden /> : null}
                  </>
                ) : (
                  <span className="focus__empty">
                    The agent's thinking will appear here as it works.
                  </span>
                )}
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
    </section>
  );
}
