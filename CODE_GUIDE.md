# Code Guide — goal-flow-agent-chat-ui

The **chat UI** is the tablet client of GoalFlow: a React + Vite + TypeScript app that talks to the
cloud agent over WebSocket. It sends the user's goal, renders the plan as the hero of the screen,
drives the human-in-the-loop approvals, and (for the demo) advances the simulated week. See
`../goal-flow-agents/docs/SYSTEM_OVERVIEW.md` for the whole system.

> **Note:** `README.md` describes M1 scope; this guide reflects the finished M1–M4 build.

## File map

```
index.html
package.json                 # scripts: dev / build / preview
.env.example                 # VITE_WS_URL=ws://localhost:8000/ws
src/
  main.tsx                   # React entry
  App.tsx                    # owns the socket, transcript, WS-frame feed, demo controls  ← start here
  lib/ws.ts                  # WebSocket wrapper: connect, send, reconnect, state
  types/contract.ts          # TypeScript mirror of CONTRACT.md (discriminated unions)
  components/
    ChatView.tsx             # transcript, input, plan card, status/adaptation cards
    PlanCard.tsx             # the plan hero: Knew line, dishes+why, proposal, safety chip, impact badges
    MicButton.tsx            # speech-to-text stub (disabled; Web Speech API planned)
  styles.css                 # warm palette; all component styles
docs/ARCHITECTURE.md
```

## How it works

1. **`App.tsx`** creates the WebSocket via **`lib/ws.ts`** on load, sends `hello {role:"ui"}`, and
   tracks connection state (the header **● Open/closed** indicator). It keeps three pieces of state:
   the **transcript** (chat + cards), the raw **WS frame feed** (for presenter mode), and the current
   **simulated day** (for demo controls).
2. Sending the input dispatches a **`user_goal`** frame. Incoming frames are routed by `type`:
   - **`present_plan`** → render a `PlanCard` (the hero).
   - **`status`** → render an execution confirmation ("5 items added…") or a per-day sustain bubble
     ("Tue — on track; reminder set").
   - **`proposal`** (adapting) → render the prominent **"Schedule change caught"** adaptation card.
3. **HITL:** Approve/Decline (and the adaptation's Adapt/Decline) send an **`approval`** frame; the
   buttons disable after a decision and update when the confirming `status` arrives.
4. **Demo controls:** the "DEMO CONTROLS" strip (shown once a plan is active) sends **`control`**
   frames (`advance_day` / `reset`) and shows the current sim day.
5. **Presenter mode:** the header **"Show agent flow"** toggle reveals a live **WS message feed**
   (every frame with ▲ sent / ▼ received, its `type`, and a human label). Off by default → clean UX.

## The "wow" pieces (where to look)

- **`PlanCard.tsx`** — leads with the **"Knew:"** personalization line (from `present_plan.payload.knew`)
  — this is the credibility/wow line ("evidence of understanding, not a progress bar"). Also renders
  the **safety chip** and the **impact badges** (`payload.impact`).
- **`ChatView.tsx`** — the calm per-day sustain statuses vs. the loud adaptation card is deliberate:
  four quiet days, one smart Wednesday.

## Types

`src/types/contract.ts` is the **TypeScript mirror of `CONTRACT.md`** — discriminated unions for
inbound/outbound messages. All parsing/sending routes on the `type` field. Keep this file in sync
with the canonical `CONTRACT.md` (in the cloud repo) and the C# mirror (device repo) when the
protocol changes.

## Run & verify

```bash
cp -n .env.example .env         # VITE_WS_URL=ws://localhost:8000/ws
npm install
npm run build                   # tsc -b && vite build  (type-checks)
npm run dev -- --host 127.0.0.1 --port 5173
```

Open http://127.0.0.1:5173 (needs the cloud running on :8000).

## Extending it

- **Speech-to-text:** wire `MicButton.tsx` to the browser **Web Speech API** (it's a stub today).
- **Second Hub surface:** the deferred `/hub` "Home Agent Activity" display can reuse the same WS
  frames (device stages) as a display-only route.
- **New message type:** add its type to `contract.ts`, handle it in `App.tsx`'s router, and render it
  in `ChatView.tsx`.
