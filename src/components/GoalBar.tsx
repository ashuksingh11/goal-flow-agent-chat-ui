/**
 * GoalBar — the top of the working column (v5.1, Pencil "Option E").
 *
 * The goal itself is the page title; the run's elapsed clock sits opposite it, and a
 * 3px hairline underneath carries engine progress. This REPLACES the old app-header +
 * ProgressRail pair: the phase rail and the harness pipeline were two progress
 * indicators for the same run, and the harness is the one that tells the truth.
 *
 * The demo toggles (Theater / Show agent flow) stay reachable but are deliberately
 * quiet — they are stage machinery, not part of what the agent is doing.
 */

import { useEffect, useRef, useState } from "react";
import type { ConnectionState } from "../lib/ws";

export interface GoalBarProps {
  goal: string;
  /** epoch-ms the run started; null = idle (clock hidden). */
  startedAt: number | null;
  /** epoch-ms the run stopped; null = still running. Freezes the clock at the total. */
  endedAt: number | null;
  /** Engines resolved / total, for the hairline. */
  cleared: number;
  total: number;
  deviceLabel: string | null;
  /** v6-M4: a capture is not a plan — the bar must not say PLANNING over it. */
  eyebrow?: string;
  connection: ConnectionState;
  /** Re-open the device picker. The chip is the affordance — it is the only place
      the pairing is shown, so it has to be the place you can change it. */
  onChangeDevice: () => void;
  theater: boolean;
  onTheater: (on: boolean) => void;
  presenter: boolean;
  onPresenter: (on: boolean) => void;
  /** Shown when the goal's words are not available (a rehydrated surface). */
  fallback: string;
}

/** "0:18" — minutes:seconds, tabular so the width never jitters. */
function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function GoalBar({
  goal,
  startedAt,
  endedAt,
  cleared,
  total,
  deviceLabel,
  eyebrow,
  connection,
  onChangeDevice,
  theater,
  onTheater,
  presenter,
  onPresenter,
  fallback,
}: GoalBarProps) {
  const [now, setNow] = useState(() => Date.now());
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (startedAt === null || endedAt !== null) return;
    setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(tick);
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [startedAt, endedAt]);

  const pct = total > 0 ? Math.round((cleared / total) * 100) : 0;

  return (
    <header className="goalbar">
      <div className="goalbar__row">
        <div className="goalbar__lead">
          <p className="goalbar__eyebrow">{eyebrow ?? "PLANNING"}</p>
          <h1 className="goalbar__goal">{goal || fallback}</h1>
        </div>
        <div className="goalbar__aside">
          {startedAt !== null ? (
            <span className="goalbar__clock">{clock((endedAt ?? now) - startedAt)}</span>
          ) : null}
          <button
            type="button"
            className={`goalbar__device goalbar__device--${connection}`}
            onClick={onChangeDevice}
            title="Change the paired device"
          >
            <i aria-hidden />
            {deviceLabel ?? connection}
          </button>
          <span className="goalbar__toggles">
            <label>
              <input type="checkbox" checked={theater} onChange={(e) => onTheater(e.target.checked)} />
              Theater
            </label>
            <label>
              <input type="checkbox" checked={presenter} onChange={(e) => onPresenter(e.target.checked)} />
              Flow
            </label>
          </span>
        </div>
      </div>
      <div
        className="goalbar__progress"
        role="progressbar"
        aria-valuenow={cleared}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label="Harness engines cleared"
      >
        <i style={{ width: `${pct}%` }} />
      </div>
    </header>
  );
}
