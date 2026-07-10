/**
 * StatusTimeline — quiet sustain ticks during monitoring.
 *
 * Each non-material `status` frame renders as a small dot+line entry
 * ("Tue · on track"); execution confirmations render slightly stronger
 * ("5 items added ✓"). Deliberately calm — the contrast that makes the
 * AdaptationCard's entrance loud.
 *
 * SKELETON — tick shapes are final; render/motion (tick-appear) is TODO.
 */

import type { Status } from "../types/contract";

export interface StatusTimelineProps {
  ticks: Status[];
}

function tickLabel(tick: Status): string {
  const executed = tick.payload.executed;
  if (executed && executed.length > 0) {
    return `${executed.length} action(s) executed`;
  }
  return tick.payload.note ?? tick.task_status;
}

export function StatusTimeline({ ticks }: StatusTimelineProps) {
  return (
    <ol className="status-timeline" aria-label="Monitoring updates">
      {ticks.map((tick, index) => (
        <li
          key={`${tick.correlation_id}-${index}`}
          className={
            tick.payload.material ? "status-tick status-tick--material" : "status-tick"
          }
        >
          <span className="status-tick__day">{tick.payload.day ?? ""}</span>
          <span className="status-tick__note">{tickLabel(tick)}</span>
          {/* TODO(M-impl): tick-appear animation; group by sim day */}
        </li>
      ))}
    </ol>
  );
}
