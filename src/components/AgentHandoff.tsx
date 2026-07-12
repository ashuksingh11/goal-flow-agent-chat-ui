import { useEffect, useState } from "react";

export interface AgentHandoffProps {
  /** Bump to replay the cloud-to-device comet. */
  seq: number;
  /** True while the device agent is streaming work. */
  active: boolean;
  caption?: string;
}

const HANDOFF_MS = 900;

export function AgentHandoff({ seq, active, caption }: AgentHandoffProps) {
  const [arrived, setArrived] = useState(seq === 0);

  useEffect(() => {
    if (seq === 0) {
      setArrived(true);
      return;
    }

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    setArrived(false);
    const timeout = window.setTimeout(
      () => setArrived(true),
      prefersReducedMotion ? 80 : HANDOFF_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [seq]);

  const deviceClassName = [
    "agent-handoff__node",
    "agent-handoff__node--device",
    arrived ? "agent-handoff__node--arrived" : "",
    active ? "agent-handoff__node--active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="agent-handoff" aria-label="Cloud Agent handoff to Device Agent">
      <div className="agent-handoff__node agent-handoff__node--cloud">
        <span className="agent-handoff__glyph" aria-hidden="true">
          ☁
        </span>
        <span className="agent-handoff__label">Cloud Agent</span>
      </div>

      <div className="agent-handoff__track" aria-hidden="true">
        {caption ? <span className="agent-handoff__caption">{caption}</span> : null}
        {seq > 0 ? <span key={seq} className="agent-handoff__comet" /> : null}
      </div>

      <div className={deviceClassName}>
        <span className="agent-handoff__glyph" aria-hidden="true">
          ⌂
        </span>
        <span className="agent-handoff__label">Device Agent</span>
      </div>
    </div>
  );
}
