/**
 * AdaptationCard — the prominent "caught a change" moment.
 *
 * Rendered when a `proposal` frame (task_status:"adapting") streams in:
 * a card that slides in with an accent glow — deliberately louder than the
 * quiet sustain ticks around it ("four quiet days, one smart Wednesday").
 *
 * Anatomy: trigger line ("Caught: <payload.trigger>") → proposed action
 * (payload.action + detail) → tier-weighted Adapt/Keep actions (firm renders
 * heavy, same treatment as ProposalList).
 *
 * SKELETON — render/motion is TODO (`card-enter` + glow keyframes).
 */

import type { Proposal } from "../types/contract";
import type { ProposalDecisionStatus } from "../types/ui";

export interface AdaptationCardProps {
  proposal: Proposal;
  status?: ProposalDecisionStatus;
  onDecide: (approved: boolean) => void;
}

export function AdaptationCard({ proposal, status, onDecide }: AdaptationCardProps) {
  const { payload } = proposal;

  return (
    <article
      className={`adaptation-card adaptation-card--${payload.tier}`}
      aria-label="Plan adaptation"
    >
      <p className="adaptation-card__trigger">
        <span className="eyebrow">Caught a change</span>
        {payload.trigger}
      </p>
      <p className="adaptation-card__action">{payload.action}</p>
      <p className="adaptation-card__detail">{payload.detail}</p>
      {payload.requires_approval && !status ? (
        <div className="adaptation-card__actions">
          <button type="button" className="button--firm" onClick={() => onDecide(true)}>
            Adapt
          </button>
          <button type="button" className="button--ghost" onClick={() => onDecide(false)}>
            Keep plan
          </button>
        </div>
      ) : null}
      {/* TODO(M-impl): pending/done states from `status`; entrance glow animation */}
    </article>
  );
}
