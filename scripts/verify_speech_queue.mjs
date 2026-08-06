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
  if (q.current && p > priorityOf(q.current.cue)) q.current = null;         // rule 2
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

// RULE 2 — the plan cuts off progress chatter.
q = makeQueue();
push(q, "working_plan");
push(q, "plan");
check(q.current.cue === "plan",
  "the PLAN interrupts 'now putting the week together' — that sentence has been overtaken by the event it was describing");

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
check(/spokenCursor/.test(app),
  "and the effect must drain from a cursor rather than react to one value");

// --- barge-in must not eat its own button --------------------------------------------
check(/closest\?\.\(["'`]\.speak-chip/.test(app),
  "barge-in must EXEMPT .speak-chip: the listener is on capture, so without this the tap clears the queue before the chip's own handler asks it to replay — and the one button whose job is to make audio happen silently does nothing");
check(/pointerdown["']\s*,\s*hush\s*,\s*true\)/.test(app),
  "barge-in listens on the capture phase, so no component has to remember to hush");

for (const f of failures) console.log(`  FAIL ${f}`);
console.log(`gate 32 (speech queue): ${failures.length ? `FAIL: ${failures.length}` : "PASS"}`);
process.exit(failures.length ? 1 : 0);
