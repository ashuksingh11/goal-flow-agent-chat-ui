# Code Guide — goal-flow-agent-chat-ui

The **create-phase surface**: a "watch it think" stage that streams the agent's work live,
renders the plan as the hero, and hosts the two human gates (confirm-understanding, then the
tiered plan approval). It consumes the contract canonical in the cloud repo, mirrored
field-for-field in `src/types/contract.ts`, and is **domain-agnostic** end to end — no
meal-specific field exists in the types or components; the same UI carries a meal week or a
vacation prep timeline purely as data.

**Two lifecycle facts that explain most of the code:**

- **This surface is ephemeral (v4.1).** Bixby owns goal entry — there is **no composer here**
  and this UI never sends `user_goal`. It lives in a webview bracketed by
  `chat_ui_open`/`chat_ui_close`.
- **It owns creation, not the goal's life (v3.1).** After the initial approval it shows a
  hand-off banner; monitoring, world-event simulation and adaptation approvals belong to the
  Agent Board. `EventStrip` / `DemoControls` / `AdaptationCard` were removed from here.

System design: `../goal-flow-agents/docs/DESIGN.md`.

## File map

```
index.html
package.json                 # scripts: dev / build (tsc -b && vite build) / preview
.env.example                 # VITE_WS_URL=ws://localhost:8000/ws
src/
  main.tsx                   # StrictMode > ErrorBoundary > App
  App.tsx                    # socket + THE streaming reducer + stage layout  ← start here
  lib/ws.ts                  # createGoalFlowSocket: handshake, reconnect, validation
  types/contract.ts          # wire mirror (discriminated unions on `type`)
  types/ui.ts                # reducer output vocabulary (NOT wire types)
  styles.css                 # design tokens (light theme) + the v5.1 keyframes
  panel.css                  # the v5.2 panel: new class names only, loaded AFTER styles.css
  components/                # all presentational — props in, callbacks out
```

## Component tree

```
App                        — socket + streaming state machine (one pure reducer) + stage
├── DevicePicker            — one-time device-agent picker while unbound (multi-session pairing)
├── GoalBar                — the goal as the title, run clock, engines-cleared hairline (v5.1)
├── column
│   ├── WorkingColumn      — receipts / focus card (transcript + tool chips INSIDE it) / ghosts, on one spine
│   ├── PlanColumn         — rows landing into reserved slots, then the hero
│   │   └── PlanCard       — the generic plan hero
│   │       └── ProposalList — tiered approvals (auto / light / firm)
│   └── StatusTimeline     — quiet sustain ticks while monitoring
├── UnderstandingCard      — the pre-planning gate; doubles as the capture card (v6)
├── handoff banner         — "Plan approved — continue on your Board" (v3.1)
└── PresenterFeed          — raw WS frame feed ("Show agent flow" toggle)
```

`HarnessTheater` is the presenter theater (v5): a full-bleed, projection-scale rendering of the
same `HarnessState` the working column uses — a big engine strip plus a "NOW RUNNING" hero card,
shown only in presenter mode while the agent works. The reducer still folds `proposal`/
`status` frames — a UI left open past approval keeps its plan in sync — but no longer renders
adaptations; the board does.

Data flow is strictly down-props / up-callbacks; no state library. `main.tsx` wraps `App`
in `ErrorBoundary` so one bad frame never blanks the app.

## The socket (`lib/ws.ts`)

`createGoalFlowSocket()` opens ONE WebSocket to `VITE_WS_URL` (default
`ws://localhost:8000/ws`), sends `hello {role:"ui", device_id}` on open (`device_id` from
`getDeviceId()`, below), and reconnects after 1.5 s on drop (re-sending `hello`). Inbound
frames are JSON-parsed and validated against the set of UI-inbound `type`s (`hello_ack`,
`capabilities`, `agent_event`, `understanding`, `present_plan`, `proposal`, `status`,
`notice`, `devices`) — unknown frames are warned and dropped, never rendered (this allowlist
was the site of the old `notice`-frame bug: an un-whitelisted type is silently DROPPED, worth
remembering when adding a new inbound frame). `onMessage` / `onSent` / `onStateChange` feed the
App reducer, the presenter feed, and the header connection dot.

**Device pairing (multi-session).** The cloud now serves many device agents and many UIs at
once, paired by `device_id` (a "home" = 1 device + N UIs):

- `getDeviceId(search?)` reads `?device=<id>` from the query string — per-tab and
  platform-independent, so it works in the Tizen Hub's browser and a tablet alike. Empty when
  absent, which tells the cloud to auto-bind or offer a picker.
- `getRememberedDeviceId()` / `rememberDeviceId()` persist the user's picker choice in
  `localStorage` (`goalflow.device_id`) — **deliberately not sent in `hello`**: a remembered
  device that has since gone offline would silently bind the UI to a dead session. Instead
  `App` matches it against the live `devices` list, so pairing self-heals when a device drops.

## The streaming state machine (`App.tsx`)

All inbound frames pass through **one pure reducer**, `reduceInbound` — the entire
event→UI-state mapping lives there and nowhere else, so it's testable and the components
stay dumb. `UiState` holds: `activeGoalId`, `phase`, `working`, `understanding`, `goalText`
(the goal in words — it arrives only as `understanding.objective`, since this surface never
sends `user_goal`), `declinedGoalId`, `agentEntries` (thinking + chips), `harness` (the engine
pipeline + spotlight), `draftItems` / `draftQueue` / `draftHoldUntil` / `draftTotal` (the paced
plan reveal), `plan`, `planMorphs`, `proposalStatuses`, `ticks`, `frames` (presenter feed, capped
at 120), `lastSeq`, `boundDeviceId` (from `hello_ack.device_id`; `null` while unbound), and
`deviceChoices` (`DeviceInfo[] | null` from the `devices` frame; `null` = never offered ⇒ bound,
`[]` = offered but no device online yet).

`adaptations`, `eventChips` and `demoClock` are still **folded** — a UI left open past approval
keeps its plan in sync — but nothing here renders them; those surfaces moved to the board in
v3.1.

| Inbound frame | Reducer effect | What the user sees |
|---|---|---|
| `hello_ack` | `boundDeviceId` ← `device_id`, `deviceChoices` cleared; frame feed | connection dot turns green; `DevicePicker` (if shown) closes |
| `devices` | `deviceChoices` ← `payload.devices` (only while unbound) | `DevicePicker` appears if `> 1` device or none online |
| `capabilities` | store `modules` | (chips name real registry functions) |
| `chat_ui_open` | HARD-RESET keyed to `goal_id` (idempotent per goal) | the stage clears for the new goal |
| `chat_ui_close` | back to idle | the webview can be torn down |
| `agent_event · phase` | `phase` ← payload | the focus card's status line advances |
| `agent_event · harness` | queued into `harness` (paced) | the next engine lights; the resolved one leaves a receipt |
| `agent_event · thinking` | append/merge into the last thinking entry | reasoning line streams with a caret |
| `agent_event · tool_call` | push chip `{module, fn, state:"running"}` | chip pops in (`chip-pop`) |
| `agent_event · tool_result` | resolve the most recent *running* chip matching `module.function` | chip flips to ✓ + one-line summary |
| `agent_event · plan_progress` | push a `DraftPlanItem` | one skeleton row is replaced by a real draft row |
| `understanding` | `understanding` set, `goalText` ← objective, `working` off, phase → `confirming` | `UnderstandingCard` renders objective/constraints/thought — plus the capture ticks when `proposed_constraints` is present — and blocks on Confirm / Decline |
| `present_plan` | `plan` set, `understanding` cleared, `working` off, phase → `awaiting_approval` (via `task_status`) | **the hero animates in** (`card-enter`) as the reserved slots fill |
| `proposal` (adapting) | folded into `adaptations`, phase from `task_status` | nothing here — the board owns adaptation |
| `status` | tick appended (cap 40); `executed[]` flips proposals to `done`; `updated_plan` + `changed_ids` replace the plan in place and seed `planMorphs` (old title/detail) so `PlanCard` morphs the changed row (strike-through → slide in); phase from `task_status` | quiet timeline dot; approvals confirm; a changed row morphs |

Outbound `understanding_response {goal_id, payload:{confirmed, accepted_constraint_ids}}` answers
`sendUnderstanding()`. Outbound `select_device {device_id}` (via `selectDevice()`, called by
`DevicePicker.onSelect` or by an effect that auto-picks the remembered/only device from
`state.deviceChoices`) answers the pairing prompt — `rememberDeviceId()` runs first so the
choice sticks, then the cloud's `hello_ack{device_id}` confirms the bind.

Ordering/dedupe: `agent_event.seq` is monotonic per goal — `reduceAgentEvent` drops
`seq <= lastSeq` (late/duplicate frames after a reconnect). Consecutive `thinking` fragments
merge into one accumulating entry.

**What this surface sends, in full:** `hello`, `select_device`, `understanding_response`,
`approval`. Not `user_goal` (Bixby owns entry, v4.1) and not `control` (the board owns the world
tick, v3.1). Outbound frames are mirrored into the presenter feed via `onSent`. Sending decisions
(`decisions_sent`) marks those proposals `pending` optimistically — they flip to `done` only when
a later `status.payload.executed[]` entry confirms them.

Column layout logic (in `App`'s render): `awaitingDevicePick = boundDeviceId === null &&
deviceChoices !== null` renders `DevicePicker` ahead of everything else — the cloud drops frames
from an unbound UI, so nothing useful can happen yet. `UnderstandingCard` shows whenever
`state.understanding` is set, ahead of everything else. `WorkingColumn` shows once any beat has
fired and stays past `present_plan` until the beat queue drains, then keeps its receipts and
shrinks (`run--compact`, applied whenever no focus card renders). `PlanColumn` shows the reveal
(`formingPlan = draftQueue.length > 0 || (plan === null && draftItems.length > 0)`) and swaps to
`PlanCard` when the queue drains — which is why `present_plan` must NOT clear the draft queue.
Once the plan is approved the hand-off banner replaces the actions: the goal's life continues on
the board.

## Device pairing (`DevicePicker`)

Renders while `awaitingDevicePick` (see Stage layout logic above): a "Waiting for a device
agent…" message if `state.deviceChoices` is empty, else a list of `DeviceInfo {device_id,
device_name}` buttons ("Which device agent is yours?"). Clicking one calls `onSelect(device_id)`
→ `App.selectDevice`, which persists the pick (`rememberDeviceId`) and sends
`select_device {device_id}`; the picker disappears once `hello_ack.device_id` confirms the bind.
An effect in `App` skips the picker automatically when `state.deviceChoices` has exactly one
entry, or contains the browser's remembered `device_id` (`getRememberedDeviceId()`) — so this
UI only asks a human once per browser, and only when genuinely ambiguous (2+ devices online,
none remembered). `?device=<id>` in the URL bypasses pairing entirely (the value goes straight
into `hello`, so the cloud binds on connect and neither `devices` nor the picker ever appear).

## The confirm-understanding gate (`UnderstandingCard`)

Renders `Understanding.payload`: `objective` as the heading, `knew` constraints as a 2-up chip
grid (via `PlanCard`'s shared `knewValue()`), and `thought` as a line of agent reasoning. Two
buttons — **Confirm & plan** and **Decline** — call `onConfirm(acceptedConstraintIds)` /
`onDecline`, which `App` wires to `sendUnderstanding(confirmed, acceptedIds)`: dispatches
`understanding_sent` (clears `state.understanding`; on decline also records `declinedGoalId` so
late frames for that goal are dropped) and sends `understanding_response {goal_id,
payload:{confirmed, accepted_constraint_ids}}`.

The chips deliberately **do not stagger in** — allergens and a medical restriction are safety
data, and nothing the user must read should move. The two actions are deliberately *unequal*:
Confirm is the filled primary, Decline a ghost.

**Double duty as the capture card (v6).** When the payload carries `proposed_constraints`, the
card grows a capture section: one **checkbox per rule**, the user's own words quoted back, and
an ENFORCED badge on rules the device will actually block against. Nothing is remembered that
was not ticked — `accepted_constraint_ids` is the whole write authority.

With `capture_only: true` the utterance was a statement, not a goal: the header reads
**REMEMBERING** instead of PLANNING, the button reads **Remember this** instead of Confirm &
plan, and no plan or board card follows.

## The create-phase bracket (`chat_ui_open` / `chat_ui_close`)

Both frames are in `ws.ts`'s `INBOUND_TYPES` — the allowlist silently drops anything unlisted,
so forgetting a line there is indistinguishable from the feature not working.

- **`chat_ui_open {goal_id}`** HARD-RESETS the stage keyed to that goal, and thereafter
  goal-scoped frames for any *other* goal are ignored. The reset is **idempotent per goal**:
  re-receiving open for the goal already keyed is a no-op, or the cloud's bind-time replay
  (open → `understanding` → `present_plan`) would wipe the state it is about to restore.
- **`chat_ui_close {goal_id}`** returns the surface to idle.

That replay is why a webview can connect *after* the understanding was computed and still show
it — the old race, fixed at the lifecycle rather than in the router.

## The working column (`WorkingColumn` + `types/ui.ts`)

One column for the passage of work: resolved engines collapse into 41px receipts (name ·
verdict · measured duration), the running one holds the single focus card (with the live
transcript and its tool chips inside it), the rest are ghosts. Between beats no engine is lit, so
the card is **borrowed** by the next one up (`pending`) rather than vanishing — losing the only
stretchy element for a second would make everything below it jump.

**Boxes fit their content; caps stop the page scrolling.** The first cut conserved total height by
letting the focus card absorb every spare pixel, which put a one-line note in a box half the
screen tall. Now the card grows with what it holds (transcript scrolls at `max-height: 34vh`), the
run column caps at 62%, and the outcome region takes the rest.

Durations are stamped in `enqueueHarness` at ARRIVAL, never at paint: paint is paced by
`HARNESS_ACTIVE_FLOOR_MS`, so measuring at drain time would just report the floor back. Under
`HARNESS_MIN_TIMED_MS` (100ms) no duration is printed at all — Safety / Task Manager / Approval
resolve in the same millisecond they light up because their real work happened earlier, and
"0.0s" would read as "did nothing".

`RAIL_PHASES` / `railPhaseFromStatus` still drive the phase-derived status line inside the focus
card (`lib/reasoning.ts`), but there is no longer a separate rail component.

## The hero (`PlanCard`)

Renders only the generic `PlanItem` shape — `title / detail / when? / why[] / tags[]`:

1. **Knew line** — `payload.knew` (free-form key → value) as compact chips; the credibility
   line. `knewValue()` renders only primitives/string lists — objects collapse to `""`
   (defensive: a raw object child would crash React).
2. **Safety chip** — `payload.safety`: green "Safety ✓ passed" or red "blocked" (violations
   in the tooltip) — "LLM plans, code checks", rendered.
3. **Plan items** — staggered entrance (`--i` index custom property); `when` formats via
   `Intl` (invalid dates render nothing); `why[0]` is a collapsed `<details>` with the rest
   inside; tags as pills. Minimal text by design.
4. **Impact badges** — `payload.impact` `{label, value}` stat pills.
5. **`ProposalList`** — the approval gate (below).

The full `explanation` hides behind a collapsed "Why this plan" `<details>`.

## Tiered approvals (`ProposalList`, `TIER_META` in `types/ui.ts`)

Every `PlanProposal` carries `tier` (reversibility × cost × risk):

| Tier | Meaning | Treatment |
|---|---|---|
| `auto` | reversible, already executed | muted row, inline ✓, **no buttons** ("Done automatically") |
| `light` | cheap consent | compact row, one quiet **OK** |
| `firm` | spends money / irreversible | heavy card: warm accent, the exact capability call rendered as `module.function · args summary`, explicit **Approve / Decline** |

Decision lifecycle per proposal (`ProposalStatusMap`): *(none)* → `pending` (buttons vanish,
"Waiting for confirmation") → `done` ("Added ✓ - detail" or "Declined"), confirmed **only**
by a `status.payload.executed[]` entry — the UI renders the contract invariant literally:
nothing above `auto` executes until the approval round-trips.

A refused effect comes back in `executed[]` as `blocked_safety` with the filter's reason, and is
**not** marked executed — a block is a result, not a silent success.

## Presenter mode (`PresenterFeed`)

The header "Show agent flow" toggle reveals every raw frame: direction (▲ sent / ▼ recv),
`type`, terse human label (`describeFrame`). High-volume `agent_event · thinking` frames are
collapsed into burst rows (`compactFrames`: "thinking burst · 12 frames · seq 3-14"). Off by
default so the demo surface stays clean.

## Defensive rendering

- `ErrorBoundary` (class component, in `main.tsx`) catches render errors → compact fallback
  + Dismiss, logs the component stack. One bad frame never blanks the app.
- `ws.ts` drops frames whose `type` isn't a known UI-inbound type, and survives JSON parse
  failures.
- `PlanCard.knewValue` and `formatWhen`, `ProposalList.summarizeArgs`, and
  `StatusTimeline.tickDay` all render `""`/nothing on malformed values instead of throwing.
- Lists are capped: 120 presenter frames, 40 ticks (8 visible), 10 chips, thinking ticker
  shows the last ~200 chars.

## Styling & motion (`styles.css` + `panel.css`)

**Light theme** since v5: `--bg: #eceff4` soft grey, `--surface: #ffffff` cards, ink
`--ink: #1a1e2c`, one accent `--accent: #3f6fe8`, semantics `--good` / `--warn` (firm tier) /
`--danger`, each with a `-soft` tint. `panel.css` loads **after** `styles.css` and adds only new
class names, so it cannot collide with the v5.1 rules GoalBar / theater / presenter feed still
use; it also adds `--violet` (medical constraints) and the motion vocabulary (`--p-ease-out`,
`--p-dur`, …) — use those curves rather than inventing parallel ones.

Motion signals *agent momentum* only (something animates only when the agent did something);
loading is the shape of the content, never a spinner; only `transform`/`opacity` animate; and
`prefers-reduced-motion` collapses all of it. **No motion library** — React + Vite + TS are the
only dependencies.

## Run & verify

Full-stack demo commands live in one place: `../goal-flow-agents/docs/FINAL_DEMO.md`.

```bash
npm install
npm run build                   # tsc -b && vite build (type-checks)
npm run dev                     # binds all interfaces; leave VITE_WS_URL unset (derives the hub from the page host)
```

Needs the cloud hub on :8000. Read the port Vite prints — it is assigned in start order, so it is
only 5173 if this app started first. Nothing happens here until a goal is entered in the Bixby
surrogate, since this surface has no composer.

## Extending it

- **New message type:** add it to `contract.ts` (and the `UiInboundMessage` /
  `UiOutboundMessage` unions), whitelist it in `ws.ts`'s `INBOUND_TYPES`, handle it in
  `reduceInbound`, and render from the state it produces. Keep the mirror in sync with the
  canonical `CONTRACT.md` (cloud repo), `models/contract.py`, the board UI's `contract.ts`, and
  the C# mirror (device repo) — `verify_mirrors.py` gates it.
- **New component:** keep it presentational — props from `UiState`, callbacks up to `App`;
  put any new derived state in the reducer, not in the component.
- **New agent_event kind:** extend the `AgentEvent` union (`event` discriminant) and add a
  case to `reduceAgentEvent`; the exhaustive switch will flag it at compile time.
- **`MicButton.tsx` is an orphan** — it takes `onTranscript` and nothing renders it since the
  composer was removed in v4.1. Voice entry belongs to Bixby now; the file is kept only because
  a real Hub surface may want it back.
- **New domain:** nothing to do — `PlanCard`/`ProposalList` render generic items, tiers,
  and badges; a new domain is new data through the same frames.
