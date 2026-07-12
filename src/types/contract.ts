/**
 * TypeScript mirror of GoalFlow CONTRACT v2 — the generic goal-agent protocol.
 *
 * CANONICAL SPEC: CONTRACT v2 (cloud repo). This file mirrors it field-for-field
 * and must never drift (Python mirror in the cloud repo, C# mirror on the device).
 *
 * v2 is GENERIC & DOMAIN-AGNOSTIC: no meal-specific fields. A `domain` string
 * carries the use case; domain specifics live in capability modules and the
 * free-form `scope` / `context` objects. The same protocol serves any goal.
 *
 * Transport notes:
 * - JSON text frames over ONE outbound WS to the cloud; `type` discriminates.
 * - Task messages carry `goal_id`; device<->cloud messages carry
 *   `correlation_id` (dedupe key; ties approvals back to proposals).
 * - The UI NEVER talks to the device directly — the cloud is the hub.
 */

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

export type Role = "ui" | "device";

/**
 * Task lifecycle:
 * created → interpreting → grounding → planning → checking →
 * awaiting_approval → executing → monitoring → adapting → done
 */
export type TaskStatus =
  | "created"
  | "interpreting"
  | "grounding"
  | "planning"
  | "checking"
  | "awaiting_approval"
  | "executing"
  | "monitoring"
  | "adapting"
  | "done";

/**
 * Approval tier (reversibility × cost × risk):
 * - "auto":  reversible, executed without asking (shown as already done)
 * - "light": quick consent (e.g. add to shopping list)
 * - "firm":  spends money / irreversible — explicit, visually heavy approval
 */
export type ApprovalTier = "auto" | "light" | "firm" | "adapt";

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
// capabilities (device → cloud → UI) — the device's MODULE REGISTRY
// ---------------------------------------------------------------------------

/** One callable function a capability module exposes to the planner. */
export interface ModuleFunction {
  name: string;
  description: string;
  /** True when calling it changes the world (must be proposed, not just run). */
  side_effecting: boolean;
  /** Present on side-effecting functions: the approval tier they default to. */
  tier?: ApprovalTier;
}

/** One module in the device registry (extensibility/discovery surface). */
export interface CapabilityModule {
  name: string;
  /** "capability" = domain tools the LLM calls; "steering" = harness module. */
  kind: "capability" | "steering";
  description?: string;
  /** Present on kind:"capability" modules. */
  functions?: ModuleFunction[];
}

/** Device advertises its module registry; the cloud relays it to the UI. */
export interface Capabilities {
  type: "capabilities";
  modules: CapabilityModule[];
}

// ---------------------------------------------------------------------------
// user_goal (UI → cloud)
// ---------------------------------------------------------------------------

export interface UserGoal {
  type: "user_goal";
  text: string;
}

// ---------------------------------------------------------------------------
// dispatch (cloud → device) — the GENERIC Task Contract
//    (The UI never receives this; typed for completeness of the mirror.)
// ---------------------------------------------------------------------------

/**
 * constraints.hard is the ONLY block the deterministic Safety filter enforces
 * (allergens, medical, dietary, budget_cap, quiet_hours, …). Free-form by
 * design — the protocol stays domain-agnostic.
 */
export interface DispatchConstraints {
  hard: Record<string, unknown>;
  soft: Record<string, unknown>;
}

/** RELATIVE to real today — never hardcoded dates. ISO date strings. */
export interface TimeWindow {
  start: string;
  end: string;
}

export interface DispatchContext {
  notes: string;
}

export interface Dispatch {
  type: "dispatch";
  goal_id: string;
  /** The use case, e.g. "meal_plan", "guest_dinner". Domain-specifics live in scope. */
  domain: string;
  objective: string;
  success_criteria: string[];
  constraints: DispatchConstraints;
  /** Domain-flexible object — the protocol does not know its shape. */
  scope: Record<string, unknown>;
  time_window: TimeWindow;
  /** e.g. "tiered" — proposals carry per-action tiers. */
  autonomy: string;
  context: DispatchContext;
}

// ---------------------------------------------------------------------------
// agent_event (device → cloud → UI) — STREAMED as the device works.
// Drives the wow UI: progress rail, thinking stream, tool-call chips.
// ---------------------------------------------------------------------------

/** Phases the device reports while working (subset of TaskStatus). */
export type AgentPhase =
  | "interpreting"
  | "grounding"
  | "planning"
  | "checking"
  | "awaiting_approval";

interface AgentEventBase {
  type: "agent_event";
  goal_id: string;
  correlation_id: string;
  /** Monotonic per-goal sequence — order/dedupe streamed frames on it. */
  seq: number;
}

/** The device entered a new working phase → advance the progress rail. */
export interface AgentPhaseEvent extends AgentEventBase {
  event: "phase";
  payload: { phase: AgentPhase };
}

/** A fragment of the model's reasoning → append to the live thinking stream. */
export interface AgentThinkingEvent extends AgentEventBase {
  event: "thinking";
  payload: { text: string };
}

/** The LLM is calling a capability function → pop in a running tool chip. */
export interface AgentToolCallEvent extends AgentEventBase {
  event: "tool_call";
  payload: { module: string; function: string; args: Record<string, unknown> };
}

/** The call returned → resolve the matching chip with a one-line summary. */
export interface AgentToolResultEvent extends AgentEventBase {
  event: "tool_result";
  payload: { module: string; function: string; summary: string };
}

/** A plan item has taken shape → replace one skeleton row with a draft row. */
export interface AgentPlanProgressEvent extends AgentEventBase {
  event: "plan_progress";
  payload: { item: Partial<PlanItem> & Pick<PlanItem, "title"> };
}

/** Discriminate on `event` (after narrowing `type === "agent_event"`). */
export type AgentEvent =
  | AgentPhaseEvent
  | AgentThinkingEvent
  | AgentToolCallEvent
  | AgentToolResultEvent
  | AgentPlanProgressEvent;

export type AgentEventKind = AgentEvent["event"];

// ---------------------------------------------------------------------------
// plan_ready (device → cloud)  /  present_plan (cloud → UI)
// ---------------------------------------------------------------------------

/** A GENERIC plan step — works for meal days, guest-prep tasks, chores, … */
export interface PlanItem {
  id: string;
  title: string;
  detail: string;
  /** Optional ISO timestamp — when this step happens (relative to real today). */
  when?: string;
  /** Rationale bullets ("uses expiring paneer", "fits Dad's low-sodium"). */
  why: string[];
  /** Free-form badges ("waste-win", "veg", "prep"). */
  tags: string[];
}

/**
 * A proposed side effect attached to the plan. Proposals are proposals, not
 * actions: nothing above tier "auto" executes until an approval returns.
 */
export interface PlanProposal {
  proposal_id: string;
  /** Human-readable action label, e.g. "Add 5 items to the shopping list". */
  action: string;
  /** The capability call this proposal will make when approved. */
  module: string;
  function: string;
  args: Record<string, unknown>;
  tier: ApprovalTier;
  reason: string;
  requires_approval: boolean;
}

/** Outcome of the device-side deterministic safety gate ("LLM plans, code checks"). */
export interface SafetyResult {
  gate: "passed" | "blocked";
  violations: string[];
}

/** One impact badge, e.g. { label: "items rescued before expiry", value: "3" }. */
export interface ImpactBadge {
  label: string;
  value: string;
}

export interface DemoEvent {
  id: string;
  label: string;
  title: string;
  kind: string;
  order: number;
}

export interface PlanPayload {
  plan: PlanItem[];
  proposals: PlanProposal[];
  safety: SafetyResult;
  impact: ImpactBadge[];
  demo_events?: DemoEvent[];
  explanation: string;
}

/** Device → cloud. The UI sees its relayed twin, PresentPlan. */
export interface PlanReady {
  type: "plan_ready";
  goal_id: string;
  correlation_id: string;
  task_status: TaskStatus;
  payload: PlanPayload;
}

/**
 * The personalization line — what the agent already knew and used.
 * Free-form key → value(s); the UI renders it as the "Knew:" line.
 */
export type PlanKnew = Record<string, unknown>;

export interface PresentPlanPayload extends PlanPayload {
  /** Added by the cloud when relaying: the "what it knew" personalization. */
  knew?: PlanKnew;
}

/** Cloud → UI: plan_ready relayed + payload.knew. */
export interface PresentPlan {
  type: "present_plan";
  goal_id: string;
  correlation_id: string;
  task_status: TaskStatus;
  payload: PresentPlanPayload;
}

// ---------------------------------------------------------------------------
// understanding (cloud → UI) / understanding_response (UI → cloud)
// ---------------------------------------------------------------------------

export interface UnderstandingPayload {
  objective: string;
  domain: string;
  /** Display-ready hard-constraint chips, same shape as PresentPlan payload.knew. */
  knew: PlanKnew;
  thought: string;
  time_window?: TimeWindow;
}

export interface Understanding {
  type: "understanding";
  goal_id: string;
  /** Not minted until dispatch, so absent for this pre-planning gate. */
  correlation_id?: string;
  task_status: TaskStatus;
  payload: UnderstandingPayload;
}

export interface UnderstandingResponsePayload {
  confirmed: boolean;
}

export interface UnderstandingResponse {
  type: "understanding_response";
  goal_id: string;
  payload: UnderstandingResponsePayload;
}

// ---------------------------------------------------------------------------
// approval (UI → cloud → device)
// ---------------------------------------------------------------------------

export interface ApprovalDecision {
  proposal_id: string;
  approved: boolean;
}

export interface ApprovalPayload {
  decisions: ApprovalDecision[];
}

/**
 * The user's decisions — the HITL gate. `correlation_id` ties the decision
 * back to the proposal/plan it answers.
 */
export interface Approval {
  type: "approval";
  goal_id: string;
  correlation_id: string;
  payload: ApprovalPayload;
}

// ---------------------------------------------------------------------------
// proposal (device → cloud → UI) — ADAPTATION (generic "caught a change")
// ---------------------------------------------------------------------------

/**
 * A minimal plan diff from the scoped daily-adaptation LLM call. Rides inside a
 * proposal as a PREVIEW; once approved it is applied and the full updated plan
 * comes back in the status (`updated_plan`).
 */
export interface PlanPatch {
  /** Rows to insert or replace, matched by id (a swapped dinner, a new prep task). */
  upsert: PlanItem[];
  /** Plan-item ids to drop. */
  remove: string[];
  /** Impact badges to add/replace on the plan card. */
  impact_delta: ImpactBadge[];
  /** One-line rationale for the change. */
  rationale?: string;
}

export interface AdaptationPayload {
  proposal_id: string;
  /** e.g. "swap Thursday to a 20-minute dinner". */
  action: string;
  detail: string;
  /** What caused it, e.g. "calendar: recital added Thu 18:00". */
  trigger: string;
  /** Presenter-fired demo event id that produced this proposal, when applicable. */
  event_id?: string;
  tier: ApprovalTier;
  requires_approval: boolean;
  /** The proposed plan change (scoped daily adaptation). */
  patch?: PlanPatch;
}

export interface Proposal {
  type: "proposal";
  goal_id: string;
  correlation_id: string;
  event_id?: string;
  /** "adapting" when the agent caught a material change. */
  task_status: TaskStatus;
  payload: AdaptationPayload;
}

// ---------------------------------------------------------------------------
// status (device → cloud → UI)
// ---------------------------------------------------------------------------

export interface ExecutedAction {
  proposal_id: string;
  action: string;
  result: string;
  detail: string;
}

export interface StatusPayload {
  /** Simulated weekday label, e.g. "Wed". Display derives from sim_date when present. */
  day?: string;
  /** Simulated ISO date, e.g. "2026-07-15" — GENERIC, derived from real today. */
  sim_date?: string;
  /** Presenter-fired demo event id that produced this status, when applicable. */
  event_id?: string;
  /** True when this tick needs user attention; false for quiet sustain checks. */
  material?: boolean;
  executed?: ExecutedAction[];
  /** After an approved daily adaptation: the FULL updated plan (replaces the card). */
  updated_plan?: PlanItem[];
  /** Ids in `updated_plan` this adaptation changed — the UI highlights them. */
  changed_ids?: string[];
  /** Impact badges to add/replace on the plan card after the adaptation. */
  impact_delta?: ImpactBadge[];
  note?: string;
}

export interface Status {
  type: "status";
  goal_id: string;
  correlation_id: string;
  event_id?: string;
  task_status: TaskStatus;
  payload: StatusPayload;
}

// ---------------------------------------------------------------------------
// control (UI → cloud → device) — demo clock controls
// ---------------------------------------------------------------------------

export type ControlCommand = "advance_day" | "reset" | "set_date" | "trigger_event";

export interface ControlPayload {
  /** ISO date — required for "set_date", absent otherwise. */
  date?: string;
  /** Daily demo event id — required for "trigger_event". */
  event_id?: string;
}

export interface Control {
  type: "control";
  goal_id: string;
  command: ControlCommand;
  event_id?: string;
  payload: ControlPayload;
}

// ---------------------------------------------------------------------------
// Discriminated unions
// ---------------------------------------------------------------------------

/** Every CONTRACT v2 message. */
export type ContractMessage =
  | Hello
  | HelloAck
  | Capabilities
  | UserGoal
  | Dispatch
  | AgentEvent
  | PlanReady
  | PresentPlan
  | Understanding
  | UnderstandingResponse
  | Approval
  | Proposal
  | Status
  | Control;

/** Messages the UI can RECEIVE from the cloud. */
export type UiInboundMessage =
  | HelloAck
  | Capabilities
  | AgentEvent
  | Understanding
  | PresentPlan
  | Proposal
  | Status;

/** Messages the UI can SEND to the cloud. */
export type UiOutboundMessage = Hello | UserGoal | UnderstandingResponse | Approval | Control;
