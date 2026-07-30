# goal-flow-agent-chat-ui

Tablet UI for **GoalFlow** — the general goal-based agent for the Samsung Family Hub
(system design: `../goal-flow-agents/docs/DESIGN.md`). React + Vite + TypeScript, no other
runtime dependencies (all motion is CSS keyframes/transitions — no motion library).

This is not a chat transcript. It is a **"watch it think" stage**: you give the agent a goal
and watch it work live, then the plan takes over the screen as the hero. The UI talks **only**
to the cloud agent over a single WebSocket (the cloud is the hub; the UI never touches the
device). The shared protocol is **`CONTRACT.md`**, canonical in the cloud repo and mirrored here
as discriminated unions in [`src/types/contract.ts`](src/types/contract.ts).

## What's on the stage

- **Device pairing** — the cloud is multi-session (many UIs + many device agents at once,
  paired by `device_id`). One device online ⇒ this UI auto-binds silently. Two or more
  (e.g. two developers sharing one cloud) ⇒ a one-time `DevicePicker` before anything else
  renders, remembered per browser (`localStorage`). `?device=<id>` in the URL overrides
  pairing (scripted/CI runs).
- **No composer.** Goal entry belongs to Bixby (the `input` surface); this UI is a webview
  bracketed by `chat_ui_open` / `chat_ui_close` and never sends `user_goal`. Open on `chat_ui_open`
  is a hard reset keyed to that goal, and the cloud replays the create phase to a freshly-bound
  socket, so a late-connecting webview still shows the understanding it missed.
- **Confirm-understanding gate (`UnderstandingCard`)** — before the device plans, the cloud sends
  an `understanding` frame (objective / the constraints it will hold / a line of reasoning); the
  card blocks on **Confirm & plan** / **Decline**. Nothing plans until the user confirms. When the
  message stated a *household rule* rather than a goal, the same card becomes the **capture card**:
  a tick per proposed rule, the user's own words quoted back, and nothing remembered that was not
  ticked.
- **The working column** — one column for the passage of work: engines that finished collapse into
  receipts carrying their verdict and measured duration (`Grounding · grounded · 59.3s`), the one
  running holds a focus card with the live reasoning transcript and its tool-call chips inside it,
  and the rest wait below as ghosts. Each card sizes to its own content; the goal bar stays
  pinned and only the content area scrolls (v5.2).
- **The plan, landing** — `plan_progress` rows arrive into slots reserved before the content does,
  paced so the whole plan does not appear in a single frame, then the hero (`PlanCard`) takes over:
  the "Knew" chips, the safety chip ("LLM plans, code checks"), generic plan items
  (title / detail / when / why / tags) and impact badges. **Domain-agnostic by construction** — a
  meal week, a vacation prep timeline and a party run the same component; domain flavour is data.
- **Tiered HITL approvals (`ProposalList`)** — every proposed side effect carries a tier
  (reversibility × cost × risk): **auto** renders as already done (no buttons), **light** gets a
  single quiet OK, **firm** (spends money / irreversible) renders visually heavy with the exact
  `module.function` call spelled out and explicit Approve / Decline. Nothing above `auto`
  executes until the approval frame returns — and a refusal comes back as `blocked_safety` with
  the filter's reason, not as a silent success.
- **Then it hands off.** Once the plan is approved a banner points at the Agent Board, which owns
  the goal's life: monitoring, the world tick, and adaptation approvals.
- **Presenter mode** — the header "Show agent flow" toggle reveals the raw WS frame feed
  (▲ sent / ▼ recv, type, terse label; high-volume `agent_event` thinking frames collapse into
  bursts). Off by default for a clean demo surface.

All inbound frames flow through **one pure reducer** in `App.tsx`; components stay
presentational. See [`CODE_GUIDE.md`](CODE_GUIDE.md) for the walkthrough — the component tree,
the event→state mapping table and the motion rules all live there.

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

**Running two UIs against two device agents (multi-session):** one Vite server,
two tabs — `http://localhost:5173/?device=hub-a` and `?device=hub-b` — each pairs
with the matching device agent's `device_id`. Omit the query param and either UI
falls back to auto-bind (one device online) or the `DevicePicker` (several).

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
CODE_GUIDE.md               # code walkthrough (start here to hack on it)
src/
  main.tsx                  # entry: StrictMode + ErrorBoundary + App
  App.tsx                   # socket + streaming reducer/state machine + stage layout
  lib/ws.ts                 # WS client: hello handshake, reconnect, frame validation
  types/contract.ts         # TypeScript mirror of CONTRACT.md
  types/ui.ts               # reducer output vocabulary (harness state, chips, receipts…)
  styles.css                # design tokens (light theme) + the v5.1 keyframes
  panel.css                 # the v5.2 panel: new class names only, loaded after styles.css
  lib/reasoning.ts          # transcript assembly (lifted out of the old AgentStream)
  components/
    DevicePicker.tsx        # one-time device-agent picker (multi-session pairing)
    GoalBar.tsx             # the goal as the page title, run clock, engines-cleared hairline
    WorkingColumn.tsx       # receipts / the one focus card (transcript + chips) / ghosts
    PlanColumn.tsx          # plan rows landing into reserved slots
    PlanCard.tsx            # the generic plan hero
    ProposalList.tsx        # tiered approvals (auto / light / firm)
    UnderstandingCard.tsx   # the pre-planning gate; doubles as the capture card
    StatusTimeline.tsx      # quiet monitoring ticks
    HarnessTheater.tsx      # presenter mode: the projection-scale engine strip
    PresenterFeed.tsx       # raw WS frame feed ("Show agent flow")
    MicButton.tsx           # STT stub — orphaned since the composer was removed
    ErrorBoundary.tsx       # one bad frame never blanks the app
```
