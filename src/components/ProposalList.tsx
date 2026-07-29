/**
 * ProposalList — the approvals, as ONE commit (v5.2 panel design, Pencil frame 3).
 *
 * What the wire actually wants
 * ---------------------------
 * `sendDecisions` (App.tsx) sends exactly ONE `approval` frame carrying the COMPLETE
 * `decisions[]`, because the device resumes the whole plan on the FIRST approval frame it
 * receives and the cloud closes the chat webview on it. v5.1's per-proposal buttons were
 * therefore never multiple commits — they were a consent checklist collected one tap at a
 * time and submitted together. This panel collects the same consent in one place and
 * commits it with one button.
 *
 * Why firm proposals are an opt-in and NOT a switch
 * ------------------------------------------------
 * A firm proposal has THREE states — undecided / approved / declined — and a two-state
 * switch collapses "off" and "never touched" into one appearance. That forces the commit
 * button to be gated until every firm item has been touched, which makes approvals read as
 * mandatory when they are not: a rejected proposal still saves the goal. So firm rows sit
 * at "Not included" and offer `+ Include`. An untouched firm item sends `approved: false`,
 * which is already the contract's safe default — nothing above tier `auto` executes
 * without an explicit approval.
 *
 * Consequently THE COMMIT BUTTON IS NEVER DISABLED. The consequence of leaving something
 * out is stated under it, not enforced by it.
 *
 * Tier treatment (types/ui.ts TIER_META):
 * - auto:  already executed. A receipt line, no control, not in `decisions[]`.
 * - light: reversible and cheap — a switch that starts ON (opt-out). Here on/off IS the
 *          complete set of states, so a switch is the honest control.
 * - firm:  spends money / irreversible — warn-toned row, `+ Include` opt-in.
 */

import { useMemo, useState } from "react";

import type { ApprovalDecision, PlanProposal } from "../types/contract";
import type { ProposalStatusMap } from "../types/ui";

export interface ProposalListProps {
  proposals: PlanProposal[];
  statuses: ProposalStatusMap;
  /** Emits the COMPLETE decision set; App wraps it in the single approval frame. */
  onDecide: (decisions: ApprovalDecision[]) => void;
}

function summarizeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return "";
  return entries
    .slice(0, 3)
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
  // Exactly App.tsx's filter — these are the proposals that must appear in `decisions[]`.
  const required = useMemo(
    () => proposals.filter((p) => p.tier !== "auto" && p.requires_approval),
    [proposals],
  );
  const receipts = useMemo(
    () => proposals.filter((p) => p.tier === "auto" || !p.requires_approval),
    [proposals],
  );

  // light starts included (opt-out), firm starts excluded (opt-in).
  const [included, setIncluded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(required.map((p) => [p.proposal_id, p.tier !== "firm"])),
  );

  const committed = required.some((p) => statuses[p.proposal_id] !== undefined);
  const includedCount = required.filter((p) => included[p.proposal_id]).length;
  const leftOut = required.filter((p) => !included[p.proposal_id]);

  if (proposals.length === 0) return null;

  const commit = () => {
    onDecide(
      required.map((p) => ({
        proposal_id: p.proposal_id,
        approved: included[p.proposal_id] === true,
      })),
    );
  };

  const toggle = (id: string) =>
    setIncluded((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <section className="approvals" aria-label="Approvals">
      <header className="approvals__head">
        <span className="panel-eyebrow">What happens when you save</span>
        <span className="panel-meta">
          {receipts.length > 0 ? `${receipts.length} automatic` : null}
          {receipts.length > 0 && required.length > 0 ? " · " : null}
          {required.length > 0 ? `${required.length} your choice` : null}
        </span>
      </header>

      {receipts.map((proposal) => (
        <p key={proposal.proposal_id} className="approval-receipt">
          <i className="approval-receipt__mark" aria-hidden>
            ✓
          </i>
          <span className="approval-receipt__label">{proposal.action}</span>
          <span className="approval-receipt__note">
            {proposal.tier === "auto" ? "done automatically" : "no approval needed"}
          </span>
        </p>
      ))}

      {required.map((proposal) => {
        const status = statuses[proposal.proposal_id];
        const on = included[proposal.proposal_id] === true;
        const firm = proposal.tier === "firm";

        return (
          <div
            key={proposal.proposal_id}
            className={`approval approval--${firm ? "firm" : "light"}${on ? " approval--on" : ""}`}
          >
            {!firm ? (
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={proposal.action}
                className="approval__switch"
                disabled={committed}
                onClick={() => toggle(proposal.proposal_id)}
              >
                <i className="approval__knob" aria-hidden />
              </button>
            ) : null}

            <div className="approval__body">
              <strong className="approval__action">{proposal.action}</strong>
              <span className="approval__reason">
                {status
                  ? status.state === "pending"
                    ? "Waiting for your Family Hub…"
                    : status.approved === false
                      ? "Not included"
                      : `Added ✓${status.detail ? ` — ${status.detail}` : ""}`
                  : firm && !on
                    ? `Not included — ${proposal.reason}`
                    : proposal.reason}
              </span>
              {firm ? (
                <code className="approval__call">
                  {proposal.module}.{proposal.function}
                  {summarizeArgs(proposal.args) ? ` · ${summarizeArgs(proposal.args)}` : ""}
                </code>
              ) : null}
            </div>

            {firm && !committed ? (
              <button
                type="button"
                className={on ? "btn btn--included" : "btn btn--include"}
                aria-pressed={on}
                onClick={() => toggle(proposal.proposal_id)}
              >
                {on ? "✓ Included" : "+ Include"}
              </button>
            ) : null}
          </div>
        );
      })}

      {required.length === 0 ? (
        <p className="approvals__none">
          Nothing needs your approval — your Family Hub is already on it.
        </p>
      ) : committed ? (
        <p className="approvals__committed" role="status">
          Saved — your Family Hub is on it.
        </p>
      ) : (
        <>
          <button type="button" className="btn btn--primary btn--commit" onClick={commit}>
            Approve &amp; Save
          </button>
          <p className="approvals__consequence">
            {leftOut.length === 0
              ? `Saves all ${includedCount} action${includedCount === 1 ? "" : "s"}.`
              : `Saves ${includedCount} of ${required.length} actions — ${leftOut
                  .map((p) => p.action.toLowerCase())
                  .join(", ")} won't happen.`}
          </p>
        </>
      )}
    </section>
  );
}
