/**
 * Skeleton — shimmer placeholders shown while the agent works.
 *
 * NOT a spinner, NOT prose: while planning, the plan hero's silhouette
 * appears as shimmering rows that are progressively REPLACED by real
 * content as plan_progress events stream in (see PlanCard/App).
 *
 * Variants:
 * - "plan-item": a full plan-row silhouette (title bar + detail bar + tag pills)
 * - "line":     a single text bar
 * - "chip":     a tool-chip-sized pill
 *
 * Shimmer keyframe lives in styles.css (`skeleton-shimmer`).
 */

export type SkeletonVariant = "plan-item" | "line" | "chip";

export interface SkeletonProps {
  variant: SkeletonVariant;
  /** How many placeholders to render (default 1). */
  count?: number;
}

export function Skeleton({ variant, count = 1 }: SkeletonProps) {
  return (
    <div className="skeleton-group" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`skeleton skeleton--${variant}`}>
          {variant === "plan-item" ? (
            <>
              <span className="skeleton__bar skeleton__bar--title" />
              <span className="skeleton__bar skeleton__bar--detail" />
              <span className="skeleton__chips">
                <span />
                <span />
                <span />
              </span>
            </>
          ) : null}
        </div>
      ))}
    </div>
  );
}
