/**
 * TypeScript mirror of GoalFlow Contract v0.
 *
 * CANONICAL SPEC: goal-flow-cloud-agent/CONTRACT.md — this file mirrors it
 * field-for-field and must never drift (the Python mirror is
 * goal-flow-cloud-agent/src/goalflow_cloud/models/contract.py).
 *
 * Transport notes:
 * - All messages are JSON objects; `type` is the discriminant.
 * - Every task-related message carries `goal_id`.
 * - Device<->cloud messages carry `correlation_id` (dedupe key; also
 *   correlates an approval back to its proposal).
 * - The UI opens ONE outbound WS to the cloud and never talks to the device.
 */

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

export type Role = "ui" | "device";

/** Lifecycle: created → planning → awaiting_approval → executing → monitoring → adapting → done */
export type TaskStatus =
  | "created"
  | "planning"
  | "awaiting_approval"
  | "executing"
  | "monitoring"
  | "adapting"
  | "done";

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

/** Client → cloud, first frame on connect: registers the client's role. */
export interface Hello {
  type: "hello";
  role: Role;
}

/** Cloud → client: acknowledges registration and assigns a session. */
export interface HelloAck {
  type: "hello_ack";
  role: Role;
  session_id: string;
}

// ---------------------------------------------------------------------------
// 1) user_goal (UI → cloud)
// ---------------------------------------------------------------------------

export interface UserGoal {
  type: "user_goal";
  text: string;
}

// ---------------------------------------------------------------------------
// Demo controls (UI → cloud)
// ---------------------------------------------------------------------------

export type ControlCommand = "advance_day" | "reset";

export interface Control {
  type: "control";
  goal_id: string;
  command: ControlCommand;
  payload: Record<string, never>;
}

// ---------------------------------------------------------------------------
// 2) dispatch (cloud → device) — the Task Contract
//    (The UI never receives this; typed for completeness of the mirror.)
// ---------------------------------------------------------------------------

export interface DispatchScope {
  meal: string;
  days: string[];
}

export interface TimeWindow {
  /** ISO date, e.g. "2026-07-13" */
  start: string;
  /** ISO date, e.g. "2026-07-17" */
  end: string;
}

/**
 * The ONLY block the device safety gate reads. Injected verbatim from family
 * memory — never produced by LLM semantics.
 */
export interface HardConstraints {
  allergens: string[];
  dietary: string[];
  medical: string[];
}

/** Preferences that bias planning only; never enforced by the safety gate. */
export interface SoftConstraints {
  dislikes: string[];
  prefer: string[];
}

export interface DispatchConstraints {
  hard: HardConstraints;
  soft: SoftConstraints;
}

export interface ContextHints {
  notes: string;
}

export interface Dispatch {
  type: "dispatch";
  goal_id: string;
  objective: string;
  scope: DispatchScope;
  time_window: TimeWindow;
  constraints: DispatchConstraints;
  optimization: string[];
  /** e.g. "propose_all" */
  autonomy: string;
  context_hints: ContextHints;
  /** e.g. "kb/device/meal-2026-w29" */
  reply_to: string;
}

// ---------------------------------------------------------------------------
// 3) plan_ready (device → cloud)  /  4) present_plan (cloud → UI)
// ---------------------------------------------------------------------------

export interface PlanItem {
  day: string;
  dish: string;
  why: string[];
}

/**
 * A proposed action attached to a plan. Proposals are proposals, not actions:
 * the device executes NOTHING until an approval returns.
 */
export interface PlanProposal {
  proposal_id: string;
  /** e.g. "add_to_shopping_list" */
  action: string;
  items: string[];
  reason: string;
  requires_approval: boolean;
}

/** Outcome of the device-side deterministic safety gate. */
export interface SafetyResult {
  /** e.g. "passed" */
  gate: string;
  hard_violations: string[];
}

/** What the planner knew and used while shaping the recommendation. */
export interface PlanPersonalization {
  dietary?: string[];
  dislikes?: string[];
  prefer?: string[];
  notes?: string;
}

/** Optional impact metrics the cloud/device may attach for display. */
export interface PlanImpact {
  items_used_before_expiry?: number;
  pork_meals?: number;
  veg_forward_dinners?: number;
  grocery_items?: number;
}

export interface PlanPayload {
  plan: PlanItem[];
  proposals: PlanProposal[];
  safety: SafetyResult;
  knew?: PlanPersonalization;
  impact?: PlanImpact;
}

/** Device → cloud. The UI sees its relayed twin, PresentPlan. */
export interface PlanReady {
  type: "plan_ready";
  goal_id: string;
  correlation_id: string;
  task_status: TaskStatus;
  payload: PlanPayload;
}

/** Cloud → UI: the plan_ready payload relayed for rendering (cloud MAY add display hints). */
export interface PresentPlan {
  type: "present_plan";
  goal_id: string;
  correlation_id: string;
  task_status: TaskStatus;
  payload: PlanPayload;
  display_hints?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// 5) proposal (device → cloud, relayed to UI) — adaptation
// ---------------------------------------------------------------------------

export interface AdaptationPayload {
  proposal_id: string;
  /** e.g. "add_prep_task" */
  action: string;
  detail: string;
  /** What caused the adaptation, e.g. a calendar event. */
  trigger: string;
  requires_approval: boolean;
}

export interface Proposal {
  type: "proposal";
  goal_id: string;
  correlation_id: string;
  task_status: TaskStatus;
  payload: AdaptationPayload;
}

// ---------------------------------------------------------------------------
// 6) approval (UI → cloud → device)
// ---------------------------------------------------------------------------

export interface ApprovalDecision {
  proposal_id: string;
  approved: boolean;
}

export interface ApprovalPayload {
  decisions: ApprovalDecision[];
}

/**
 * The user's decisions — the APPROVAL gate (user, via cloud). `correlation_id`
 * ties the decision back to the proposal it answers.
 */
export interface Approval {
  type: "approval";
  goal_id: string;
  correlation_id: string;
  payload: ApprovalPayload;
}

// ---------------------------------------------------------------------------
// 7) status (device → cloud, relayed to UI)
// ---------------------------------------------------------------------------

export interface ExecutedAction {
  proposal_id: string;
  action: string;
  result: string;
  detail: string;
}

export interface StatusPayload {
  executed?: ExecutedAction[];
  note?: string;
  /** Simulated weekday label, e.g. "Wed". */
  day?: string;
  /** Simulated ISO date, e.g. "2026-07-15". */
  sim_date?: string;
  /** True when this tick needs user attention; false for quiet sustain checks. */
  material?: boolean;
}

export interface Status {
  type: "status";
  goal_id: string;
  correlation_id: string;
  task_status: TaskStatus;
  payload: StatusPayload;
}

// ---------------------------------------------------------------------------
// Discriminated unions
// ---------------------------------------------------------------------------

/** Every Contract v0 message. */
export type ContractMessage =
  | Hello
  | HelloAck
  | UserGoal
  | Dispatch
  | PlanReady
  | PresentPlan
  | Proposal
  | Approval
  | Control
  | Status;

/** Messages the UI can RECEIVE from the cloud. */
export type UiInboundMessage = HelloAck | PresentPlan | Proposal | Status;

/** Messages the UI can SEND to the cloud. */
export type UiOutboundMessage = Hello | UserGoal | Approval | Control;
