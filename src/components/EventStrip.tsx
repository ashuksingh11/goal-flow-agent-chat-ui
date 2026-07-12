import type { DemoEvent } from "../types/contract";

export interface EventStripProps {
  events: DemoEvent[];
  enabled: boolean;
  firedIds: string[];
  firingId: string | null;
  onFire: (eventId: string) => void;
  onReset: () => void;
}

export function EventStrip({
  events,
  enabled,
  firedIds,
  firingId,
  onFire,
  onReset,
}: EventStripProps) {
  const ordered = [...events].sort((a, b) => a.order - b.order);
  const anyFiring = firingId !== null;

  const confirmReset = () => {
    if (window.confirm("Reset the demo? The plan and all fired events clear.")) {
      onReset();
    }
  };

  return (
    <section className="event-strip" aria-label="World events">
      <div className="event-strip__header">
        <div>
          <span className="eyebrow">World events</span>
          {!enabled ? (
            <span className="event-strip__hint">Approve the plan to enable events</span>
          ) : null}
        </div>
        <button type="button" className="button--ghost event-strip__reset" onClick={confirmReset}>
          Reset week
        </button>
      </div>

      <div className="event-strip__chips">
        {ordered.map((event) => {
          const fired = firedIds.includes(event.id);
          const firing = firingId === event.id;
          const dayLabel = `Day ${event.day}`;
          const locked = !enabled;
          const disabled = locked || fired || anyFiring;
          const stateClass = firing
            ? "event-chip--firing"
            : fired
              ? "event-chip--fired"
              : locked
                ? "event-chip--locked"
                : "event-chip--idle";

          return (
            <button
              key={event.id}
              type="button"
              className={`event-chip ${stateClass}`}
              title={`${dayLabel} - ${event.title}`}
              disabled={disabled}
              aria-busy={firing || undefined}
              onClick={() => onFire(event.id)}
            >
              <span className="event-chip__label">{dayLabel}</span>
              <span className="event-chip__title">{event.title}</span>
              <span className="event-chip__glyph" aria-hidden="true">
                {firing ? <span className="event-chip__spinner" /> : fired ? "✓" : null}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
