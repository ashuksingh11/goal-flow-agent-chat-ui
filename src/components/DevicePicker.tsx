import type { DeviceInfo } from "../types/contract";

interface DevicePickerProps {
  devices: DeviceInfo[];
  /** The device we're currently paired with, if any (marked in the list). */
  currentDeviceId?: string | null;
  onSelect: (deviceId: string) => void;
  /** Present only when we're already paired — i.e. this picker was opened by
   *  "Change", so backing out is meaningful. */
  onCancel?: () => void;
}

/**
 * Choose which device agent this UI drives.
 *
 * Shown when the cloud can't pair us unambiguously — no `?device=`, and either zero
 * or several agents are online — or when the user asks to switch. With one agent the
 * cloud auto-pairs and this never appears. A pick is remembered per browser, so it's
 * normally a ONE-TIME click; `?device=<id>` skips it entirely (scripted/CI runs).
 */
export function DevicePicker({ devices, currentDeviceId, onSelect, onCancel }: DevicePickerProps) {
  if (devices.length === 0) {
    return (
      <section className="device-picker" aria-live="polite">
        <p className="device-picker__title">Waiting for a device agent…</p>
        <p className="device-picker__hint">
          Start the device agent and it will appear here automatically.
        </p>
        {onCancel ? (
          <button type="button" className="device-picker__cancel" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <section className="device-picker" aria-live="polite">
      <p className="device-picker__title">
        {currentDeviceId ? "Switch device agent" : "Which device agent is yours?"}
      </p>
      <p className="device-picker__hint">
        {currentDeviceId
          ? "Your goals will go to the one you pick. We'll remember it on this browser."
          : "More than one is connected. Pick yours — we'll remember it on this browser."}
      </p>
      <ul className="device-picker__list">
        {devices.map((device) => {
          const isCurrent = device.device_id === currentDeviceId;
          return (
            <li key={device.device_id}>
              <button
                type="button"
                className={
                  isCurrent ? "device-picker__option device-picker__option--current" : "device-picker__option"
                }
                onClick={() => onSelect(device.device_id)}
              >
                <span className="device-picker__name">
                  {device.device_name || device.device_id}
                  {isCurrent ? <span className="device-picker__current"> · current</span> : null}
                </span>
                <span className="device-picker__id">{device.device_id}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {onCancel ? (
        <button type="button" className="device-picker__cancel" onClick={onCancel}>
          Cancel
        </button>
      ) : null}
    </section>
  );
}
