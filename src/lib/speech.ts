/**
 * speech.ts — playing the cloud's voice in a webview that may not be allowed to speak.
 *
 * THE WHOLE PROBLEM IS AUTOPLAY, so it is worth writing down properly rather than
 * discovering it on a fridge door.
 *
 * A browser rejects `audio.play()` with `NotAllowedError` unless the document has
 * "user activation" — a real tap or click. There are two independent gates:
 *
 *   1. PERMISSIONS POLICY, which applies only to iframes. This UI runs cross-origin
 *      inside the Bixby surrogate (`:5173` inside `:5175`), so without
 *      `allow="autoplay"` on that <iframe> we are blocked before user activation is
 *      even consulted. We own that tag, and it is set (bixby-ui, App.tsx).
 *   2. USER ACTIVATION, which we do NOT own. On the real Hub, native Bixby creates the
 *      WebView; whether its host waives the gesture requirement
 *      (`media_playback_requires_user_gesture`) is a native-app setting we cannot
 *      change, and the default differs by platform — WebKitGTK allows autoplay,
 *      Android WebView blocks it, and Tizen's EWK is unverified.
 *
 * And the create phase gives us NO gesture to lean on: the webview is mounted by the
 * cloud's `chat_ui_open` while the user is looking at Bixby, and the understanding card
 * arrives ~11s later without anyone having touched this document.
 *
 * SO THIS MODULE NEVER ASSUMES IT MAY SPEAK. It tries, and reports honestly when it is
 * refused, so the card can offer a tap-to-hear affordance instead of failing silently.
 * A blocked voice must look like a button, not like a bug.
 *
 * Two things reduce how often that button is needed:
 *   - `primeOnFirstGesture()` — ANY touch in this document unlocks audio for the rest
 *     of its life, so a user who taps anything at all never sees the affordance again;
 *   - once a play succeeds, the document has activation and every later cue autoplays.
 */

import type { SpeechPayload } from "../types/contract";
import { getSocketUrl } from "./ws";

/** How a play attempt ended — the card renders a different thing for each. */
export type PlaybackOutcome =
  /** It is playing (or has played). Nothing for the UI to do. */
  | "playing"
  /** The browser refused for want of a user gesture — OFFER THE TAP. */
  | "blocked"
  /** The audio itself failed: no key on the cloud (503), an unknown utterance (404),
   *  a provider error (empty body). Stay silent; the card is complete without it. */
  | "unavailable";

/**
 * Resolve the frame's PATH against the origin we reached the hub on.
 *
 * The cloud deliberately sends "/speech/<id>.mp3" and not an absolute URL: it has no
 * idea whether this UI is a tablet on the LAN, the Hub's own browser, or a dev laptop,
 * and the wrong host here yields a URL that resolves to nothing. The socket URL is the
 * one piece of truth about where the hub actually is, so it is what we build on.
 */
export function speechUrl(payload: SpeechPayload): string {
  if (/^https?:\/\//i.test(payload.url)) return payload.url;
  const socketUrl = getSocketUrl();
  try {
    const ws = new URL(socketUrl);
    const scheme = ws.protocol === "wss:" ? "https:" : "http:";
    return `${scheme}//${ws.host}${payload.url.startsWith("/") ? "" : "/"}${payload.url}`;
  } catch {
    return payload.url;
  }
}

/**
 * The element every utterance plays through.
 *
 * ONE ELEMENT, REUSED, and that is the point: a second `new Audio()` would let two
 * utterances overlap, and two voices talking over each other on a fridge is worse than
 * none. Reusing it also means the activation earned by one successful play carries to
 * the next, which is most of why the tap affordance is rarely seen twice.
 */
let element: HTMLAudioElement | null = null;

function audio(): HTMLAudioElement {
  if (element === null) {
    element = new Audio();
    element.preload = "auto";
  }
  return element;
}

/**
 * Spend any gesture this document happens to receive on unlocking audio.
 *
 * Playing a zero-length silent clip inside a real event handler is enough to mark the
 * element as user-activated; every later `play()` on the SAME element is then allowed
 * with no gesture of its own. Costs nothing, is inaudible, and is why a user who taps
 * anywhere — the card, the background, a scroll — never meets the fallback button.
 *
 * `once: true` — this is not worth doing twice, and a listener that survives is a
 * listener someone will later wonder about.
 */
export function primeOnFirstGesture(): () => void {
  if (typeof window === "undefined") return () => {};
  const prime = () => {
    const el = audio();
    if (!el.src) {
      // A 1-frame silent WAV. Inline rather than fetched: this must run INSIDE the
      // gesture handler, and a network round-trip would land after the activation has
      // already been spent.
      el.src =
        "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
      el.play().then(
        () => {
          el.pause();
          el.currentTime = 0;
        },
        () => {
          /* Refused even inside a gesture: nothing lost, the fallback still works. */
        },
      );
    }
  };
  const options = { once: true, capture: true } as const;
  window.addEventListener("pointerdown", prime, options);
  window.addEventListener("keydown", prime, options);
  return () => {
    window.removeEventListener("pointerdown", prime, options);
    window.removeEventListener("keydown", prime, options);
  };
}

/**
 * Play an utterance. Never throws, never rejects — it REPORTS.
 *
 * The distinction between "blocked" and "unavailable" is the only thing the caller
 * really needs, because they mean opposite things to a user: "blocked" is a working
 * voice waiting for permission (offer the tap), "unavailable" is no voice at all
 * (say nothing, the card is enough).
 */
export async function play(payload: SpeechPayload): Promise<PlaybackOutcome> {
  const el = audio();
  const url = speechUrl(payload);

  // A failure to FETCH or decode surfaces on the element, asynchronously, long after
  // play() resolved — so it needs its own listener rather than a try/catch.
  const failed = new Promise<PlaybackOutcome>((resolve) => {
    el.addEventListener("error", () => resolve("unavailable"), { once: true });
  });

  el.src = url;
  el.currentTime = 0;
  try {
    await el.play();
  } catch (error) {
    const name = (error as { name?: string })?.name;
    // NotAllowedError is the autoplay refusal specifically. Anything else (a decode
    // failure, an aborted load) is the audio being unavailable, not withheld.
    return name === "NotAllowedError" ? "blocked" : "unavailable";
  }
  // play() resolving means playback STARTED; a body that turns out to be empty (the
  // cloud's provider-failure path closes the stream early) errors a moment later.
  return Promise.race([
    failed,
    new Promise<PlaybackOutcome>((resolve) => setTimeout(() => resolve("playing"), 150)),
  ]);
}

/** Stop whatever is speaking. Called when the gate is answered — see App.tsx. */
export function stop(): void {
  if (element === null) return;
  element.pause();
  element.currentTime = 0;
}
