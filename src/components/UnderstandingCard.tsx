import type { PlanKnew } from "../types/contract";
import { knewValue } from "./PlanCard";

export interface UnderstandingCardProps {
  objective: string;
  constraints: PlanKnew;
  thought: string;
  onConfirm: () => void;
  onDecline: () => void;
  resolved?: "confirmed" | "declined";
}

export function UnderstandingCard({
  objective,
  constraints,
  thought,
  onConfirm,
  onDecline,
  resolved,
}: UnderstandingCardProps) {
  const chips = Object.entries(constraints)
    .map(([key, value]) => [key, knewValue(value)] as const)
    .filter(([, text]) => text !== "");

  return (
    <article
      className={
        resolved ? `understanding-card understanding-card--${resolved}` : "understanding-card"
      }
      aria-label="Confirm understanding"
    >
      <div className="understanding-card__header">
        <span className="eyebrow">Confirm</span>
        <h2>{objective}</h2>
      </div>

      {chips.length > 0 ? (
        <p className="understanding-card__knew">
          <span className="eyebrow">Constraints</span>
          {chips.map(([key, text]) => (
            <span key={key} className="knew-chip">
              <strong>{key}</strong> {text}
            </span>
          ))}
        </p>
      ) : null}

      {thought ? <p className="understanding-card__thought">{thought}</p> : null}

      {resolved ? (
        <p className="understanding-card__resolved">
          {resolved === "confirmed" ? "Confirmed. Planning next." : "Declined."}
        </p>
      ) : (
        <div className="understanding-card__actions">
          <button type="button" className="button--firm" onClick={onConfirm}>
            Confirm &amp; plan
          </button>
          <button type="button" className="button--ghost" onClick={onDecline}>
            Decline
          </button>
        </div>
      )}
    </article>
  );
}
