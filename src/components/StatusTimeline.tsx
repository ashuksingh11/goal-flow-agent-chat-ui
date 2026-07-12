/**
 * StatusTimeline — quiet sustain ticks during monitoring.
 *
 * Each non-material `status` frame renders as a small dot+line entry
 * ("Tue · on track"); execution confirmations render slightly stronger
 * ("5 items added ✓"). Deliberately calm — the contrast that makes the
 * AdaptationCard's entrance loud.
 *
 */

import type { Status } from "../types/contract";

export interface StatusTimelineProps {
  ticks: Status[];
}

function tickLabel(tick: Status): string {
  const executed = tick.payload.executed;
  if (executed && executed.length > 0) {
    const first = executed[0];
    return executed.length === 1
      ? `${first.action} ✓${first.detail ? ` - ${first.detail}` : ""}`
      : `${executed.length} actions executed ✓`;
  }
  return tick.payload.note ?? tick.task_status;
}

function tickDay(tick: Status): string {
  const match = tick.payload.note?.match(/\bDay\s+\d+\b/);
  if (match) return match[0];
  const day = tick.payload.day?.trim();
  if (!day) return "";
  if (/^Day\s+\d+$/.test(day)) return day;
  return /^\d+$/.test(day) ? `Day ${day}` : "";
}

export function StatusTimeline({ ticks }: StatusTimelineProps) {
  const visibleTicks = ticks.slice(-8);

  return (
    <section className="status-panel" aria-label="Monitoring updates">
      <div className="status-panel__header">
        <span className="eyebrow">Monitoring</span>
        <strong>{ticks.length}</strong>
      </div>
      <ol className="status-timeline">
      {visibleTicks.map((tick, index) => (
        <li
          key={`${tick.correlation_id}-${index}`}
          className={
            tick.payload.material || tick.payload.executed?.length
              ? "status-tick status-tick--material"
              : "status-tick"
          }
        >
          <span className="status-tick__day">{tickDay(tick)}</span>
          <span className="status-tick__note">{tickLabel(tick)}</span>
        </li>
      ))}
      </ol>
    </section>
  );
}
