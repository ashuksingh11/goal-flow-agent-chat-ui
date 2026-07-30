/**
 * PlanCard — the plan, once it has landed (v5.2 panel design, Pencil frame 3).
 *
 * Anatomy, top to bottom:
 *   ✓ Plan ready · 7 steps · 5 constraints honoured   ← the arrival
 *   [Safety gate passed]  [Why this plan]              ← how it was checked
 *   allergens peanuts · dietary no_pork · …            ← what it knew (credibility)
 *   Mon, Jul 27  Chickpea Salad Bowl              ⌄    ← the plan itself, one row per
 *      detail + why + tags (the open row)                step, first row open
 *   [impact]                                            ← what it changes
 *   ProposalList                                        ← what happens when you save
 *
 * DOMAIN-AGNOSTIC by construction: generic PlanItem rows (title / detail / why / tags /
 * optional `when`) carry meal days, guest-prep steps, chores, anything. The left column is
 * the item's `when` if it has one and its step number if it does not — never a weekday for
 * a goal that has no days. No meal-specific field appears anywhere.
 *
 * Only one row is open at a time: this panel has one screen's worth of height and no page
 * scroll, so an accordion keeps the whole plan visible while still letting any single step
 * be read in full.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { ApprovalDecision, PresentPlan } from "../types/contract";
import type { ProposalStatusMap } from "../types/ui";
import { formatWhen } from "../lib/date";
import { ProposalList } from "./ProposalList";

type PlanMorph = { prevTitle: string; prevDetail?: string };

export interface PlanCardProps {
  plan: PresentPlan;
  /** Ids changed by the most recent approved daily adaptation — highlighted. */
  changedIds?: string[];
  /** Previous row copy captured before the adapted plan replaced it. */
  morphs?: Record<string, PlanMorph>;
  /** Sequence that bumps per adapted plan patch, replaying changed-row animations. */
  morphSeq?: number;
  /** Impact labels changed by the most recent adaptation. */
  changedImpactLabels?: string[];
  proposalStatuses: ProposalStatusMap;
  onDecide: (decisions: ApprovalDecision[]) => void;
}

export function knewValue(value: unknown): string {
  // Defensive: only render primitives / string lists — never a raw object (that would
  // crash React). Objects/empties collapse to "".
  if (Array.isArray(value)) return value.slice(0, 3).map(String).join(", ");
  if (value == null || typeof value === "object") return "";
  return String(value);
}

export function PlanCard({
  plan,
  changedIds = [],
  morphs = {},
  morphSeq = 0,
  changedImpactLabels = [],
  proposalStatuses,
  onDecide,
}: PlanCardProps) {
  const { payload } = plan;
  const changed = useMemo(() => new Set(changedIds), [changedIds]);
  const changedImpact = useMemo(() => new Set(changedImpactLabels), [changedImpactLabels]);
  const firstChangedId = changedIds[0];
  const changedRowRef = useRef<HTMLLIElement | null>(null);

  // The first step opens by default — the plan should be readable, not just listed.
  const [openId, setOpenId] = useState<string | null>(payload.plan[0]?.id ?? null);

  // An adaptation should open the row it changed: that is the row worth reading now.
  useEffect(() => {
    if (morphSeq === 0 || !firstChangedId) return;
    setOpenId(firstChangedId);
    if (!changedRowRef.current) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    changedRowRef.current.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "center",
    });
  }, [morphSeq, firstChangedId]);

  const knewChips = payload.knew
    ? Object.entries(payload.knew)
        .map(([key, value]) => [key, knewValue(value)] as const)
        .filter(([, text]) => text !== "")
    : [];
  const passed = payload.safety.gate === "passed";

  return (
    <article className="result-card" aria-label="Proposed plan">
      <header className="result__head">
        <i className={`result__mark result__mark--${passed ? "ok" : "blocked"}`} aria-hidden>
          {passed ? "✓" : "!"}
        </i>
        <div className="result__titles">
          <h2 className="result__title">{passed ? "Plan ready" : "Plan blocked"}</h2>
          <p className="result__sub">
            {payload.plan.length} step{payload.plan.length === 1 ? "" : "s"}
            {knewChips.length > 0 ? ` · ${knewChips.length} constraints honoured` : ""}
          </p>
        </div>
      </header>

      <div className="result__badges">
        <span
          className={`safety-pill safety-pill--${payload.safety.gate}`}
          title={payload.safety.violations.join(", ")}
        >
          {passed ? "✓ Safety gate passed" : `Blocked — ${payload.safety.violations.length} violation(s)`}
        </span>
        {payload.explanation ? (
          <details className="why-plan">
            <summary className="why-plan__summary">Why this plan</summary>
            <p className="why-plan__body">{payload.explanation}</p>
          </details>
        ) : null}
      </div>

      {knewChips.length > 0 ? (
        <p className="knew" aria-label="What it knew">
          {knewChips.map(([key, text]) => (
            <span key={key} className="knew__pair">
              <span className="knew__key">{key.replace(/[_-]+/g, " ")}</span>
              <strong className="knew__value">{text}</strong>
            </span>
          ))}
        </p>
      ) : null}

      <ol className="days">
        {payload.plan.map((item, index) => {
          const isChanged = changed.has(item.id);
          const morph = morphs[item.id];
          const open = openId === item.id;
          const when = formatWhen(item.when) ?? `${String(index + 1).padStart(2, "0")}`;

          return (
            <li
              key={`${item.id}:${isChanged ? morphSeq : 0}`}
              ref={firstChangedId === item.id ? changedRowRef : undefined}
              className={`day${open ? " day--open" : ""}${isChanged ? " day--morph" : ""}`}
            >
              <button
                type="button"
                className="day__row"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : item.id)}
              >
                <span className="day__when">{when}</span>
                <span className="day__titles">
                  {/* Explicit "Cancelled → New" framing: the labels carry the story even
                      when old and new titles are near-identical, and the cancelled line
                      PERSISTS after the morph settles. */}
                  {morph ? (
                    <span className="day__old">
                      <span className="day__oldlabel">Cancelled</span>
                      <s>{morph.prevTitle}</s>
                    </span>
                  ) : null}
                  <strong className="day__title">
                    {morph ? <span className="day__newlabel">New</span> : null}
                    {item.title}
                  </strong>
                  {/* v7: ALWAYS VISIBLE. `why` has ridden the wire since v2 and lived
                      inside a collapsed row nobody opens — which is where the one piece
                      of evidence that something reasoned about this day was kept. */}
                  {item.why.length > 0 ? (
                    <span className="day__why">
                      <span aria-hidden>↳ </span>
                      {item.why[0]}
                    </span>
                  ) : null}
                </span>
                {isChanged ? <span className="day__updated">Updated</span> : null}
                <i className="day__chevron" aria-hidden />
              </button>

              {/* Stays mounted: the collapse animates the grid row track, so opening and
                  closing is one interruptible transition instead of a mount. */}
              <div className="day__detail" aria-hidden={!open}>
                <div className="day__inner">
                  {item.detail ? <p className="day__body">{item.detail}</p> : null}
                  {item.why.length > 1 || item.tags.length > 0 ? (
                    <div className="day__tags">
                      {/* The FIRST why is on the row above now; anything further is
                          supporting detail and stays here. */}
                      {item.why.slice(1, 3).map((reason) => (
                        <span key={reason} className="tag tag--why">
                          {reason}
                        </span>
                      ))}
                      {item.tags.slice(0, 4).map((tag) => (
                        <span key={tag} className="tag">
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {/* v7 — WHAT IT THREW AWAY. A lookup table cannot reject, so this is the clearest
          evidence on the card that something weighed options. Model-authored and
          display-only; absent is normal and the block simply does not render. */}
      {payload.considered || (payload.rejected && payload.rejected.length > 0) ? (
        <section className="weighed" aria-label="What it considered">
          <p className="weighed__head">
            <span aria-hidden>🧠 </span>
            {payload.considered ? `${payload.considered} options considered` : "Options considered"}
            {payload.rejected && payload.rejected.length > 0
              ? ` · ${payload.rejected.length} rejected`
              : ""}
          </p>
          {payload.rejected && payload.rejected.length > 0 ? (
            <ul className="weighed__list">
              {payload.rejected.slice(0, 4).map((r) => (
                <li key={`${r.option}:${r.reason}`} className="weighed__item">
                  <s>{r.option}</s>
                  <span className="weighed__reason">{r.reason}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {payload.impact.length > 0 ? (
        <p className="impact" aria-label="Impact">
          {payload.impact.map((badge) => (
            <span
              key={`${badge.label}:${changedImpact.has(badge.label) ? morphSeq : 0}`}
              className={changedImpact.has(badge.label) ? "impact__item impact__item--tick" : "impact__item"}
            >
              <strong>{badge.value}</strong> {badge.label}
            </span>
          ))}
        </p>
      ) : null}

      <ProposalList
        proposals={payload.proposals}
        statuses={proposalStatuses}
        onDecide={onDecide}
      />
    </article>
  );
}
