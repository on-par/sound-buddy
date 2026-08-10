// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The experimental secondary measurement-device block (#460) — a metering-only
// room mic, independent of the board capture — ported off inline-app.js's
// static-markup/DOM-writer glue to React (TD-001 relocation, #724). Portaled
// by App.tsx onto #secondary-measurement-island, immediately after
// LiveControls.tsx's #live-controls-island, mirroring that component's
// pattern: it renders null while settingsStore.secondaryMeasurementEnabled is
// off, otherwise derives its markup from liveCaptureStore's
// secondaryMeasurement/devices state via the unchanged pure helpers in
// measurement-device-state.ts. renderMeasurementBadge()/renderEqPane() stay
// imperative and out of scope — reached via one new optional method on the
// existing window.liveCaptureRuntime object (LiveControls.tsx's
// LiveCaptureRuntime interface), the same way LiveControls.tsx's own
// onChange handlers reach bridged orchestration.

import { useEffect, type JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore, type StartCaptureOpts } from './stores/liveCaptureStore';
import { useSettingsStore } from './stores/settingsStore';
import {
  deviceIndexForName,
  secondaryStatusHTML,
  secondaryDeviceOptionsHTML,
  alignmentWarningHTML,
  captureOptsFromCadence,
} from './measurement-device-state';
import { iconSvg } from './report-card';
import type { LiveDevice } from './live-capture-panel';
import { runtime } from './LiveControls';

const SECONDARY_RECONNECT_POLL_MS = 5000;

export function secondaryCaptureOpts(): StartCaptureOpts {
  const { windowSecs, meterIntervalMs } = useLiveCaptureStore.getState();
  return captureOptsFromCadence(windowSecs, meterIntervalMs);
}

export async function selectSecondaryDevice(
  value: string,
  devices: LiveDevice[],
  opts: StartCaptureOpts,
): Promise<void> {
  if (value === '') {
    await useLiveCaptureStore.getState().stopSecondaryMeasurement();
    useLiveCaptureStore.getState().setSecondaryDeviceName('');
  } else {
    const dev = devices.find((d) => String(d.index) === value);
    useLiveCaptureStore.getState().setSecondaryDeviceName(dev ? dev.name : '');
    await useLiveCaptureStore.getState().startSecondaryMeasurement(opts);
  }
  runtime()?.afterSecondaryMeasurementChange?.();
}

export async function secondaryReconnectTick(enabled: boolean, opts: StartCaptureOpts): Promise<boolean> {
  if (!enabled || useLiveCaptureStore.getState().secondaryMeasurement.status !== 'disconnected') return false;
  const restarted = await useLiveCaptureStore.getState().pollSecondaryReconnect(opts);
  if (restarted) runtime()?.afterSecondaryMeasurementChange?.();
  return restarted;
}

export default function SecondaryMeasurementPanel(): JSX.Element | null {
  const enabled = useStoreShallow(useSettingsStore, (s) => !!s.settings?.secondaryMeasurementEnabled);
  const { devices, secondaryMeasurement } = useStoreShallow(useLiveCaptureStore, (s) => ({
    devices: s.devices,
    secondaryMeasurement: s.secondaryMeasurement,
  }));

  /* c8 ignore start -- setInterval scheduling, no jsdom in this harness;
     secondaryReconnectTick (the actual reconnect decision) is tested
     directly in SecondaryMeasurementPanel.test.ts. Exercised end-to-end by
     tests/e2e/live-capture-workspace.spec.ts. */
  useEffect(() => {
    if (!enabled || secondaryMeasurement.status !== 'disconnected') return;
    const id = setInterval(() => {
      void secondaryReconnectTick(enabled, secondaryCaptureOpts());
    }, SECONDARY_RECONNECT_POLL_MS);
    return () => clearInterval(id);
  }, [enabled, secondaryMeasurement.status]);
  /* c8 ignore stop */

  if (!enabled) return null;

  const selectedValue = deviceIndexForName(devices, secondaryMeasurement.deviceName) ?? '';
  const showWarning = secondaryMeasurement.deviceName !== '' && secondaryMeasurement.status !== 'off';

  return (
    <label className="select-label" id="secondary-measurement-block">
      <span>Secondary Measurement Device (experimental)</span>
      <div className="select-row">
        <div className="select-wrap">
          <select
            id="secondary-measurement-device"
            value={selectedValue}
            dangerouslySetInnerHTML={{ __html: secondaryDeviceOptionsHTML(devices, secondaryMeasurement.deviceName) }}
            /* c8 ignore next -- change dispatch, no jsdom */
            onChange={(e) => { void selectSecondaryDevice(e.target.value, devices, secondaryCaptureOpts()); }}
          />
          <span className="select-caret" dangerouslySetInnerHTML={{ __html: iconSvg('chevron-down', 16) }} />
        </div>
      </div>
      <p id="secondary-measurement-status" className="device-hint" dangerouslySetInnerHTML={{ __html: secondaryStatusHTML(secondaryMeasurement) }} />
      <p id="secondary-measurement-warning" className="device-hint" dangerouslySetInnerHTML={{ __html: showWarning ? alignmentWarningHTML() : '' }} />
    </label>
  );
}
