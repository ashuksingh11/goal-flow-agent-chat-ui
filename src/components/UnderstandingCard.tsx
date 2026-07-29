/**
 * UnderstandingCard — the confirm-understanding gate (v5.2 panel design, Pencil frame 1).
 *
 * The cloud's read of the goal, shown BEFORE the device plans: the objective as the
 * heading, the constraints it will hold as a 2-up chip grid, the sentence describing what
 * it is about to do, then Confirm / Decline.
 *
 * On the chip grid: the constraints are the credibility of the whole run — they are what
 * the user is really approving here — so they get icons, a tint per family and the value in
 * that family's tone. They deliberately do NOT stagger in (see the motion spec): allergens
 * and a medical restriction are safety data, and nothing the user must read should move.
 *
 * The two actions are NOT equal weight, unlike the mock: Confirm is the filled primary,
 * Decline is a ghost. Two identical-looking options make the reader do work the interface
 * should have done.
 */

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

/** Icon + tone per constraint family. Keys are free-form, so this matches on substrings. */
const CONSTRAINT_FAMILIES: { match: RegExp; icon: string; tone: string }[] = [
  { match: /allerg/i, icon: "🥜", tone: "warn" },
  { match: /diet|vegan|vegetarian|halal|kosher/i, icon: "🥗", tone: "good" },
  { match: /medic|health|sodium|sugar|condition/i, icon: "💊", tone: "violet" },
  { match: /budget|cost|price|spend/i, icon: "💰", tone: "accent" },
  { match: /quiet|hour|time|schedule|window/i, icon: "🌙", tone: "plain" },
  { match: /guest|people|headcount|serves/i, icon: "🧑‍🤝‍🧑", tone: "accent" },
  { match: /date|day|week|deadline/i, icon: "📅", tone: "plain" },
];

function familyOf(key: string): { icon: string; tone: string } {
  const hit = CONSTRAINT_FAMILIES.find((f) => f.match.test(key));
  return hit ? { icon: hit.icon, tone: hit.tone } : { icon: "📌", tone: "plain" };
}

/** "quiet_hours" → "QUIET HOURS" — the label is a category, not a field name. */
function labelOf(key: string): string {
  return key.replace(/[_-]+/g, " ").toUpperCase();
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
      className={resolved ? `confirm-card confirm-card--${resolved}` : "confirm-card"}
      aria-label="Confirm understanding"
    >
      <header className="confirm-card__head">
        <span className="panel-eyebrow">Before I plan</span>
        <h2 className="confirm-card__title">{objective}</h2>
      </header>

      {chips.length > 0 ? (
        <section className="constraints" aria-label="Constraints">
          <header className="constraints__head">
            <span className="panel-eyebrow">Constraints</span>
            <span className="panel-meta">
              {chips.length} held
            </span>
          </header>
          <ul className="constraints__grid">
            {chips.map(([key, text]) => {
              const { icon, tone } = familyOf(key);
              return (
                <li key={key} className={`constraint constraint--${tone}`}>
                  <span className="constraint__icon" aria-hidden>
                    {icon}
                  </span>
                  <span className="constraint__body">
                    <span className="constraint__label">{labelOf(key)}</span>
                    <strong className="constraint__value">{text}</strong>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {thought ? <p className="confirm-card__thought">{thought}</p> : null}

      {resolved ? (
        <p className="confirm-card__resolved">
          {resolved === "confirmed" ? "Confirmed. Planning next." : "Declined."}
        </p>
      ) : (
        <div className="confirm-card__actions">
          <button type="button" className="btn btn--primary" onClick={onConfirm}>
            Confirm &amp; plan
          </button>
          <button type="button" className="btn btn--quiet" onClick={onDecline}>
            Decline
          </button>
        </div>
      )}
    </article>
  );
}
