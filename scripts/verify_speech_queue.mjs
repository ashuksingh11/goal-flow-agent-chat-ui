/**
 * gate 32 — the speech queue's policy, which is the whole of v11.1's UI risk.
 *
 * Run:  node scripts/verify_speech_queue.mjs      (no browser, no audio, no network)
 *
 * WHAT THIS PROTECTS. The cloud can now emit six utterances across one create phase, on
 * a channel that plays exactly one thing at a time, driven by a run that does not wait.
 * Every way this goes wrong is a way it goes wrong ON STAGE and cannot be walked back:
 * two voices at once, a question talked over, a progress line spoken after the thing it
 * described has finished, or the "Hear this" button silently doing nothing.
 *
 * None of that is reachable from a unit test of the real module, because `play()` needs
 * an HTMLAudioElement. So the POLICY — which is the part that can be wrong — is
 * re-implemented here against the same priority table and exercised directly. That is a
 * real limitation and worth naming: this gate proves the RULES are coherent, not that
 * SpeechQueue calls the DOM correctly. The DOM half is covered by the live browser run.
 *
 * If the priority table in lib/speechQueue.ts changes, this file must change with it —
 * they are checked against each other below, so a drift fails rather than passes quietly.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../src/lib/speechQueue.ts"), "utf8");

const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); };

// --- the table this gate reasons about must BE the shipped table ---------------------
const PRIORITY = { understanding: 2, plan: 1, approvals: 1, saved: 1, working_start: 0, working_plan: 0 };
for (const [cue, rank] of Object.entries(PRIORITY)) {
  const found = new RegExp(`${cue}:\\s*${rank}\\b`).test(source);
  check(found, `lib/speechQueue.ts must rank ${cue} at ${rank} — this gate is reasoning about a stale table otherwise`);
}
check(/PRIORITY\[cue\] \?\? 0/.test(source),
  "an UNKNOWN cue must default to PROGRESS (0) — a future cue must not acquire the power to talk over a question by being unrecognised");
// The model above is only as good as its agreement with the shipped module. This is the
// check that would have caught the drift when rule 2 was reversed: the interrupt is gone
// from push(), so the model must not simulate one either.
check(!/incomingPriority > priorityOf\(this\.current/.test(source),
  "push() must not interrupt what is speaking — v11.11 removed that, and this gate's own model was left asserting the opposite until it was caught");
check(/this\.pending = this\.pending\.filter/.test(source),
  "but rule 3 must remain: progress that has NOT started is still dropped, which is what keeps a stale line from ever beginning");
check(/await whenEnded\(\)/.test(source),
  "the queue must wait for the audio to END, not for play() to resolve — play() reports in ~150ms and utterances run 4-10s, so draining on it is the two-voices bug");

// --- a model of the policy, exercised ------------------------------------------------
const priorityOf = (cue) => PRIORITY[cue] ?? 0;

function makeQueue() {
  return { pending: [], current: null, seq: 0, spoken: [] };
}
function push(q, cue) {
  const p = priorityOf(cue);
  if (p > 0) q.pending = q.pending.filter((i) => priorityOf(i.cue) > 0);   // rule 3
  // rule 2 (v11.11): NOTHING is interrupted. What is already speaking finishes its
  // sentence; priority decides who goes NEXT, via the sort below.
  q.pending.push({ cue, seq: q.seq++ });
  q.pending.sort((a, b) => priorityOf(b.cue) - priorityOf(a.cue) || a.seq - b.seq);
  drain(q);
}
function drain(q) {
  if (q.current || q.pending.length === 0) return;
  q.current = q.pending.shift();
  q.spoken.push(q.current.cue);
}
function finish(q) { q.current = null; drain(q); }

// RULE 1 — one at a time.
let q = makeQueue();
push(q, "working_start");
push(q, "working_plan");
check(q.spoken.length === 1 && q.current.cue === "working_start",
  "two utterances offered together: only ONE speaks. Two voices from a fridge is worse than none");
check(q.pending.length === 1, "the second waits its turn rather than being lost");
finish(q);
check(q.current.cue === "working_plan", "and speaks when the first ends");

// RULE 2 (v11.11) — nothing is cut off mid-sentence; the plan goes NEXT, not NOW.
//
// This assertion used to be the exact opposite, and the reversal came from hearing it on
// a Hub: a sentence chopped mid-word does not read as "overtaken by events", it reads as
// the voice breaking. The staleness that justified the interrupt is still handled by
// rule 3 — a line that has not STARTED is dropped and nobody knows. A line already in
// the room gets to finish.
q = makeQueue();
push(q, "working_plan");
push(q, "plan");
check(q.current.cue === "working_plan",
  "a sentence already being spoken is never cut off — a chopped word reads as a fault in the machine, which costs more than a few seconds of stale narration");
check(q.pending[0].cue === "plan",
  "and the plan is queued FIRST, so it is next the moment the current sentence ends");
finish(q);
check(q.current.cue === "plan", "then the plan speaks");

// RULE 3 — queued progress is DROPPED, not deferred.
q = makeQueue();
push(q, "understanding");
push(q, "working_start");     // queued behind the question
push(q, "plan");              // ...and now overtaken
check(!q.pending.some((i) => i.cue === "working_start"),
  "queued progress is DISCARDED when something real arrives — 'checking your kitchen' spoken after the plan has landed is a lie about the present tense");

// RULE 4 — a question is never talked over.
q = makeQueue();
push(q, "understanding");
push(q, "working_start");
check(q.current.cue === "understanding",
  "progress must NOT interrupt a question — someone would be left waiting to be asked");
push(q, "plan");
check(q.current.cue === "understanding",
  "and neither does an outcome: a decision outranks news about one");

// Equal priority WAITS rather than truncating itself.
q = makeQueue();
push(q, "plan");
push(q, "approvals");
check(q.current.cue === "plan" && q.pending[0].cue === "approvals",
  "the plan summary must not be cut off by its own approvals line — equal weight means queue, not interrupt");
finish(q);
check(q.current.cue === "approvals",
  "and the approvals line follows it, so a screen that says two things says both");

// Arrival order breaks ties.
q = makeQueue();
push(q, "understanding");
finish(q);
push(q, "plan");
push(q, "saved");
check(q.current.cue === "plan" && q.pending[0].cue === "saved",
  "equal priority resolves in ARRIVAL order — the plan before the goodbye");

// --- the batching bug, which only a live run could find -------------------------------
//
// The cloud emits `plan` and `approvals` back-to-back on one screen. React batches both
// into ONE re-render, so a `Speech | null` slot in state only ever exposes the SECOND —
// and the plan summary, the single most valuable utterance in the flow, was silently
// never spoken. It reproduced on every live run and on none of the headless ones,
// because a headless client has no reducer to batch. Hence: append-only, drained by a
// cursor.
const app = readFileSync(join(here, "../src/App.tsx"), "utf8");
check(/speech:\s*Speech\[\]/.test(app),
  "state.speech must be a LIST — a single slot loses one of any two utterances that arrive in the same React batch, which is exactly what plan+approvals do");
check(/speech:\s*\[\.\.\.withGoal\.speech,\s*message\]/.test(app),
  "the reducer must APPEND, so two frames in one tick are both representable");
// v11.7 — and it must NOT drain from a positional cursor. This check used to assert the
// opposite, and it kept passing after the cursor was deleted because the word survives in
// the comment explaining why. A gate satisfied by prose is not a gate.
//
// An index is only meaningful while the array grows monotonically, and `state.speech` is
// reset to [] on present_plan and five other transitions. Whenever the post-reset batch
// came back at least as long as the old cursor, `slice(cursor)` was empty and the plan
// narration was never spoken at all: 3 of 3 real goals lost it.
check(!/const spokenCursor = useRef/.test(app),
  "the positional cursor must stay deleted — it silently ate the plan narration whenever state.speech was reset to a list at least as long as the cursor");
check(/for \(const frame of state\.speech\)/.test(app),
  "the effect must scan the WHOLE list and skip by identity; position cannot survive an array the reducer replaces");

// --- v11.6: an utterance is spoken at most once ---------------------------------------
//
// The cursor stops the SAME frame being drained twice; it does nothing about the same
// utterance ARRIVING twice, which is a normal event. The socket reconnects on any
// non-1012 close and re-sends `hello`, and the cloud answers a fresh bind by replaying
// the understanding / plan / approvals speech — correct for a webview that binds
// mid-gate, wrong for this one, which already said all of it. Symptom from a real run:
// leave the approvals screen untouched and the voice starts up again minutes later.
//
// The cloud cannot fix this: it cannot tell a reconnecting socket from a new surface.
check(/spokenIds/.test(app),
  "App must remember which utterance_ids it has spoken — the cloud replays speech to any freshly-bound socket, so a reconnect repeats the plan and approvals lines into a screen that already heard them");
check(/spokenIds\.current\.has\(frame\.payload\.utterance_id\)/.test(app),
  "and it must skip on utterance_id, which is deterministic per (goal_id, cue) and per sentence within it — the only stable identity an utterance has");
check(!/spokenIds\.current\.clear\(\)/.test(app),
  "the set must never be cleared mid-document, or the cloud's next replay repeats everything");

// v11.8 — and it must survive a RELOAD of the webview slot. Reported from a Tizen Hub
// and not reproducible on Ubuntu: the Hub owns the webview's lifetime, so the document
// can be replaced under us, and a fresh document with an empty Set hears the cloud's
// create-phase replay as new. sessionStorage is the deliberate middle: it survives a
// reload of the same slot, and does NOT survive a genuinely new surface — which must
// still hear the question it binds in the middle of.
check(/sessionStorage/.test(app),
  "spoken utterance ids must survive a webview reload — the Hub can replace the document under us, and an empty Set turns the cloud's replay back into a repeat");
check(!/localStorage\.getItem\(SPOKEN_KEY|localStorage\.setItem\(SPOKEN_KEY/.test(app),
  "and NOT localStorage: that would silence a genuinely new webview that binds mid-gate, which is the case the cloud's replay exists to serve");
check(/SPOKEN_LIMIT/.test(app),
  "the persisted list must be bounded");

// --- v11.9: a superseded webview goes quiet -------------------------------------------
//
// The cloud now closes an older chat socket with 1012 when a newer one binds, which
// stops it being SENT anything. That is necessary and not sufficient: on a Hub the
// document can stay alive, backgrounded, still holding an audio element mid-sentence.
// Reported there — press Approve, hear it twice, cloud logging chat_surfaces=2.
const ws = readFileSync(join(here, "../src/lib/ws.ts"), "utf8");
check(/onReplaced/.test(ws),
  "lib/ws.ts must surface the 1012 replacement — a webview the Hub replaced but did not destroy has to be told");
check(/subscriber\.onReplaced\?\.\(\)/.test(ws),
  "and notify subscribers on that close, before returning without a reconnect");
check(/onReplaced:\s*\(\)\s*=>\s*speechQueueRef\.current\?\.clear\(\)/.test(app),
  "App must STOP the voice when superseded — the cloud can stop sending to a stale surface but cannot stop what it is already playing");

// --- barge-in must not eat its own button --------------------------------------------
check(/closest\?\.\(["'`]\.speak-chip/.test(app),
  "barge-in must EXEMPT .speak-chip: the listener is on capture, so without this the tap clears the queue before the chip's own handler asks it to replay — and the one button whose job is to make audio happen silently does nothing");
check(/capture:\s*true/.test(app),
  "barge-in listens on the capture phase, so no component has to remember to hush");

// v11.10 — a SCROLL is reading, not a decision, and must not silence the voice.
//
// Touch-scrolling begins with a pointerdown, so hushing on pointerdown alone silenced
// the narration every time someone scrolled the plan — constant on a fridge with a
// seven-day plan. It hid for two versions: desktop scrolling is a WHEEL event and fires
// no pointerdown, and on the Hub the platform instantly restarted the audio this had
// just stopped, so the stop was invisible underneath the repeat it caused.
check(/TAP_SLOP_PX/.test(app),
  "barge-in needs a movement threshold — intent is not knowable at pointerdown, because a press that becomes a scroll and a press that becomes a tap are the same event until one of them moves");
check(/addEventListener\("pointerup"/.test(app) && /addEventListener\("pointermove"/.test(app),
  "the decision must land on pointer-UP with pointermove able to disqualify it; that is the whole tap-versus-scroll test");
check(/const up = \(event: PointerEvent\) => \{[\s\S]{0,220}speechQueueRef\.current\?\.clear\(\)/.test(app),
  "and the queue must be cleared from the pointerUP handler, not from pointerdown");
check(!/addEventListener\("pointerdown",\s*hush/.test(app),
  "the old hush-on-pointerdown listener must stay gone");
check(/pointercancel/.test(app),
  "a cancelled pointer is not a tap either — the browser took it for a gesture");

for (const f of failures) console.log(`  FAIL ${f}`);
console.log(`gate 32 (speech queue): ${failures.length ? `FAIL: ${failures.length}` : "PASS"}`);
process.exit(failures.length ? 1 : 0);
