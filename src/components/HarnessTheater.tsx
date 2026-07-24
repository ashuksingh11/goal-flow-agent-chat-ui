import { Fragment } from "react";
import { HARNESS_PIPELINE } from "../types/ui";
import type { HarnessState } from "../types/ui";

/**
 * v5 — the PRESENTER THEATER (design Frame 2). A full-bleed, projection-scale view of the
 * harness pipeline for showing on stage: a big engine strip that lights up left-to-right,
 * and a "NOW RUNNING" hero card for whichever engine currently holds the spotlight. Same
 * `HarnessState` the inline pipeline uses — this is just the big, bold presentation of it.
 *
 * Shown only in presenter mode while the agent is working; `monitor_adapt` is a board
 * engine and omitted from the create-time strip.
 */
const ENGINES = HARNESS_PIPELINE.filter((e) => e.id !== "monitor_adapt");

/** Trim the long labels so they fit under the big strip nodes. */
function shortLabel(label: string): string {
  return label.replace(" Engine", "").replace(" Policy", " Policy").replace(" Manager", "");
}

export function HarnessTheater({ harness, goalText }: { harness: HarnessState; goalText: string }) {
  const active = harness.activeModule;
  const activeCell = active ? harness.engines[active] : null;
  const activeMeta = active ? ENGINES.find((e) => e.id === active) ?? null : null;
  const allDone = ENGINES.every((e) => {
    const s = harness.engines[e.id].status;
    return s === "done" || s === "blocked";
  });

  return (
    <section className="theater" aria-label="Harness theater">
      <div className="theater__top">
        <div className="theater__eyebrow">GoalFlow · live harness</div>
        {goalText ? <div className="theater__goal">{goalText}</div> : null}
      </div>

      <div className="theater__strip">
        {ENGINES.map((e, i) => {
          const cell = harness.engines[e.id];
          const prevDone = i > 0 && harness.engines[ENGINES[i - 1].id].status !== "idle";
          return (
            <Fragment key={e.id}>
              {i > 0 ? <span className={`theater__wire${prevDone ? " theater__wire--lit" : ""}`} /> : null}
              <div className={`theater-node theater-node--${cell.status}`}>
                <span className="theater-node__tile" aria-hidden>
                  {cell.status === "done" ? "✓" : e.glyph}
                </span>
                <span className="theater-node__label">{shortLabel(e.label)}</span>
              </div>
            </Fragment>
          );
        })}
      </div>

      {active && activeCell && activeMeta ? (
        <div className="theater__hero">
          <div className="theater__now">
            <i className="theater__nowdot" aria-hidden />
            NOW RUNNING
          </div>
          <div className="theater__heroname">
            <span className="theater__heroglyph" aria-hidden>
              {activeMeta.glyph}
            </span>
            {activeMeta.label}
          </div>
          {activeCell.note ? <div className="theater__heronote">{activeCell.note}</div> : null}
          {activeCell.grade ? <span className="theater__grade">{activeCell.grade}</span> : null}
        </div>
      ) : (
        <div className="theater__hero theater__hero--rest">
          {allDone ? "Plan ready — every engine cleared ✓" : "Warming up the harness…"}
        </div>
      )}

      <div className="theater__foot">Every action the agent proposes passes through these harness gates — live, on-device.</div>
    </section>
  );
}
