// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Settings ▸ Audio ▸ Record (#1648): the two sources the header Record takes
// — Main (the Input Device above, the board's mix out) and Measurement (the
// secondary measurement device, the room mic) — each with a mono/stereo
// channel picker. Devices are chosen in the Input and Measurement groups;
// this only picks channels. Choices live in recordTakeStore for the session.
// Rendered directly as JSX inside SettingsPanel.tsx, like LiveSourceSettings.

import type { JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useRecordTakeStore } from './stores/recordTakeStore';
import { iconSvg } from './report-card';
import { recordSourceRows } from './record-take';

export default function RecordSourceSettings(): JSX.Element {
  const live = useStoreShallow(useLiveCaptureStore, (s) => ({
    devices: s.devices,
    selectedDevice: s.selectedDevice,
    measurementDeviceName: s.secondaryMeasurement.deviceName,
  }));
  const take = useStoreShallow(useRecordTakeStore, (s) => ({
    phase: s.phase,
    mainChannels: s.mainChannels,
    measurementChannels: s.measurementChannels,
  }));
  const locked = take.phase !== 'idle';
  const rows = recordSourceRows({ ...live, mainChannels: take.mainChannels, measurementChannels: take.measurementChannels });

  /* c8 ignore start -- change dispatch, no jsdom; the setters are recordTakeStore.test.ts */
  function onChange(key: 'main' | 'measurement', value: string) {
    const store = useRecordTakeStore.getState();
    if (key === 'main') store.setMainChannels(value);
    else store.setMeasurementChannels(value);
  }
  /* c8 ignore stop */

  return (
    <>
      {rows.map((row) => (
        <label className="select-label" key={row.key}>
          <span>{`${row.title} · ${row.deviceLabel}`}</span>
          <div className="select-row">
            <div className="select-wrap">
              <select
                id={`record-${row.key}-channels`}
                value={row.value}
                disabled={locked}
                /* c8 ignore next -- change dispatch, no jsdom */
                onChange={(e) => onChange(row.key, e.target.value)}
              >
                {row.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <span className="select-caret" dangerouslySetInnerHTML={{ __html: iconSvg('chevron-down', 16) }} />
            </div>
          </div>
        </label>
      ))}
    </>
  );
}
