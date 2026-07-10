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
 * SKELETON — grouping + states are final; render/motion is TODO.
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

export function ProposalList({ proposals, statuses, onDecide }: ProposalListProps) {
  return (
    <div className="proposal-list">
      {proposals.map((proposal) => {
        const meta = TIER_META[proposal.tier];
        const status = statuses[proposal.proposal_id];
        return (
          <div
            key={proposal.proposal_id}
            className={`proposal proposal--${proposal.tier} proposal--${status?.state ?? "open"}`}
          >
            <span className="proposal__tier-badge">{meta.label}</span>
            <p className="proposal__action">{proposal.action}</p>
            <p className="proposal__reason">{proposal.reason}</p>
            {/* TODO(M-impl): firm-only — capability call line
                ({proposal.module}.{proposal.function} + args summary) */}
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
            {/* TODO(M-impl): pending shimmer; done → check + status.detail */}
          </div>
        );
      })}
    </div>
  );
}
