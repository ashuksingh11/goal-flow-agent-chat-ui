/**
 * CountdownRing — the one determinate indicator in the panel, and the only one that
 * has earned the right to be.
 *
 * The working screen deliberately has no progress bar: an LLM run of unknown length has
 * no honest percent, so it gets a spinner. This is the exact opposite case. The cloud has
 * ALREADY scheduled the close when it sends the refusal, and it now says how long that is
 * (`notice.closes_in_s`), so the remaining time is a real, knowable quantity and drawing
 * it is telling the truth rather than manufacturing reassurance.
 *
 * Two consequences follow from it being a clock:
 *
 * 1. IT IS LINEAR. Every other motion in this panel is eased, because eased motion reads
 *    as physical. A clock is not physical — easing it would make the last second crawl
 *    and the middle rush, which is a lie about how much time is left. `linear`, always.
 *
 * 2. IT NEVER RESTARTS. The animation runs once, forwards, and holds. If this component
 *    re-renders mid-count the ring keeps draining from where it is rather than snapping
 *    back to full, because the CSS animation belongs to the element, not to the render.
 *
 * The label counts in whole seconds. It is deliberately NOT tied to a JS interval: the
 * ring is the continuous signal and the text is the coarse one, so a `setInterval` here
 * would be a second timer racing a CSS animation to say the same thing. It reads its
 * own value off the same duration, once per second, and stops at zero.
 *
 * Reduced motion keeps it. This is information, not decoration — a countdown that
 * vanished under `prefers-reduced-motion` would take the answer to "how long do I have?"
 * with it. What changes is that the ring stops sweeping and the seconds simply tick.
 */

import { useEffect, useState } from "react";

export interface CountdownRingProps {
  /** Total seconds, straight off `notice.closes_in_s`. */
  seconds: number;
  size?: number;
}

export function CountdownRing({ seconds, size = 22 }: CountdownRingProps) {
  const [left, setLeft] = useState(() => Math.ceil(seconds));

  useEffect(() => {
    setLeft(Math.ceil(seconds));
    const started = Date.now();
    const id = window.setInterval(() => {
      const remaining = Math.ceil(seconds - (Date.now() - started) / 1000);
      setLeft(remaining > 0 ? remaining : 0);
      if (remaining <= 0) window.clearInterval(id);
    }, 250);
    return () => window.clearInterval(id);
  }, [seconds]);

  const r = (size - 3) / 2;
  const circumference = 2 * Math.PI * r;

  return (
    <span className="countdown" role="timer" aria-live="off">
      <svg
        className="countdown__ring"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          opacity="0.2"
        />
        <circle
          className="countdown__sweep"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={circumference}
          /* Drains over exactly the seconds the cloud gave us. */
          style={{ animationDuration: `${seconds}s`, ["--c" as string]: `${circumference}` }}
        />
      </svg>
      <span className="countdown__label">Closing in {left}s</span>
    </span>
  );
}
