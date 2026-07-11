/**
 * App — root: owns the socket, the STREAMING STATE MACHINE, and the stage.
 *
 * v2 component tree (docs/ARCHITECTURE.md is the spec):
 *   App
 *   ├── ProgressRail      — phase rail (agent_event:phase + task_status)
 *   ├── stage
 *   │   ├── GoalComposer  — input + MicButton (inline below)
 *   │   ├── AgentStream   — thinking stream + tool-call chips (live)
 *   │   ├── Skeleton      — plan silhouette while planning (no plan yet)
 *   │   ├── PlanCard      — the plan hero (generic) + ProposalList (tiers)
 *   │   ├── AdaptationCard— "caught a change" (proposal frames)
 *   │   └── StatusTimeline— quiet sustain ticks (monitoring)
 *   ├── DemoControls      — sim clock (generic dates + the v1 day-fix)
 *   └── PresenterFeed     — raw WS frames ("Show agent flow" toggle)
 *
 * All inbound frames flow through ONE pure reducer (reduceInbound) — the
 * streaming-event → UI-state mapping lives there and nowhere else.
 *
 * SKELETON — state machine + composition are final; visual polish is TODO.
 */

import { useEffect, useReducer, useRef, useState } from "react";
import { AdaptationCard } from "./components/AdaptationCard";
import { AgentStream } from "./components/AgentStream";
import { DemoControls } from "./components/DemoControls";
import { MicButton } from "./components/MicButton";
import { PlanCard } from "./components/PlanCard";
import { PresenterFeed } from "./components/PresenterFeed";
import { ProgressRail } from "./components/ProgressRail";
import { Skeleton } from "./components/Skeleton";
import { StatusTimeline } from "./components/StatusTimeline";
import { createGoalFlowSocket } from "./lib/ws";
import type { ConnectionState, GoalFlowSocket } from "./lib/ws";
import type {
  AgentEvent,
  ApprovalDecision,
  CapabilityModule,
  ControlCommand,
  ImpactBadge,
  PresentPlan,
  Proposal,
  Status,
  UiInboundMessage,
  UiOutboundMessage,
} from "./types/contract";
import {
  INITIAL_DEMO_CLOCK,
  mergeDemoClock,
  maxRailPhase,
  railPhaseFromAgentPhase,
  railPhaseFromStatus,
} from "./types/ui";
import type {
  AgentStreamEntry,
  DemoClock,
  DraftPlanItem,
  FlowFrame,
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
  /** Device module registry (capabilities frame) — chips legend / debug. */
  modules: CapabilityModule[] | null;
  /** Reduced agent_event stream: thinking entries + tool chips. */
  agentEntries: AgentStreamEntry[];
  /** plan_progress drafts — progressively replace skeleton rows. */
  draftItems: DraftPlanItem[];
  /** The hero, once present_plan lands. Patched in place by daily adaptations. */
  plan: PresentPlan | null;
  /** Plan-item ids changed by the most recent approved adaptation (highlight). */
  changedPlanIds: string[];
  proposalStatuses: ProposalStatusMap;
  adaptations: Proposal[];
  /** Sustain ticks for StatusTimeline (capped). */
  ticks: Status[];
  demoClock: DemoClock;
  transcript: TranscriptEntry[];
  /** Raw feed for PresenterFeed (capped). */
  frames: FlowFrame[];
  /** Last applied agent_event seq (order/dedupe on reconnect). */
  lastSeq: number;
  nextId: number;
}

const INITIAL_STATE: UiState = {
  activeGoalId: null,
  phase: null,
  working: false,
  modules: null,
  agentEntries: [],
  draftItems: [],
  plan: null,
  changedPlanIds: [],
  proposalStatuses: {},
  adaptations: [],
  ticks: [],
  demoClock: INITIAL_DEMO_CLOCK,
  transcript: [],
  frames: [],
  lastSeq: 0,
  nextId: 1,
};

type UiAction =
  | { type: "recv"; message: UiInboundMessage }
  | { type: "sent"; message: UiOutboundMessage }
  | { type: "goal_submitted"; text: string }
  | { type: "decisions_sent"; decisions: ApprovalDecision[] };

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
      const last = next.agentEntries[next.agentEntries.length - 1];
      if (last?.kind === "thinking") {
        // consecutive fragments accumulate into one streaming line
        const merged = { ...last, text: last.text + event.payload.text };
        return { ...next, agentEntries: [...next.agentEntries.slice(0, -1), merged] };
      }
      return {
        ...next,
        nextId: next.nextId + 1,
        agentEntries: [
          ...next.agentEntries,
          { kind: "thinking", id: next.nextId, text: event.payload.text },
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
      return {
        ...next,
        draftItems: [
          ...next.draftItems,
          {
            title: event.payload.item.title,
            detail: event.payload.item.detail,
            tags: event.payload.item.tags,
          },
        ],
      };
  }
}

/** Merge adaptation impact badges into the plan's existing set, replacing by label. */
function mergeImpact(current: ImpactBadge[], delta: ImpactBadge[]): ImpactBadge[] {
  if (delta.length === 0) return current;
  const byLabel = new Map(current.map((b) => [b.label, b]));
  for (const b of delta) byLabel.set(b.label, b);
  return [...byLabel.values()];
}

/** The single inbound-frame → UI-state mapping (see ARCHITECTURE.md table). */
function reduceInbound(state: UiState, message: UiInboundMessage): UiState {
  const withGoal =
    "goal_id" in message && message.goal_id !== state.activeGoalId
      ? { ...state, activeGoalId: message.goal_id }
      : state;

  switch (message.type) {
    case "hello_ack":
      return withGoal;

    case "capabilities":
      return { ...withGoal, modules: message.modules };

    case "agent_event":
      return reduceAgentEvent(withGoal, message);

    case "present_plan":
      return {
        ...withGoal,
        plan: message,
        working: false,
        draftItems: [],
        phase: railPhaseFromStatus(message.task_status) ?? "awaiting_approval",
      };

    case "proposal":
      return {
        ...withGoal,
        working: false,
        adaptations: [...withGoal.adaptations, message],
        phase: railPhaseFromStatus(message.task_status) ?? withGoal.phase,
      };

    case "status": {
      let next: UiState = {
        ...withGoal,
        ticks: [...withGoal.ticks.slice(-(MAX_TICKS - 1)), message],
        // THE DAY-UPDATE FIX: merge (never replace) the sim clock — frames
        // without day/sim_date can no longer reset the label (v1 bug).
        demoClock: mergeDemoClock(withGoal.demoClock, message.payload),
        phase: railPhaseFromStatus(message.task_status) ?? withGoal.phase,
      };
      // A daily adaptation was approved → replace the plan in place with the
      // patched plan, merge its impact badges, and mark the changed rows so the
      // card can highlight them. Everything else about the card is preserved.
      const updated = message.payload.updated_plan;
      if (updated && updated.length > 0 && next.plan) {
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
          changedPlanIds: message.payload.changed_ids ?? [],
        };
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
      return next;
    }
  }
}

function reducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case "recv":
      return reduceInbound(pushFrame(state, "recv", action.message), action.message);

    case "sent":
      return pushFrame(state, "sent", action.message);

    case "goal_submitted":
      // new goal resets the stage; rail lights "interpreting" immediately
      // (the device's own phase events take over as they stream in)
      return {
        ...state,
        nextId: state.nextId + 1,
        transcript: [
          ...state.transcript,
          { kind: "goal", id: state.nextId, text: action.text },
        ],
        phase: "interpreting",
        working: true,
        agentEntries: [],
        draftItems: [],
        plan: null,
        proposalStatuses: {},
        adaptations: [],
        ticks: [],
        lastSeq: 0,
      };

    case "decisions_sent": {
      const proposalStatuses = { ...state.proposalStatuses };
      for (const decision of action.decisions) {
        proposalStatuses[decision.proposal_id] = {
          state: "pending",
          approved: decision.approved,
        };
      }
      return { ...state, proposalStatuses };
    }
  }
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const socketRef = useRef<GoalFlowSocket | null>(null);
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [presenterMode, setPresenterMode] = useState(false);

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

  const submitGoal = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    dispatch({ type: "goal_submitted", text: trimmed });
    socketRef.current?.send({ type: "user_goal", text: trimmed });
  };

  const sendDecisions = (
    goalId: string,
    correlationId: string,
    decisions: ApprovalDecision[],
  ) => {
    dispatch({ type: "decisions_sent", decisions });
    socketRef.current?.send({
      type: "approval",
      goal_id: goalId,
      correlation_id: correlationId,
      payload: { decisions },
    });
  };

  const sendControl = (command: ControlCommand, payload?: { date?: string }) => {
    if (!state.activeGoalId) return;
    socketRef.current?.send({
      type: "control",
      goal_id: state.activeGoalId,
      command,
      payload: payload ?? {},
    });
  };

  const planPending = state.working && !state.plan;

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <p className="eyebrow">GoalFlow</p>
          <h1>Home agent</h1>
          {/* TODO(M-impl): show active goal text / domain instead of static title */}
        </div>
        <div className="app-header__actions">
          <label className="presenter-toggle">
            <input
              type="checkbox"
              checked={presenterMode}
              onChange={(event) => setPresenterMode(event.target.checked)}
            />
            Show agent flow
          </label>
          <span className={`connection-dot connection-dot--${connection}`}>
            {connection}
          </span>
        </div>
      </header>

      <ProgressRail phase={state.phase} />

      <main className={presenterMode ? "stage stage--with-feed" : "stage"}>
        <section className="stage__main">
          <GoalComposer onSubmit={submitGoal} disabled={connection !== "open"} />

          {/* The live "watch it think" stream is for the WORKING phase; once the
              plan is the hero it collapses (raw trail stays in presenter mode). */}
          {!state.plan && (state.agentEntries.length > 0 || state.working) ? (
            <AgentStream entries={state.agentEntries} active={state.working} />
          ) : null}

          {planPending ? (
            <>
              {/* plan_progress drafts replace skeleton rows one by one */}
              {state.draftItems.map((item, index) => (
                <p key={index} className="draft-plan-item">
                  {item.title}
                </p>
              ))}
              <Skeleton
                variant="plan-item"
                count={Math.max(1, 4 - state.draftItems.length)}
              />
            </>
          ) : null}

          {state.plan ? (
            <PlanCard
              plan={state.plan}
              changedIds={state.changedPlanIds}
              proposalStatuses={state.proposalStatuses}
              onDecide={(decisions) =>
                sendDecisions(state.plan!.goal_id, state.plan!.correlation_id, decisions)
              }
            />
          ) : null}

          {state.adaptations.map((adaptation) => (
            <AdaptationCard
              key={adaptation.payload.proposal_id}
              proposal={adaptation}
              status={state.proposalStatuses[adaptation.payload.proposal_id]}
              onDecide={(approved) =>
                sendDecisions(adaptation.goal_id, adaptation.correlation_id, [
                  { proposal_id: adaptation.payload.proposal_id, approved },
                ])
              }
            />
          ))}

          {state.ticks.length > 0 ? <StatusTimeline ticks={state.ticks} /> : null}
        </section>

        {presenterMode ? <PresenterFeed frames={state.frames} /> : null}
      </main>

      {state.activeGoalId ? (
        <DemoControls clock={state.demoClock} onCommand={sendControl} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GoalComposer — the single input row (kept inline: it is App's only input)
// ---------------------------------------------------------------------------

function GoalComposer({
  onSubmit,
  disabled,
}: {
  onSubmit: (text: string) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState("");

  const submit = () => {
    onSubmit(draft);
    setDraft("");
  };

  return (
    <form
      className="goal-composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <input
        type="text"
        value={draft}
        placeholder="What should the home take care of?"
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
      />
      <MicButton onTranscript={onSubmit} disabled />
      <button type="submit" disabled={disabled || !draft.trim()}>
        Go
      </button>
      {/* TODO(M-impl): example-goal chips when idle (meal week / guest dinner) */}
    </form>
  );
}
