/**
 * UnderstandingCard — the confirm-understanding gate (v5.2 panel design, Pencil frame 1).
 *
 * The cloud's read of the goal, shown BEFORE the device plans: the objective as the
 * heading, the constraints it will hold as a full-width column, the preferences under
 * them, the sentence describing what it is about to do, then Confirm / Decline.
 *
 * On the constraints: they are the credibility of the whole run — they are what the user
 * is really approving here — so they get icons, a tint per family, the value in that
 * family's tone and a lock. They deliberately do NOT stagger in (see the motion spec):
 * allergens and a medical restriction are safety data, and nothing the user must read
 * should move.
 *
 * v9 — constraints vs preferences. These were the same object in two skins: identical
 * radius, identical padding, identical icon-then-two-lines anatomy, separated only by
 * fill-vs-outline and a caption that failed contrast. The single most important thing
 * this screen teaches is that one of them can stop your plan and the other cannot, so
 * they are now different shapes: a constraint is a tinted box with a disc and a lock, a
 * preference is a bare row in a dense list. Tell them apart from across the kitchen.
 *
 * The two actions are NOT equal weight, unlike the mock: Confirm is the filled primary,
 * Decline is a ghost. Two identical-looking options make the reader do work the interface
 * should have done.
 */

import { useState } from "react";
import type {
  AppliedConstraint,
  AppliedPreference,
  PlanKnew,
  ProposedConstraint,
} from "../types/contract";
import { Icon, type IconName } from "./Icon";
import { knewValue } from "./PlanCard";

export interface UnderstandingCardProps {
  objective: string;
  constraints: PlanKnew;
  thought: string;
  /** v6: provenance behind the chips. Shown as a caption inside each chip. */
  applied?: AppliedConstraint[];
  /** v7: the soft half — shown as its own lighter section below the chips. */
  preferences?: AppliedPreference[];
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
const CONSTRAINT_FAMILIES: { match: RegExp; icon: IconName; tone: string }[] = [
  { match: /allerg/i, icon: "ban", tone: "warn" },
  { match: /diet|vegan|vegetarian|halal|kosher/i, icon: "leaf", tone: "good" },
  { match: /medic|health|sodium|sugar|condition/i, icon: "cross", tone: "violet" },
  { match: /budget|cost|price|spend/i, icon: "coin", tone: "accent" },
  { match: /quiet|hour|time|schedule|window/i, icon: "moon", tone: "plain" },
  { match: /guest|people|headcount|serves/i, icon: "users", tone: "accent" },
  { match: /date|day|week|deadline/i, icon: "calendar", tone: "plain" },
];

function familyOf(key: string): { icon: IconName; tone: string } {
  const hit = CONSTRAINT_FAMILIES.find((f) => f.match.test(key));
  return hit ? { icon: hit.icon, tone: hit.tone } : { icon: "pin", tone: "plain" };
}

/**
 * The same idea for preferences, and deliberately a SEPARATE table: a preference is not
 * a weak constraint, it is a different kind of thing, and sharing the map would have
 * tempted us to share the tone too. These carry no tone at all — see .pref in panel.css.
 */
const PREFERENCE_FAMILIES: { match: RegExp; icon: IconName }[] = [
  { match: /meat|chicken|fish|protein|dish|meal|recipe|cook/i, icon: "utensils" },
  { match: /workout|activity|exercise|gym|run|train/i, icon: "dumbbell" },
  { match: /home|house|away|routine|smartthings/i, icon: "house" },
  { match: /energy|power|tariff|electric|saving/i, icon: "zap" },
  { match: /fresh|perish|expir|produce|veg|waste/i, icon: "leaf" },
  { match: /time|hour|schedule|evening|morning/i, icon: "clock" },
];

function preferenceIcon(label: string): IconName {
  return PREFERENCE_FAMILIES.find((f) => f.match.test(label))?.icon ?? "pin";
}

/** "quiet_hours" → "QUIET HOURS" — the label is a category, not a field name. */
function labelOf(key: string): string {
  return key.replace(/[_-]+/g, " ").toUpperCase();
}

/**
 * Chip key → store kind, for the two the cloud renames on the way out. Everything
 * else is already its own kind. Kept tiny and explicit: the alternative is guessing
 * from the label, and a wrong guess attaches the wrong provenance to a safety chip.
 */
const CHIP_KIND: Record<string, string> = {
  "peak tariff": "peak_hours",
  away: "away_window",
};

/**
 * "account" → "Account · always enforced". The source is where the rule came from,
 * the why is how it reached THIS goal; together they are the whole answer to "why am
 * I being told this", which is the question a chip nobody can trace provokes.
 */
function provenanceLine(row: { source: string; why: string }): string {
  const source = row.source ? row.source[0].toUpperCase() + row.source.slice(1) : "";
  return [source, row.why].filter(Boolean).join(" · ");
}

export function UnderstandingCard({
  objective,
  constraints,
  thought,
  applied = [],
  preferences = [],
  proposed = [],
  captureOnly = false,
  onConfirm,
  onDecline,
  resolved,
}: UnderstandingCardProps) {
  const chips = Object.entries(constraints)
    .map(([key, value]) => [key, knewValue(value)] as const)
    .filter(([, text]) => text !== "");

  // Chip keys are display labels ("peak tariff"), provenance rows carry store kinds
  // ("peak_hours"), so the two are paired through CHIP_KIND rather than by identity.
  // A key with no entry there simply gets no caption — that is the normal case for
  // anything the resolver did not source from a store entry, and inventing a
  // provenance line would be worse than leaving it out.
  const provenanceByKind = new Map(applied.filter((row) => row.kind).map((row) => [row.kind!, row]));
  const provenanceFor = (chipKey: string) => provenanceByKind.get(CHIP_KIND[chipKey] ?? chipKey);

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
      {/* v9: the "Before I plan" eyebrow is gone. The goal bar above already names the
          goal and this heading already says "confirm" — three stacked labels before any
          content, two of them saying the same thing. The eyebrow survives only for
          capture-only, where it is the ONLY thing telling you no plan is coming. */}
      <header className="confirm-card__head">
        {captureOnly ? <span className="panel-eyebrow">Something to remember</span> : null}
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
          {/* v9: ONE COLUMN, not a 2-up grid. The old `repeat(auto-fit, minmax(230px,1fr))`
              gave an odd-numbered constraint set a half-width last chip sitting against
              dead space, and the constraint count is data-driven — it is odd as often as
              not. Full width also stops values like "low sodium — Rohan" truncating. */}
          <ul className="constraints__list">
            {chips.map(([key, text]) => {
              const { icon, tone } = familyOf(key);
              const row = provenanceFor(key);
              return (
                <li key={key} className={`constraint constraint--${tone}`}>
                  <span className="constraint__icon">
                    <Icon name={icon} size={20} />
                  </span>
                  <span className="constraint__body">
                    <span className="constraint__label">{labelOf(key)}</span>
                    <strong className="constraint__value">{text}</strong>
                    {row ? <span className="constraint__source">{provenanceLine(row)}</span> : null}
                  </span>
                  {/* The marker that makes "enforced" legible without reading a caption. */}
                  <Icon name="lock" size={18} className="constraint__mark" />
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {preferences.length > 0 ? (
        <section className="prefs" aria-label="Preferences">
          <header className="constraints__head">
            <span className="panel-eyebrow">Preferences</span>
            <span className="panel-meta">{preferences.length} applied</span>
          </header>
          <p className="prefs__note">Preferences shape the plan. They never block it.</p>
          {/* v9: an unboxed, dense list. It used to be an outlined box on the same 18px
              radius and the same anatomy as a constraint chip, so the two read as one
              object in two skins — and the ONE thing this screen exists to teach is that
              a constraint can block the plan and a preference cannot. Different weight is
              not enough; they have to be different SHAPES. */}
          <ul className="prefs__list">
            {preferences.map((pref) => (
              <li key={pref.id} className="pref">
                <Icon name={preferenceIcon(pref.label)} size={20} className="pref__icon" />
                <strong className="pref__label">{pref.label}</strong>
                <span className="pref__source">{provenanceLine(pref)}</span>
              </li>
            ))}
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
