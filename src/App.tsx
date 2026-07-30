/**
 * App — root: owns the socket, the STREAMING STATE MACHINE, and the stage.
 *
 * v3.1: the chat UI is the goal-CREATION surface. It owns the understanding gate and
 * the INITIAL tiered plan approval — then hands off. Once the plan is approved it shows
 * a hand-off banner and the goal's LIFE (monitoring, the world-event simulation
 * controls, and world-event adaptation approvals) moves to the Agent Board. So
 * EventStrip / DemoControls / AdaptationCard were removed from here and live on the
 * board now.
 *
 * v4.1: this surface is EPHEMERAL — Bixby (the `input` surface) owns goal entry and
 * hosts this UI in a webview bracketed by `chat_ui_open`/`chat_ui_close`. The goal
 * composer was REMOVED: goal text now comes from Bixby, so this UI never sends
 * `user_goal`. `chat_ui_open{goal_id}` HARD-RESETS the stage keyed to that goal (and
 * thereafter ignores goal-scoped frames for any other goal); `chat_ui_close` returns
 * it to idle. The reset is idempotent per goal so the cloud's bind-time replay
 * (open → understanding → present_plan) rehydrates a freshly-bound socket.
 *
 * v5.1: the stage is ONE working column (Pencil "Option E"). The phase rail and the
 * side-by-side pipeline + reasoning panel are gone — they were two progress indicators
 * for the same run, and the harness is the one that tells the truth.
 *
 * Component tree:
 *   App
 *   ├── GoalBar           — the goal, the run clock, engines-cleared hairline
 *   ├── column
 *   │   ├── WorkingColumn — receipts / focus card (transcript + calls) / ghosts
 *   │   ├── PlanColumn    — the plan forming, then PlanCard + ProposalList
 *   │   └── StatusTimeline— quiet sustain ticks (monitoring)
 *   ├── UnderstandingCard — the pre-planning confirm gate
 *   ├── handoff banner    — "Plan approved — continue on your Board" (v3.1)
 *   └── PresenterFeed     — raw WS frames ("Show agent flow" toggle)
 *
 * All inbound frames flow through ONE pure reducer (reduceInbound) — the
 * streaming-event → UI-state mapping lives there and nowhere else. The reducer still
 * folds proposal/status frames (a UI that stays open past approval keeps its plan in
 * sync), but no longer renders adaptations — the board does.
 */

import { useEffect, useReducer, useRef, useState } from "react";
import { GoalBar } from "./components/GoalBar";
import { HarnessTheater } from "./components/HarnessTheater";
import { PlanColumn } from "./components/PlanColumn";
import { PresenterFeed } from "./components/PresenterFeed";
import { StatusTimeline } from "./components/StatusTimeline";
import { WorkingColumn } from "./components/WorkingColumn";
import { UnderstandingCard } from "./components/UnderstandingCard";
import { DevicePicker } from "./components/DevicePicker";
import { createGoalFlowSocket, getDeviceId, getGoalId, getRememberedDeviceId, rememberDeviceId } from "./lib/ws";
import type { ConnectionState, GoalFlowSocket } from "./lib/ws";
import type {
  AgentEvent,
  ApprovalDecision,
  CapabilityModule,
  ImpactBadge,
  DeviceInfo,
  PresentPlan,
  Proposal,
  Status,
  Understanding,
  UiInboundMessage,
  UiOutboundMessage,
} from "./types/contract";
import {
  HARNESS_PIPELINE,
  INITIAL_DEMO_CLOCK,
  INITIAL_HARNESS,
  PLAN_ITEM_STEP_MS,
  drainHarness,
  enqueueHarness,
  harnessStarted,
  mergeDemoClock,
  maxRailPhase,
  railPhaseFromAgentPhase,
  railPhaseFromStatus,
  settleHarness,
} from "./types/ui";
import type {
  AgentStreamEntry,
  DemoClock,
  EventChip,
  DraftPlanItem,
  FlowFrame,
  HarnessState,
  ProposalStatusMap,
  RailPhase,
  TranscriptEntry,
} from "./types/ui";

// ---------------------------------------------------------------------------
// Streaming state machine
// ---------------------------------------------------------------------------

interface UiState {
  activeGoalId: string | null;
  /** Current rail phase (null = idle, before the first goal). */
  phase: RailPhase | null;
  /** True while the device streams work (drives caret/chips/skeletons). */
  working: boolean;
  /** Pre-planning confirmation gate from the cloud. */
  understanding: Understanding | null;
  /**
   * The goal in words, for the goal bar. This surface never SENDS `user_goal` (v4.1 —
   * Bixby owns goal entry), so the only place the goal text reaches us is the cloud's
   * `understanding.objective`. Kept in state because the understanding frame itself is
   * cleared the moment the gate is answered.
   */
  goalText: string;
  /** Locally declined goal; late frames for it are ignored. */
  declinedGoalId: string | null;
  /** Device module registry (capabilities frame) — chips legend / debug. */
  modules: CapabilityModule[] | null;
  /** Reduced agent_event stream: thinking entries + tool chips. */
  agentEntries: AgentStreamEntry[];
  /** v5: the harness pipeline — one cell per engine + the active spotlight. */
  harness: HarnessState;
  /** plan_progress rows already REVEALED in the outcome column. */
  draftItems: DraftPlanItem[];
  /**
   * Rows accepted off the wire but not yet revealed. The device emits every
   * plan_progress in one tight loop, so without this the whole plan appears in a single
   * frame — see PLAN_ITEM_STEP_MS. Paced reveal only; nothing is withheld or invented.
   */
  draftQueue: DraftPlanItem[];
  /** epoch-ms floor: the next queued row must not be revealed before this. */
  draftHoldUntil: number;
  /**
   * How many rows the finished plan has, as announced by `plan_progress.total` (v5.1).
   * Null until a device tells us — pre-v5.1 devices never do, and PlanColumn falls back
   * to a single placeholder rather than inventing a horizon.
   */
  draftTotal: number | null;
  /** The hero, once present_plan lands. Patched in place by daily adaptations. */
  plan: PresentPlan | null;
  /** The original plan_ready payload, restored by Reset week. */
  pristinePlan: PresentPlan | null;
  /** Plan-item ids changed by the most recent approved adaptation (highlight). */
  changedPlanIds: string[];
  /** Previous row copy for changed items, captured before updated_plan replaces them. */
  planMorphs: Record<string, { prevTitle: string; prevDetail?: string }>;
  /** Bumps on every adapted plan patch so row animations can replay. */
  morphSeq: number;
  /** Impact badge labels changed by the most recent adaptation. */
  changedImpactLabels: string[];
  proposalStatuses: ProposalStatusMap;
  adaptations: Proposal[];
  eventChips: EventChip[];
  firedEventIds: string[];
  firingEventId: string | null;
  /** Unlocks the world-event strip after the user approves the initial plan. */
  approved: boolean;
  /**
   * v7: the moment between "Approve & Save" and the webview closing.
   *
   * It existed before and was invisible. The cloud's chat_ui_close arrives within a
   * round-trip of the approval, so the UI reset before the user could read anything —
   * which meant the execution status frames (what actually ran, what was deferred,
   * what was blocked) landed on a surface that had already gone. Now the surface holds
   * for a minimum dwell, and for Act 3 it holds for as long as the cross-goal update
   * genuinely takes, because the cloud does that work BEFORE it sends the close.
   */
  saving: { startedAt: number; detail: string | null } | null;
  /** A close that arrived before the saving dwell was up; applied when it expires. */
  pendingClose: string | null;
  /** Sustain ticks for StatusTimeline (capped). */
  ticks: Status[];
  demoClock: DemoClock;
  transcript: TranscriptEntry[];
  /** Raw feed for PresenterFeed (capped). */
  frames: FlowFrame[];
  /** Last applied agent_event seq (order/dedupe on reconnect). */
  lastSeq: number;
  nextId: number;
  /** The device agent this UI is paired with (from hello_ack); null = unbound. */
  boundDeviceId: string | null;
  /** Live device agents to choose from. null = not offered yet;
   *  [] = offered but none online (wait for one to connect). */
  deviceChoices: DeviceInfo[] | null;
  /** True once the pairing is a real CHOICE (?device=, or a picker/remembered
   *  selection) rather than the cloud's auto-bind guess. An auto-bind is only
   *  unambiguous while exactly one device exists — if a second shows up we re-ask. */
  explicitPair: boolean;
  /** The user asked to change device — show the picker even though we're paired. */
  pickerOpen: boolean;
}

const INITIAL_STATE: UiState = {
  activeGoalId: null,
  phase: null,
  working: false,
  understanding: null,
  goalText: "",
  declinedGoalId: null,
  modules: null,
  agentEntries: [],
  harness: INITIAL_HARNESS,
  draftItems: [],
  draftQueue: [],
  draftHoldUntil: 0,
  draftTotal: null,
  plan: null,
  pristinePlan: null,
  changedPlanIds: [],
  planMorphs: {},
  morphSeq: 0,
  changedImpactLabels: [],
  proposalStatuses: {},
  adaptations: [],
  eventChips: [],
  firedEventIds: [],
  firingEventId: null,
  approved: false,
  saving: null,
  pendingClose: null,
  ticks: [],
  demoClock: INITIAL_DEMO_CLOCK,
  transcript: [],
  frames: [],
  lastSeq: 0,
  nextId: 1,
  boundDeviceId: null,
  deviceChoices: null,
  // ?device=<id> in the URL is an explicit choice made before we ever connect.
  explicitPair: getDeviceId() !== "",
  pickerOpen: false,
};

type UiAction =
  | { type: "recv"; message: UiInboundMessage }
  | { type: "sent"; message: UiOutboundMessage }
  | { type: "harness_tick" }
  | { type: "harness_settled" }
  | { type: "draft_tick" }
  | { type: "goal_text_restored"; goalId: string; text: string }
  | { type: "device_selected"; explicit: boolean }
  | { type: "open_picker" }
  | { type: "close_picker" }
  | { type: "understanding_sent"; goalId: string; confirmed: boolean }
  | { type: "decisions_sent"; decisions: ApprovalDecision[] }
  | { type: "event_fired"; eventId: string }
  | { type: "event_timeout"; eventId: string }
  | { type: "close_now" }
  | { type: "demo_reset" };

/**
 * How long "Saving…" stays up at minimum (v7).
 *
 * Not a delay for its own sake: the cloud does the cross-goal work BEFORE it closes the
 * webview, so in Act 3 this screen is up for exactly as long as that takes and the floor
 * never binds. It binds in Act 1, where saving really is instant and a flash of a screen
 * nobody can read is worse than no screen at all.
 */
const MIN_SAVING_MS = 1400;

const MAX_FRAMES = 120;
const MAX_TICKS = 40;

function pushFrame(state: UiState, direction: FlowFrame["direction"], message: FlowFrame["message"]): UiState {
  const frame: FlowFrame = { id: state.nextId, direction, at: Date.now(), message };
  return {
    ...state,
    nextId: state.nextId + 1,
    frames: [...state.frames.slice(-(MAX_FRAMES - 1)), frame],
  };
}

/** agent_event → live stream entries (the "watch it think" reduction). */
function reduceAgentEvent(state: UiState, event: AgentEvent): UiState {
  if (event.seq <= state.lastSeq) {
    return state; // late/duplicate frame after reconnect — drop
  }
  const next: UiState = { ...state, lastSeq: event.seq, working: true };

  switch (event.event) {
    case "phase": {
      // Fold the raw device phase onto the rail vocabulary and only ever advance
      // (never regress) — an unrecognized/terminal phase used to collapse the rail
      // and flicker. Unknown → keep the current phase.
      const incoming = railPhaseFromAgentPhase(event.payload.phase);
      if (incoming === null) return next;
      return { ...next, phase: maxRailPhase(next.phase, incoming) };
    }

    case "thinking": {
      // Attributed to the engine running ON THE WIRE, so each focus card shows only what
      // its own engine said. `activeModule` is the PAINTED engine and lags by the render
      // floor, which would file grounding's narration under whichever card is on screen.
      const engine = next.harness.wireActive;

      // v7 — A STEP IS NOT A FRAGMENT. It arrives whole, so it is never merged with what
      // came before and never touched by the blob-stripping below; those heuristics exist
      // only because prose and JSON share one untyped channel, and a step does not.
      const thinkingKind = event.payload.kind;
      if (thinkingKind === "step" || thinkingKind === "notice") {
        const step = event.payload.step ?? event.payload.text;
        if (!step.trim()) return next;
        return {
          ...next,
          nextId: next.nextId + 1,
          agentEntries: [
            ...next.agentEntries,
            {
              kind: "step",
              id: next.nextId,
              step,
              detail: event.payload.detail,
              tone: thinkingKind === "notice" ? "notice" : "step",
              engine,
            },
          ],
        };
      }

      const last = next.agentEntries[next.agentEntries.length - 1];
      const sameEngine = last?.kind === "thinking" && (last.engine ?? null) === engine;
      const merged = sameEngine && last?.kind === "thinking" ? last.text + event.payload.text : event.payload.text;
      // Fragments accumulate VERBATIM. There used to be a per-fragment JSON filter here
      // and it made things worse: the device streams token chunk by token chunk, so it
      // dropped precisely the chunks holding the braces and kept everything between
      // them — a JSON blob rendered as mangled pseudo-prose. A blob can only be
      // recognised once the text is whole, so the filtering moved to buildTranscript
      // (lib/reasoning.ts) and the raw stream stays intact for the presenter feed.
      if (sameEngine && last?.kind === "thinking") {
        // consecutive fragments from the SAME engine accumulate into one block
        return { ...next, agentEntries: [...next.agentEntries.slice(0, -1), { ...last, text: merged }] };
      }
      return {
        ...next,
        nextId: next.nextId + 1,
        agentEntries: [
          ...next.agentEntries,
          { kind: "thinking", id: next.nextId, text: event.payload.text, engine },
        ],
      };
    }

    case "tool_call":
      return {
        ...next,
        nextId: next.nextId + 1,
        agentEntries: [
          ...next.agentEntries,
          {
            kind: "chip",
            id: next.nextId,
            module: event.payload.module,
            fn: event.payload.function,
            state: "running",
          },
        ],
      };

    case "tool_result": {
      // resolve the most recent RUNNING chip for this module.function
      const entries = [...next.agentEntries];
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const entry = entries[i];
        if (
          entry.kind === "chip" &&
          entry.state === "running" &&
          entry.module === event.payload.module &&
          entry.fn === event.payload.function
        ) {
          entries[i] = { ...entry, state: "done", summary: event.payload.summary };
          break;
        }
      }
      return { ...next, agentEntries: entries };
    }

    case "plan_progress":
      // Queued, not shown: the device fires every item in one loop after the safety and
      // approval beats, so all N land in the same millisecond. The `draft_tick` timer
      // reveals them one at a time (PLAN_ITEM_STEP_MS).
      return {
        ...next,
        draftQueue: [
          ...next.draftQueue,
          {
            title: event.payload.item.title,
            detail: event.payload.item.detail,
            tags: event.payload.item.tags,
            when: event.payload.item.when,
            day: event.payload.item.day,
          },
        ],
        draftTotal: event.payload.total ?? next.draftTotal,
      };

    case "harness":
      // v5: light up the harness pipeline. This is the star of the demo — the harness
      // engines are finally visible, one row per engine, the active one glowing.
      // The beat is QUEUED, not applied: Safety / Task Manager / Approval emit their
      // `active` and resolve in the same millisecond (their real work happens earlier —
      // see HARNESS_ACTIVE_FLOOR_MS), so painting on arrival flashed them past unseen.
      // The `harness_tick` timer below drains the queue at eye speed.
      return { ...next, harness: enqueueHarness(next.harness, event.payload, Date.now()) };

    default:
      // An agent_event kind this UI doesn't render — notably `task_update`, which
      // the device streams heavily (it drives Agent Board's progress, not this feed).
      // Without this the switch returns undefined and the NEXT event crashes reading
      // `state.lastSeq` on it → the ErrorBoundary's "cannot render". Advance lastSeq
      // (via `next`) and drop the frame. Same fix as reduceInbound's default; this is
      // the inner reducer, which was missed.
      return next;
  }
}

/** Merge adaptation impact badges into the plan's existing set, replacing by label. */
function mergeImpact(current: ImpactBadge[], delta: ImpactBadge[]): ImpactBadge[] {
  if (delta.length === 0) return current;
  const byLabel = new Map(current.map((b) => [b.label, b]));
  for (const b of delta) byLabel.set(b.label, b);
  return [...byLabel.values()];
}

function buildEventChips(plan: PresentPlan): EventChip[] {
  return [...(plan.payload.demo_events ?? [])]
    .sort((a, b) => a.order - b.order)
    .map((event) => ({ event, state: "idle" }));
}

function inboundEventId(message: Proposal | Status): string | undefined {
  return message.payload.event_id ?? message.event_id;
}

function markEventFired(state: UiState, eventId: string): UiState {
  if (!state.eventChips.some((chip) => chip.event.id === eventId)) return state;
  return {
    ...state,
    eventChips: state.eventChips.map((chip) =>
      chip.event.id === eventId ? { ...chip, state: "fired" } : chip,
    ),
    firedEventIds: state.firedEventIds.includes(eventId)
      ? state.firedEventIds
      : [...state.firedEventIds, eventId],
    firingEventId: state.firingEventId === eventId ? null : state.firingEventId,
  };
}

function isPlanApproved(plan: PresentPlan | null, statuses: ProposalStatusMap): boolean {
  if (!plan) return false;
  // Only proposals the user must actually click gate the event strip. Auto-tier
  // proposals are executed automatically (no approve button, see ProposalList),
  // so including them here would leave the strip locked forever.
  const approvalRequired = plan.payload.proposals.filter(
    (proposal) => proposal.tier !== "auto" && proposal.requires_approval,
  );
  if (approvalRequired.length === 0) return true;
  return approvalRequired.every(
    (proposal) => statuses[proposal.proposal_id]?.approved === true,
  );
}

/**
 * Is the device this UI is bound to actually ONLINE?
 *
 * The cloud's `devices` list contains ONLY currently-connected agents (offline ones
 * are omitted entirely — never sent with online:false), so presence in the list IS
 * "online". Returns true when we have no binding yet or no list yet (nothing to heal):
 * "offline" is a claim we can only make once a `devices` frame has arrived and our
 * bound id is missing from it.
 */
function boundDeviceOnline(boundId: string | null, choices: DeviceInfo[] | null): boolean {
  if (!boundId || choices === null) return true;
  return choices.some((device) => device.device_id === boundId);
}

/**
 * The create phase for the active goal terminated (approval / declined gate / terminal
 * error) → back to the idle waiting state. The board owns the goal now.
 *
 * Extracted in v7 because two paths reach it: the cloud's `chat_ui_close`, and the timer
 * that applies a close which arrived while the saving screen was still up.
 */
function closeCreatePhase(state: UiState): UiState {
  return {
    ...state,
        activeGoalId: null,
        understanding: null,
        goalText: "",
        phase: null,
        working: false,
        agentEntries: [],
        harness: INITIAL_HARNESS,
        draftItems: [],
        draftQueue: [],
        draftHoldUntil: 0,
        draftTotal: null,
        plan: null,
        pristinePlan: null,
        changedPlanIds: [],
        planMorphs: {},
        morphSeq: 0,
        changedImpactLabels: [],
        proposalStatuses: {},
        adaptations: [],
        eventChips: [],
        firedEventIds: [],
        firingEventId: null,
        approved: false,
        ticks: [],
        lastSeq: 0,
    saving: null,
    pendingClose: null,
  };
}

/** The single inbound-frame → UI-state mapping (see ARCHITECTURE.md table). */
function reduceInbound(state: UiState, message: UiInboundMessage): UiState {
  if ("goal_id" in message && message.goal_id === state.declinedGoalId) {
    return state;
  }

  // v4.1 strict create-phase filter: once `chat_ui_open` has keyed the stage to a
  // goal, IGNORE every goal-scoped frame for any OTHER goal (a superseded or
  // previous goal's late/replayed frames). `chat_ui_open` itself is exempt — it is
  // what (re)targets the active goal (a supersede is a retarget, not a reset flicker).
  if (
    message.type !== "chat_ui_open" &&
    "goal_id" in message &&
    state.activeGoalId !== null &&
    message.goal_id !== state.activeGoalId
  ) {
    return state;
  }

  const withGoal =
    "goal_id" in message && message.goal_id !== state.activeGoalId
      ? { ...state, activeGoalId: message.goal_id }
      : state;

  switch (message.type) {
    case "hello_ack":
      // The cloud tells us which device agent it paired this socket with — from
      // our `?device=`, its auto-bind (only one device online), or our pick. Keep
      // deviceChoices: we need it for the paired device's NAME and the "change" picker.
      return message.device_id
        ? { ...withGoal, boundDeviceId: message.device_id, pickerOpen: false }
        : withGoal;

    case "devices":
      // Sent to every ui whenever the connected set changes. While unbound this
      // drives the picker; while AUTO-bound it's how we learn a second device
      // appeared and our guess is no longer unambiguous.
      return { ...withGoal, deviceChoices: message.devices };

    case "capabilities":
      return { ...withGoal, modules: message.modules };

    // v3 board frames. The cloud broadcasts to EVERY ui bound to a session, so this
    // surface receives them even though Agent Board is its own app. Ignored HERE
    // ON PURPOSE — but listed, so the compiler forces a decision instead of letting
    // a frame vanish into a default case. (This surface is one goal at a time; it
    // adopts its goal_id from `understanding`, so goal_accepted tells it nothing new.)
    case "board_snapshot":
    case "board_update":
    case "goal_accepted":
      return withGoal;

    case "agent_event":
      return reduceAgentEvent(withGoal, message);

    case "understanding":
      return {
        ...withGoal,
        understanding: message,
        goalText: message.payload.objective || withGoal.goalText,
        working: false,
        phase: maxRailPhase(withGoal.phase, "confirming"),
      };

    case "notice":
      // v7: NOT every notice is terminal. "updating_goals" arrives mid-save, while the
      // saving screen is deliberately still up, and says what the cloud is doing to the
      // user's OTHER goals. Clearing the stage on it would tear down the very screen it
      // is captioning.
      if (message.kind === "updating_goals") {
        return withGoal.saving
          ? { ...withGoal, saving: { ...withGoal.saving, detail: message.message } }
          : withGoal;
      }
      // Terminal, non-plan message (e.g. an out-of-scope decline). The goal
      // never reached the device — clear the stage and surface the redirect as a
      // prominent transcript note (activeGoalId=null lets the note render).
      return {
        ...withGoal,
        nextId: withGoal.nextId + 1,
        transcript: [
          ...withGoal.transcript,
          { kind: "note", id: withGoal.nextId, text: message.message },
        ],
        activeGoalId: null,
        declinedGoalId: message.goal_id,
        understanding: null,
        goalText: "",
        phase: null,
        working: false,
        agentEntries: [],
        harness: INITIAL_HARNESS,
        draftItems: [],
        draftQueue: [],
        draftHoldUntil: 0,
        draftTotal: null,
        plan: null,
        pristinePlan: null,
        changedPlanIds: [],
        planMorphs: {},
        morphSeq: 0,
        changedImpactLabels: [],
        proposalStatuses: {},
        adaptations: [],
        eventChips: [],
        firedEventIds: [],
        firingEventId: null,
        approved: false,
        ticks: [],
        lastSeq: 0,
      };

    case "chat_ui_open": {
      // The create phase for `goal_id` began → HARD RESET, keyed to this goal.
      // IDEMPOTENT per goal: a repeat open for the already-active goal is a no-op,
      // because the cloud replays chat_ui_open on bind right before replaying the
      // cached understanding/plan — resetting again would wipe the restored state.
      if (state.activeGoalId === message.goal_id) {
        return state;
      }
      // Drop ALL prior-goal stage state and render the fresh "listening" stage
      // (modeled on the `notice` reset shape). Device-pairing state (boundDeviceId,
      // deviceChoices, explicitPair, pickerOpen, modules) is deliberately preserved.
      return {
        ...state,
        activeGoalId: message.goal_id,
        declinedGoalId: null,
        understanding: null,
        goalText: "",
        phase: "interpreting",
        working: true,
        agentEntries: [],
        harness: INITIAL_HARNESS,
        draftItems: [],
        draftQueue: [],
        draftHoldUntil: 0,
        draftTotal: null,
        plan: null,
        pristinePlan: null,
        changedPlanIds: [],
        planMorphs: {},
        morphSeq: 0,
        changedImpactLabels: [],
        proposalStatuses: {},
        adaptations: [],
        eventChips: [],
        firedEventIds: [],
        firingEventId: null,
        approved: false,
        ticks: [],
        lastSeq: 0,
      };
    }

    case "chat_ui_close":
      // v7: HOLD IT while the saving screen is up. The cloud closes within a round-trip
      // of the approval, which used to wipe the surface before anyone could read it —
      // and took the execution status frames with it. The close is remembered and
      // applied when the dwell expires (see the effect that dispatches close_now).
      if (withGoal.saving && Date.now() - withGoal.saving.startedAt < MIN_SAVING_MS) {
        return { ...withGoal, pendingClose: message.goal_id };
      }
      return closeCreatePhase(withGoal);

    case "present_plan":
      return {
        ...withGoal,
        understanding: null,
        plan: message,
        pristinePlan: message,
        working: false,
        // NOT cleared here (v5.1). plan_ready follows the plan_progress burst by
        // milliseconds, so wiping the reveal queue on arrival meant the outcome column
        // jumped straight to the finished hero and the rows never landed one by one.
        // The queue drains on its own; PlanColumn swaps to the hero when it is empty —
        // which is also what makes the slot count exact, since by then the true total
        // is known. Only a goal boundary (chat_ui_open/close, notice) resets these.
        changedPlanIds: [],
        planMorphs: {},
        morphSeq: 0,
        changedImpactLabels: [],
        eventChips: buildEventChips(message),
        firedEventIds: [],
        firingEventId: null,
        approved: isPlanApproved(message, {}),
        phase: maxRailPhase(
          withGoal.phase,
          railPhaseFromStatus(message.task_status) ?? "awaiting_approval",
        ),
      };

    case "proposal": {
      const next = {
        ...withGoal,
        working: false,
        adaptations: [...withGoal.adaptations, message],
        phase: maxRailPhase(withGoal.phase, railPhaseFromStatus(message.task_status)),
      };
      const eventId = inboundEventId(message);
      return eventId ? markEventFired(next, eventId) : next;
    }

    case "status": {
      let next: UiState = {
        ...withGoal,
        ticks: [...withGoal.ticks.slice(-(MAX_TICKS - 1)), message],
        // THE DAY-UPDATE FIX: merge (never replace) the sim clock — frames
        // without day/sim_date can no longer reset the label (v1 bug).
        demoClock: mergeDemoClock(withGoal.demoClock, message.payload),
        phase: maxRailPhase(withGoal.phase, railPhaseFromStatus(message.task_status)),
      };
      // A daily adaptation was approved → replace the plan in place with the
      // patched plan, merge its impact badges, and mark the changed rows so the
      // card can highlight them. Everything else about the card is preserved.
      const updated = message.payload.updated_plan;
      if (updated && updated.length > 0 && next.plan) {
        const prevItems = next.plan.payload.plan;
        const prevById = new Map(prevItems.map((item) => [item.id, item]));
        // The row a changed id replaced: same id first, then the row that held
        // the slot (same day, then same position) — a swapped row often arrives
        // under a FRESH id, and an id-only lookup silently drops the morph.
        const prevForRow = (id: string) => {
          const index = updated.findIndex((item) => item.id === id);
          const row = updated[index];
          if (!row) return undefined;
          return (
            prevById.get(id) ??
            prevItems.find((prev) => prev.day === row.day) ??
            prevItems[index]
          );
        };
        // A row is changed only when its title/detail ACTUALLY differ from the
        // row it replaced. Do NOT trust changed_ids alone: the device re-sends
        // the same updated_plan on later monitoring ticks, and force-including
        // those ids would recompute an empty morph on the echo and WIPE the
        // just-set cancelled-dish morph. (changed_ids still informs prevForRow's
        // id lookup; it just can't force an unchanged row to count as changed.)
        const changedIds = updated
          .filter((item) => {
            const prev = prevForRow(item.id);
            return prev != null && (prev.title !== item.title || prev.detail !== item.detail);
          })
          .map((item) => item.id);
        // Only (re)apply when something really changed. An identical echo must
        // leave the plan — and the persistent morph — untouched.
        if (changedIds.length > 0) {
          const planMorphs = Object.fromEntries(
            changedIds.flatMap((id) => {
              const prev = prevForRow(id);
              const row = updated.find((item) => item.id === id);
              // Skip the strike only when the title is IDENTICAL — striking the
              // same text as the new title would read as a glitch.
              return prev && row && prev.title !== row.title
                ? [[id, { prevTitle: prev.title, prevDetail: prev.detail }]]
                : [];
            }),
          );
          next = {
            ...next,
            plan: {
              ...next.plan,
              payload: {
                ...next.plan.payload,
                plan: updated,
                impact: mergeImpact(next.plan.payload.impact, message.payload.impact_delta ?? []),
              },
            },
            changedPlanIds: changedIds,
            planMorphs,
            morphSeq: next.morphSeq + 1,
            changedImpactLabels: (message.payload.impact_delta ?? []).map((badge) => badge.label),
          };
        }
      }
      for (const executed of message.payload.executed ?? []) {
        next = {
          ...next,
          proposalStatuses: {
            ...next.proposalStatuses,
            [executed.proposal_id]: {
              state: "done",
              approved: next.proposalStatuses[executed.proposal_id]?.approved ?? true,
              detail: executed.detail || executed.result,
            },
          },
        };
      }
      next = { ...next, approved: isPlanApproved(next.plan, next.proposalStatuses) };
      const eventId = inboundEventId(message);
      if (eventId) {
        next = markEventFired(next, eventId);
      }
      return next;
    }
    default:
      // A frame the allowlist passes but this switch doesn't map. Every case is
      // covered today, so this never fires — but without it an unhandled type makes
      // reduceInbound return undefined, and the NEXT frame crashes reading
      // `state.nextId` on it. A reducer must always return a state; carry the goal
      // update and drop the frame rather than poison the store.
      return withGoal;
  }
}

function reducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case "recv":
      return reduceInbound(pushFrame(state, "recv", action.message), action.message);

    case "sent":
      return pushFrame(state, "sent", action.message);

    case "harness_tick":
      // Show the next queued harness beat (paced — see HARNESS_ACTIVE_FLOOR_MS).
      return { ...state, harness: drainHarness(state.harness, Date.now()) };

    case "draft_tick": {
      // Reveal the next plan row.
      const [row, ...rest] = state.draftQueue;
      if (!row) return state;
      return {
        ...state,
        draftItems: [...state.draftItems, row],
        draftQueue: rest,
        draftHoldUntil: Date.now() + PLAN_ITEM_STEP_MS,
      };
    }

    case "goal_text_restored":
      // Remembered locally (see the effect below) — only ever applied to the goal it
      // was stored for, and never over a text the wire has already given us.
      return state.activeGoalId === action.goalId && state.goalText === ""
        ? { ...state, goalText: action.text }
        : state;

    case "harness_settled":
      // Every beat is shown and the last one has been read — release the collapse.
      return { ...state, harness: settleHarness(state.harness) };

    case "device_selected":
      // Only a real CHOICE (the picker, or the device this browser remembered) settles
      // the pairing. Auto-picking the only device on offer is still a guess, so it stays
      // re-askable if another device turns up.
      return action.explicit ? { ...state, explicitPair: true } : state;

    case "open_picker":
      return { ...state, pickerOpen: true };

    case "close_picker":
      return { ...state, pickerOpen: false };

    case "understanding_sent":
      if (action.confirmed) {
        return {
          ...state,
          understanding: null,
          activeGoalId: action.goalId,
          phase: maxRailPhase(state.phase, "planning"),
          working: true,
        };
      }
      return {
        ...state,
        nextId: state.nextId + 1,
        transcript: [
          ...state.transcript,
          { kind: "note", id: state.nextId, text: "Cancelled — try rephrasing" },
        ],
        activeGoalId: null,
        understanding: null,
        goalText: "",
        declinedGoalId: action.goalId,
        phase: null,
        working: false,
        agentEntries: [],
        harness: INITIAL_HARNESS,
        draftItems: [],
        draftQueue: [],
        draftHoldUntil: 0,
        draftTotal: null,
        plan: null,
        pristinePlan: null,
        changedPlanIds: [],
        planMorphs: {},
        morphSeq: 0,
        changedImpactLabels: [],
        proposalStatuses: {},
        adaptations: [],
        eventChips: [],
        firedEventIds: [],
        firingEventId: null,
        approved: false,
        ticks: [],
        lastSeq: 0,
      };

    case "close_now":
      return closeCreatePhase(state);

    case "decisions_sent": {
      const proposalStatuses = { ...state.proposalStatuses };
      for (const decision of action.decisions) {
        // A DECLINE resolves immediately — nothing gets executed, so no status
        // frame will ever confirm it; leaving it "pending" stuck the card on
        // "Waiting for confirmation" forever. Only approvals wait for the device.
        proposalStatuses[decision.proposal_id] = decision.approved
          ? { state: "pending", approved: true }
          : { state: "done", approved: false };
      }
      // The event strip unlocks once the user has approved every approval-required
      // proposal on the initial plan. Pending approvals count because the user
      // has acted on the plan CTA; later status frames only confirm execution.
      const approved = isPlanApproved(state.plan, proposalStatuses);
      return {
        ...state,
        proposalStatuses,
        approved,
        // v7: hold the surface. Everything the device reports about what actually ran
        // arrives AFTER this tap, and used to land on a UI the close had already wiped.
        saving: approved ? { startedAt: Date.now(), detail: null } : state.saving,
      };
    }

    case "event_fired":
      if (state.firingEventId || state.firedEventIds.includes(action.eventId) || !state.approved) {
        return state;
      }
      return {
        ...state,
        firingEventId: action.eventId,
        eventChips: state.eventChips.map((chip) =>
          chip.event.id === action.eventId ? { ...chip, state: "firing" } : chip,
        ),
      };

    case "event_timeout":
      if (state.firingEventId !== action.eventId) return state;
      return {
        ...state,
        firingEventId: null,
        eventChips: state.eventChips.map((chip) =>
          chip.event.id === action.eventId ? { ...chip, state: "idle" } : chip,
        ),
      };

    case "demo_reset":
      return {
        ...state,
        plan: state.pristinePlan,
        changedPlanIds: [],
        planMorphs: {},
        morphSeq: 0,
        changedImpactLabels: [],
        proposalStatuses: {},
        adaptations: [],
        eventChips: state.pristinePlan ? buildEventChips(state.pristinePlan) : [],
        firedEventIds: [],
        firingEventId: null,
        approved: false,
        ticks: [],
        demoClock: INITIAL_DEMO_CLOCK,
        working: false,
        phase: state.pristinePlan ? "awaiting_approval" : state.phase,
      };
    default:
      // Actions are an internal closed union, so this is unreachable today — but a
      // reducer must always return a state, and "switch falls through to undefined"
      // has bitten this file three times (reduceInbound, reduceAgentEvent, here).
      return state;
  }
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const socketRef = useRef<GoalFlowSocket | null>(null);
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  /**
   * Apply a close that arrived while "Saving…" was still up (v7).
   *
   * The cloud closes the webview within a round-trip of the approval, so without this
   * the screen that reports what was saved is destroyed before it can be read — and the
   * execution status frames land on a surface that is already gone.
   */
  useEffect(() => {
    if (!state.pendingClose || !state.saving) return;
    const remaining = MIN_SAVING_MS - (Date.now() - state.saving.startedAt);
    if (remaining <= 0) {
      dispatch({ type: "close_now" });
      return;
    }
    const id = window.setTimeout(() => dispatch({ type: "close_now" }), remaining);
    return () => window.clearTimeout(id);
  }, [state.pendingClose, state.saving]);

  const [presenterMode, setPresenterMode] = useState(false);
  // v5: full-screen "harness theater" for projecting the pipeline on stage.
  const [theaterMode, setTheaterMode] = useState(false);

  useEffect(() => {
    const socket = createGoalFlowSocket({
      onMessage: (message) => dispatch({ type: "recv", message }),
      onSent: (message) => dispatch({ type: "sent", message }),
      onStateChange: setConnection,
    });
    socketRef.current = socket;
    socket.connect();
    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, []);

  // v5 harness pacing: drain the beat queue one beat at a time, never faster than the
  // floor armed by the previous beat. Re-arms itself while the queue is non-empty, so a
  // burst of same-millisecond beats (Safety → Task Manager → Approval) plays out as a
  // watchable sequence instead of a single frame. Nothing is skipped or reordered.
  useEffect(() => {
    const { queue, holdUntil, settled } = state.harness;
    if (queue.length === 0 && settled) return;
    const wait = Math.max(0, holdUntil - Date.now());
    const next: UiAction = queue.length > 0 ? { type: "harness_tick" } : { type: "harness_settled" };
    const timer = setTimeout(() => dispatch(next), wait);
    return () => clearTimeout(timer);
  }, [state.harness.queue, state.harness.holdUntil, state.harness.settled]);

  // v5.1 plan reveal pacing — the outcome column fills one row at a time, for the same
  // reason the harness has a render floor: the device emits every plan_progress in a
  // single loop, so unpaced the whole plan appears in one frame.
  useEffect(() => {
    if (state.draftQueue.length === 0) return;
    const wait = Math.max(0, state.draftHoldUntil - Date.now());
    const timer = setTimeout(() => dispatch({ type: "draft_tick" }), wait);
    return () => clearTimeout(timer);
  }, [state.draftQueue, state.draftHoldUntil]);

  // The run clock shown in the goal bar: starts with the goal, freezes when the work
  // stops (so it reports how long the run took, not how long the tab has been open).
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [runEndedAt, setRunEndedAt] = useState<number | null>(null);
  useEffect(() => {
    setRunStartedAt(state.activeGoalId ? Date.now() : null);
    setRunEndedAt(null);
  }, [state.activeGoalId]);
  useEffect(() => {
    if (state.working) {
      setRunStartedAt((prev) => prev ?? Date.now());
      setRunEndedAt(null);
    } else {
      setRunEndedAt((prev) => prev ?? (runStartedAt !== null ? Date.now() : null));
    }
    // runStartedAt is read, not tracked: this fires on the working edge by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.working]);

  // This surface is EPHEMERAL (v4.1: Bixby opens it in a webview) and the cloud stops
  // replaying `understanding` once a plan exists — see _replay_create_phase. The
  // objective it carried is the only place the goal's words appear, so remember them
  // per goal locally; otherwise a reopened webview shows a plan under a blank title.
  useEffect(() => {
    const goalId = state.activeGoalId;
    if (!goalId) return;
    const key = `goalflow:goal-text:${goalId}`;
    try {
      if (state.goalText) {
        window.localStorage.setItem(key, state.goalText);
        return;
      }
      const remembered = window.localStorage.getItem(key);
      if (remembered) dispatch({ type: "goal_text_restored", goalId, text: remembered });
    } catch {
      // Private mode / storage disabled — the title just falls back. Not worth a crash.
    }
  }, [state.activeGoalId, state.goalText]);

  const selectDevice = (deviceId: string, explicit = true) => {
    if (explicit) {
      rememberDeviceId(deviceId); // only a real choice is worth remembering
    }
    dispatch({ type: "device_selected", explicit });
    socketRef.current?.send({ type: "select_device", device_id: deviceId });
    // The cloud replies hello_ack{device_id} — that's what marks us bound.
  };

  // Settle the pairing without bothering anyone when it's unambiguous:
  //  - the device this browser last chose, if it's online → a CHOICE, settles it;
  //  - else, while unbound, the only device on offer      → a guess, stays re-askable.
  // Anything else renders the picker.
  useEffect(() => {
    if (!state.deviceChoices?.length) return;

    // SELF-HEAL an offline binding. We are bound to a device the (online-only)
    // `devices` list no longer contains — e.g. the device restarted under a fresh
    // auto-generated id, so our stale id silently binds to an empty session that
    // declines every goal. When EXACTLY ONE device is online, auto-rebind to it
    // (demo has one device — it should just work), even when the pairing was
    // explicit (?device=). 0 or 2+ online → leave it to the picker / reconnecting
    // note. Runs BEFORE the explicitPair early-return so an explicit-but-dead
    // binding still heals. The `only !== bound` guard never re-sends for the id we
    // are already on (and a bound id that is offline is by definition NOT `only`,
    // which is online), so this cannot loop.
    if (state.boundDeviceId && !boundDeviceOnline(state.boundDeviceId, state.deviceChoices)) {
      if (state.deviceChoices.length === 1) {
        const only = state.deviceChoices[0].device_id;
        if (only !== state.boundDeviceId) {
          rememberDeviceId(only);
          selectDevice(only, false);
        }
      }
      return;
    }

    if (state.boundDeviceId && state.explicitPair) return; // already settled

    const remembered = getRememberedDeviceId();
    const match = state.deviceChoices.find((d) => d.device_id === remembered);
    if (match) {
      if (match.device_id === state.boundDeviceId) {
        dispatch({ type: "device_selected", explicit: true }); // already on it — just settle
      } else {
        selectDevice(match.device_id, true);
      }
      return;
    }
    if (!state.boundDeviceId && state.deviceChoices.length === 1) {
      selectDevice(state.deviceChoices[0].device_id, false);
    }
  }, [state.boundDeviceId, state.deviceChoices, state.explicitPair]);

  // Drill-in from the Agent Board: `?goal=<id>` means "show me this one". Ask only
  // once we're BOUND — the hub answers into a device session, so a request sent
  // before pairing would be answered into nowhere. Once per load: this rejoins a
  // goal, it doesn't poll one.
  const rejoinedGoalRef = useRef(false);
  useEffect(() => {
    if (rejoinedGoalRef.current || !state.boundDeviceId) return;
    const goalId = getGoalId();
    if (!goalId) return;
    rejoinedGoalRef.current = true;
    socketRef.current?.send({ type: "goal_state_get", goal_id: goalId });
  }, [state.boundDeviceId]);

  const sendDecisions = (
    goalId: string,
    correlationId: string,
    decisions: ApprovalDecision[],
  ) => {
    // Record this click locally (updates the card + the approved/handoff state).
    dispatch({ type: "decisions_sent", decisions });

    // v4.1: DO NOT send an `approval` frame per click. The device resumes the WHOLE
    // plan on the FIRST `approval` frame it receives — the contract's `decisions[]`
    // is meant to be the COMPLETE set — and the cloud closes the chat webview on that
    // frame. Sending per proposal therefore drops every later proposal (e.g. a firm
    // grocery order) and closes the webview early. So we send ONE frame with EVERY
    // decision, only once every approval-required proposal has been decided.
    const plan = state.plan;
    if (!plan) return;
    const required = plan.payload.proposals.filter(
      (proposal) => proposal.tier !== "auto" && proposal.requires_approval,
    );
    // Merge decisions already recorded with this click — the dispatch above is async,
    // so `state.proposalStatuses` does not yet reflect the current click.
    const decided = new Map<string, boolean>();
    for (const [proposalId, status] of Object.entries(state.proposalStatuses)) {
      if (status) decided.set(proposalId, status.approved);
    }
    for (const decision of decisions) decided.set(decision.proposal_id, decision.approved);

    if (!required.every((proposal) => decided.has(proposal.proposal_id))) return;

    const fullDecisions: ApprovalDecision[] = required.map((proposal) => ({
      proposal_id: proposal.proposal_id,
      approved: decided.get(proposal.proposal_id) === true,
    }));
    socketRef.current?.send({
      type: "approval",
      goal_id: goalId,
      correlation_id: correlationId,
      payload: { decisions: fullDecisions },
    });
  };

  const sendUnderstanding = (confirmed: boolean, acceptedConstraintIds: string[] = []) => {
    if (!state.understanding) return;
    const goalId = state.understanding.goal_id;
    dispatch({ type: "understanding_sent", goalId, confirmed });
    socketRef.current?.send({
      type: "understanding_response",
      goal_id: goalId,
      // v6-M4: the ticked rules ride with the answer. Declining sends none — a
      // household rule needs its own yes, never one inherited from the goal.
      payload: { confirmed, accepted_constraint_ids: confirmed ? acceptedConstraintIds : [] },
    });
  };

  // Unbound = the cloud has no device to route our goal to yet; it would drop
  // the frame, so block the composer until a device is picked.
  const unbound = state.boundDeviceId === null && state.deviceChoices !== null;
  // An AUTO-bind (no ?device=, cloud saw exactly one device) was a guess. If a second
  // device has since connected the guess is ambiguous — ask, rather than silently
  // leaving this tab on whichever agent happened to be up first. Only while idle: never
  // interrupt a running goal.
  const stageIdle = !state.working && state.plan === null && state.understanding === null;
  const ambiguousAutoPair =
    state.boundDeviceId !== null &&
    !state.explicitPair &&
    (state.deviceChoices?.length ?? 0) > 1 &&
    stageIdle;
  // Bound to a device that is NOT in the (online-only) `devices` list → the paired
  // device agent is offline. Without this the UI stays "paired" to a dead session and
  // silently declines every goal, never offering the picker (boundDeviceId is truthy).
  // The settle effect above auto-rebinds when exactly one device is online; otherwise
  // we surface the picker (2+) or a reconnecting note (0).
  const boundOffline = !boundDeviceOnline(state.boundDeviceId, state.deviceChoices);
  // While an offline binding is self-healing (exactly one device online) or simply
  // waiting for a device to reappear (0 online), show a reassuring note rather than a
  // picker. A real CHOICE is only needed when 2+ devices are online.
  const boundOfflineReconnecting = boundOffline && (state.deviceChoices?.length ?? 0) < 2;
  // ...or the user asked to switch devices.
  const awaitingDevicePick = unbound || ambiguousAutoPair || boundOffline || state.pickerOpen;
  const pairedDevice = state.boundDeviceId
    ? state.deviceChoices?.find((d) => d.device_id === state.boundDeviceId) ?? null
    : null;
  const latestNote = [...state.transcript].reverse().find((entry) => entry.kind === "note");

  // v5.1: the run column OUTLIVES the plan's arrival. The device sends plan_ready
  // immediately after the Approval beat, so unmounting on `present_plan` yanked the last
  // engines' verdicts off screen before anyone could read them. Once every beat has been
  // shown the column stays, minus its focus card — the receipts ARE the record, so there
  // is no separate collapsed ribbon any more.
  const harnessDraining = state.harness.queue.length > 0 || !state.harness.settled;
  const goalText =
    [...state.transcript].reverse().find((entry) => entry.kind === "goal")?.text ?? state.goalText;
  const enginesCleared = HARNESS_PIPELINE.filter((e) => {
    if (e.id === "monitor_adapt") return false;
    const s = state.harness.engines[e.id].status;
    return s === "done" || s === "blocked";
  }).length;
  const engineTotal = HARNESS_PIPELINE.length - 1; // monitor_adapt is a board engine

  const showRun =
    !state.understanding && (harnessStarted(state.harness) || state.working || harnessDraining);
  // Rows are still landing, or they have landed but the plan itself has not.
  const formingPlan =
    state.draftQueue.length > 0 || (state.plan === null && state.draftItems.length > 0);
  const showOutcome =
    !state.understanding &&
    (state.plan !== null || state.draftItems.length > 0 || state.draftQueue.length > 0);
  // Hand the screen to the plan once the run has nothing left to say.
  const runCompact = state.plan !== null && !harnessDraining && !formingPlan;

  return (
    <div className="app">
      <GoalBar
        goal={goalText}
        eyebrow={state.understanding?.payload.capture_only ? "REMEMBERING" : undefined}
        fallback={state.plan ? "Your plan" : "Waiting for a goal…"}
        startedAt={runStartedAt}
        endedAt={runEndedAt}
        cleared={enginesCleared}
        total={engineTotal}
        deviceLabel={pairedDevice?.device_name ?? state.boundDeviceId}
        connection={connection}
        onChangeDevice={() => dispatch({ type: "open_picker" })}
        theater={theaterMode}
        onTheater={setTheaterMode}
        presenter={presenterMode}
        onPresenter={setPresenterMode}
      />

      {/* v5 presenter theater: full-bleed harness pipeline for the stage. Replaces the
          normal column while the agent works; falls back to the column otherwise. */}
      {theaterMode &&
      !state.understanding &&
      (!state.plan || harnessDraining) &&
      (state.working || harnessDraining || state.harness.activeModule) ? (
        <HarnessTheater harness={state.harness} goalText={goalText} />
      ) : (
        <main className={presenterMode ? "column column--with-feed" : "column"}>
          <div className="column__main">
            {boundOfflineReconnecting ? (
              <p className="device-offline-note" role="status" aria-live="polite">
                Paired device offline — reconnecting…
              </p>
            ) : awaitingDevicePick ? (
              <DevicePicker
                devices={state.deviceChoices ?? []}
                currentDeviceId={state.boundDeviceId}
                onSelect={selectDevice}
                onCancel={state.boundDeviceId ? () => dispatch({ type: "close_picker" }) : undefined}
              />
            ) : null}

            {latestNote && !state.activeGoalId && !state.working && !state.plan ? (
              <p className="transcript-note">{latestNote.text}</p>
            ) : null}

            {state.understanding ? (
              <UnderstandingCard
                objective={state.understanding.payload.objective}
                constraints={state.understanding.payload.knew}
                thought={state.understanding.payload.thought}
                applied={state.understanding.payload.constraints}
                preferences={state.understanding.payload.preferences}
                proposed={state.understanding.payload.proposed_constraints}
                captureOnly={state.understanding.payload.capture_only}
                onConfirm={(acceptedIds) => sendUnderstanding(true, acceptedIds)}
                onDecline={() => sendUnderstanding(false)}
              />
            ) : null}

            {showRun ? (
              <WorkingColumn
                harness={state.harness}
                entries={state.agentEntries}
                working={state.working}
                compact={runCompact}
              />
            ) : null}

            {showOutcome ? (
              <PlanColumn
                drafts={state.draftItems}
                announcedTotal={state.draftTotal}
                forming={formingPlan}
                plan={state.plan}
                changedIds={state.changedPlanIds}
                morphs={state.planMorphs}
                morphSeq={state.morphSeq}
                changedImpactLabels={state.changedImpactLabels}
                proposalStatuses={state.proposalStatuses}
                onDecide={(decisions) =>
                  sendDecisions(state.plan!.goal_id, state.plan!.correlation_id, decisions)
                }
              />
            ) : null}

            {state.ticks.length > 0 ? <StatusTimeline ticks={state.ticks} /> : null}
          </div>

          {presenterMode ? <PresenterFeed frames={state.frames} /> : null}
        </main>
      )}

      {/* v7 — THE SAVING SCREEN. Replaces the hand-off banner while the save is in
          flight: the banner said what WOULD happen next, and this says what is
          happening now. In Act 1 it is up for the dwell floor; in Act 3 it is up for as
          long as the cross-goal update takes, because the cloud does that work before
          it closes the webview. */}
      {state.saving ? (
        <div className="saving" role="status" aria-live="polite">
          <span className="saving__spinner" aria-hidden="true" />
          <div className="saving__body">
            <strong className="saving__title">
              {state.saving.detail ? "Saving, and updating your other goals…" : "Saving your plan…"}
            </strong>
            <span className="saving__detail">
              {state.saving.detail ??
                "Writing it to your device AI board. Your Family Hub takes it from here."}
            </span>
          </div>
        </div>
      ) : state.approved ? (
        <div className="handoff" role="status">
          <span className="handoff__mark" aria-hidden="true">✓</span>
          <div className="handoff__body">
            <strong>Plan approved.</strong>{" "}
            Your Agent Board is now driving this goal — it tracks progress, simulates
            world events, and will ask you there if anything needs to change.
          </div>
        </div>
      ) : null}
    </div>
  );
}
