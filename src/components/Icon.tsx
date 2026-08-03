/**
 * Icon — the v9 icon set, inline.
 *
 * Why hand-drawn SVG and not an icon package
 * ------------------------------------------
 * This repo has exactly two runtime dependencies — react and react-dom — and the board UI
 * makes the same promise. That is a deliberate property of the POC, not an accident, so a
 * whole icon library for ~20 glyphs is the wrong trade. These are 24x24, stroked, round
 * caps and joins, drawn to one weight.
 *
 * What they replace
 * -----------------
 * The panel used emoji (🥜 🥗 💊 🏃 ⚡) for data-driven category marks and bare text
 * characters (⌃ ⌄ ○ ✓ ▸ ♻) for UI affordances. Both were wrong for different reasons:
 * emoji cannot be tinted to carry state and render differently on every platform, and
 * `⌃` is U+2303 UP ARROWHEAD — the Mac control-key symbol, not a chevron — which lands
 * wherever the font decides. An icon that inherits `currentColor` can go green when a
 * step clears and grey when it is waiting, which is the entire point.
 *
 * Icons here are decorative: every one sits beside a real text label, so they are
 * `aria-hidden` and add nothing to the accessibility tree. If you ever use one ALONE as a
 * control, give the control an aria-label — do not make the icon speak.
 */

export type IconName =
  // affordances
  | "check"
  | "circle-check"
  | "chevron-down"
  | "chevron-up"
  | "chevron-left"
  | "arrow-right"
  | "corner-down-right"
  | "x"
  | "plus"
  // state / meaning
  | "lock"
  | "shield-check"
  | "mic"
  | "refresh-cw"
  | "clock"
  // constraint families (see CONSTRAINT_FAMILIES in UnderstandingCard)
  | "ban"
  | "leaf"
  | "cross"
  | "coin"
  | "moon"
  | "users"
  | "calendar"
  | "pin"
  // preference / domain
  | "utensils"
  | "dumbbell"
  | "house"
  | "zap";

/** Each entry is a list of `d` attributes stroked in order. No fills — one visual weight. */
const PATHS: Record<IconName, string[]> = {
  check: ["M20 6 9 17l-5-5"],
  "circle-check": ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "m8.5 12 2.5 2.5 4.5-5"],
  "chevron-down": ["m6 9 6 6 6-6"],
  "chevron-up": ["m18 15-6-6-6 6"],
  "chevron-left": ["m15 18-6-6 6-6"],
  "arrow-right": ["M4 12h15", "m13 6 6 6-6 6"],
  "corner-down-right": ["M5 5v7a3 3 0 0 0 3 3h10", "m15 11 4 4-4 4"],
  x: ["M18 6 6 18", "m6 6 12 12"],
  plus: ["M12 5v14", "M5 12h14"],

  lock: ["M5 11h14v10H5z", "M8 11V7.5a4 4 0 0 1 8 0V11"],
  "shield-check": [
    "M12 3l7.5 3v5.2c0 4.6-3.1 8.5-7.5 10.3C7.6 19.7 4.5 15.8 4.5 11.2V6z",
    "m8.8 11.8 2.2 2.2 4.2-4.4",
  ],
  mic: [
    "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z",
    "M5.5 11.5a6.5 6.5 0 0 0 13 0",
    "M12 18v3",
  ],
  "refresh-cw": ["M20 12a8 8 0 1 1-2.3-5.6", "M20 4v5h-5"],
  clock: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 7.5V12l3 1.8"],

  ban: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "m5.6 5.6 12.8 12.8"],
  leaf: ["M4.5 19.5C4.5 11 10.5 5 20 5c0 9.5-6 15-15.5 14.5z", "M9 15c1.8-3 4-5.2 7-6.5"],
  cross: ["M9.5 4.5h5v5h5v5h-5v5h-5v-5h-5v-5h5z"],
  coin: [
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
    "M12 6.6v10.8",
    "M14.6 9.4a2.6 2.6 0 0 0-2.6-1.4h-.4a2.3 2.3 0 0 0 0 4.6h1a2.3 2.3 0 0 1 0 4.6h-.4a2.6 2.6 0 0 1-2.6-1.4",
  ],
  moon: ["M20 14.2A8.4 8.4 0 1 1 9.8 4 6.7 6.7 0 0 0 20 14.2z"],
  users: [
    "M9.5 11.5a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2z",
    "M2.8 20a6.7 6.7 0 0 1 13.4 0",
    "M16.2 4.7a3.6 3.6 0 0 1 0 6.8",
    "M18 20a6.7 6.7 0 0 0-2.6-5.3",
  ],
  calendar: ["M4.5 6.5h15v14h-15z", "M8.5 3.5v5", "M15.5 3.5v5", "M4.5 11.5h15"],
  pin: [
    "M12 21.5s7-6.6 7-11.5a7 7 0 1 0-14 0c0 4.9 7 11.5 7 11.5z",
    "M12 12.4a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8z",
  ],

  utensils: [
    "M6 3v6.5a2.2 2.2 0 0 0 4.4 0V3",
    "M8.2 9.5V21",
    "M17.5 3c-1.6 2.4-2.2 4.6-2.2 6.6 0 1.7.8 2.6 2.2 2.6V21",
  ],
  dumbbell: ["M4 9.5v5", "M7 7v10", "M17 7v10", "M20 9.5v5", "M7 12h10"],
  house: ["M3.5 11 12 4l8.5 7", "M5.5 9.8V20h13V9.8"],
  zap: ["M13 2 4.5 13.5H11L10 22l8.5-11.5H12z"],
};

export interface IconProps {
  name: IconName;
  /** Rendered box in px. 16-18 for markers beside text, 20 for content icons. */
  size?: number;
  className?: string;
  /** Thinner at small sizes keeps the stroke from filling in. */
  strokeWidth?: number;
}

export function Icon({ name, size = 20, className, strokeWidth = 1.75 }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
