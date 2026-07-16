import type { DeviceInfo } from "../types/contract";

interface DevicePickerProps {
  devices: DeviceInfo[];
  onSelect: (deviceId: string) => void;
}

/**
 * Shown only while this UI is UNBOUND — i.e. the cloud could not auto-pair us
 * because there isn't exactly one device agent online. With several (two devs
 * sharing a cloud), you pick yours ONCE: the choice is remembered per browser,
 * so this never appears again unless that device goes away.
 *
 * `?device=<id>` skips this entirely (scripted/CI runs).
 */
export function DevicePicker({ devices, onSelect }: DevicePickerProps) {
  if (devices.length === 0) {
    return (
      <section className="device-picker" aria-live="polite">
        <p className="device-picker__title">Waiting for a device agent…</p>
        <p className="device-picker__hint">
          Start the device agent and it will appear here automatically.
        </p>
      </section>
    );
  }

  return (
    <section className="device-picker" aria-live="polite">
      <p className="device-picker__title">Which device agent is yours?</p>
      <p className="device-picker__hint">
        More than one is connected. Pick yours — we'll remember it on this browser.
      </p>
      <ul className="device-picker__list">
        {devices.map((device) => (
          <li key={device.device_id}>
            <button
              type="button"
              className="device-picker__option"
              onClick={() => onSelect(device.device_id)}
            >
              <span className="device-picker__name">{device.device_name || device.device_id}</span>
              <span className="device-picker__id">{device.device_id}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
