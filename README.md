# goal-flow-agent-chat-ui

Tablet UI for **GoalFlow v2** — the *general* goal-based agent for the Samsung Family Hub
(see `../goal-flow-agents/docs/V2_DESIGN_PROPOSAL.md`). React + Vite + TypeScript, no other
runtime dependencies (all motion is CSS keyframes/transitions — no motion library).

This is not a chat transcript. It is a **"watch it think" stage**: you give the agent a goal
and watch it work live, then the plan takes over the screen as the hero. The UI talks **only**
to the cloud agent over a single WebSocket (the cloud is the hub; the UI never touches the
device). The shared protocol is **CONTRACT v2**, canonical in the cloud repo and mirrored here
as discriminated unions in [`src/types/contract.ts`](src/types/contract.ts).

## What's on the stage (v2)

- **Progress rail** — Interpreting → Grounding → Confirm → Planning → Checking → Approval →
  Monitoring, driven live by streamed `agent_event {event:"phase"}` frames (the active step
  pulses).
- **Confirm-understanding gate (`UnderstandingCard`)** — before the device plans, the cloud
  agent sends an `understanding` frame (objective / constraints / thought); the card renders it
  and blocks on **Confirm & plan** / **Decline**, answered with `understanding_response`. Nothing
  plans until the user confirms.
- **Agent stream** — the live feed while the device works: a streaming **thinking ticker**
  (reasoning fragments with a blinking caret) and **tool-call chips** that pop in as the LLM
  calls real capability functions ("Inventory · GetExpiringItems …") and flip to ✓ + a one-line
  summary when the `tool_result` lands.
- **Skeleton loaders** — while planning, the plan's *silhouette* shimmers (never a spinner);
  `plan_progress` events replace skeleton rows with real draft rows one by one.
- **Plan hero (`PlanCard`)** — on `present_plan` the plan animates in and owns the stage:
  the "Knew:" personalization chips, the safety gate chip ("LLM plans, code checks"),
  generic plan items (title / detail / when / why / tags), and impact badges. It is
  **domain-agnostic by construction** — the same component carries a meal week, a guest-dinner
  prep timeline, or chores; domain flavor arrives purely as data.
- **Tiered HITL approvals (`ProposalList`)** — every proposed side effect carries a tier
  (reversibility × cost × risk): **auto** renders as already done (no buttons), **light** gets a
  single quiet OK, **firm** (spends money / irreversible) renders visually heavy with the exact
  `module.function` call spelled out and explicit Approve / Decline. Nothing above `auto`
  executes until the approval frame returns.
- **Adaptation card** — when the agent catches a material change mid-goal (a `proposal` frame,
  `task_status:"adapting"`), a deliberately loud "Caught a change" card slides in — the one
  glowing entrance, earned by the quiet sustain ticks around it (`StatusTimeline`).
- **Event-driven meal week (`EventStrip`)** — when the plan carries `demo_events`, a strip of
  day-labelled ("Day N") chips replaces the sim-clock's "Advance day" control: the presenter
  fires an event (`control {command:"trigger_event", event_id}`) once the plan is approved, the
  chip goes `idle → firing → fired` as the matching `proposal`/`status` echoes `event_id` back,
  and approving the resulting adaptation morphs the changed day-row in place — the old dish
  strikes through and the new one slides in.
- **Demo controls (sim clock)** — the fallback for plans with no `demo_events`: a generic
  simulated-clock strip with the current sim day/date and a 7-day week strip **derived from
  `status.sim_date`** (real today before the first status — nothing hardcoded), plus Advance day
  / Reset / Set date, which send `control` frames and re-render only when the device's status
  echoes back.
- **Presenter mode** — the header "Show agent flow" toggle reveals the raw WS frame feed
  (▲ sent / ▼ recv, type, terse label; high-volume `agent_event` thinking frames collapse into
  bursts). Off by default for a clean demo surface.
- **Mic button** — speech-to-text stub (Web Speech API planned, browser-only).

All inbound frames flow through **one pure reducer** in `App.tsx`; components stay
presentational. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full spec (component
tree, event→state mapping table, motion principles) and [`CODE_GUIDE.md`](CODE_GUIDE.md) for
the code walkthrough.

## How to run

For the **full three-service demo** (cloud + device + UI), follow
`goal-flow-agents/docs/FINAL_DEMO.md` — the single source of truth for run
commands. To run just the UI:

```bash
npm install
npm run dev             # Vite dev server, binds all interfaces (server.host)
```

No `.env` is needed: with `VITE_WS_URL` unset the UI derives the hub URL from the
host that served the page (see Configuration). Open http://localhost:5173.

`npm run build` runs `tsc -b && vite build` (type-checks the whole app).

## Running across machines (LAN — cloud + tablet)

Typical deployment: the **cloud hub** and this **UI** run on one Ubuntu box, the
**device agent** runs on the Tizen Hub, and the UI is viewed in a **tablet
browser**. The wiring is host-relative, so no IPs are baked into the build:

1. **Cloud (Ubuntu):** `./run.sh` — already binds `0.0.0.0:8000` (reachable on the
   LAN). If a firewall is in play, open TCP 8000.
2. **UI (Ubuntu):** `npm run dev` — Vite binds all interfaces (`server.host`), so
   the tablet can load it. **Leave `VITE_WS_URL` unset** (see Configuration): the
   UI derives the hub URL from the host that served the page, so a tablet on
   `http://<ubuntu-ip>:5173` connects to `ws://<ubuntu-ip>:8000/ws` automatically.
3. **Tablet:** browse to `http://<ubuntu-ip>:5173`.
4. **Device (Tizen Hub):** set `WS_URL=ws://<ubuntu-ip>:8000/ws` in `goalflow.conf`
   (a Tizen service can't use env vars — see that repo's AGENTS.md).

Everything routes through the cloud; the UI and device never talk directly.

## Configuration

| Variable       | Default                        | Notes                                                         |
|----------------|--------------------------------|--------------------------------------------------------------|
| `VITE_WS_URL`  | *(unset → derived from host)*  | Full override, e.g. `ws://192.168.1.50:8000/ws`. Leave unset to auto-derive `ws://<page-host>:8000/ws`. |
| `VITE_WS_PORT` | `8000`                         | Port used by host-derivation when `VITE_WS_URL` is unset.     |

## Repo layout

```
docs/ARCHITECTURE.md        # the v2 wow-UI spec: tree, event mapping, motion
CODE_GUIDE.md               # code walkthrough (start here to hack on it)
src/
  main.tsx                  # entry: StrictMode + ErrorBoundary + App
  App.tsx                   # socket + streaming reducer/state machine + stage layout
  lib/ws.ts                 # WS client: hello handshake, reconnect, frame validation
  types/contract.ts         # TypeScript mirror of CONTRACT v2
  types/ui.ts               # reducer output vocabulary (rail phases, chips, DemoClock…)
  styles.css                # design tokens + all keyframes (CSS-only motion)
  components/
    ProgressRail.tsx        # seven-phase rail (incl. Confirm)
    UnderstandingCard.tsx   # confirm-understanding gate (Confirm & plan / Decline)
    AgentStream.tsx         # thinking ticker + tool-call chips
    Skeleton.tsx            # shimmer placeholders (plan-item / line / chip)
    PlanCard.tsx            # the generic plan hero
    ProposalList.tsx        # tiered approvals (auto / light / firm)
    AdaptationCard.tsx      # the loud "caught a change" card
    StatusTimeline.tsx      # quiet monitoring ticks
    EventStrip.tsx          # presenter-fired demo event chips (meal week)
    DemoControls.tsx        # generic sim clock + advance/reset/set-date (fallback, no demo_events)
    PresenterFeed.tsx       # raw WS frame feed ("Show agent flow")
    MicButton.tsx           # STT stub
    ErrorBoundary.tsx       # one bad frame never blanks the app
```
