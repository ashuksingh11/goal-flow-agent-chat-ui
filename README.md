# goal-flow-agent-chat-ui

Tablet chat UI for the **GoalFlow** POC (Samsung Tizen Family Hub two-tier
goal-agent demo). React + Vite + TypeScript.

The UI talks **only** to the cloud agent over a single WebSocket — it never
talks to the device directly (the cloud is the hub). The shared protocol is
Contract v0; the canonical copy lives in
`goal-flow-cloud-agent/CONTRACT.md`, mirrored here as TypeScript types in
[`src/types/contract.ts`](src/types/contract.ts).

## Scope by milestone

### M1 — thin vertical slice (current)
- Single tablet chat surface (`ChatView`).
- Type a goal → send `user_goal` to the cloud.
- Receive `present_plan` → render the weekly dinner plan + proposals
  (`PlanCard`), including the approve/decline decision that becomes an
  `approval` message (the **approval gate**: the user, via the cloud).

### Planned / deferred
- **STT** via the browser **Web Speech API** (`MicButton` is a stub for now).
- `/hub` display surface (ambient Family Hub screen) — deferred.
- "Show agent flow" presenter toggle (live message-flow visualization for
  demos) — deferred.
- `proposal` / `status` rendering for mid-week adaptations — M2.

## How to run

```bash
npm install
cp .env.example .env    # points at the cloud hub
npm run dev             # Vite dev server
```

## Environment

| Variable      | Default                  | Notes                        |
|---------------|--------------------------|------------------------------|
| `VITE_WS_URL` | `ws://localhost:8000/ws` | The cloud agent's WS endpoint |

## Repo layout

```
docs/ARCHITECTURE.md      # UI architecture, WS lifecycle, component tree
src/
  main.tsx                # entry point
  App.tsx                 # layout + composition (design stub)
  types/contract.ts       # TypeScript mirror of Contract v0
  lib/ws.ts               # WS client wrapper (design stub)
  components/
    ChatView.tsx          # chat transcript + input (design stub)
    PlanCard.tsx          # plan + proposals + approval UI (design stub)
    MicButton.tsx         # Web Speech API STT (deferred, stub)
```
