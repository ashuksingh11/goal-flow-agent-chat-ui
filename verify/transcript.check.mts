/**
 * Gate — the reasoning transcript never renders raw JSON.
 *
 * Run:  npx tsx verify/transcript.check.mts     (no server, no API key)
 *
 * WHY THIS EXISTS. The grounding model narrates and then dumps the structured context it
 * assembled into the SAME token stream. The first defence tested each streamed fragment
 * for a leading brace and dropped it — which deleted the chunks carrying the braces and
 * kept everything between them, so a blob reached the stage as mangled pseudo-prose
 * (`"time_window": "start": "2026-07-28",`). Case 1 is that exact failure. Cases 3 and 4
 * are what a naive brace-counter gets wrong. Case 6 is the one that matters most: prose
 * must survive untouched.
 */

import { stripJsonBlobs } from "../src/lib/reasoning";

let pass = 0;
let fail = 0;
const check = (name: string, got: string, want: string) => {
  if (got === want) {
    pass += 1;
    console.log("  ok   " + name);
  } else {
    fail += 1;
    console.log(
      "  FAIL " + name + "\n    got:  " + JSON.stringify(got) + "\n    want: " + JSON.stringify(want),
    );
  }
};

// 1. the real shape of the leak: prose, a closed blob, more prose
check(
  "prose + closed blob + prose",
  stripJsonBlobs(
    'broke the goal into 7 steps: Gather items.\n{ "time_window": { "start": "2026-07-28", "end": "2026-08-02" }, "size": 4 }\nNow selecting recipes.',
  ),
  "broke the goal into 7 steps: Gather items.\n⟨context · time_window, size⟩\nNow selecting recipes.",
);

// 2. still streaming (never closes) — cut to the end, keep the prose before it
check(
  "unterminated blob",
  stripJsonBlobs('Assembling context.\n{ "family": { "members": [{ "name": "Priya"'),
  "Assembling context.\n⟨context · still arriving…⟩",
);

// 3. a brace inside a string must not close the blob early
check(
  "brace inside a string literal",
  stripJsonBlobs('Note.\n{ "note": "a } inside", "x": 1 }\nDone.'),
  "Note.\n⟨context · note, x⟩\nDone.",
);

// 4. escaped quote inside a string
check(
  "escaped quote",
  stripJsonBlobs('A.\n{ "q": "say \\" then }", "y": 2 }\nB.'),
  "A.\n⟨context · q, y⟩\nB.",
);

// 5. residue when the opening brace arrived before this buffer (reconnect mid-blob) —
//    one blob leaves several adjacent markers, and they collapse to the most informative
check(
  "headless residue lines",
  stripJsonBlobs(
    'Checking.\n"budget_cap_usd": 120,\n"quiet_hours": { "start": "21:30" }\n},\nCarrying on.',
  ),
  "Checking.\n⟨context · start⟩\nCarrying on.",
);

// 6. prose is untouched — arrows, colons, quotes, apostrophes, numbered lists
const prose =
  'Four people. Maya\'s profile lists a "severe" peanut allergy: that is a hard block, not a warning.\n\n1. Salmon — clear. 2. Ragu — clear.';
check("prose untouched", stripJsonBlobs(prose), prose);

// 7. a top-level array blob
check(
  "array blob",
  stripJsonBlobs('Items:\n[{ "id": "inv-001" }, { "id": "inv-002" }]\nthat is all.'),
  "Items:\n⟨context · 2 items⟩\nthat is all.",
);

// 8. nothing to do
check("empty", stripJsonBlobs("   \n  "), "");

console.log(`\ntranscript gate: ${fail === 0 ? "PASS" : "FAIL"} (${pass} passed, ${fail} failed)`);
process.exit(fail ? 1 : 0);
