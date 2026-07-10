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

import type { CSSProperties } from "react";
import type { ApprovalDecision, PresentPlan } from "../types/contract";
import type { ProposalStatusMap } from "../types/ui";
import { ProposalList } from "./ProposalList";

export interface PlanCardProps {
  plan: PresentPlan;
  proposalStatuses: ProposalStatusMap;
  onDecide: (decisions: ApprovalDecision[]) => void;
}

function formatWhen(when?: string): string | null {
  if (!when) return null;
  const date = new Date(when);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function knewValue(value: unknown): string {
  // Defensive: only render primitives / string lists — never a raw object
  // (that would crash React). Objects/empties collapse to "".
  if (Array.isArray(value)) return value.slice(0, 3).map(String).join(", ");
  if (value == null || typeof value === "object") return "";
  return String(value);
}

export function PlanCard({ plan, proposalStatuses, onDecide }: PlanCardProps) {
  const { payload } = plan;

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
        {payload.plan.map((item, index) => (
          <li
            key={item.id}
            className="plan-item"
            style={{ "--i": index } as CSSProperties}
          >
            <div className="plan-item__topline">
              <strong className="plan-item__title">{item.title}</strong>
              {formatWhen(item.when) ? (
                <time className="plan-item__when" dateTime={item.when}>
                  {formatWhen(item.when)}
                </time>
              ) : null}
            </div>
            <span className="plan-item__detail">{item.detail}</span>
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
    </article>
  );
}
