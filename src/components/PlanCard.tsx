/**
 * PlanCard — the plan, once it has landed (v5.2 panel design, Pencil frame 3).
 *
 * Anatomy, top to bottom:
 *   ✓ Composed your plan · 7 steps · 5 honoured · 10.6s   [Details]  ← the arrival
 *   [Safety gate passed]                               ← how it was checked
 *   allergens peanuts · dietary no_pork · …            ← what it knew (credibility)
 *   Mon, Jul 27  Chickpea Salad Bowl              ⌄    ← the plan itself, one row per
 *      detail + why + tags (the open row)                step, first row open
 *   [impact]                                            ← what it changes
 *   ProposalList                                        ← what happens when you save
 *
 * DOMAIN-AGNOSTIC by construction: generic PlanItem rows (title / detail / why / tags /
 * optional `when`) carry meal days, guest-prep steps, chores, anything. The left column is
 * the item's `when` if it has one and its step number if it does not — never a weekday for
 * a goal that has no days. No meal-specific field appears anywhere.
 *
 * Only one row is open at a time: this panel has one screen's worth of height and no page
 * scroll, so an accordion keeps the whole plan visible while still letting any single step
 * be read in full.
 *
 * v9 — THE RUN RECEDES HERE. "Composing your plan…" settles into "Composed your plan":
 * same words, same place, past tense, and the spinner's slot is taken by the green disc so
 * the eye does not have to re-find where the answer went. The run's duration appears here
 * and ONLY here — while it is working there is no clock anywhere, because a counter beside
 * a spinner is a second live region for one fact. Its evidence moves behind [Details],
 * which is quieter than the accent pill it replaced: on this screen the accent belongs to
 * "Approve & Save".
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { ApprovalDecision, PresentPlan } from "../types/contract";
import type { ProposalStatusMap } from "../types/ui";
import { formatWhen } from "../lib/date";
import { Icon, type IconName } from "./Icon";
import { ProposalList } from "./ProposalList";

type PlanMorph = { prevTitle: string; prevDetail?: string };

export interface PlanCardProps {
  plan: PresentPlan;
  /**
   * v11.1: the state of the voice, when it is speaking about THIS card.
   *
   * Only "blocked" renders anything — the tap that a browser's autoplay refusal makes
   * necessary. See UnderstandingCard for the same treatment and lib/speech.ts for why
   * a refusal is ordinary rather than exceptional.
   */
  speech?: "idle" | "playing" | "blocked" | "unavailable";
  /** Play the pending utterance from inside a real click. */
  onPlaySpeech?: () => void;
  /** Ids changed by the most recent approved daily adaptation — highlighted. */
  changedIds?: string[];
  /** Previous row copy captured before the adapted plan replaced it. */
  morphs?: Record<string, PlanMorph>;
  /** Sequence that bumps per adapted plan patch, replaying changed-row animations. */
  morphSeq?: number;
  /** Impact labels changed by the most recent adaptation. */
  changedImpactLabels?: string[];
  /**
   * Wall-clock of the whole run, once it has ended.
   *
   * This is the ONLY place the duration is shown. While the run is going there is no
   * clock anywhere — a counter beside a spinner is a second live region for one fact,
   * and it counts up, so it reads as a stopwatch on a late train. Settled, next to the
   * result it produced, the same number is information: "that took eleven seconds."
   */
  composedMs?: number | null;
  proposalStatuses: ProposalStatusMap;
  onDecide: (decisions: ApprovalDecision[]) => void;
}

/** 10600 → "10.6s"; 74000 → "1m 14s". Sub-minute keeps a decimal, past that it is noise. */
function composedIn(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}

/**
 * WHAT A PLAN ROW IS, as a mark — v9.
 *
 * Seven rows of near-identical text is a list you scan rather than read, and the one
 * thing that differs most between them (a dinner, a trip day, an appliance run) was
 * carried only by the words. The mark is derived from the row's own tags and title, in
 * that order: tags are authored data, the title is prose the model wrote.
 *
 * DOMAIN-AGNOSTIC, like everything else on this card — the table is keyed on what a row
 * DOES, not on which of the six domains it came from, so a goal we have not thought of
 * still gets a sensible mark instead of a wrong one. The list stays SHORT on purpose;
 * what a no-match falls back to is decided by the plan, not by adding words. See
 * planMarks.
 */
const ROW_MARKS: { match: RegExp; icon: IconName }[] = [
  { match: /shop|grocer|order|restock|buy|list/i, icon: "cart" },
  { match: /remind|notify|announce|tell|message/i, icon: "bell" },
  { match: /dishwash|laundry|oven|preheat|appliance|energy|tariff|power|charge|run /i, icon: "zap" },
  { match: /away|home|house|secur|lock|thermostat|vacuum|clean/i, icon: "house" },
  { match: /workout|training|exercise|gym|activity/i, icon: "dumbbell" },
  { match: /meal|dinner|lunch|recipe|cook|bake|salad|curry|wrap|soup|bowl|fish|chicken|paneer|traybake/i, icon: "utensils" },
];

function matchMark(item: { title: string; tags: string[]; status?: string }): IconName | null {
  // A skipped row is a fact about the DAY, not about what was going to happen on it —
  // the reason it is skipped (an away window) outranks whatever the row used to be.
  if (item.status === "skipped") return "plane";
  const haystack = `${item.tags.join(" ")} ${item.title}`;
  return ROW_MARKS.find((m) => m.match.test(haystack))?.icon ?? null;
}

/**
 * The marks for a whole plan — and the reason this is a plan-level function rather than a
 * row-level one.
 *
 * Matched live, "Lemon herb fish with greens" and "Chickpea salad bowl" found `utensils`
 * while "Turkey stir-fry with peppers" and "Milk and fruit snack" fell through to the
 * generic pin, in the same seven-row meal plan. The obvious fix is more food words, which
 * is a word list that grows forever and is wrong for the seventh domain nobody has built
 * yet. The rows of one plan are nearly always the same KIND of thing, so an unmatched row
 * takes the plan's dominant mark instead — the list stays small, and a plan of any domain
 * ends up internally consistent.
 *
 * `plane` is excluded from the vote: a skipped day is the exception in its plan by
 * definition, and letting one away day mark six dinners with an aeroplane would be worse
 * than any fallback.
 */
export function planMarks(items: { title: string; tags: string[]; status?: string }[]): IconName[] {
  const matched = items.map(matchMark);
  const votes = new Map<IconName, number>();
  for (const mark of matched) {
    if (!mark || mark === "plane") continue;
    votes.set(mark, (votes.get(mark) ?? 0) + 1);
  }
  let dominant: IconName = "pin";
  let best = 0;
  for (const [mark, count] of votes) {
    if (count > best) [dominant, best] = [mark, count];
  }
  return matched.map((mark) => mark ?? dominant);
}

export function knewValue(value: unknown): string {
  // Defensive: only render primitives / string lists — never a raw object (that would
  // crash React). Objects/empties collapse to "".
  if (Array.isArray(value)) return value.slice(0, 3).map(String).join(", ");
  if (value == null || typeof value === "object") return "";
  return String(value);
}

export function PlanCard({
  plan,
  changedIds = [],
  morphs = {},
  morphSeq = 0,
  changedImpactLabels = [],
  composedMs = null,
  proposalStatuses,
  onDecide,
  speech = "idle",
  onPlaySpeech,
}: PlanCardProps) {
  const { payload } = plan;
  const changed = useMemo(() => new Set(changedIds), [changedIds]);
  const changedImpact = useMemo(() => new Set(changedImpactLabels), [changedImpactLabels]);
  const firstChangedId = changedIds[0];
  const changedRowRef = useRef<HTMLLIElement | null>(null);

  // The first step opens by default — the plan should be readable, not just listed.
  const [openId, setOpenId] = useState<string | null>(payload.plan[0]?.id ?? null);

  // An adaptation should open the row it changed: that is the row worth reading now.
  useEffect(() => {
    if (morphSeq === 0 || !firstChangedId) return;
    setOpenId(firstChangedId);
    if (!changedRowRef.current) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    changedRowRef.current.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "center",
    });
  }, [morphSeq, firstChangedId]);

  /*
   * v11.2 — BRING THE APPROVALS INTO VIEW WHEN THE PLAN LANDS.
   *
   * The voice says "two things need your approval" and the buttons were below the fold:
   * a full week of plan rows sits between the card's heading and its approvals, so the
   * one thing the user was just ASKED to do was the one thing not on screen. Being told
   * to act and having to hunt for the control is worse than not being told.
   *
   * Scrolls to the approvals rather than the page bottom, and `block: "nearest"` so a
   * short plan whose approvals are already visible does not jump at all. Runs once per
   * plan (keyed on the goal), never on a re-render — and never for a plan with nothing
   * to approve, where there is nothing to bring into view.
   */
  const approvalsRef = useRef<HTMLDivElement | null>(null);
  const needsApproval = payload.proposals.some((p) => p.requires_approval !== false && p.tier !== "auto");
  useEffect(() => {
    if (!needsApproval || !approvalsRef.current) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // A frame's delay: the card has only just mounted, and scrolling to an element
    // whose siblings are still laying out lands in the wrong place.
    const timer = window.setTimeout(() => {
      approvalsRef.current?.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "nearest",
      });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [plan.goal_id, needsApproval]);

  const knewChips = payload.knew
    ? Object.entries(payload.knew)
        .map(([key, value]) => [key, knewValue(value)] as const)
        .filter(([, text]) => text !== "")
    : [];
  const passed = payload.safety.gate === "passed";
  // Computed once for the plan, not per row — an unmatched row borrows the plan's own
  // dominant mark. See planMarks.
  const marks = useMemo(() => planMarks(payload.plan), [payload.plan]);

  return (
    <article className="result-card" aria-label="Proposed plan">
      {/*
        The arrival. "Composing your plan…" settles into "Composed your plan" — same
        words, same place, past tense — and the spinner's slot is taken by a green disc,
        so the eye does not have to re-find where the answer went. Everything about the
        RUN recedes here and the plan becomes the subject; the run's evidence is still one
        tap away behind Details, it just stops competing with the thing it produced.
      */}
      <header className="result__head">
        <i className={`result__mark result__mark--${passed ? "ok" : "blocked"}`}>
          {passed ? <Icon name="check" size={17} strokeWidth={2.5} /> : "!"}
        </i>
        <div className="result__titles">
          <h2 className="result__title">{passed ? "Composed your plan" : "Plan blocked"}</h2>
          <p className="result__sub">
            {payload.plan.length} step{payload.plan.length === 1 ? "" : "s"}
            {knewChips.length > 0 ? ` · ${knewChips.length} constraints honoured` : ""}
            {composedMs !== null ? ` · ${composedIn(composedMs)}` : ""}
          </p>
        </div>
        {/* v11.1 — the same affordance the confirm gate has, for the same reason: the
            browser may have refused to autoplay and only a tap can undo that. The plan
            is the one utterance carrying something the screen cannot say as quickly —
            what this week actually IS — so it is worth offering twice. */}
        {speech === "blocked" ? (
          <button type="button" className="speak-chip" onClick={onPlaySpeech}>
            <Icon name="speaker" size={18} />
            Hear this
          </button>
        ) : null}
        {payload.explanation ? (
          <details className="result__why">
            <summary className="result__why-summary">
              <Icon name="chevron-down" size={16} />
              Details
            </summary>
            <p className="result__why-body">{payload.explanation}</p>
          </details>
        ) : null}
      </header>

      <div className="result__badges">
        <span
          className={`safety-pill safety-pill--${payload.safety.gate}`}
          title={payload.safety.violations.join(", ")}
        >
          {passed ? <Icon name="shield-check" size={15} /> : null}
          {passed ? "Safety gate passed" : `Blocked — ${payload.safety.violations.length} violation(s)`}
        </span>
      </div>

      {/*
        v9 — THE "WHAT IT KNEW" STRIP IS GONE, and the count it fed stays.

        It listed every constraint and preference in enforcement tokens —
        `allergens peanuts · dietary no_pork · medical rohan_low_sodium · prefer
        prefer_white_meat, chicken_turkey_fish_over_red_meat,
        match_protein_to_activity_load` — directly under a heading saying the plan was
        composed. The user had read all of it two screens earlier, on the confirm gate,
        in a form built to be read; here it was a database row, and the `prefer` list
        alone ran to three snake_case tokens on one line.

        `knewChips` survives because "4 constraints honoured" above is the honest,
        one-word version of the same fact.
      */}

      <ol className="days">
        {payload.plan.map((item, index) => {
          const isChanged = changed.has(item.id);
          const morph = morphs[item.id];
          const open = openId === item.id;
          const when = formatWhen(item.when) ?? `${String(index + 1).padStart(2, "0")}`;
          // v7: a day deliberately left empty. STILL RENDERED — deleting the row was the
          // alternative and it is worse: a shorter plan says nothing about why it got
          // shorter, and reads as data loss rather than as a decision someone made.
          const skipped = item.status === "skipped";

          return (
            <li
              key={`${item.id}:${isChanged ? morphSeq : 0}`}
              ref={firstChangedId === item.id ? changedRowRef : undefined}
              className={`day${open ? " day--open" : ""}${isChanged ? " day--morph" : ""}${skipped ? " day--skipped" : ""}`}
            >
              <button
                type="button"
                className="day__row"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : item.id)}
              >
                <span className="day__when">{when}</span>
                {/* The mark, between the date and the title: what KIND of thing this row
                    is, before the words say which one. Seven rows of near-identical text
                    is a list you scan; a row you can recognise is one you read. */}
                <Icon name={marks[index]} size={18} className="day__mark" />
                <span className="day__titles">
                  {/* Explicit "Cancelled → New" framing: the labels carry the story even
                      when old and new titles are near-identical, and the cancelled line
                      PERSISTS after the morph settles. */}
                  {morph ? (
                    <span className="day__old">
                      <span className="day__oldlabel">Cancelled</span>
                      <s>{morph.prevTitle}</s>
                    </span>
                  ) : null}
                  <strong className="day__title">
                    {morph ? <span className="day__newlabel">New</span> : null}
                    {item.title}
                  </strong>
                  {/* v7: ALWAYS VISIBLE. `why` has ridden the wire since v2 and lived
                      inside a collapsed row nobody opens — which is where the one piece
                      of evidence that something reasoned about this day was kept. */}
                  {skipped && item.status_reason ? (
                    <span className="day__why">
                      <span aria-hidden>✈ </span>
                      {item.status_reason}
                    </span>
                  ) : item.why.length > 0 ? (
                    <span className="day__why">
                      <Icon name="corner-down-right" size={14} className="day__why-mark" />
                      {item.why[0]}
                    </span>
                  ) : null}
                </span>
                {isChanged ? <span className="day__updated">Updated</span> : null}
                <Icon name="chevron-down" size={16} className="day__chevron" />
              </button>

              {/* Stays mounted: the collapse animates the grid row track, so opening and
                  closing is one interruptible transition instead of a mount. */}
              <div className="day__detail" aria-hidden={!open}>
                <div className="day__inner">
                  {item.detail ? <p className="day__body">{item.detail}</p> : null}
                  {item.why.length > 1 || item.tags.length > 0 ? (
                    <div className="day__tags">
                      {/* The FIRST why is on the row above now; anything further is
                          supporting detail and stays here. */}
                      {item.why.slice(1, 3).map((reason) => (
                        <span key={reason} className="tag tag--why">
                          <Icon name="corner-down-right" size={12} strokeWidth={2} />
                          {reason}
                        </span>
                      ))}
                      {item.tags.slice(0, 4).map((tag) => (
                        <span key={tag} className="tag">
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {/* v7 — WHAT IT THREW AWAY. A lookup table cannot reject, so this is the clearest
          evidence on the card that something weighed options. Model-authored and
          display-only; absent is normal and the block simply does not render. */}
      {payload.considered || (payload.rejected && payload.rejected.length > 0) ? (
        <section className="weighed" aria-label="What it considered">
          {/* v9 — NO COUNTS. "10 options considered · 5 rejected" spent the line on two
              numbers nobody can check, in front of the four rejections that are the
              actual evidence. What the reader wants from this block is WHAT was thrown
              away and WHY; the arithmetic of it says nothing they can use. */}
          <p className="weighed__head">
            <Icon name="lightbulb" size={15} className="weighed__mark" />
            Also considered
          </p>
          {payload.rejected && payload.rejected.length > 0 ? (
            <ul className="weighed__list">
              {payload.rejected.slice(0, 4).map((r) => (
                <li key={`${r.option}:${r.reason}`} className="weighed__item">
                  <s>{r.option}</s>
                  <span className="weighed__reason">{r.reason}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {payload.impact.length > 0 ? (
        <p className="impact" aria-label="Impact">
          {payload.impact.map((badge) => (
            <span
              key={`${badge.label}:${changedImpact.has(badge.label) ? morphSeq : 0}`}
              className={changedImpact.has(badge.label) ? "impact__item impact__item--tick" : "impact__item"}
            >
              <strong>{badge.value}</strong> {badge.label}
            </span>
          ))}
        </p>
      ) : null}

      <div ref={approvalsRef}>
        <ProposalList
          proposals={payload.proposals}
          statuses={proposalStatuses}
          onDecide={onDecide}
        />
      </div>
    </article>
  );
}
