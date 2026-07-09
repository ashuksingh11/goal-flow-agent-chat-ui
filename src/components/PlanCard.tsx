/**
 * PlanCard — renders a present_plan payload.
 *
 * Shows: the Mon–Fri dinner plan (day, dish, "why" chips), the attached
 * proposals (e.g. shopping-list additions), the safety-gate result, and
 * Approve / Decline controls that emit ApprovalDecision[] upward.
 *
 * Reminder: proposals are proposals, not actions — the device executes
 * nothing until the approval round-trips through the cloud.
 */

import type { ApprovalDecision, PresentPlan } from "../types/contract";

export interface PlanCardProps {
  plan: PresentPlan;
  /** Emit the user's decisions for this plan's proposals (approval gate). */
  onDecide: (decisions: ApprovalDecision[]) => void;
}

export function PlanCard({ plan, onDecide }: PlanCardProps) {
  const proposals = plan.payload.proposals;
  const safetyPassed =
    plan.payload.safety.gate === "passed" && plan.payload.safety.hard_violations.length === 0;

  const decideAll = (approved: boolean) => {
    onDecide(
      proposals.map((proposal) => ({
        proposal_id: proposal.proposal_id,
        approved,
      })),
    );
  };

  return (
    <article className="plan-card">
      <div className="plan-card__header">
        <div>
          <p className="eyebrow">Weekly plan</p>
          <h2>Dinners for this week</h2>
        </div>
        <span className={`safety-chip ${safetyPassed ? "safety-chip--passed" : "safety-chip--blocked"}`}>
          Safety: {plan.payload.safety.gate} {safetyPassed ? "✓" : "!"}
        </span>
      </div>

      {plan.payload.safety.hard_violations.length > 0 ? (
        <div className="safety-warning">
          Hard violations: {plan.payload.safety.hard_violations.join(", ")}
        </div>
      ) : null}

      <div className="plan-list">
        {plan.payload.plan.map((item) => (
          <section className="plan-day" key={`${item.day}-${item.dish}`}>
            <div className="plan-day__date">{item.day}</div>
            <div>
              <h3>{item.dish}</h3>
              <div className="tag-row">
                {item.why.map((reason) => (
                  <span className="why-tag" key={reason}>
                    {reason}
                  </span>
                ))}
              </div>
            </div>
          </section>
        ))}
      </div>

      {proposals.length > 0 ? (
        <div className="proposal-section">
          <h3>Proposals</h3>
          <ul className="proposal-list">
            {proposals.map((proposal) => (
              <li key={proposal.proposal_id}>
                <div>
                  <strong>{formatAction(proposal.action)}:</strong>{" "}
                  {proposal.items.join(", ")}
                </div>
                <p>{proposal.reason}</p>
              </li>
            ))}
          </ul>
          <div className="plan-actions">
            <button type="button" onClick={() => decideAll(true)}>
              Approve
            </button>
            <button type="button" className="secondary-button" onClick={() => decideAll(false)}>
              Decline
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function formatAction(action: string) {
  return action.replaceAll("_", " ");
}
