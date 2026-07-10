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
 * SKELETON — structure + data mapping final; render/motion is TODO.
 */

import type { ApprovalDecision, PresentPlan } from "../types/contract";
import type { ProposalStatusMap } from "../types/ui";
import { ProposalList } from "./ProposalList";

export interface PlanCardProps {
  plan: PresentPlan;
  proposalStatuses: ProposalStatusMap;
  onDecide: (decisions: ApprovalDecision[]) => void;
}

export function PlanCard({ plan, proposalStatuses, onDecide }: PlanCardProps) {
  const { payload } = plan;

  return (
    <article className="plan-card" aria-label="Proposed plan">
      {payload.knew ? (
        <p className="plan-card__knew">
          <span className="eyebrow">Knew</span>
          {Object.entries(payload.knew).map(([key, value]) => (
            <span key={key} className="knew-chip">
              {key}: {Array.isArray(value) ? value.join(", ") : value}
            </span>
          ))}
        </p>
      ) : null}

      <span className={`safety-chip safety-chip--${payload.safety.gate}`}>
        Safety {payload.safety.gate === "passed" ? "✓" : "✕"}
        {/* TODO(M-impl): violations popover when blocked */}
      </span>

      <ol className="plan-items">
        {payload.plan.map((item) => (
          <li key={item.id} className="plan-item">
            <strong className="plan-item__title">{item.title}</strong>
            <span className="plan-item__detail">{item.detail}</span>
            {/* TODO(M-impl): item.when → short local time; item.why → hover/
                tap rationale bullets; item.tags → pills; staggered card-enter */}
          </li>
        ))}
      </ol>

      <div className="impact-badges">
        {payload.impact.map((badge) => (
          <span key={badge.label} className="impact-badge">
            <strong>{badge.value}</strong> {badge.label}
          </span>
        ))}
      </div>

      <ProposalList
        proposals={payload.proposals}
        statuses={proposalStatuses}
        onDecide={onDecide}
      />

      {/* TODO(M-impl): collapsed one-line payload.explanation ("Why this plan?") */}
    </article>
  );
}
