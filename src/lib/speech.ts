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
    attachPlaybackEvents(element);
  }
  return element;
}

/* ---------------------------------------------------------------------------
 * IS SOUND ACTUALLY COMING OUT? (v11.4)
 *
 * The aurora is light that means "the Hub is talking", so it has to be tied to the
 * one fact that is actually true — the element is producing audio — and NOT to any
 * of the three things that merely look like it:
 *
 *   - the `speech` FRAME arriving: the audio may still be synthesising, and on a
 *     blocked webview it will never play at all;
 *   - `SpeechQueue.onOutcome("playing")`: reported OPTIMISTICALLY, before `play()`
 *     has resolved, precisely so a refusal reaches the card within a beat. Light
 *     bound to that glows for ~150ms for a voice that turns out to be blocked;
 *   - `play()` resolving: that is playback STARTED, and says nothing about the end.
 *
 * So this subscribes to the element itself, and the element is the only thing that
 * knows. `pause` is in the list because `stop()` — barge-in — pauses; a light that
 * outlives the voice the user just silenced is worse than no light.
 * ------------------------------------------------------------------------- */

type PlaybackListener = (playing: boolean) => void;

const playbackListeners = new Set<PlaybackListener>();
let isPlaying = false;

/**
 * The priming clip is a data: URI (see primeOnFirstGesture), and it PLAYS — it has to,
 * that is how it spends the gesture. Without this guard the first tap anywhere on the
 * surface would flash the aurora for one frame of silence, which is the exact opposite
 * of what the light is for: it would mean "speaking" at the one moment nothing is.
 */
function isRealUtterance(el: HTMLAudioElement): boolean {
  return el.src !== "" && !el.src.startsWith("data:");
}

function attachPlaybackEvents(el: HTMLAudioElement): void {
  const announce = (next: boolean) => {
    if (next === isPlaying) return;
    isPlaying = next;
    for (const listener of playbackListeners) listener(next);
  };
  el.addEventListener("playing", () => announce(isRealUtterance(el)));
  el.addEventListener("pause", () => announce(false));
  el.addEventListener("ended", () => announce(false));
  el.addEventListener("error", () => announce(false));
}

/** Subscribe to "there is sound coming out right now". Fires immediately with the
 *  current truth, so a late subscriber never misses an utterance already in flight. */
export function subscribePlayback(listener: PlaybackListener): () => void {
  audio(); // the element is the source of these events; make sure it exists
  playbackListeners.add(listener);
  listener(isPlaying);
  return () => {
    playbackListeners.delete(listener);
  };
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

/**
 * Resolve when the current utterance FINISHES — or immediately, if nothing is speaking.
 *
 * `play()` deliberately resolves as soon as playback has STARTED, because the caller
 * needs to know about a refusal within a beat, not in eight seconds. But a queue needs
 * the other event entirely: without this it would start the next utterance ~150ms into
 * the current one, which is the exact "two voices at once" that having a queue was
 * supposed to prevent.
 *
 * Resolves rather than rejects on `error`: an utterance that dies mid-sentence is still
 * over, and the queue's job is to move on.
 */
export function whenEnded(): Promise<void> {
  const el = element;
  if (el === null || el.paused || el.ended) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      el.removeEventListener("ended", done);
      el.removeEventListener("error", done);
      el.removeEventListener("pause", done);
      resolve();
    };
    el.addEventListener("ended", done);
    el.addEventListener("error", done);
    // `pause` covers stop() — a superseded utterance must not hold the queue open for
    // the remaining seconds of audio nobody is going to hear.
    el.addEventListener("pause", done);
  });
}

/**
 * Stop whatever is speaking, and leave NOTHING for the platform to resume.
 *
 * This used to be `pause()` followed by `currentTime = 0`, and that rewind is the prime
 * suspect for a Tizen-only report: on the Hub, any gesture — a tap on Confirm, a tap on
 * Include, even a touch-SCROLL — makes the last utterance play again from the beginning.
 *
 * The reasoning, and it is a hypothesis until the Hub's log confirms it. Barge-in fires
 * on every `pointerdown`, so every gesture ran this function. On a finished utterance
 * `pause()` is a no-op and `currentTime = 0` un-ends the element and seeks it back to
 * the start: a fully loaded, decoded resource sitting at frame zero, waiting. Chrome
 * leaves it sitting there, which is why Ubuntu never showed this. An older WebView,
 * evaluating a media element that was just seeked INSIDE a user gesture, has every
 * reason to treat that as the activation it was waiting for and start playing. The
 * gesture meant to silence the voice becomes the gesture that authorises it.
 *
 * So: do not rewind, and do not keep the resource. `removeAttribute("src")` + `load()`
 * is the standard way to abandon a media resource — after it there is no source to
 * resume, no buffer to replay, and no seek position to honour. The next utterance
 * assigns a fresh src, which is what `play()` does anyway.
 *
 * Guarded on there being something loaded: barge-in calls this on EVERY pointer down,
 * and re-running the resource selection algorithm on an already-empty element each time
 * is pointless work on a device with none to spare.
 */
export function stop(): void {
  const el = element;
  if (el === null) return;
  el.pause();
  if (el.src) {
    el.removeAttribute("src");
    // Abandons the current resource. Fires `emptied`; `whenEnded()` is already resolved
    // by the `pause` above, so nothing is left waiting on it.
    el.load();
  }
}
