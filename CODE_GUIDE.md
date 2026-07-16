# Code Guide — goal-flow-agent-chat-ui (v2)

The v2 UI is the tablet client of the GoalFlow **general** goal agent: a "watch it think"
stage that streams the agent's work live, renders the plan as the hero, hosts the tiered
human-in-the-loop approval gate, and drives the demo's simulated clock. It consumes
**CONTRACT v2** (canonical in the cloud repo; mirrored field-for-field in
`src/types/contract.ts`) and is **domain-agnostic** end to end — no meal-specific field
exists anywhere in the types or components; the same UI carries a meal week or a
guest-dinner prep timeline purely as data.

Spec: `docs/ARCHITECTURE.md`. Framing: `../goal-flow-agents/docs/V2_DESIGN_PROPOSAL.md`.

## File map

```
index.html
package.json                 # scripts: dev / build (tsc -b && vite build) / preview
.env.example                 # VITE_WS_URL=ws://localhost:8000/ws
src/
  main.tsx                   # StrictMode > ErrorBoundary > App
  App.tsx                    # socket + THE streaming reducer + stage layout  ← start here
  lib/ws.ts                  # createGoalFlowSocket: handshake, reconnect, validation
  types/contract.ts          # CONTRACT v2 mirror (discriminated unions on `type`)
  types/ui.ts                # reducer output vocabulary (NOT wire types)
  styles.css                 # design tokens + every keyframe (CSS-only motion)
  components/                # all presentational — props in, callbacks out
```

## Component tree

```
App                        — socket + streaming state machine (one pure reducer) + stage
├── DevicePicker            — one-time device-agent picker while unbound (multi-session pairing)
├── ProgressRail           — Interpreting → Grounding → Confirm → Planning → Checking → Approval → Monitoring
├── stage
│   ├── GoalComposer       — input row (inline in App.tsx) + MicButton (STT stub)
│   ├── UnderstandingCard  — confirm-understanding gate: objective/constraints/thought; Confirm & plan / Decline
│   ├── AgentStream        — live thinking ticker + tool-call chips
│   ├── Skeleton           — shimmering plan silhouette while planning
│   ├── PlanCard           — the generic plan hero
│   │   └── ProposalList   — tiered approvals (auto / light / firm)
│   ├── AdaptationCard     — the loud "caught a change" card
│   └── StatusTimeline     — quiet sustain ticks while monitoring
├── EventStrip             — presenter-fired demo event chips (idle→firing→fired), when the plan has demo_events
├── DemoControls           — sim clock: derived day/date, week strip, Advance/Reset/Set date (fallback, no demo_events)
└── PresenterFeed          — raw WS frame feed ("Show agent flow" toggle)
```

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
stay dumb. `UiState` holds: `phase` (rail), `working`, `understanding`, `agentEntries` (thinking
+ chips), `draftItems`, `plan`, `proposalStatuses`, `adaptations`, `ticks`, `demoClock`,
`eventChips` / `firedEventIds` / `firingEventId`, `planMorphs` / `morphSeq`, `frames`
(presenter feed, capped at 120), `lastSeq`, `boundDeviceId` (from `hello_ack.device_id`;
`null` while unbound), and `deviceChoices` (`DeviceInfo[] | null` from the `devices` frame;
`null` = never offered ⇒ bound, `[]` = offered but no device online yet).

| Inbound frame | Reducer effect | What the user sees |
|---|---|---|
| `hello_ack` | `boundDeviceId` ← `device_id`, `deviceChoices` cleared; frame feed | connection dot turns green; `DevicePicker` (if shown) closes |
| `devices` | `deviceChoices` ← `payload.devices` (only while unbound) | `DevicePicker` appears if `> 1` device or none online |
| `capabilities` | store `modules` | (chips name real registry functions) |
| `agent_event · phase` | `phase` ← payload | rail advances, active dot pulses |
| `agent_event · thinking` | append/merge into the last thinking entry | reasoning line streams with a caret |
| `agent_event · tool_call` | push chip `{module, fn, state:"running"}` | chip pops in (`chip-pop`) |
| `agent_event · tool_result` | resolve the most recent *running* chip matching `module.function` | chip flips to ✓ + one-line summary |
| `agent_event · plan_progress` | push a `DraftPlanItem` | one skeleton row is replaced by a real draft row |
| `understanding` | `understanding` set, `working` off, phase → `confirming` | `UnderstandingCard` renders objective/constraints/thought and blocks on Confirm & plan / Decline |
| `present_plan` | `plan` set, `understanding` cleared, `working` off, drafts cleared, `eventChips` built from `payload.demo_events`, phase → `awaiting_approval` (via `task_status`) | **the hero animates in** (`card-enter`) over the dissolving skeleton; `EventStrip` appears once the plan is approved if `demo_events` is non-empty |
| `proposal` (adapting) | append to `adaptations`, phase from `task_status`; `event_id` (payload or top-level) flips the matching event chip to `fired` | the AdaptationCard slides in with a glow |
| `status` | tick appended (cap 40); **clock MERGED** (see below); `executed[]` flips proposals to `done`; `updated_plan` + `changed_ids` replace the plan in place and seed `planMorphs` (old title/detail) so `PlanCard` morphs the changed day-row (strike-through → slide in); `event_id` flips the matching event chip to `fired`; phase from `task_status` | quiet timeline dot; approvals confirm; sim day advances; a fired event's adaptation lands as a morphing row |

Outbound `understanding_response {goal_id, payload:{confirmed}}` answers `sendUnderstanding()`.
Outbound `control {command:"trigger_event", event_id}` (via `fireEvent()`) fires an event chip —
gated on `state.approved` and a 30 s firing timeout (`event_timeout` action) in case the
round-trip never lands. Outbound `select_device {device_id}` (via `selectDevice()`, called by
`DevicePicker.onSelect` or by an effect that auto-picks the remembered/only device from
`state.deviceChoices`) answers the pairing prompt — `rememberDeviceId()` runs first so the
choice sticks, then the cloud's `hello_ack{device_id}` confirms the bind.

Ordering/dedupe: `agent_event.seq` is monotonic per goal — `reduceAgentEvent` drops
`seq <= lastSeq` (late/duplicate frames after a reconnect). Consecutive `thinking` fragments
merge into one accumulating entry.

Outbound: `user_goal`, `approval`, and `control` are mirrored into the frame feed via
`onSent`. Submitting a goal (`goal_submitted` action) **resets the stage** and optimistically
lights "Interpreting" until the device's own phase events take over. Sending decisions
(`decisions_sent`) marks those proposals `pending` optimistically — they flip to `done` only
when a later `status.payload.executed[]` entry confirms them.

Stage layout logic (in `App`'s render): `awaitingDevicePick = boundDeviceId === null &&
deviceChoices !== null` renders `DevicePicker` ahead of everything else and disables the goal
composer — the cloud drops frames from an unbound UI, so nothing useful can happen yet.
`UnderstandingCard` shows whenever `state.understanding`
is set, ahead of everything else, and blocks the goal composer; `AgentStream` shows while there's
no understanding gate or plan and the agent is working; `planPending = working && !plan` shows
draft rows + `Skeleton` (count shrinks as drafts arrive: `max(1, 4 - drafts)`); `PlanCard`
replaces both once `present_plan` lands. Below the stage: `EventStrip` renders when the plan
carries `demo_events` (`hasEventStrip`), otherwise `DemoControls` renders once a plan exists
(`hasDemoControls`) — the two are mutually exclusive per plan.

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

Renders `Understanding.payload`: `objective` as the heading, `knew` constraints as chips (via
`PlanCard`'s shared `knewValue()`), and `thought` as a line of agent reasoning. Two buttons —
**Confirm & plan** (`button--firm`) and **Decline** (`button--ghost`) — call `onConfirm`/
`onDecline`, which `App` wires to `sendUnderstanding(confirmed)`: dispatches the
`understanding_sent` action (clears `state.understanding`; on decline also records
`declinedGoalId` so any late frames for that goal are dropped) and sends
`understanding_response {goal_id, payload:{confirmed}}`. No `resolved` prop is passed in the
live flow, so the card always shows its action buttons while mounted; the `resolved` states
("Confirmed. Planning next." / "Declined.") exist for a brief resolved rendering if reintroduced.

## The event-driven meal week (`EventStrip`)

When `present_plan.payload.demo_events` is non-empty (`DemoEvent {id, label, day, title, kind,
order}`), `EventStrip` replaces `DemoControls` for that plan. Chips are day-labelled ("Day N"
from `event.day`, never a calendar date) and sorted by `order`; each is `idle` (locked until
`state.approved`), `firing` (clicked, awaiting a round-trip, spinner, everything else disabled),
or `fired` (✓, permanently disabled). `onFire(eventId)` → `App.fireEvent` dispatches
`event_fired` (chip → `firing`) and sends `control {command:"trigger_event", payload:{event_id}}`;
a 30 s timer (`event_timeout`) unsticks a chip whose round-trip never lands. The device's
resulting `proposal`/`status` echoes `event_id` (top-level or `payload.event_id`) — the reducer's
`markEventFired` matches it back to the chip and flips it to `fired`. Approving that adaptation's
proposal is what delivers the `status.updated_plan` / `changed_ids` that morph the plan card (see
above). "Reset week" sends `control {command:"reset"}` and clears the strip client-side.

## The rail (`ProgressRail` + `types/ui.ts`)

Seven steps in `RAIL_PHASES` (Interpreting, Grounding, **Confirm**, Planning, Checking, Approval,
Monitoring). Driven by `agent_event:phase` while working, by the `understanding` frame (→
`confirming`), and by `railPhaseFromStatus(task_status)` on `present_plan`/`proposal`/`status` —
`executing`/`monitoring`/`adapting`/`done` all fold into **Monitoring**. Per-step states:
`done` (check), `active` (`rail-pulse`, connector filling), `todo` (dim). `phase === null`
(before the first goal) renders the rail idle/dimmed.

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

`AdaptationCard` reuses the same tier treatment for a `proposal` frame's Adapt/Decline:
trigger line ("Caught a change: calendar: recital added Thu 18:00") → action + detail →
tier-weighted buttons → the same pending/confirmed states via `proposalStatuses`.

## The generic sim clock (`DemoControls` + `DemoClock` in `types/ui.ts`)

The fallback control for plans with no `demo_events` (see `EventStrip` above, which takes over
for the event-driven meal week). Three rules, enforced in code (this fixes the v1 bug where any status frame lacking
`day`/`sim_date` snapped the label back to a hardcoded "Mon"):

1. **Merge, never replace** — `mergeDemoClock` updates only the fields a status carries.
2. **Derive, never hardcode** — `deriveClockDisplay` computes the weekday/date labels and
   the Monday-start 7-day week strip from `sim_date` via `Intl` (local-safe ISO parsing);
   before the first status it derives from the **real today**.
3. **Device is the source of truth** — Advance day / Reset / Set date send `control` frames
   (`advance_day` / `reset` / `set_date {date}` from a native date input); the strip is
   **not optimistic** — it re-renders when the echoed `status` arrives, with a brief
   "syncing" shimmer (auto-clears after 1.8 s) in between.

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

## Styling & motion (`styles.css`)

Design tokens on `:root`: deep-ink base `--bg: #0b0e14` with a radial glow, glass panels,
one accent `--accent: #5b8cff`, semantics `--good` / `--warn: #ffb454` (firm tier) /
`--danger: #ff6b6b`. Keyframes: `skeleton-shimmer`, `chip-pop`, `rail-pulse`, `card-enter`,
`caret-blink`, `tick-appear`. Motion signals *agent momentum* only (something animates only
when the agent did something); loading is the shape of the content, never a spinner;
`prefers-reduced-motion` collapses all animation. **No motion library** — React + Vite + TS
are the only dependencies.

## Run & verify

# Full-stack demo commands live in goal-flow-agents/docs/FINAL_DEMO.md.
```bash
npm install
npm run build                   # tsc -b && vite build (type-checks)
npm run dev                     # binds all interfaces; leave VITE_WS_URL unset (derives the hub from the page host)
```

Open http://localhost:5173 (needs the cloud hub on :8000).

## Extending it

- **New message type:** add it to `contract.ts` (and the `UiInboundMessage` /
  `UiOutboundMessage` unions), whitelist it in `ws.ts`'s `INBOUND_TYPES`, handle it in
  `reduceInbound`, and render from the state it produces. Keep the mirror in sync with the
  canonical CONTRACT v2 (cloud repo) and the C# mirror (device repo).
- **New component:** keep it presentational — props from `UiState`, callbacks up to `App`;
  put any new derived state in the reducer, not in the component.
- **New agent_event kind:** extend the `AgentEvent` union (`event` discriminant) and add a
  case to `reduceAgentEvent`; the exhaustive switch will flag it at compile time.
- **Speech-to-text:** wire `MicButton.tsx` to the browser Web Speech API (in-browser only);
  it already takes `onTranscript` and is rendered inside `GoalComposer`.
- **New domain:** nothing to do — `PlanCard`/`ProposalList` render generic items, tiers,
  and badges; a new domain is new data through the same frames.
