/**
 * PlanColumn — the outcome region (v5.2 panel design).
 *
 * Two states in one frame:
 * - FORMING: rows land one at a time into slots that were already reserved, so the region
 *   never reflows as the plan materialises. The slot count is real — it comes from
 *   `plan_progress.total`, not from a guess.
 * - SETTLED: the result card (PlanCard) takes over — it carries its own header, so this
 *   component gets out of the way entirely.
 *
 * On the reveal being honest: the device composes the whole plan in ONE non-streaming call
 * and then fires `plan_progress` for every item in a tight loop, so all N arrive together,
 * after the safety and approval beats. This paces the REVEAL (see PLAN_ITEM_STEP_MS) —
 * every row shown is final and already screened.
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
  /** Wall-clock of the whole run, once it has ended. Null while it is still going. */
  composedMs: number | null;
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
  composedMs,
  proposalStatuses,
  onDecide,
}: PlanColumnProps) {
  // The real total, the moment we have it. `plan_progress.total` arrives with the FIRST
  // row, so the slots are exact from the very first frame; the plan's own length is the
  // fallback for a pre-v5.1 device. Null in neither case → one placeholder, no invented
  // horizon.
  const total = announcedTotal ?? plan?.payload.plan.length ?? null;
  const slots = total !== null ? Math.max(0, total - drafts.length) : forming ? 1 : 0;

  if (!forming && plan) {
    return (
      <section className="outcome" aria-label="The plan">
        <PlanCard
          plan={plan}
          changedIds={changedIds}
          morphs={morphs}
          morphSeq={morphSeq}
          changedImpactLabels={changedImpactLabels}
          composedMs={composedMs}
          proposalStatuses={proposalStatuses}
          onDecide={onDecide}
        />
      </section>
    );
  }

  return (
    <section className="outcome" aria-label="The plan">
      <header className="outcome__head">
        <span className="panel-eyebrow">The plan, taking shape</span>
        <span className="panel-meta">
          {total !== null ? `${drafts.length} of ${total} placed` : `${drafts.length} placed`}
        </span>
      </header>

      {forming || drafts.length > 0 ? (
        <ol className="drafts">
          {drafts.map((item, index) => {
            const newest = index === drafts.length - 1;
            const when = formatWhen(item.when) ?? `${String(index + 1).padStart(2, "0")}`;
            return (
              <li
                key={`${index}:${item.title}`}
                className={newest ? "draft draft--new" : "draft"}
              >
                <span className="draft__when">{when}</span>
                <span className="draft__body">
                  <strong className="draft__title">{item.title}</strong>
                  {item.detail ? <span className="draft__detail">{item.detail}</span> : null}
                </span>
                <span className="draft__tag">{newest ? "placing…" : "✓ screened"}</span>
              </li>
            );
          })}

          {/* Reserved, not invented: the row exists before its content does, so nothing
              below it moves when the content arrives. */}
          {Array.from({ length: slots }, (_, i) => (
            <li key={`slot-${i}`} className="draft draft--slot" aria-hidden>
              <span className="draft__when">
                {String(drafts.length + i + 1).padStart(2, "0")}
              </span>
              <span className="draft__bar" />
            </li>
          ))}
        </ol>
      ) : (
        <p className="outcome__empty">The plan will appear here as the agent composes it.</p>
      )}
    </section>
  );
}
