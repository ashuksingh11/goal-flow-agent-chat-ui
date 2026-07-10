# UI Architecture — v2 (the wow UI)

## Role

The UI is the human surface of the GoalFlow v2 generic goal agent: it captures a goal, shows the
agent **working live** (streamed thinking + tool calls), renders the plan as the **hero**, hosts the
**tiered approval gate**, and surfaces adaptation. It never plans, never executes, and never talks
to the device — its single peer is the cloud hub, over one WebSocket.

CONTRACT v2 is canonical in the cloud repo; this repo's mirror is
[`../src/types/contract.ts`](../src/types/contract.ts) (discriminated unions on `type`; agent
events further discriminate on `event`).

**Why v2 exists:** v1 was rejected as "too much text, no loading, no progress, not wow." v2 leads
with motion and visuals: a live agent stream, a progress rail, skeleton loaders, and a plan hero —
prose is trimmed to rationale-on-demand.

## Component tree

```
App                        — socket + STREAMING STATE MACHINE (one pure reducer) + stage layout
├── ProgressRail           — Interpreting → Grounding → Planning → Checking → Approval → Monitoring
├── stage
│   ├── GoalComposer       — single input row (inline in App) + MicButton (STT stub)
│   ├── AgentStream        — live thinking stream + tool-call chips ("Inventory.GetExpiringItems ✓")
│   ├── Skeleton           — shimmering plan-silhouette rows while planning (never a spinner)
│   ├── PlanCard           — the GENERIC plan hero: Knew line, safety chip, items, impact badges
│   │   └── ProposalList   — TIERED approvals (auto = done, light = quick OK, firm = heavy)
│   ├── AdaptationCard     — the loud "caught a change" card (proposal frames, adapting)
│   └── StatusTimeline     — quiet sustain ticks while monitoring
├── DemoControls           — sim clock: derived day/date, week strip, Advance/Reset/Set date
└── PresenterFeed          — raw WS frame feed ("Show agent flow" toggle, kept from v1, refined)
```

Data flow is strictly down-props / up-callbacks; no state library. All inbound frames pass through
**one pure reducer** in `App.tsx` (`reduceInbound`) — the event→state mapping below lives there and
nowhere else, so the streaming behavior is testable and the components stay presentational.

## Streaming event → UI state mapping

| Inbound frame | Reducer effect | What the user sees |
|---|---|---|
| `hello_ack` | frame feed only | connection dot turns green |
| `capabilities` | `modules` stored | (debug/legend; chips name real registry functions) |
| `agent_event · phase` | `phase` ← payload | rail dot slides + pulses on the new phase |
| `agent_event · thinking` | append/merge text into last thinking entry | reasoning line streams with a caret — momentum |
| `agent_event · tool_call` | push chip `{module, fn, running}` | chip pops in (spring), accent ring while running |
| `agent_event · tool_result` | resolve most recent matching running chip → `done` + summary | chip flips to ✓ + one-line summary |
| `agent_event · plan_progress` | push `draftItems` | one skeleton row is replaced by a real draft row |
| `present_plan` | `plan` set; `working` off; drafts cleared; phase → awaiting_approval | **the hero animates in** over the dissolving skeleton |
| `proposal` (adapting) | append `adaptations`; phase → monitoring | the loud AdaptationCard slides in with a glow |
| `status` | tick appended; **clock MERGED** (see fix); `executed[]` → proposal statuses `done`; phase from task_status | quiet timeline dot; approvals confirm; sim day advances |

`agent_event.seq` is monotonic per goal: the reducer drops `seq <= lastSeq` (dedupe after
reconnect). Outbound (`user_goal`, `approval`, `control`) are mirrored into the frame feed;
`user_goal` resets the stage and optimistically lights "Interpreting" until the device's own phase
events take over. Approvals mark their proposals `pending` optimistically and flip to `done` only
when a `status.executed[]` entry confirms.

## Progress rail

Six steps (`types/ui.ts RAIL_PHASES`): **Interpreting → Grounding → Planning → Checking → Approval
→ Monitoring**. Driven by `agent_event:phase` while working and by `task_status` on
`present_plan`/`proposal`/`status` (`railPhaseFromStatus`: `executing`/`adapting`/`done` fold into
Monitoring). States per step: `done` (green dot + check), `active` (accent dot, `rail-pulse`
keyframe, connector filling), `todo` (dim). Idle (no goal yet) renders the rail dimmed.

## Tiered approvals

Every proposal carries `tier` (reversibility × cost × risk):

| Tier | Meaning | Treatment |
|---|---|---|
| `auto` | reversible, already executed | muted row, check, **no buttons** — "done automatically" |
| `light` | cheap consent (add to list) | compact row, single quiet **OK** |
| `firm` | spends money / irreversible | **visually heavy**: warm accent border/tint, capability call (`module.function`) spelled out, explicit **Approve / Decline** |

Contract invariant rendered literally: nothing above `auto` executes until the `approval` frame
returns; `firm` never auto-executes. The AdaptationCard reuses the same tier treatment for its
Adapt/Keep actions.

## Demo controls — and the v1 day-update bug, fixed

State: `DemoClock { simDate, dayLabel }` (types/ui.ts), owned by the App reducer.

**The v1 bug:** the strip displayed `latestStatus.payload.day || "Mon"`. Every status frame
*replaced* the tracked frame, so execution confirmations and quiet ticks — which omit
`day`/`sim_date` — snapped the label back to a hardcoded "Mon". "Advance day" appeared dead.

**The v2 fix (enforced in code, not convention):**

1. **Merge, never replace** — `mergeDemoClock` updates only the fields a status actually carries;
   a frame without `sim_date` cannot wipe the clock.
2. **Derive, never hardcode** — `deriveClockDisplay` computes the weekday/date labels and the
   7-day week strip from `sim_date` via `Intl` on the real parsed date (local-safe ISO parsing).
   Before the first status it derives from the **real today** — no literal "Mon", no hardcoded
   dates anywhere (matches the contract's generic-clock invariant).
3. **Device is the source of truth** — Advance day / Reset / Set date send `control` frames
   (`set_date` carries `payload.date` from a native date input); the strip re-renders from the
   echoed `status`, not optimistically. (Impl adds a brief "syncing" shimmer between the two.)

## Presenter mode

The v1 "Show agent flow" toggle survives, refined: `PresenterFeed` shows every raw frame
(▲ sent / ▼ recv, `type`, terse label). v2 additions: `agent_event` frames labeled by
`event · seq` and collapsed in bursts (they are high-volume). Off by default — clean demo surface.

## Domain-agnostic plan rendering

`PlanCard` renders only the generic `PlanItem` shape — `title / detail / when? / why[] / tags[]` —
so the identical hero carries a meal week, a guest-dinner prep timeline, or chores. No meal fields
exist in the contract or the components; domain flavor arrives purely as data (titles, tags,
impact-badge labels, `knew` keys). This is the on-screen proof of "general agent, not a meal app."

## Visual & motion spec

**Palette** (tokens in `src/styles.css`): deep-ink base `#0b0e14` with a subtle radial glow, glass
cards (`rgba(255,255,255,.045)` + hairline strokes), one electric accent `#5b8cff`, semantics
green `#3ddc97` / amber `#ffb454` (firm tier) / red `#ff6b6b`. Inter/system type; tool chips in
monospace.

**Animation principles**

1. Motion signals *agent momentum*, never decoration: something animates only when the agent did
   something (chip pop, rail pulse, row materializing).
2. Enter with ease-out (160–480 ms tokens); chips get a small spring overshoot; nothing bounces
   twice.
3. Loading = shape of the content (skeleton shimmer in the plan's silhouette), never spinners.
4. Loud is reserved: the AdaptationCard is the only glowing entrance — earned by the calm ticks
   around it.
5. `prefers-reduced-motion` collapses all animation.

Keyframes (styles.css): `skeleton-shimmer`, `chip-pop`, `rail-pulse`, `card-enter`, `caret-blink`,
`tick-appear`.

**Minimal text:** rationale (`why[]`, `explanation`) is collapsed behind hover/tap; the Knew line
and reasons are chips, not paragraphs.

## Dependencies

React + Vite + TypeScript only. **No motion library**: every animation above is an entrance/state
transition expressible as CSS keyframes/transitions driven by class changes — a JS motion dep
(framer-motion ≈ 30 kB+) would buy exit-animations we don't need on a demo tablet. Revisit only if
the impl pass needs orchestrated exits (FLIP/`View Transitions` first).

## WebSocket lifecycle

Owned by `src/lib/ws.ts` (`createGoalFlowSocket`), created once by `App`:

```
connect(VITE_WS_URL) → send hello {role:"ui"} → hello_ack {session_id}
  → steady: send user_goal / approval / control
            recv capabilities / agent_event / present_plan / proposal / status
  → on drop: reconnect (1.5 s), re-send hello; reducer dedupes agent_event on seq
```

## Status of this pass

This is the **M0 design pass**: types and the streaming reducer are complete and type-checked
(`npm run build`); components are prop-typed skeletons with structural JSX and `TODO(M-impl)`
markers for render/motion polish. The clock-fix helpers (`mergeDemoClock`, `deriveClockDisplay`)
are fully implemented — they are the named v1 bug.
