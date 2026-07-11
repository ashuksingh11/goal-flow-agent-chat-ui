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
 */

import type { Proposal } from "../types/contract";
import type { ProposalDecisionStatus } from "../types/ui";
import { TIER_META } from "../types/ui";

export interface AdaptationCardProps {
  proposal: Proposal;
  status?: ProposalDecisionStatus;
  onDecide: (approved: boolean) => void;
}

export function AdaptationCard({ proposal, status, onDecide }: AdaptationCardProps) {
  const { payload } = proposal;
  const meta = TIER_META[payload.tier];
  const confirmed = status?.state === "done";
  const pending = status?.state === "pending";

  return (
    <article
      className={`adaptation-card adaptation-card--${payload.tier} adaptation-card--${status?.state ?? "open"}`}
      aria-label="Plan adaptation"
    >
      <div className="adaptation-card__trigger">
        <span className="eyebrow">Caught a change</span>
        <p>{payload.trigger}</p>
      </div>
      <span className="adaptation-card__tier">{meta.label}</span>
      <p className="adaptation-card__action">{payload.action}</p>
      <p className="adaptation-card__detail">{payload.detail}</p>
      {payload.patch ? (
        <ul className="adaptation-card__patch" aria-label="Proposed plan change">
          {payload.patch.upsert.map((row) => (
            <li key={row.id} className="adaptation-card__patch-row adaptation-card__patch-row--upsert">
              <span className="adaptation-card__patch-mark">→</span>
              <span>
                <strong>{row.title}</strong>
                {row.detail ? ` — ${row.detail}` : ""}
              </span>
            </li>
          ))}
          {payload.patch.remove.map((id) => (
            <li key={id} className="adaptation-card__patch-row adaptation-card__patch-row--remove">
              <span className="adaptation-card__patch-mark">✕</span>
              <span>Remove {id}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {payload.requires_approval && !status ? (
        <div className="adaptation-card__actions">
          <button
            type="button"
            className={payload.tier === "firm" ? "button--firm" : "button--light"}
            onClick={() => onDecide(true)}
          >
            Adapt
          </button>
          <button type="button" className="button--ghost" onClick={() => onDecide(false)}>
            Decline
          </button>
        </div>
      ) : null}
      {pending ? <p className="adaptation-card__state">Waiting for confirmation</p> : null}
      {confirmed ? (
        <p className="adaptation-card__state">
          {status.approved ? "Adapted ✓" : "Declined"}
          {status.detail ? ` - ${status.detail}` : ""}
        </p>
      ) : null}
    </article>
  );
}
