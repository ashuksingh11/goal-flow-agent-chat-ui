/**
 * GoalBar — the top of the working column (v5.1, Pencil "Option E").
 *
 * The goal itself is the page title; the run's elapsed clock sits opposite it, and a
 * 3px hairline underneath carries engine progress. This REPLACES the old app-header +
 * ProgressRail pair: the phase rail and the harness pipeline were two progress
 * indicators for the same run, and the harness is the one that tells the truth.
 *
 * v7.7: the Theater / Flow toggles are gone. They were stage machinery for a demo that
 * no longer needs them, and on the Hub they were two checkboxes a family could tap into
 * a state nobody would know how to leave.
 *
 * The device chip is CONDITIONAL. It is the affordance for changing the pairing, so it
 * only earns its place when there is another device to change to — with one device
 * connected it named the dev machine and did nothing.
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
  /** How many devices the cloud is offering. The chip appears only when it is a CHOICE. */
  deviceCount: number;
  /** v6-M4: a capture is not a plan — the bar must not say PLANNING over it. */
  eyebrow?: string;
  connection: ConnectionState;
  /** Re-open the device picker. The chip is the affordance — it is the only place
      the pairing is shown, so it has to be the place you can change it. */
  onChangeDevice: () => void;
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
  deviceCount,
  eyebrow,
  connection,
  onChangeDevice,
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
          {/* One device is not a choice — the chip would be a dev machine's hostname
              sitting on the family's screen, wired to a picker with one entry. It still
              appears the moment there is a second device, and whenever the connection is
              not open, because THEN it is news. */}
          {deviceCount > 1 || connection !== "open" ? (
            <button
              type="button"
              className={`goalbar__device goalbar__device--${connection}`}
              onClick={onChangeDevice}
              title="Change the paired device"
            >
              <i aria-hidden />
              {deviceCount > 1 ? deviceLabel ?? connection : connection}
            </button>
          ) : null}
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
