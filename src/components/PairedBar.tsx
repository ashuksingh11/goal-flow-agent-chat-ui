interface PairedBarProps {
  name: string;
  onChange: () => void;
}

/**
 * The quiet "which fridge am I talking to" line, shown once paired.
 *
 * It exists so the pairing is never invisible: the cloud may have auto-bound us,
 * or this browser may be silently reusing a remembered choice — either way you can
 * SEE which agent your goals go to, and switch without clearing localStorage by hand.
 */
export function PairedBar({ name, onChange }: PairedBarProps) {
  return (
    <p className="paired-bar">
      <span className="paired-bar__label">Paired with</span>
      <span className="paired-bar__name">{name}</span>
      <button type="button" className="paired-bar__change" onClick={onChange}>
        Change
      </button>
    </p>
  );
}
