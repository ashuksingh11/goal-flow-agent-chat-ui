/**
 * MicButton — speech-to-text input. DEFERRED STUB (planned, not M1-critical).
 *
 * Planned: browser Web Speech API (webkitSpeechRecognition / SpeechRecognition)
 * — start/stop listening, interim results into the input, final transcript via
 * onTranscript. No cloud STT; keep it entirely in-browser.
 */

export interface MicButtonProps {
  /** Called with the final recognized utterance. */
  onTranscript?: (text: string) => void;
  /** Disable while the socket is down or recognition is unsupported. */
  disabled?: boolean;
}

export function MicButton({ onTranscript, disabled = true }: MicButtonProps) {
  void onTranscript;
  return (
    <button
      type="button"
      className="mic-button"
      disabled={disabled}
      aria-label="Speak your goal"
      title="Speech input is coming soon"
    >
      Mic
    </button>
  );
}
