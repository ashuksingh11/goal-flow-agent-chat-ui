/**
 * PlanColumn — the outcome region (v5.1, Pencil "Option E").
 *
 * The run's product, directly under the run itself. Two states in one frame:
 *
 * - FORMING: rows land one at a time into slots that were already reserved, so the
 *   region never reflows as the plan materialises. The slot count is real — it comes
 *   from the plan we have already received (see below), not from a guess.
 * - SETTLED: the plan hero (PlanCard) takes over, with its impact badges and the tiered
 *   approvals underneath — approvals sit BELOW the plan, where the decision belongs.
 *
 * On the reveal being honest: the device composes the whole plan in ONE non-streaming
 * call and then fires `plan_progress` for every item in a tight loop, so all N arrive
 * together, after the safety and approval beats. This paces the REVEAL (see
 * PLAN_ITEM_STEP_MS) — every row shown is final and already screened. Because
 * `present_plan` normally lands in the same breath, the true total is known while the
 * reveal is still running, which is what lets the slots be exact instead of a shimmer.
 *
 * Domain-agnostic by construction, like PlanCard: the left column is the item's `when`
 * if it has one and its step number if it does not — never a weekday, never a "day N"
 * for goals that have no days.
 */

import type { ApprovalDecision, PresentPlan } from "../types/contract";
import type { DraftPlanItem, ProposalStatusMap } from "../types/ui";
import { formatWhen } from "../lib/date";
import { PlanCard } from "./PlanCard";

export interface PlanColumnProps {
  /** Rows revealed so far (paced out of the reveal queue). */
  drafts: DraftPlanItem[];
  /** `plan_progress.total` if the device announced one (v5.1); null on older devices. */
  announcedTotal: number | null;
  /** True while rows are still being revealed. */
  forming: boolean;
  plan: PresentPlan | null;
  changedIds: string[];
  morphs: Record<string, { prevTitle: string; prevDetail?: string }>;
  morphSeq: number;
  changedImpactLabels: string[];
  proposalStatuses: ProposalStatusMap;
  onDecide: (decisions: ApprovalDecision[]) => void;
}

export function PlanColumn({
  drafts,
  announcedTotal,
  forming,
  plan,
  changedIds,
  morphs,
  morphSeq,
  changedImpactLabels,
  proposalStatuses,
  onDecide,
}: PlanColumnProps) {
  // The real total, the moment we have it. `plan_progress.total` arrives with the FIRST
  // row, so the slots are exact from the very first frame; the plan's own length is the
  // fallback for a pre-v5.1 device, and is usually here too because plan_ready follows
  // the burst by milliseconds. Null in neither case → one placeholder, no invented
  // horizon.
  const total = announcedTotal ?? plan?.payload.plan.length ?? null;
  const slots = total !== null ? Math.max(0, total - drafts.length) : forming ? 1 : 0;
  const screened = plan?.payload.safety.gate === "passed";

  return (
    <section className="outcome" aria-label="The plan">
      <header className="outcome__head">
        <span className="outcome__eyebrow">{forming ? "THE PLAN, TAKING SHAPE" : "THE PLAN"}</span>
        <span className="outcome__count">
          {forming
            ? total !== null
              ? `${drafts.length} of ${total} placed`
              : `${drafts.length} placed`
            : total !== null
              ? `${total} step${total === 1 ? "" : "s"}`
              : ""}
        </span>
      </header>

      {forming ? (
        <ol className="outcome__list">
          {drafts.map((item, index) => {
            const newest = index === drafts.length - 1;
            const when = formatWhen(item.when) ?? `${String(index + 1).padStart(2, "0")}`;
            const tag = newest ? "placing…" : screened ? "✓ screened" : item.tags?.[0] ?? "";
            return (
              <li
                key={`${index}:${item.title}`}
                className={newest ? "outcome-row outcome-row--new" : "outcome-row"}
              >
                <span className="outcome-row__when">{when}</span>
                <span className="outcome-row__body">
                  <strong className="outcome-row__title">{item.title}</strong>
                  {item.detail ? <span className="outcome-row__detail">{item.detail}</span> : null}
                </span>
                <span className={newest ? "outcome-row__tag outcome-row__tag--new" : "outcome-row__tag"}>
                  {tag}
                </span>
              </li>
            );
          })}

          {/* Reserved, not invented: the row exists before its content does, so nothing
              below it moves when the content arrives. */}
          {Array.from({ length: slots }, (_, i) => (
            <li key={`slot-${i}`} className="outcome-row outcome-row--slot" aria-hidden>
              <span className="outcome-row__when">
                {String(drafts.length + i + 1).padStart(2, "0")}
              </span>
              <span className="outcome-row__bar" />
            </li>
          ))}
        </ol>
      ) : plan ? (
        <div className="outcome__hero">
          <PlanCard
            plan={plan}
            changedIds={changedIds}
            morphs={morphs}
            morphSeq={morphSeq}
            changedImpactLabels={changedImpactLabels}
            proposalStatuses={proposalStatuses}
            onDecide={onDecide}
          />
        </div>
      ) : (
        <p className="outcome__empty">The plan will appear here as the agent composes it.</p>
      )}
    </section>
  );
}
