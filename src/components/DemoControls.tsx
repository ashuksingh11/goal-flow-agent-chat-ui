/**
 * DemoControls — the simulated-clock strip: current sim day/date, a derived
 * 7-day week strip, and Advance day / Reset / Set date actions.
 *
 * GENERIC DATES + THE v1 DAY-UPDATE FIX (see types/ui.ts DemoClock):
 * - The displayed day/date is ALWAYS derived from clock.simDate (the device's
 *   echoed status), falling back to the REAL today before the first status —
 *   never a hardcoded "Mon", never a hardcoded date.
 * - App merges status frames into DemoClock field-by-field (mergeDemoClock),
 *   so frames that omit day/sim_date can no longer wipe the label — the v1
 *   bug where "Advance day" appeared to do nothing.
 * - Controls are NOT optimistic: advance_day/set_date/reset go up as control
 *   frames; the strip re-renders when the device's status echoes back
 *   (single source of truth). TODO(M-impl): brief "syncing…" shimmer on the
 *   label between click and echo.
 *
 * SKELETON — derivation helpers are implemented (they ARE the fix);
 * layout/motion polish is TODO.
 */

import type { ControlCommand } from "../types/contract";
import type { DemoClock } from "../types/ui";

export interface DemoControlsProps {
  clock: DemoClock;
  onCommand: (command: ControlCommand, payload?: { date?: string }) => void;
}

/** Parse "YYYY-MM-DD" as a LOCAL date (avoids UTC off-by-one on weekday). */
function parseIsoDate(iso: string): Date | null {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export interface ClockDisplay {
  /** e.g. "Wed" — Intl-derived from the actual date, never hardcoded. */
  dayLabel: string;
  /** e.g. "Jul 15". */
  dateLabel: string;
  /** ISO of the displayed sim date (input default for Set date). */
  iso: string;
  /** The 7 days of the sim date's week (Mon-start), for the strip. */
  week: { iso: string; dayLabel: string; active: boolean }[];
}

/** THE FIX, rule 2: derive display from simDate, else from REAL today. */
export function deriveClockDisplay(clock: DemoClock, realToday = new Date()): ClockDisplay {
  const base = (clock.simDate ? parseIsoDate(clock.simDate) : null) ?? realToday;
  const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short" });
  const dateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

  const monday = new Date(base);
  monday.setDate(base.getDate() - ((base.getDay() + 6) % 7));

  const week = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    return {
      iso: toIsoDate(day),
      dayLabel: weekdayFmt.format(day),
      active: day.toDateString() === base.toDateString(),
    };
  });

  return {
    dayLabel: weekdayFmt.format(base),
    dateLabel: dateFmt.format(base),
    iso: toIsoDate(base),
    week,
  };
}

export function DemoControls({ clock, onCommand }: DemoControlsProps) {
  const display = deriveClockDisplay(clock);

  return (
    <section className="demo-controls" aria-label="Demo controls">
      <div className="demo-controls__now">
        <span className="eyebrow">Sim clock</span>
        <strong>
          {display.dayLabel} {display.dateLabel}
        </strong>
      </div>

      <div className="demo-week" aria-label="Simulated week">
        {display.week.map((day) => (
          <span
            key={day.iso}
            className={day.active ? "demo-day demo-day--active" : "demo-day"}
          >
            {day.dayLabel}
          </span>
        ))}
      </div>

      <div className="demo-controls__actions">
        <button type="button" onClick={() => onCommand("advance_day")}>
          Advance day
        </button>
        <button
          type="button"
          className="button--ghost"
          onClick={() => onCommand("reset")}
        >
          Reset
        </button>
        <input
          type="date"
          aria-label="Set simulated date"
          defaultValue={display.iso}
          onChange={(event) => {
            if (event.target.value) {
              onCommand("set_date", { date: event.target.value });
            }
          }}
        />
        {/* TODO(M-impl): "syncing…" shimmer between control send and status echo */}
      </div>
    </section>
  );
}
