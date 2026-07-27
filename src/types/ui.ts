/**
 * UI-side state vocabulary (NOT part of the wire contract).
 *
 * These types are what the streaming reducer in App.tsx produces from
 * CONTRACT v2 frames, and what the presentational components consume.
 * See docs/ARCHITECTURE.md § "Streaming event → UI state mapping".
 */

import type {
  AgentHarnessEvent,
  ApprovalTier,
  DemoEvent,
  HarnessModule,
  TaskStatus,
  UiInboundMessage,
  UiOutboundMessage,
} from "./contract";

// ---------------------------------------------------------------------------
// Progress rail
// ---------------------------------------------------------------------------

/** The seven steps the rail renders, in order. */
export type RailPhase =
  | "interpreting"
  | "grounding"
  | "confirming"
  | "planning"
  | "checking"
  | "awaiting_approval"
  | "monitoring";

export type RailAgent = "cloud" | "device";

export const RAIL_PHASES: readonly { id: RailPhase; label: string; agent: RailAgent }[] = [
  { id: "interpreting", label: "Interpreting", agent: "cloud" },
  { id: "grounding", label: "Grounding", agent: "cloud" },
  { id: "confirming", label: "Confirm", agent: "cloud" },
  { id: "planning", label: "Planning", agent: "device" },
  { id: "checking", label: "Checking", agent: "device" },
  { id: "awaiting_approval", label: "Approval", agent: "device" },
  { id: "monitoring", label: "Monitoring", agent: "device" },
] as const;

/** Map any task_status onto the rail (executing/adapting fold into monitoring). */
export function railPhaseFromStatus(status: TaskStatus): RailPhase | null {
  switch (status) {
    case "created":
      return null;
    case "interpreting":
    case "grounding":
    case "planning":
    case "checking":
    case "awaiting_approval":
      return status;
    case "executing":
    case "monitoring":
    case "adapting":
    case "done":
      return "monitoring";
  }
}

/**
 * Fold a raw device `agent_event {phase}` string onto the rail vocabulary. The
 * device streams phases the rail doesn't render as their own step — `executing`,
 * `adapting`, `done` all belong to Monitoring. Returns null for anything
 * unrecognized so the caller can KEEP the current phase rather than collapse the
 * rail to empty (a raw unknown value made findIndex return -1, unfilling every
 * step — the source of the left-to-right "flicker").
 */
export function railPhaseFromAgentPhase(raw: string): RailPhase | null {
  switch (raw) {
    case "interpreting":
    case "grounding":
    case "planning":
    case "checking":
    case "awaiting_approval":
    case "monitoring":
      return raw;
    case "executing":
    case "adapting":
    case "done":
      return "monitoring";
    default:
      return null;
  }
}

/**
 * The later of two rail phases. Keeps the rail MONOTONIC within a goal so the
 * fill only ever advances left→right and never jumps backward mid-stream (a new
 * goal resets the phase explicitly, outside this helper).
 */
export function maxRailPhase(a: RailPhase | null, b: RailPhase | null): RailPhase | null {
  if (a === null) return b;
  if (b === null) return a;
  const ai = RAIL_PHASES.findIndex((p) => p.id === a);
  const bi = RAIL_PHASES.findIndex((p) => p.id === b);
  return bi > ai ? b : a;
}

// ---------------------------------------------------------------------------
// Harness pipeline (v5) — the harness engines lighting up engine-by-engine
// ---------------------------------------------------------------------------

/** Rendered status of one engine row. `blocked` is a resolved-red terminal state. */
export type HarnessEngineStatus = "idle" | "active" | "done" | "blocked";

/** One engine's live cell in the pipeline. */
export interface HarnessEngineState {
  status: HarnessEngineStatus;
  /** The engine's live one-line sub-text (from the latest beat). */
  note?: string;
  /** Short verdict badge ("18 tools", "ready", "3 steps"). */
  verdict?: string;
  /** Safety grade (A0/A1/A2/AX) on the safety engine. */
  grade?: string;
}

/** One `harness` beat off the wire, waiting its turn in the pacing queue. */
export type HarnessBeat = AgentHarnessEvent["payload"];

/** The whole pipeline: one cell per engine + which one currently holds the spotlight. */
export interface HarnessState {
  engines: Record<HarnessModule, HarnessEngineState>;
  /** The engine currently `active` — the reasoning panel slaves to this. null = none. */
  activeModule: HarnessModule | null;
  /**
   * Beats accepted off the wire but not yet SHOWN — see {@link enqueueHarness}.
   * Non-empty means the pipeline is still catching up on real beats, which is why
   * App.tsx keeps the panel mounted past `present_plan` until this drains.
   */
  queue: readonly HarnessBeat[];
  /** epoch-ms floor: the next queued beat must not be applied before this. */
  holdUntil: number;
  /**
   * False from the first beat until the queue has drained AND the settle window has
   * elapsed. Gates the COLLAPSE, so the last engine's resolved badge is read in the full
   * panel rather than being swapped for the ribbon the instant it turns green.
   */
  settled: boolean;
}

/**
 * How long an engine's `active` state is guaranteed to stay on screen before its
 * resolve is allowed to land.
 *
 * WHY THIS EXISTS: Safety, Task Manager and Approval do their real work EARLIER than
 * their beats (the safety filter vets each tool call during grounding/planning; the
 * task DAG is decomposed before grounding; proposals are registered before the
 * approval beat). So the device emits `active` and its resolve back-to-back with
 * nothing in between but the optional presenter dwell — at the default
 * HARNESS_DWELL_MS=0 that is the same millisecond, and those three engines flashed
 * past unseen. This is a RENDER floor only: order and total latency stay exactly what
 * the device reported, we just refuse to paint a state change faster than the eye can
 * follow. Engines with real work between their beats (Grounding, Planner — tens of
 * seconds) are never delayed, because their gap already exceeds the floor.
 */
export const HARNESS_ACTIVE_FLOOR_MS = 550;

/** Smaller floor after a resolve, so a settled badge is seen before the next engine lights. */
export const HARNESS_RESOLVE_STEP_MS = 150;

/** How long the full panel lingers after the LAST beat resolves, before collapsing. */
export const HARNESS_SETTLE_MS = 900;

/** The engines in fire order, with display label + a dependency-free emoji glyph. */
export const HARNESS_PIPELINE: readonly { id: HarnessModule; label: string; glyph: string }[] = [
  { id: "precheck", label: "Pre-Check Engine", glyph: "📋" },
  { id: "capability_manager", label: "Capability Manager", glyph: "🧰" },
  { id: "grounding", label: "Grounding", glyph: "🌐" },
  { id: "planner", label: "Planner", glyph: "🗺️" },
  { id: "safety", label: "Safety Policy Engine", glyph: "🛡️" },
  { id: "task_manager", label: "Task Manager", glyph: "🗂️" },
  { id: "approval", label: "Approval", glyph: "🙋" },
  { id: "monitor_adapt", label: "Monitor & Adapt", glyph: "📡" },
] as const;

/** Human labels keyed by module, for the reasoning panel's "slaved to X" header. */
export const HARNESS_LABEL: Record<HarnessModule, string> = Object.fromEntries(
  HARNESS_PIPELINE.map((e) => [e.id, e.label]),
) as Record<HarnessModule, string>;

function idleEngines(): Record<HarnessModule, HarnessEngineState> {
  return Object.fromEntries(
    HARNESS_PIPELINE.map((e) => [e.id, { status: "idle" as HarnessEngineStatus }]),
  ) as Record<HarnessModule, HarnessEngineState>;
}

export const INITIAL_HARNESS: HarnessState = {
  engines: idleEngines(),
  activeModule: null,
  queue: [],
  holdUntil: 0,
  settled: true, // nothing has fired, so there is nothing to wait for
};

/**
 * ACCEPT a beat off the wire: it joins the pacing queue, it does NOT light up yet.
 * Called from the seq-deduped agent_event reducer, so ordering and drop semantics are
 * unchanged — only the moment of PAINT moves. Unknown modules are dropped here (rather
 * than queued and dropped later) so adding an engine device-side stays additive.
 */
export function enqueueHarness(state: HarnessState, payload: HarnessBeat): HarnessState {
  if (!(payload.module in state.engines)) return state;
  return { ...state, queue: [...state.queue, payload], settled: false };
}

/**
 * Apply the OLDEST queued beat and arm the floor for the next one. Driven by a timer in
 * App.tsx, which re-arms itself while `queue` is non-empty. `now` is passed in to keep
 * this pure and testable.
 */
export function drainHarness(state: HarnessState, now: number): HarnessState {
  const [beat, ...rest] = state.queue;
  if (!beat) return state;
  const applied = reduceHarness(state, beat);
  const floor =
    rest.length === 0
      ? HARNESS_SETTLE_MS // last beat — linger before collapsing
      : applied.engines[beat.module].status === "active"
        ? HARNESS_ACTIVE_FLOOR_MS
        : HARNESS_RESOLVE_STEP_MS;
  return { ...applied, queue: rest, holdUntil: now + floor };
}

/** The settle window has elapsed — the panel may now collapse to its ribbon. */
export function settleHarness(state: HarnessState): HarnessState {
  return state.settled ? state : { ...state, settled: true };
}

/**
 * Fold one `agent_event {harness}` beat into the pipeline. Last-write-wins per engine
 * (correct for a live view: a monitoring re-run legitimately re-lights an engine). An
 * unknown module is ignored so adding an engine device-side stays additive.
 */
export function reduceHarness(state: HarnessState, payload: HarnessBeat): HarnessState {
  const { module, status, note, verdict, grade } = payload;
  if (!(module in state.engines)) return state;

  const mapped: HarnessEngineStatus =
    status === "enter" || status === "active"
      ? "active"
      : status === "block"
        ? "blocked"
        : status === "skip"
          ? "idle"
          : "done"; // pass | done

  const prev = state.engines[module];
  const cell: HarnessEngineState = {
    status: mapped,
    // Keep the last note/verdict/grade if this beat omits them.
    note: note ?? prev.note,
    verdict: verdict ?? prev.verdict,
    grade: grade ?? prev.grade,
  };

  // The active engine is whichever one is currently lit; when it resolves, the
  // spotlight clears unless another engine is still active.
  const activeModule =
    mapped === "active"
      ? module
      : state.activeModule === module
        ? null
        : state.activeModule;

  return { ...state, engines: { ...state.engines, [module]: cell }, activeModule };
}

/** Has any engine fired this run? (false = nothing to show, pipeline stays hidden.) */
export function harnessStarted(state: HarnessState): boolean {
  return (
    state.queue.length > 0 ||
    HARNESS_PIPELINE.some((e) => state.engines[e.id].status !== "idle")
  );
}

// ---------------------------------------------------------------------------
// Agent stream (thinking + tool-call chips)
// ---------------------------------------------------------------------------

/** A rendered entry in the live "watch it think" stream. */
export type AgentStreamEntry =
  | {
      kind: "thinking";
      id: number;
      /** Accumulated text — consecutive thinking events append here. */
      text: string;
    }
  | {
      kind: "chip";
      id: number;
      module: string;
      fn: string;
      /** "running" until the matching tool_result lands. */
      state: "running" | "done";
      /** One-line result summary (from tool_result). */
      summary?: string;
    };

/** A plan row that streamed in early via plan_progress (fills a skeleton slot). */
export interface DraftPlanItem {
  title: string;
  detail?: string;
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Event strip
// ---------------------------------------------------------------------------

export type EventChipState = "idle" | "firing" | "fired";

export interface EventChip {
  event: DemoEvent;
  state: EventChipState;
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export type ProposalDecisionStatus =
  | { state: "pending"; approved: boolean }
  | { state: "done"; approved: boolean; detail?: string };

export type ProposalStatusMap = Record<string, ProposalDecisionStatus>;

/** Display metadata per tier (weight drives the visual treatment). */
export const TIER_META: Record<
  ApprovalTier,
  { label: string; weight: "done" | "light" | "heavy" }
> = {
  auto: { label: "Done automatically", weight: "done" },
  light: { label: "Quick OK", weight: "light" },
  firm: { label: "Needs your approval", weight: "heavy" },
  adapt: { label: "Adapt", weight: "light" },
};

// ---------------------------------------------------------------------------
// Demo clock — THE v1 DAY-UPDATE BUG LIVES HERE; v2 fixes it by construction
// ---------------------------------------------------------------------------

/**
 * The simulated clock as reported by the device via `status` frames.
 *
 * v1 BUG: the display read `latestStatus.payload.day || "Mon"` — every status
 * frame REPLACED the tracked frame, so any frame that omitted day/sim_date
 * (execution confirmations, quiet sustain ticks) snapped the label back to a
 * hardcoded "Mon", and advance_day appeared to do nothing.
 *
 * v2 FIX (three rules, enforced by mergeDemoClock + deriveClockDisplay):
 * 1. MERGE, never replace — a status only updates the fields it carries.
 * 2. DERIVE, never hardcode — the weekday label is computed from sim_date
 *    (Intl on the real parsed date); before the first status it derives from
 *    the REAL today, never a literal "Mon".
 * 3. The device is the source of truth — control sends advance_day/set_date
 *    and the display updates from the echoed status, not optimistically.
 */
export interface DemoClock {
  /** Simulated ISO date; null until a status carries one. */
  simDate: string | null;
  /** Device-provided label, kept for presenter parity; display prefers simDate. */
  dayLabel: string | null;
}

export const INITIAL_DEMO_CLOCK: DemoClock = { simDate: null, dayLabel: null };

/** Rule 1: merge only the fields the incoming status actually carries. */
export function mergeDemoClock(
  clock: DemoClock,
  payload: { day?: string; sim_date?: string },
): DemoClock {
  if (payload.sim_date === undefined && payload.day === undefined) {
    return clock;
  }
  return {
    simDate: payload.sim_date ?? clock.simDate,
    dayLabel: payload.day ?? clock.dayLabel,
  };
}

// ---------------------------------------------------------------------------
// Transcript + presenter feed
// ---------------------------------------------------------------------------

/** Minimal-text transcript: goals the user sent + terse agent notes. */
export type TranscriptEntry =
  | { kind: "goal"; id: number; text: string }
  | { kind: "note"; id: number; text: string };

/** One raw frame in the presenter "Show agent flow" feed. */
export interface FlowFrame {
  id: number;
  direction: "sent" | "recv";
  at: number;
  message: UiInboundMessage | UiOutboundMessage;
}
