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

import { useState } from "react";
import type { PlanKnew, ProposedConstraint } from "../types/contract";
import { knewValue } from "./PlanCard";

export interface UnderstandingCardProps {
  objective: string;
  constraints: PlanKnew;
  thought: string;
  /** v6-M4: household rules the user just stated, offered for confirmation. */
  proposed?: ProposedConstraint[];
  /** v6-M4: this gate is only about the rules — no plan is coming. */
  captureOnly?: boolean;
  onConfirm: (acceptedConstraintIds: string[]) => void;
  onDecline: () => void;
  resolved?: "confirmed" | "declined";
}

/** How a proposed rule's value reads on a chip: ["no_dairy"] → "no dairy". */
function proposedValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => String(v).replace(/_/g, " ")).join(", ");
  if (typeof value === "number") return `$${value}`;
  return String(value ?? "").replace(/_/g, " ");
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
  proposed = [],
  captureOnly = false,
  onConfirm,
  onDecline,
  resolved,
}: UnderstandingCardProps) {
  const chips = Object.entries(constraints)
    .map(([key, value]) => [key, knewValue(value)] as const)
    .filter(([, text]) => text !== "");

  // Ticked by default: the user just SAID this, so pre-selecting matches what they
  // asked for and confirming is one click. It is still an explicit tick they can
  // clear — a rule that will block a future plan should never be captured by
  // silence, only by a yes the user can see and undo.
  const [accepted, setAccepted] = useState<string[]>(() => proposed.map((p) => p.id));
  const toggle = (id: string) =>
    setAccepted((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <article
      className={resolved ? `confirm-card confirm-card--${resolved}` : "confirm-card"}
      aria-label="Confirm understanding"
    >
      <header className="confirm-card__head">
        <span className="panel-eyebrow">{captureOnly ? "Something to remember" : "Before I plan"}</span>
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

      {proposed.length > 0 ? (
        <section className="capture" aria-label="Rules to remember">
          <header className="constraints__head">
            <span className="panel-eyebrow">Remember for next time?</span>
            <span className="panel-meta">{accepted.length} of {proposed.length}</span>
          </header>
          <ul className="capture__list">
            {proposed.map((rule) => {
              const on = accepted.includes(rule.id);
              return (
                <li key={rule.id} className={on ? "capture__item capture__item--on" : "capture__item"}>
                  <label className="capture__label">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={Boolean(resolved)}
                      onChange={() => toggle(rule.id)}
                    />
                    <span className="capture__text">
                      <strong>{rule.label || rule.kind.replace(/_/g, " ")}</strong>
                      <span className="capture__value">{proposedValue(rule.value)}</span>
                      {rule.quote ? <em className="capture__quote">“{rule.quote}”</em> : null}
                    </span>
                    {rule.enforcement === "hard" ? (
                      <span className="capture__badge" title="A plan will be blocked if it breaks this">
                        enforced
                      </span>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {thought ? <p className="confirm-card__thought">{thought}</p> : null}

      {resolved ? (
        <p className="confirm-card__resolved">
          {resolved === "confirmed"
            ? captureOnly
              ? "Saved."
              : "Confirmed. Planning next."
            : "Declined."}
        </p>
      ) : (
        <div className="confirm-card__actions">
          <button type="button" className="btn btn--primary" onClick={() => onConfirm(accepted)}>
            {captureOnly ? "Remember this" : "Confirm & plan"}
          </button>
          <button type="button" className="btn btn--quiet" onClick={onDecline}>
            {captureOnly ? "Don't save" : "Decline"}
          </button>
        </div>
      )}
    </article>
  );
}
