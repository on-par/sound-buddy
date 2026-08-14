// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The week-to-week Live-capture setup controls — input device picker +
// refresh, measurement source, and the record-folder row — split out of
// LiveControls.tsx (#727) into their own component so they can move from the
// Live tab's now-removed left column into Settings → Audio, alongside
// RigControls/SecondaryMeasurementPanel/CaptureCadenceControls. Rendered
// directly as JSX inside SettingsPanel.tsx (no createPortal — see that
// file's header for why). Reads the same liveCaptureStore/settingsStore
// slices LiveControls used to, and still delegates the runtime-side effects
// (device re-seed, measurement-source normalize, folder dialog) to
// window.liveCaptureRuntime via LiveControls.tsx's runtime() accessor — the
// same pattern SecondaryMeasurementPanel.tsx already uses.

import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useSettingsStore } from './stores/settingsStore';
import { iconSvg } from './report-card';
import { deviceOptionLabel, measurementSourceOptionsHTML } from './live-capture-panel';
import { boardSourceHint } from './measurement-source-hints';
import { runtime, type LiveCaptureRuntime } from './LiveControls';

export type { LiveCaptureRuntime };

// Device <select> changed: writes the selection into the store (so the
// controlled <select>'s value stays in sync) and delegates the re-seed of
// channel config/groups/preflight for the newly selected device to the
// bridged runtime.
export function changeDevice(rt: LiveCaptureRuntime | undefined, value: string): void {
  useLiveCaptureStore.getState().selectDevice(value);
  rt?.selectDevice(value);
}

export default function LiveSourceSettings() {
  const { devices, deviceHint, selectedDevice, channelConfig, measurementSource, recordDir, isCapturing } =
    useStoreShallow(useLiveCaptureStore, (s) => ({
      devices: s.devices,
      deviceHint: s.deviceHint,
      selectedDevice: s.selectedDevice,
      channelConfig: s.channelConfig,
      measurementSource: s.measurementSource,
      recordDir: s.recordDir,
      isCapturing: s.isCapturing,
    }));
  const storageDir = useStoreShallow(useSettingsStore, (s) => s.settings?.storageDir ?? null);

  const devicePlaceholder = devices.length > 0
    ? 'Default Device'
    : (deviceHint?.text || 'Loading devices…');
  // Mirrors inline-app.js's defaultRecordFolderText() (#91) — the configured
  // storageDir setting, falling back to the platform default.
  const defaultRecordFolderText = (storageDir && storageDir.trim()) || '~/Music/Sound Buddy';

  return (
    <>
      <label className="select-label">
        <span>Input Device</span>
        <div className="select-row">
          <div className="select-wrap">
            <select
              id="device-select"
              value={selectedDevice}
              disabled={isCapturing}
              aria-disabled={isCapturing}
              onChange={(e) => changeDevice(runtime(), e.target.value)}
            >
              {devices.length === 0
                ? <option value="">{devicePlaceholder}</option>
                : (
                  <>
                    <option value="">Default Device</option>
                    {devices.map((d) => <option key={d.index} value={String(d.index)}>{deviceOptionLabel(d)}</option>)}
                  </>
                )}
            </select>
            <span className="select-caret" dangerouslySetInnerHTML={{ __html: iconSvg('chevron-down', 16) }} />
          </div>
          <button
            type="button"
            id="device-refresh-btn"
            className="ghost-btn"
            title="Re-scan input devices"
            disabled={isCapturing}
            aria-disabled={isCapturing}
            onClick={() => { void runtime()?.loadDevices(); }}
          >
            Refresh
          </button>
        </div>
      </label>
      {deviceHint?.text && (
        <p id="device-hint" className={`device-hint${deviceHint.isError ? ' is-error' : ''}`}>{deviceHint.text}</p>
      )}

      <label className="select-label">
        <span>Measurement Source</span>
        <div className="select-row">
          <div className="select-wrap">
            <select
              id="measurement-source"
              value={measurementSource == null ? '' : String(measurementSource)}
              dangerouslySetInnerHTML={{ __html: measurementSourceOptionsHTML(channelConfig, measurementSource) }}
              onChange={(e) => runtime()?.changeMeasurementSource(e.target.value)}
            />
            <span className="select-caret" dangerouslySetInnerHTML={{ __html: iconSvg('chevron-down', 16) }} />
          </div>
        </div>
      </label>
      {/* The board source is always a board feed (#461) — one hedged hint
          under the select, no per-strip classification. */}
      <p className="device-hint" id="measurement-source-hint">{boardSourceHint().copy}</p>

      {/* The record-folder row renders always (#757) — the mode toggle that
          used to gate it is gone, and the top-bar Record button records to
          this folder regardless of mode. */}
      <div className="record-row" id="record-folder-row">
        <button
          type="button"
          id="record-folder-btn"
          className="ghost-btn"
          title="Choose recording folder"
          disabled={isCapturing}
          aria-disabled={isCapturing}
          onClick={() => { void runtime()?.chooseRecordFolder(); }}
        >
          Folder…
        </button>
        <span className="record-path" id="record-folder-path">{recordDir || defaultRecordFolderText}</span>
      </div>
    </>
  );
}
