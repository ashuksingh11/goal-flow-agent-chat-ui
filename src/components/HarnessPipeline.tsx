import { HARNESS_PIPELINE, HARNESS_LABEL } from "../types/ui";
import type { HarnessState } from "../types/ui";

/**
 * v5 — the HARNESS PIPELINE: one row per harness engine, lighting up in fire order as
 * the device works. This is the whole point of v5: the harness (the star of the system)
 * is finally *visible* — Pre-Check → Capability Manager → Grounding → Planner → Safety
 * Policy → Task Manager → Approval, the active one glowing, each with its live sub-line
 * and verdict. The reasoning transcript (AgentStream) sits beside it, slaved to whichever
 * engine currently holds the spotlight.
 *
 * `monitor_adapt` is deliberately omitted here — it fires on the BOARD during advance-day,
 * where the board's HarnessRibbon renders it; during goal creation it never runs.
 */
const CREATE_ENGINES = HARNESS_PIPELINE.filter((e) => e.id !== "monitor_adapt");

export function HarnessPipeline({ harness }: { harness: HarnessState }) {
  const activeLabel = harness.activeModule ? HARNESS_LABEL[harness.activeModule] : null;
  const done = CREATE_ENGINES.filter((e) => {
    const s = harness.engines[e.id].status;
    return s === "done" || s === "blocked";
  }).length;

  return (
    <section className="harness" aria-label="Harness pipeline">
      <header className="harness__head">
        <span className="harness__eyebrow">Harness pipeline</span>
        <span className="harness__live">
          <i className="harness__livedot" aria-hidden />
          {activeLabel ? `${activeLabel} working…` : `${done}/${CREATE_ENGINES.length} engines`}
        </span>
      </header>

      <ol className="harness__rows">
        {CREATE_ENGINES.map((e) => {
          const cell = harness.engines[e.id];
          return (
            <li key={e.id} className={`harness-row harness-row--${cell.status}`}>
              <span className="harness-row__glyph" aria-hidden>
                {e.glyph}
              </span>
              <span className="harness-row__body">
                <span className="harness-row__name">{e.label}</span>
                {cell.note ? <span className="harness-row__note">{cell.note}</span> : null}
              </span>
              <span className="harness-row__side">
                {cell.status === "active" ? (
                  <span className="harness-row__working">
                    <i className="harness-row__pulse" aria-hidden />
                    working…
                  </span>
                ) : cell.status === "blocked" ? (
                  <span className="harness-row__badge harness-row__badge--block">
                    {cell.verdict ?? "blocked"}
                  </span>
                ) : cell.status === "done" ? (
                  <span className="harness-row__badge harness-row__badge--done">
                    {cell.verdict ?? "done"}
                  </span>
                ) : (
                  <span className="harness-row__badge harness-row__badge--idle">queued</span>
                )}
                {cell.grade ? <span className="harness-row__grade">{cell.grade}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
