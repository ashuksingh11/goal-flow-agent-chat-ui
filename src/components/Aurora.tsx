/**
 * Aurora.tsx — the light that is on while the Hub is talking.
 *
 * v11 gave the demo a voice and left it invisible. On a fridge door that is a real
 * problem: a sentence arrives from a large silent panel in a kitchen that also contains
 * a TV, a phone and a speaker, and nothing on the screen claims it. This is the claim —
 * a band of drifting colour along the bottom edge, present for exactly as long as sound
 * is coming out, and absent the rest of the time.
 *
 * WHAT IT DELIBERATELY IS NOT. The first draft of this was a dock: a pill with a
 * waveform, a caption and a "Hear this" button. It was rejected, and the reasons are
 * worth keeping because they will be re-proposed:
 *
 *   - a bar at the bottom competes with Confirm and Approve & Save, which are the only
 *     two things on this surface that MUST be tapped;
 *   - a caption pulls the eye down off the card the voice is describing — and the voice
 *     is deliberately not a second copy of the screen (see the v11.1 narration design);
 *   - a waveform at the bottom of a Samsung screen is the LISTENING idiom, and nothing
 *     here is listening. v11.2 already deleted "Shall I go ahead?" from the spoken gate
 *     for that same reason: it invited a reply into a mic that isn't there.
 *
 * So this has no caption, no control and no container. It is not a component of the
 * page so much as a condition of it, and it carries no information: every screen stays
 * complete and answerable in silence.
 */

import { useEffect, useState } from "react";
import { subscribePlayback } from "../lib/speech";

/**
 * How long the light survives a gap in the audio.
 *
 * THIS CONSTANT IS THE WHOLE REASON THIS IS NOT A ONE-LINER. Since v11.2 a cue is
 * emitted as one frame PER SENTENCE — that fix took first audio from 6.6s to 1.0s and
 * is not negotiable — so a single spoken screen is four to six separate `play()` calls
 * with a fetch-shaped gap between each. Light bound directly to "is audio playing"
 * would strobe four to six times per screen.
 *
 * 150ms is chosen to be longer than the queue's own hand-off (it drains on `ended` and
 * starts the next utterance in the same tick) and far shorter than any pause a person
 * would read as "it finished" — the exit transition alone is 620ms.
 */
const GAP_GRACE_MS = 150;

/**
 * THE SHAPE OF THE LIGHT — a wash, then three curtains.
 *
 * The wash is a single radial gradient whose CENTRE SITS BELOW THE BOTTOM EDGE, so its
 * own falloff is the fade. It was once the whole aurora, and on its own it read as lamps
 * behind the panel: round, static-looking, no form.
 *
 * What makes an aurora legible is the CREST — a soft irregular edge that moves — so the
 * colour now lives in three overlapping curtains, each a filled SVG path. Three rules
 * about their shape, and every one of them is the difference between "light" and
 * something else:
 *
 *   - THE CRESTS MUST CROSS. Stacked in bands they read as an illustration of hills.
 *     Their peaks and troughs are deliberately at different x, and each drifts at its
 *     own speed, so the silhouette is never the same twice.
 *   - THEY MUST BE IRREGULAR AND OFF-CENTRE. A symmetric periodic wave centred on the
 *     panel is the LISTENING idiom, which is the one thing this must never claim. None
 *     of these is a sine; the control points were placed by hand.
 *   - THE FADE STARTS AT THE CREST, not at the bottom of the band. Each viewBox begins
 *     at that curtain's own highest point, so the transparent stop lands on the crest —
 *     otherwise the top edge stays opaque and you get a hard line. Peak brightness sits
 *     just under the crest and thins downward: three curtains all reaching full opacity
 *     at the floor stack into a flat purple slab.
 *
 * Still no mask, no `filter: blur()` and no `backdrop-filter` — the softness is entirely
 * in the gradient stops. The Hub's webview is years older than this laptop; a 320px
 * blurred layer repainting at 60fps is not a bet worth taking.
 */
const CURTAINS = [
  {
    key: "blue",
    hex: "#3F6FE8",
    viewBox: "0 80 980 240",
    d: "M0,180 C 80,235 140,222 240,178 C 340,134 400,84 520,110 C 640,136 690,214 800,206 C 890,200 940,168 980,150 L980,320 L0,320 Z",
    peakAt: 0.46,
    peak: 0.44,
    base: 0.14,
  },
  {
    key: "violet",
    hex: "#7255C9",
    viewBox: "0 110 980 210",
    d: "M0,196 C 90,166 170,240 300,252 C 430,264 480,206 620,152 C 720,114 820,140 980,196 L980,320 L0,320 Z",
    peakAt: 0.48,
    peak: 0.38,
    base: 0.115,
  },
  {
    key: "rose",
    hex: "#E86B9F",
    viewBox: "0 140 980 180",
    d: "M0,214 C 60,166 150,144 260,186 C 380,231 460,286 600,278 C 740,270 860,206 980,224 L980,320 L0,320 Z",
    peakAt: 0.5,
    peak: 0.33,
    base: 0.095,
  },
] as const;

export function Aurora() {
  const [playing, setPlaying] = useState(false);
  useEffect(() => subscribePlayback(setPlaying), []);

  // The grace above. Rising is immediate — the light must not lag the first syllable;
  // only the fall is delayed, because only the fall can be a false alarm.
  const [lit, setLit] = useState(false);
  useEffect(() => {
    if (playing) {
      setLit(true);
      return;
    }
    const timer = window.setTimeout(() => setLit(false), GAP_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [playing]);

  /*
   * MOUNTED ONLY ONCE SOMETHING HAS ACTUALLY BEEN SPOKEN, and never unmounted after.
   *
   * v11's first rule is that a run with no voice renders exactly as v10 did — a cloud
   * with no key, or SPEECH_ENABLED=false, must cost the surface nothing. An element that
   * is merely transparent still holds four composited layers with `will-change` on the
   * Hub's GPU, so "nothing" here means no node at all.
   *
   * Staying mounted afterwards is what lets the exit be a transition rather than a
   * disappearance.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (lit) setMounted(true);
  }, [lit]);

  /*
   * The class is applied a frame AFTER the node exists, so the browser has an initial
   * state to transition FROM. Setting both in one paint gives no animation at all —
   * the light would simply appear, which is the one thing an aurora must not do.
   */
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!mounted) return;
    if (!lit) {
      setOn(false);
      return;
    }
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setOn(true)));
    return () => cancelAnimationFrame(frame);
  }, [mounted, lit]);

  if (!mounted) return null;

  // aria-hidden, and it must stay that way: the audio IS the announcement, so a live
  // region here would have a screen reader narrate over the voice it is narrating.
  return (
    <div className={on ? "aurora aurora--on" : "aurora"} aria-hidden="true">
      <span className="aurora__layer aurora__layer--wash" />
      {CURTAINS.map((curtain) => (
        /*
         * TWO NESTED ELEMENTS, AND THE NESTING IS THE MOTION.
         *
         * A single element can only run one `transform` animation, so a lone curtain
         * slides back and forth on one period — and a smooth silhouette sliding
         * sideways is nearly invisible. The wrapper sways horizontally on one period
         * while the curtain inside stretches and lifts on ANOTHER, and because the two
         * periods share no factors the combination never repeats: the crest keeps
         * arriving somewhere it has not been. That is what reads as alive, rather than
         * as a picture being panned.
         */
        <span
          key={curtain.key}
          className={`aurora__layer aurora__sway aurora__sway--${curtain.key}`}
        >
        <svg
          className={`aurora__curtain aurora__curtain--${curtain.key}`}
          viewBox={curtain.viewBox}
          /* The panel is 760 wide on a Hub and whatever the window is on a laptop.
             Letting the curtain STRETCH is right — a wave that is wider or narrower is
             still a wave — where the default (`meet`) would letterbox it and pull the
             crest away from the bottom edge. */
          preserveAspectRatio="none"
          focusable="false"
        >
          <defs>
            <linearGradient id={`aurora-grad-${curtain.key}`} x1="0" y1="0" x2="0" y2="1">
              {/* Transparent at the CREST — the viewBox starts at this curtain's own
                  highest point, so offset 0 lands on the top of the wave rather than on
                  the top of the band. Without that, the crest keeps a hard edge. */}
              <stop offset="0" stopColor={curtain.hex} stopOpacity={0} />
              <stop offset={curtain.peakAt} stopColor={curtain.hex} stopOpacity={curtain.peak} />
              <stop offset="1" stopColor={curtain.hex} stopOpacity={curtain.base} />
            </linearGradient>
          </defs>
          <path d={curtain.d} fill={`url(#aurora-grad-${curtain.key})`} />
        </svg>
        </span>
      ))}
    </div>
  );
}
