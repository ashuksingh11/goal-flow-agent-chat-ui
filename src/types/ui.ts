/**
 * UI-side state vocabulary (NOT part of the wire contract).
 *
 * These types are what the streaming reducer in App.tsx produces from
 * CONTRACT v2 frames, and what the presentational components consume.
 * See docs/ARCHITECTURE.md § "Streaming event → UI state mapping".
 */

import type {
  ApprovalTier,
  DemoEvent,
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

export const RAIL_PHASES: readonly { id: RailPhase; label: string }[] = [
  { id: "interpreting", label: "Interpreting" },
  { id: "grounding", label: "Grounding" },
  { id: "confirming", label: "Confirm" },
  { id: "planning", label: "Planning" },
  { id: "checking", label: "Checking" },
  { id: "awaiting_approval", label: "Approval" },
  { id: "monitoring", label: "Monitoring" },
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
