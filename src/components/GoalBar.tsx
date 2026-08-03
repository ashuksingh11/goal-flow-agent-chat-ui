/**
 * GoalBar — the top of the working column (v5.1, Pencil "Option E").
 *
 * The goal itself is the page title. v9: the elapsed clock only appears once the run has
 * ENDED, and the engines-cleared hairline is gone — see the notes below. Replaced the old
 * app-header + ProgressRail pair: the phase rail and the harness pipeline were two
 * progress indicators for one run, and the harness is the one that tells the truth.
 *
 * v7.7: the Theater / Flow toggles are gone. They were stage machinery for a demo that
 * no longer needs them, and on the Hub they were two checkboxes a family could tap into
 * a state nobody would know how to leave.
 *
 * The device chip is CONDITIONAL. It is the affordance for changing the pairing, so it
 * only earns its place when there is another device to change to — with one device
 * connected it named the dev machine and did nothing.
 */

import type { ConnectionState } from "../lib/ws";

export interface GoalBarProps {
  goal: string;
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

export function GoalBar({
  goal,
  deviceLabel,
  deviceCount,
  eyebrow,
  connection,
  onChangeDevice,
  fallback,
}: GoalBarProps) {

  return (
    <header className="goalbar">
      <div className="goalbar__row">
        <div className="goalbar__lead">
          <p className="goalbar__eyebrow">{eyebrow ?? "PLANNING"}</p>
          <h1 className="goalbar__goal">{goal || fallback}</h1>
        </div>
        <div className="goalbar__aside">
          {/* v9 — NO CLOCK HERE AT ALL, in either direction.
              It stopped ticking first, then it turned out the settled total was a
              duplicate too: the plan card's header already reads "7 steps · 5
              constraints honoured · 22.6s", and this printed "0:22" two hundred pixels
              above it in a different format. Two renderings of one number is the exact
              thing this pass has been deleting. The duration belongs next to the result
              it describes, and it lives there. */}
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
      {/* v9 — the engines-cleared hairline is gone. It was the third drawing of a fact
          the pipeline rail already shows engine by engine and the pipeline head already
          states in words ("3 of 7 engines cleared"). Three renderings of one number is
          not reassurance, it is noise, and this one was the least legible of them: a 3px
          line carrying a seven-step count. The rail and the sentence stay. */}
    </header>
  );
}
