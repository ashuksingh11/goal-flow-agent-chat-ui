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
import type { ProposalStatusMap } from "../types/ui";

export interface PlanCardProps {
  plan: PresentPlan;
  /** Emit the user's decisions for this plan's proposals (approval gate). */
  onDecide: (decisions: ApprovalDecision[]) => void;
  proposalStatuses: ProposalStatusMap;
}

export function PlanCard({ plan, onDecide, proposalStatuses }: PlanCardProps) {
  const proposals = plan.payload.proposals;
  const knownContext = formatKnownContext(plan.payload.knew);
  const impactBadges = formatImpactBadges(plan.payload.impact);
  const hasDecision = proposals.some((proposal) => proposalStatuses[proposal.proposal_id]);
  const safetyPassed =
    plan.payload.safety.gate === "passed" && plan.payload.safety.hard_violations.length === 0;

  const decideAll = (approved: boolean) => {
    if (hasDecision) {
      return;
    }

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

      {knownContext ? <p className="known-context">Knew: {knownContext}</p> : null}

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
                <div className="proposal-list__topline">
                  <div>
                    <strong>{formatAction(proposal.action)}:</strong>{" "}
                    {proposal.items.join(", ")}
                  </div>
                  <ProposalStatusBadge status={proposalStatuses[proposal.proposal_id]} />
                </div>
                <p>{proposal.reason}</p>
              </li>
            ))}
          </ul>
          <div className="plan-actions">
            <button type="button" onClick={() => decideAll(true)} disabled={hasDecision}>
              {hasDecision ? "Decision sent" : "Approve"}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => decideAll(false)}
              disabled={hasDecision}
            >
              Decline
            </button>
          </div>
        </div>
      ) : null}

      {impactBadges.length > 0 ? (
        <div className="impact-row" aria-label="Plan impact">
          {impactBadges.map((badge) => (
            <span className="impact-badge" key={badge}>
              {badge}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function formatAction(action: string) {
  return action.replaceAll("_", " ");
}

function ProposalStatusBadge({
  status,
}: {
  status: ProposalStatusMap[string] | undefined;
}) {
  if (!status) {
    return null;
  }

  if (!status.approved) {
    return <span className="proposal-status proposal-status--declined">Declined</span>;
  }

  if (status.state === "pending") {
    return <span className="proposal-status proposal-status--pending">Approving...</span>;
  }

  return (
    <span className="proposal-status proposal-status--done">
      {status.detail || "Added ✓"}
    </span>
  );
}

function formatKnownContext(knew: PresentPlan["payload"]["knew"]) {
  if (!knew) {
    return "";
  }

  const pieces = [
    formatList(knew.dietary),
    formatPrefixedList("dislikes", knew.dislikes),
    formatPrefixedList("prefers", knew.prefer),
    knew.notes,
  ].filter(Boolean);

  return pieces.join(" · ");
}

function formatPrefixedList(prefix: string, values?: string[]) {
  const list = formatList(values);
  return list ? `${prefix} ${list}` : "";
}

function formatList(values?: string[]) {
  return values?.filter(Boolean).join(", ") ?? "";
}

function formatImpactBadges(impact: PresentPlan["payload"]["impact"]) {
  if (!impact) {
    return [];
  }

  const badges: string[] = [];

  if (impact.pork_meals !== undefined) {
    badges.push(`${impact.pork_meals} ${pluralize("pork meal", impact.pork_meals)}`);
  }
  if (impact.veg_forward_dinners !== undefined) {
    badges.push(
      `${impact.veg_forward_dinners} ${pluralize(
        "veg-forward dinner",
        impact.veg_forward_dinners,
      )}`,
    );
  }
  if (impact.items_used_before_expiry !== undefined) {
    badges.push(
      `${impact.items_used_before_expiry} ${pluralize(
        "item",
        impact.items_used_before_expiry,
      )} used before expiry`,
    );
  }
  if (impact.grocery_items !== undefined) {
    badges.push(`${impact.grocery_items} ${pluralize("grocery item", impact.grocery_items)}`);
  }

  return badges;
}

function pluralize(label: string, value: number) {
  return value === 1 ? label : `${label}s`;
}
