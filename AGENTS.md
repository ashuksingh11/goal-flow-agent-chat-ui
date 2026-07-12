# AGENTS.md — goal-flow-agent-chat-ui (coding-session guide)

Context for an AI/coding session in this repo. Read first.

## What this repo is

The **tablet chat UI** of GoalFlow — a two-tier goal-based agent POC for the Samsung
Tizen Family Hub. React + Vite + TypeScript. It opens ONE outbound WebSocket to the
cloud hub and NEVER talks to the device directly. It is the "wow" surface: streaming
thinking, an animated progress rail, a plan-as-hero card, tiered approvals, a
confirm-understanding gate, and a presenter-fired event strip that morphs the plan.
It is **fully built**, not skeletons (ignore any older doc that says "M0 skeleton").

Siblings under `~/ashu/git/`: `goal-flow-cloud-agent` (Python hub, owns canonical
`CONTRACT.md`), `goal-flow-device-agent-ubuntu` (.NET/SK device). `src/types/contract.ts`
MIRRORS the cloud's `CONTRACT.md`.

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
  `isPlanApproved` must EXCLUDE `auto`-tier proposals (else the event chips never
  unlock). Declined proposals resolve to `{state:"done", approved:false}`. Captures
  `planMorphs`/`morphSeq` from `status.updated_plan`/`changed_ids`.
- `src/lib/ws.ts` — a **module-level SINGLETON** socket (so React StrictMode double-
  mount / HMR reuse ONE socket, no self-eviction). Does NOT reconnect on close 1012.
  `INBOUND_TYPES` allowlist includes `"understanding"`.
- `src/components/`:
  - `UnderstandingCard.tsx` — the **confirm-understanding gate**: renders the cloud's
    read (objective / constraints / thought / summary) with "Confirm & plan" /
    "Decline" before the device plans. Driven by the `understanding` frame; answers
    with `understanding_response`.
  - `EventStrip.tsx` — the **presenter-fired event chips** (state machine
    idle→firing→fired✓). Firing sends `control trigger_event {event_id}`. Chips are
    locked until the plan is approved; render only for meal (from `demo_events`).
  - `PlanCard.tsx` — the plan hero. Renders generic `PlanItem` rows as "Day N"
    (`item.day`), Knew chips, safety chip, impact badges, ProposalList. **Morph**: the
    changed row shows the old dish in a native `<s>` (strike-through) then slides the
    new title in — see `plan-item__old` / `plan-item__title--in` in `styles.css`.
  - `ProposalList.tsx`, `AdaptationCard.tsx` (tiers incl. `adapt`), `ProgressRail.tsx`
    (cloud vs device steps, revealed one-by-one), `StatusTimeline.tsx`,
    `PresenterFeed.tsx`, `AgentStream.tsx`, `DemoControls.tsx` (clock controls — only
    for domains without an event strip), `Skeleton.tsx`, `MicButton.tsx`, `ErrorBoundary.tsx`.
  - NOT built: `AgentHandoff.tsx` (a cloud↔device comet viz) — aspirational spec only.
- `src/types/contract.ts` — mirrors CONTRACT v2: `Understanding`/`UnderstandingResponse`,
  `PlanItem.day`, `DemoEvent`/`demo_events`, `trigger_event`, `event_id`, `ApprovalTier`
  incl. `"adapt"`.
- `src/styles.css` — all animations. Meal-morph timings: the struck old dish
  (`.plan-item__old`, native red `line-through`, held 2.6s) then `morph-in` the new
  title; `--rail-enter-duration` reveals rail steps. Respects `prefers-reduced-motion`.

## Contract touchpoints

Sends: `user_goal`, `understanding_response`, `approval`, `control`
(`advance_day`/`reset`/`set_date`/`trigger_event`). Receives: `understanding`,
`present_plan` (with `knew` + `demo_events`), `agent_event`, `proposal`, `status`
(with `updated_plan`/`changed_ids`/`event_id` on adaptation). See cloud `CONTRACT.md`.

## Conventions & gotchas

- **Commit identity:** author as `ashuksingh11`
  (`31301999+ashuksingh11@users.noreply.github.com`). **Push only when asked.**
- **Workflow:** plan=Opus · design=Fable · coding=Codex CLI · browsing=Sonnet.
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
