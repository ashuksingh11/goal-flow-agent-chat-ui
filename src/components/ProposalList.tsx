/**
 * ProposalList — TIERED approvals attached to the plan hero.
 *
 * Tier treatment (types/ui.ts TIER_META):
 * - auto:  rendered as ALREADY DONE — muted row, check, no buttons
 *          ("Set 3 reminders ✓ — reversible, done automatically").
 * - light: compact row with a single quiet [OK] approve action.
 * - firm:  visually HEAVY card — accent border, cost/irreversibility called
 *          out (module.function + args summary), explicit [Approve]/[Decline].
 *          Nothing firm executes until approval returns (contract invariant).
 *
 * Decision lifecycle per proposal (ProposalStatusMap):
 *   (none) → pending (buttons disable, subtle progress) → done (confirmed by
 *   the executed[] entries of a later status frame — see App reducer).
 *
 */

import type { ApprovalDecision, PlanProposal } from "../types/contract";
import { TIER_META } from "../types/ui";
import type { ProposalStatusMap } from "../types/ui";

export interface ProposalListProps {
  proposals: PlanProposal[];
  statuses: ProposalStatusMap;
  /** Emits one-or-many decisions; App wraps them in an approval frame. */
  onDecide: (decisions: ApprovalDecision[]) => void;
}

function summarizeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return "No arguments";
  return entries
    .slice(0, 4)
    .map(([key, value]) => {
      const rendered =
        typeof value === "string"
          ? value
          : Array.isArray(value)
            ? `${value.length} item${value.length === 1 ? "" : "s"}`
            : value === null
              ? "null"
              : typeof value === "object"
                ? "object"
                : String(value);
      return `${key}: ${rendered}`;
    })
    .join(" · ");
}

export function ProposalList({ proposals, statuses, onDecide }: ProposalListProps) {
  if (proposals.length === 0) return null;

  return (
    <section className="proposal-list" aria-label="Approvals">
      <div className="proposal-list__header">
        <span className="eyebrow">Approvals</span>
        <strong>{proposals.length}</strong>
      </div>
      {proposals.map((proposal) => {
        const meta = TIER_META[proposal.tier];
        const status = statuses[proposal.proposal_id];
        const confirmed = status?.state === "done";
        const pending = status?.state === "pending";
        const declined = confirmed && status.approved === false;
        return (
          <div
            key={proposal.proposal_id}
            className={`proposal proposal--${proposal.tier} proposal--${status?.state ?? "open"}`}
          >
            <span className="proposal__tier-badge">{meta.label}</span>
            <div className="proposal__main">
              <p className="proposal__action">
                {proposal.action}
                {proposal.tier === "auto" ? <span className="proposal__inline-status"> ✓</span> : null}
              </p>
              {confirmed ? (
                <p className="proposal__confirmation">
                  {declined ? "Declined" : "Added ✓"}
                  {status.detail ? ` - ${status.detail}` : ""}
                </p>
              ) : pending ? (
                <p className="proposal__confirmation">Waiting for confirmation</p>
              ) : null}
            </div>
            <p className="proposal__reason">{proposal.reason}</p>
            {proposal.tier === "firm" ? (
              <code className="proposal__call">
                {proposal.module}.{proposal.function} · {summarizeArgs(proposal.args)}
              </code>
            ) : null}
            {proposal.tier !== "auto" && proposal.requires_approval && !status ? (
              <div className="proposal__actions">
                <button
                  type="button"
                  className={proposal.tier === "firm" ? "button--firm" : "button--light"}
                  onClick={() =>
                    onDecide([{ proposal_id: proposal.proposal_id, approved: true }])
                  }
                >
                  {proposal.tier === "firm" ? "Approve" : "OK"}
                </button>
                {proposal.tier === "firm" ? (
                  <button
                    type="button"
                    className="button--ghost"
                    onClick={() =>
                      onDecide([{ proposal_id: proposal.proposal_id, approved: false }])
                    }
                  >
                    Decline
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
