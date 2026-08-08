/**
 * gate 35 — the aurora, and the five ways it becomes a liability instead of a flourish.
 *
 * Run:  node scripts/verify_aurora.mjs        (no browser, no audio, no network)
 *
 * WHY A GATE FOR DECORATION. Because it is not decoration in the places that matter. It
 * is a fixed layer at z 40 covering the bottom of a touch panel whose two most important
 * controls — Confirm, and Approve & Save — live at the bottom of their cards. Every
 * failure below is silent in review and obvious on a fridge in front of an audience:
 *
 *   1. it eats taps (Approve & Save stops working, and barge-in with it);
 *   2. it hides under the saving takeover, so the goodbye is spoken to a blank screen;
 *   3. it strobes between sentences, because v11.2 emits one frame per SENTENCE;
 *   4. it flashes on the first tap, because priming plays a silent clip;
 *   5. it animates something the Hub's old webview cannot composite at 60fps.
 *
 * This reads the shipped files. It cannot prove the light looks good — that needs eyes
 * and a real run — but every check here is a fact the code either states or does not.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, "..", p), "utf8");

const css = read("src/styles.css");
const speech = read("src/lib/speech.ts");
const component = read("src/components/Aurora.tsx");

const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); };

/** Body of the first `selector { ... }` rule. Naive on purpose: these blocks have no
 *  nested braces, and a parser here would be more code than the thing it guards. */
function ruleBody(source, selector) {
  const at = source.indexOf(selector + " {");
  if (at === -1) return null;
  const open = source.indexOf("{", at);
  const close = source.indexOf("}", open);
  return close === -1 ? null : source.slice(open + 1, close);
}

// --- 1. it must never eat a tap -----------------------------------------------------
const aurora = ruleBody(css, ".aurora");
check(aurora !== null, "styles.css must define a `.aurora` rule");
check(aurora !== null && /pointer-events:\s*none/.test(aurora),
  ".aurora must set `pointer-events: none` — it covers Approve & Save, and barge-in is a tap ANYWHERE");
check(aurora !== null && /position:\s*fixed/.test(aurora),
  ".aurora must be `position: fixed` — the panel scrolls below 720px and an absolute band would scroll off with it");

// --- 2. it must outrank the saving takeover ----------------------------------------
const savingBody = ruleBody(css, ".saving");
const z = (body) => { const m = body && body.match(/z-index:\s*(\d+)/); return m ? Number(m[1]) : null; };
const auroraZ = z(aurora);
const savingZ = z(savingBody);
check(auroraZ !== null, ".aurora must declare a z-index");
check(savingZ !== null, ".saving must declare a z-index (this gate compares them)");
check(auroraZ !== null && savingZ !== null && auroraZ > savingZ,
  `.aurora (z ${auroraZ}) must paint ABOVE .saving (z ${savingZ}) — cue 5, the goodbye, is spoken while the saving takeover holds the surface`);

// --- 3. cheap to composite on a years-old webview -----------------------------------
const auroraCss = css.slice(css.indexOf(".aurora {"));
for (const banned of ["backdrop-filter", "mask-image", "-webkit-mask", "box-shadow"]) {
  check(!auroraCss.includes(banned),
    `the aurora must not use \`${banned}\` — the fade is each gradient's own falloff, and the Hub's webview repaints this at 60fps`);
}
check(!/\bfilter:\s*blur/.test(auroraCss),
  "the aurora must not use `filter: blur()` — four blurred layers is the one thing that will not hold frame rate on the Hub");

// Every aurora keyframe may touch transform and opacity, and nothing else: anything
// else is a layout or paint property and takes the whole band off the compositor.
const keyframes = [];
for (const m of auroraCss.matchAll(/@keyframes\s+(aurora-[\w-]+)\s*\{/g)) {
  // Balance the braces: a keyframe body contains nested `from {}` / `to {}` blocks, and
  // some of these rules are written on one line. A lazy regex silently swallows the
  // NEXT rule instead, which is how this gate first "found" transitions inside a
  // keyframe that has none.
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  while (i < auroraCss.length && depth > 0) {
    if (auroraCss[i] === "{") depth += 1;
    else if (auroraCss[i] === "}") depth -= 1;
    i += 1;
  }
  keyframes.push([m[0], m[1], auroraCss.slice(start, i - 1)]);
}
check(keyframes.length >= 8,
  "expected at least 8 aurora keyframes (4 drift + 4 breathe) — the coprime periods are what stop it reading as a loop");
for (const [, name, body] of keyframes) {
  const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
  const offenders = props.filter((p) => p !== "transform" && p !== "opacity");
  check(offenders.length === 0,
    `@keyframes ${name} animates ${offenders.join(", ")} — only transform and opacity may animate here`);
}

// Coprime-ish: no two layers may share a drift duration, or the mix visibly repeats.
const durations = [...auroraCss.matchAll(/animation-duration:\s*([\dsm.]+),\s*([\dsm.]+)/g)].map((m) => m[1]);
check(durations.length >= 4, "each aurora layer must declare its own animation-duration pair");
check(new Set(durations).size === durations.length,
  `two layers share a drift period (${durations.join(", ")}) — matched periods make a four-layer aurora read as a loop within two cycles`);

// --- 3b. it must actually look like it is moving ------------------------------------
// The first cut animated at 14-23s over ~70px: about 5px per second, which is motion by
// the spec sheet and static to the eye. Two independent guards against that returning.
const seconds = (v) => (v.endsWith("ms") ? Number(v.slice(0, -2)) / 1000 : Number(v.slice(0, -1)));
for (const d of durations) {
  check(seconds(d) <= 6,
    `a drift period of ${d} is too slow to read as movement. This ceiling was earned: 14-23s read as frozen, and 5.5-13s STILL had to be stared at. A smooth translucent silhouette needs ~50px/s of travel before the eye calls it motion.`);
}
const sways = [...auroraCss.matchAll(/\.aurora__sway--(\w+)\s*\{[\s\S]*?animation-duration:\s*([\dsm.]+);/g)];
check(sways.length === 3, "each curtain needs a sway wrapper with its own horizontal period — one element can only run one transform animation, and a lone sliding curtain is what 'no motion' looked like");
check(new Set(sways.map((m) => m[2])).size === sways.length,
  `two curtains sway on the same period (${sways.map((m) => m[2]).join(", ")})`);
for (const [, key, sway] of sways) {
  const own = auroraCss.match(new RegExp(`\\.aurora__curtain--${key}\\s*\\{[\\s\\S]*?animation-duration:\\s*([\\dsm.]+),`));
  check(own !== null, `.aurora__curtain--${key} must declare its own stretch period`);
  check(own !== null && own[1] !== sway,
    `curtain ${key} sways and stretches on the same period (${sway}) — they beat back to the same silhouette every cycle, which is the whole reason to nest two elements`);
}

// --- 3c. it must not eat the panel --------------------------------------------------
const bandHeight = aurora && aurora.match(/height:\s*(\d+)px/);
check(bandHeight !== null, ".aurora must declare a pixel height");
check(bandHeight !== null && Number(bandHeight[1]) <= 200,
  `the band is ${bandHeight?.[1]}px — over ~200px it stops being an edge and becomes a quarter of a 1280px panel, which reads as decoration with a size problem`);

// --- 4. reduced motion drops the drift, keeps the arrival ---------------------------
const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)", css.indexOf(".aurora {")));
check(/\.aurora__layer\s*\{\s*animation:\s*none/.test(reduced),
  "prefers-reduced-motion must stop the drift — a slow, wide, endless oscillation is the vestibular pattern to drop");
check(/\.aurora\s*\{[\s\S]*?transition:\s*opacity/.test(reduced),
  "prefers-reduced-motion must KEEP the fade — that it arrives and leaves is the information; the movement is not");

// --- 5. the light follows the AUDIO, not the queue's optimism -----------------------
check(/subscribePlayback/.test(speech) && /subscribePlayback/.test(component),
  "Aurora must subscribe to lib/speech's playback state — SpeechQueue reports \"playing\" BEFORE play() resolves, so light bound to it glows for a voice that turns out to be blocked");
for (const event of ["playing", "pause", "ended", "error"]) {
  check(new RegExp(`addEventListener\\("${event}"`).test(speech),
    `speech.ts must announce playback state on "${event}" — \`pause\` in particular is barge-in, and light that outlives a silenced voice is worse than none`);
}
check(/startsWith\("data:"\)/.test(speech),
  "the data: URI guard must survive — primeOnFirstGesture PLAYS a silent clip to spend the gesture, and without this the first tap anywhere flashes the aurora over silence");

// --- 6. the gap grace, and the fact that silence renders nothing --------------------
const grace = component.match(/GAP_GRACE_MS\s*=\s*(\d+)/);
check(grace !== null, "Aurora.tsx must define GAP_GRACE_MS");
check(grace !== null && Number(grace[1]) >= 100 && Number(grace[1]) <= 400,
  `GAP_GRACE_MS is ${grace?.[1]} — a cue is one frame per SENTENCE since v11.2, so too short strobes 4-6 times per screen and too long claims the Hub is still talking`);
check(/if\s*\(!mounted\)\s*return null/.test(component),
  "Aurora must render null until something has actually been spoken — v11's first rule is that a voiceless run renders exactly as v10");
check(/aria-hidden="true"/.test(component),
  "the aurora must be aria-hidden — the audio IS the announcement, and a live region would narrate over the voice");
check(/requestAnimationFrame/.test(component),
  "the --on class must land a frame AFTER mount, or there is no initial state to transition from and the light simply appears");

// ------------------------------------------------------------------------------------
if (failures.length > 0) {
  console.error("gate 35 FAILED\n");
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("gate 35 OK — aurora: passes taps, outranks the takeover, composites cheaply, follows the audio");
