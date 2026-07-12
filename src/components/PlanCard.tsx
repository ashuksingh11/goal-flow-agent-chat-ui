/**
 * PlanCard — the plan HERO. On present_plan it animates in (`card-enter`)
 * and owns the stage.
 *
 * DOMAIN-AGNOSTIC by construction: renders generic PlanItem rows
 * (title / detail / optional when / why bullets / tag pills) — the same
 * component carries meal days, guest-prep timeline steps, chores, anything.
 * No meal-specific fields anywhere.
 *
 * Anatomy (top to bottom):
 * 1. "Knew:" line   — payload.knew rendered as compact key:value chips; the
 *                     credibility line ("evidence of understanding").
 * 2. Safety chip    — payload.safety: green "Safety ✓ passed" or red
 *                     "blocked" with violations ("LLM plans, code checks").
 * 3. Plan items     — staggered entrance, one row per PlanItem; `when`
 *                     renders as a relative/short local time, tags as pills.
 * 4. Impact badges  — payload.impact [{label, value}] as stat pills.
 * 5. ProposalList   — the tiered approvals (child component).
 * Explanation stays one collapsed line ("why this plan") — MINIMAL TEXT.
 *
 */

import { useEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import type { ApprovalDecision, PresentPlan } from "../types/contract";
import type { ProposalStatusMap } from "../types/ui";
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
  // Defensive: only render primitives / string lists — never a raw object
  // (that would crash React). Objects/empties collapse to "".
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
  const changedImpact = useMemo(
    () => new Set(changedImpactLabels),
    [changedImpactLabels],
  );
  const firstChangedId = changedIds[0];
  const changedRowRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    if (morphSeq === 0 || !changedRowRef.current) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    changedRowRef.current.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "center",
    });
  }, [morphSeq]);

  return (
    <article className="plan-card" aria-label="Proposed plan">
      {payload.knew ? (
        <p className="plan-card__knew">
          <span className="eyebrow">Knew</span>
          {Object.entries(payload.knew)
            .map(([key, value]) => [key, knewValue(value)] as const)
            .filter(([, text]) => text !== "")
            .map(([key, text]) => (
              <span key={key} className="knew-chip">
                <strong>{key}</strong> {text}
              </span>
            ))}
        </p>
      ) : null}

      <div className="plan-card__meta">
        <span
          className={`safety-chip safety-chip--${payload.safety.gate}`}
          title={payload.safety.violations.join(", ")}
        >
          Safety {payload.safety.gate === "passed" ? "✓ passed" : "blocked"}
        </span>
        {payload.explanation ? (
          <details className="plan-explanation">
            <summary>Why this plan</summary>
            <p>{payload.explanation}</p>
          </details>
        ) : null}
      </div>

      <ol className="plan-items">
        {payload.plan.map((item, index) => {
          const isChanged = changed.has(item.id);
          const morph = morphs[item.id];
          const day = item.day || index + 1;

          return (
            <li
              key={`${item.id}:${isChanged ? morphSeq : 0}`}
              ref={firstChangedId === item.id ? changedRowRef : undefined}
              className={isChanged ? "plan-item plan-item--morph" : "plan-item"}
              style={{ "--i": index } as CSSProperties}
            >
              <div className="plan-item__topline">
                <div className="plan-item__title-stack">
                  {/* Explicit "Cancelled → New" framing: the labels carry the
                      story even when old and new titles are near-identical,
                      and the cancelled line PERSISTS after the morph settles. */}
                  {morph ? (
                    <span className="plan-item__old-line">
                      <span className="plan-item__old-label">Cancelled</span>
                      <s className="plan-item__old">{morph.prevTitle}</s>
                    </span>
                  ) : null}
                  <strong className={morph ? "plan-item__title plan-item__title--in" : "plan-item__title"}>
                    {morph ? <span className="plan-item__new-label">New</span> : null}
                    {item.title}
                  </strong>
                </div>
                {isChanged ? (
                  <span className="plan-item__updated-badge">Updated</span>
                ) : null}
                <span className="plan-item__when">Day {day}</span>
              </div>
              <span className={morph ? "plan-item__detail plan-item__detail--in" : "plan-item__detail"}>
                {item.detail}
              </span>
              <div className="plan-item__footer">
                {item.why.length > 0 ? (
                  <details className="why-popover">
                    <summary>{item.why[0]}</summary>
                    {item.why.length > 1 ? (
                      <ul>
                        {item.why.slice(1, 4).map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    ) : null}
                  </details>
                ) : null}
                {item.tags.length > 0 ? (
                  <div className="tag-row" aria-label="Tags">
                    {item.tags.slice(0, 4).map((tag) => (
                      <span key={tag} className="tag-chip">
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="impact-badges">
        {payload.impact.map((badge) => (
          <span
            key={`${badge.label}:${changedImpact.has(badge.label) ? morphSeq : 0}`}
            className={changedImpact.has(badge.label) ? "impact-badge impact-badge--tick" : "impact-badge"}
          >
            <strong>{badge.value}</strong> {badge.label}
          </span>
        ))}
      </div>

      <ProposalList
        proposals={payload.proposals}
        statuses={proposalStatuses}
        onDecide={onDecide}
      />
    </article>
  );
}
