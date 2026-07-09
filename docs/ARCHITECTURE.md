# UI Architecture

## Role

The UI is the human's surface in the GoalFlow three-tier system: it captures
the goal, renders the device's plan (relayed by the cloud), and hosts the
**approval gate** — the user's yes/no on proposals. It never plans and never
executes; and it **never talks to the device directly**. Its single peer is
the cloud hub, over one WebSocket.

Contract v0 is canonical in `goal-flow-cloud-agent/CONTRACT.md`; this repo's
mirror is [`../src/types/contract.ts`](../src/types/contract.ts)
(discriminated unions on `type`).

## M1: single tablet chat surface

One full-screen chat view, sized for the Family Hub tablet. Flow:

1. User types (later: speaks) a goal → `user_goal` → cloud.
2. Cloud/device do their work; the UI receives `present_plan`.
3. `PlanCard` renders the weekly plan + proposals + safety-gate result.
4. User approves/declines proposals → `approval` → cloud → device.
5. `status` frames render as inline agent notes.

### Deferred surfaces (documented so the layout anticipates them)

- **`/hub` display surface** — an ambient, read-mostly Family Hub screen
  showing the current week's plan and adaptation notifications. Deferred;
  will be a second route sharing the same socket/types.
- **"Show agent flow" presenter toggle** — a demo overlay visualizing the
  live message flow (user_goal → dispatch → plan_ready → present_plan →
  approval …) to make the two-tier mechanism visible on stage. Deferred.

## WebSocket connection lifecycle

Owned by `src/lib/ws.ts` (`createGoalFlowSocket`), created once by `App`.

```
connect(VITE_WS_URL)
  → on open: send hello { role: "ui" }
  → receive hello_ack { session_id }
  → steady state: send user_goal / approval; receive present_plan / proposal / status
  → on drop: reconnect with backoff, re-send hello (M2 hardening)
```

- Inbound frames are parsed and narrowed on `type` (`UiInboundMessage`)
  before reaching components.
- Dedupe on `correlation_id` for device-origin frames (M2).
- Connection state (`connecting | open | closed`) drives a header indicator.

## Component tree

```
App                       — owns the socket + transcript state, layout shell
└── ChatView              — transcript + input row
    ├── PlanCard          — plan table, proposals, Approve/Decline, safety badge
    └── MicButton         — Web Speech API STT (deferred stub)
```

Data flow is strictly down-props / up-callbacks for M1 (no state library):
`App` holds `ChatEntry[]`; `ChatView` emits `onSendGoal` / `onApprove`;
`PlanCard` emits `ApprovalDecision[]` via `onDecide`.

## Milestone map

| Piece                          | M1 | Later |
|--------------------------------|----|-------|
| Chat transcript + text input   | x  |       |
| Send `user_goal`               | x  |       |
| Render `present_plan` (PlanCard)| x |       |
| Send `approval` from PlanCard  | x  |       |
| `status` inline notes          | x  |       |
| `proposal` (adaptation) UI     |    | M2    |
| Reconnect/backoff + dedupe     |    | M2    |
| MicButton (Web Speech STT)     |    | planned |
| `/hub` display surface         |    | deferred |
| "Show agent flow" toggle       |    | deferred |
