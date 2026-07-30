# AGENTS.md — goal-flow-agent-chat-ui (coding-session guide)

Context for an AI/coding session in this repo. Read first.

## What this repo is

The **tablet chat UI** of GoalFlow — a two-tier goal-based agent POC for the Samsung
Tizen Family Hub. React + Vite + TypeScript. It opens ONE outbound WebSocket to the
 cloud hub and NEVER talks to the device directly. It is the **create-phase** surface: the
confirm-understanding gate, the working column ("watch it think"), the plan as hero, and the
tiered approvals. After the initial approval it hands off to the Agent Board.

It has **no composer** — goal entry is Bixby's (v4.1) — and it is an **ephemeral webview**,
bracketed by `chat_ui_open` / `chat_ui_close`.

Siblings under `~/ashu/git/`: `goal-flow-cloud-agent` (Python hub, owns canonical
`CONTRACT.md`), `goal-flow-device-agent-ubuntu` (.NET/SK device), `goal-flow-agent-bixby-ui`
(the surface that opens this one), `goal-flow-agent-board-ui` (where the goal lives after
approval). `src/types/contract.ts` MIRRORS the cloud's `CONTRACT.md`. System design:
`../goal-flow-agents/docs/DESIGN.md`.

## Stack & run

- React 18 + Vite + TypeScript. Talks only to the cloud via `VITE_WS_URL`
  (default `ws://localhost:8000/ws`).
- Dev: `npm run dev` (Vite dev server, HMR — CSS/TSX edits apply live).
- Build: `npm run build` (= `tsc -b && vite build`). Preview: `npm run preview`.
- GOTCHA: after out-of-band edits (e.g. Codex), the dev server can serve STALE
  modules — `rm -rf node_modules/.vite` and hard-reload a fresh browser context.

## Architecture / key files

- `src/App.tsx` — socket wiring + a single **pure reducer** `reduceInbound` +
  the full stage layout. This is the brain; ~800 lines, fully implemented.
  `isPlanApproved` must EXCLUDE `auto`-tier proposals. Declined proposals resolve to
  `{state:"done", approved:false}`. Captures
  `planMorphs`/`morphSeq` from `status.updated_plan`/`changed_ids`. State
  `boundDeviceId` (from `hello_ack.device_id`) + `deviceChoices`
  (`DeviceInfo[] | null`: `null` = never offered ⇒ bound, `[]` = offered but no
  device online yet) drive device pairing — see Contract touchpoints below. While
  unbound (`awaitingDevicePick`) nothing else renders: the cloud drops frames from an
  unbound UI, so there is nothing useful to show.
- `src/lib/ws.ts` — a **module-level SINGLETON** socket (so React StrictMode double-
  mount / HMR reuse ONE socket, no self-eviction). Does NOT reconnect on close 1012.
  `INBOUND_TYPES` allowlist includes `"understanding"`, `"devices"` and the v4.1 bracket
  (`"chat_ui_open"` / `"chat_ui_close"`) — an un-whitelisted frame is silently DROPPED
  (this was the old `notice` bug; worth keeping as a warning). `getDeviceId()` reads `?device=<id>` from the query string
  for the `hello` frame (per-tab, platform-independent — works in the Tizen Hub
  browser and a tablet alike). `getRememberedDeviceId()`/`rememberDeviceId()`
  persist the user's pick in **localStorage** (`goalflow.device_id`) — deliberately
  NOT sent in `hello` (a remembered device that's since gone offline would bind the
  UI to a dead session); it's matched against the live `devices` list instead, so
  pairing self-heals.
- `src/components/DevicePicker.tsx` — the one-time device picker, shown only while
  unbound and more than one device agent is online (`ashu@boxA` / `bob@boxB`);
  remembered per browser after the first pick. `?device=` skips it entirely
  (scripted/CI override).
- `src/components/`:
  - `UnderstandingCard.tsx` — the **confirm-understanding gate**: renders the cloud's
    read (objective / constraints / thought) with "Confirm & plan" / "Decline" before the
    device plans. Driven by the `understanding` frame; answers with
    `understanding_response {confirmed, accepted_constraint_ids}`. With
    `proposed_constraints` it grows the **capture section** (a tick per rule, the user's
    words quoted, an ENFORCED badge); with `capture_only: true` it becomes the capture
    card outright — header REMEMBERING, button "Remember this", no plan to follow.
  - `PlanCard.tsx` — the plan hero. Renders generic `PlanItem` rows as "Day N"
    (`item.day`), Knew chips, safety chip, impact badges, ProposalList. **Morph**: the
    changed row shows the old dish in a native `<s>` (strike-through) then slides the
    new title in — see `plan-item__old` / `plan-item__title--in` in `styles.css`.
  - **v5.1 working column** (Pencil "Option E") — `GoalBar.tsx` (goal + run clock +
    engines-cleared hairline), `WorkingColumn.tsx` (receipts / one focus card holding the
    transcript + tool chips / ghosts, on a spine), `PlanColumn.tsx` (the plan forming into
    reserved slots, then `PlanCard`). These REPLACED `ProgressRail.tsx`, `AgentStream.tsx`,
    `HarnessPipeline.tsx`, `Skeleton.tsx` and `PairedBar.tsx`, all deleted: the phase rail
    and the harness pipeline were two progress indicators for one run, and the transcript
    now lives inside the engine that produced it. Transcript helpers moved to
    `lib/reasoning.ts`.
  - `ProposalList.tsx`, `StatusTimeline.tsx`, `PresenterFeed.tsx`, `HarnessTheater.tsx`
    (the full-bleed presenter view), `ErrorBoundary.tsx`.
  - **Gone from here (v3.1 — they live on the board):** `EventStrip.tsx`,
    `DemoControls.tsx`, `AdaptationCard.tsx`. The reducer still folds the frames behind
    them so a UI left open keeps its plan in sync; nothing renders them.
  - `MicButton.tsx` is an orphan — nothing renders it since the composer was removed.
- `src/types/contract.ts` — mirrors the contract: `Understanding`/`UnderstandingResponse`,
  `PlanItem.day`, `DemoEvent`/`demo_events`, `trigger_event`, `event_id`, `ApprovalTier`
  incl. `"adapt"`; `DeviceInfo`, `Devices` (inbound), `SelectDevice` (outbound); `Hello`/
  `HelloAck` gained `device_id`.
- `src/styles.css` — light-theme tokens + the v5.1 keyframes. Plan-morph timings: the struck
  old row (`.plan-item__old`, native red `line-through`, held 2.6s) then `morph-in` for the new
  title. `src/panel.css` loads after it with the v5.2 panel classes and the motion vocabulary
  (`--p-ease-out`, `--p-dur`, …) — use those curves, don't invent parallel ones. Both respect
  `prefers-reduced-motion`.

## Contract touchpoints

Sends, and this is the complete list: `hello` (`device_id` from `?device=<id>` if present, else
empty — lets the cloud auto-bind or offer a picker), `select_device`,
`understanding_response {confirmed, accepted_constraint_ids}`, `approval`. **Not** `user_goal`
(Bixby owns entry, v4.1) and **not** `control` (the board owns the world tick, v3.1).

Receives: `hello_ack` (carries `device_id`, driving `boundDeviceId`), `devices` (live device
list — triggers the picker when `> 1` or none), `chat_ui_open` / `chat_ui_close` (the
create-phase bracket; open is a hard reset keyed to the goal), `understanding` (with `knew`,
`constraints` provenance, and `proposed_constraints` / `capture_only` for capture),
`present_plan`, `agent_event` (incl. `harness` and `plan_progress.total`), `notice`,
`proposal`, `status`. See cloud `CONTRACT.md`.

**Multi-session pairing:** the cloud now serves many device agents and many UIs
at once, paired by `device_id`. One device online ⇒ the cloud auto-binds, no
picker. Two+ (e.g. two developers sharing one cloud) ⇒ a one-time
`DevicePicker`, remembered per browser (`localStorage: goalflow.device_id`).
`?device=<id>` in the URL query string remains a scripted/CI override that skips
pairing entirely.

## Conventions & gotchas

- **Commit identity:** author as `ashuksingh11`
  (`31301999+ashuksingh11@users.noreply.github.com`). **Push only when asked.**
- **Workflow:** plan=Opus · design=Fable · coding=Opus · browsing=Sonnet.
- **Verify UI live with the `agent-browser` CLI** (a global npm skill, NOT an MCP —
  won't appear in tool search). Drive via Bash: `open`, `snapshot -i`, `click @eN`,
  `fill`, `get count/text`, `screenshot`, `console`. Refs (`@eN`) SHIFT between
  snapshots — re-snapshot immediately before each click. Screenshots taken too early
  miss transient morphs (understanding+plan take ~10-20s; morph round-trips ~2s).
- WS storm history: a single-slot `ui` registry on the cloud + reconnect-on-close
  caused eviction storms when two `ui` sockets coexisted (StrictMode, a second tab,
  or a WSL agent-browser client — WSL2 forwards Windows localhost). Fixed via cloud
  multi-ui broadcast + this repo's singleton socket. Clean up stray browser clients
  between tests.
- **Running two UIs** (multi-session test): one Vite server, two tabs —
  `http://localhost:5173/?device=hub-a` and `?device=hub-b` (or omit the query
  param and use the `DevicePicker`).
