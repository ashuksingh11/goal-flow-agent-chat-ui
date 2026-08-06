/**
 * speechQueue.ts — one voice, five cues, and the rules for what happens when they collide.
 *
 * v11.0 had one cue and needed no scheduler: a frame arrived, it played. Five cues on a
 * serial channel is a different problem, because the run does not wait for the voice.
 * Measured on a real run, grounding starts ~3s after the confirm tap and the planner
 * ~10s after that — so an utterance is very often still speaking when the next one is
 * ready, and "just play it" means two voices at once.
 *
 * FIVE RULES, and every one of them exists because of a specific way the naive version
 * sounds wrong:
 *
 *   1. ONE AT A TIME. Two voices from a fridge is worse than none.
 *   2. NEWER WINS, when the newer thing is more important. The plan landing while
 *      "now putting the week together" is still talking must cut it off — the sentence
 *      has been overtaken by the event it was describing.
 *   3. PROGRESS IS DISPOSABLE. If `working_plan` is queued behind something and the plan
 *      arrives, it is not spoken LATER — it is dropped. Narration about work is only
 *      true while the work is happening.
 *   4. DECISIONS ARE NOT. `understanding` and `approvals` ask the user for something. A
 *      question that gets cut off leaves someone waiting to be asked.
 *   5. BARGE-IN. Any tap stops the voice. Someone who is acting does not need to be
 *      talked at, and a UI that keeps narrating over a user's decision is not assisting.
 *
 * The priority ordering is the whole policy, and it is deliberately NOT "newest wins"
 * flat: that would let a progress line interrupt a question.
 */

import type { SpeechPayload } from "../types/contract";
import { play, stop, whenEnded, type PlaybackOutcome } from "./speech";

/**
 * How much a cue is allowed to interrupt, and how much it survives being interrupted.
 *
 * GATE (2) — the run has STOPPED and is waiting for a human. Never interrupted.
 * SUBSTANCE (1) — something worth hearing, delivered in order. Interrupts progress
 *   (rule 2), never interrupts a peer.
 * PROGRESS (0) — reassurance while work happens. Interrupts nothing, and is discarded
 *   the moment anything else is ready (rule 3).
 *
 * `approvals` SITS AT 1, NOT 2, and the gate caught this the first time it ran. Ranking
 * it as a decision looked obviously right — it asks the user for something — but the
 * cloud emits it immediately after `plan`, on the same screen (ProposalList renders
 * inside PlanCard). At 2 it outranked the plan summary and cut it off EVERY TIME: the
 * user would hear "Your week's rea—" then "Two things need your approval." The pair is
 * sequential, not competing, and equal rank is what makes them queue instead of fight.
 *
 * Nothing is lost by the demotion: 1 still outranks progress, and the rule-3 filter
 * only discards rank 0, so an approvals line can never be dropped.
 */
const PRIORITY: Record<string, number> = {
  understanding: 2,
  plan: 1,
  approvals: 1,
  saved: 1,
  working_start: 0,
  working_plan: 0,
};

function priorityOf(cue: string): number {
  // An unknown cue is treated as PROGRESS — the humblest thing it can be. A future cue
  // that should interrupt has to say so here, rather than acquiring the power to talk
  // over a question by being unrecognised.
  return PRIORITY[cue] ?? 0;
}

export interface QueuedSpeech {
  payload: SpeechPayload;
  /** Monotonic per-utterance, so equal priorities resolve in arrival order. */
  seq: number;
}

export interface SpeechQueueOptions {
  /** Surfaces the current state so the card can render "playing" / "blocked". */
  onOutcome: (outcome: PlaybackOutcome | "idle", payload: SpeechPayload | null) => void;
}

export class SpeechQueue {
  private pending: QueuedSpeech[] = [];
  private current: QueuedSpeech | null = null;
  private seq = 0;
  private generation = 0;
  private readonly onOutcome: SpeechQueueOptions["onOutcome"];

  constructor(options: SpeechQueueOptions) {
    this.onOutcome = options.onOutcome;
  }

  /** Offer an utterance. It may play now, wait, cut something off, or be dropped. */
  push(payload: SpeechPayload): void {
    const incoming: QueuedSpeech = { payload, seq: this.seq++ };
    const incomingPriority = priorityOf(payload.cue);

    // Rule 3: anything of real importance clears queued progress chatter. Dropped, not
    // deferred — "checking your kitchen" spoken after the plan has landed is a lie
    // about the present tense.
    if (incomingPriority > 0) {
      this.pending = this.pending.filter((item) => priorityOf(item.payload.cue) > 0);
    }

    // Rule 2: cut off what is speaking, but only for something that outranks it. Equal
    // priority WAITS — two questions in a row are both worth hearing, and a plan
    // summary must not truncate itself with its own approvals line.
    if (this.current && incomingPriority > priorityOf(this.current.payload.cue)) {
      this.stopCurrent();
    }

    this.pending.push(incoming);
    this.pending.sort((a, b) => priorityOf(b.payload.cue) - priorityOf(a.payload.cue) || a.seq - b.seq);
    void this.drain();
  }

  /**
   * Rule 5, and also what a screen change calls. Everything queued is abandoned: the
   * utterances were about a moment that has passed.
   */
  clear(): void {
    this.pending = [];
    this.stopCurrent();
    this.onOutcome("idle", null);
  }

  /** The tap on "Hear this" — replays what was blocked, WITH the user's gesture. */
  retry(): void {
    const target = this.current ?? this.pending[0] ?? null;
    if (target) void this.speak(target);
  }

  private stopCurrent(): void {
    this.current = null;
    // Bump the generation so an in-flight play() resolving later cannot report an
    // outcome for an utterance we have already abandoned — the async equivalent of a
    // stale pointer, and the reason the card would otherwise show "playing" forever.
    this.generation += 1;
    stop();
  }

  private async drain(): Promise<void> {
    if (this.current || this.pending.length === 0) return;
    const next = this.pending.shift()!;
    await this.speak(next);
  }

  private async speak(item: QueuedSpeech): Promise<void> {
    this.current = item;
    const generation = ++this.generation;
    this.onOutcome("playing", item.payload);

    const outcome = await play(item.payload);
    if (generation !== this.generation) return; // superseded mid-flight

    this.onOutcome(outcome, item.payload);
    if (outcome === "blocked") {
      // Hold position: the card is showing "Hear this", and retry() needs something to
      // replay. Draining past it would silently skip the utterance the user is about to
      // ask for.
      return;
    }

    // WAIT FOR THE AUDIO TO END, not for play() to resolve. play() reports within ~150ms
    // so a refusal reaches the card promptly; the utterance itself runs 4-10 seconds.
    // Draining on the former would start the next line a heartbeat into this one — the
    // precise overlap this queue exists to prevent.
    if (outcome === "playing") await whenEnded();
    if (generation !== this.generation) return;

    this.current = null;
    void this.drain();
  }
}
