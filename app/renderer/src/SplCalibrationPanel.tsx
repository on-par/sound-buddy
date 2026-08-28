// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// SPL calibration control (#846) — composed directly into SettingsPanel.tsx's
// #settings-pane-audio (ADR-0007, no createPortal). Modeled on
// CaptureCadenceControls.tsx: the live Room dBFS reading is a static
// #spl-cal-live-level span the existing single createLiveMeterController
// patches straight to the DOM at animation rate (ADR-0005) — this component
// never subscribes to lastTick. The persisted offset is read straight from
// settingsStore on every render (ADR-0085, no local display mirror); the
// meter-value input is the only local state, an in-flight buffer.

import { useState, type JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useSettingsStore } from './stores/settingsStore';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { SPL_METER_MIN_DB, SPL_METER_MAX_DB, splCalibrationRowView, splOffsetFromSnapshot } from './spl-calibration';
import type { LiveMeterSnapshot } from './live-meter-controller';
import { settingsHelpNoteId } from './settings-help';

function liveMeterSnapshotFromStore(): LiveMeterSnapshot {
  const s = useLiveCaptureStore.getState();
  return {
    lastTick: s.lastTick,
    isCapturing: s.isCapturing,
    measurementSource: s.measurementSource,
    lastMeasurementChannels: s.lastMeasurementChannels,
    secondaryActive: s.secondaryMeasurement.status === 'active' && s.secondaryWindows.length > 0,
  };
}

export default function SplCalibrationPanel(): JSX.Element {
  const splCalibrationOffsetDb = useStoreShallow(useSettingsStore, (s) => s.settings?.splCalibrationOffsetDb ?? null);
  const [meterText, setMeterText] = useState('');
  const view = splCalibrationRowView(splCalibrationOffsetDb);

  return (
    <>
      <div className="ai-enable-row">
        <span className="settings-row-label">Live room level</span>
        <span className="settings-row-value" id="spl-cal-live-level">—</span>
        <span className="stat-unit">dBFS</span>
      </div>
      <div className="ai-enable-row">
        <span className="settings-row-label">Your SPL meter reads</span>
        <input
          type="number"
          id="spl-cal-meter-input"
          className="rig-dialog-input"
          min={SPL_METER_MIN_DB}
          max={SPL_METER_MAX_DB}
          step={0.1}
          value={meterText}
          aria-describedby={settingsHelpNoteId('splCalibration')}
          onChange={(e) => setMeterText(e.target.value)}
        />
        <button
          type="button"
          id="spl-cal-apply"
          className="btn btn-primary sm"
          /* c8 ignore next -- click dispatch, no jsdom */
          onClick={() => {
            const offset = splOffsetFromSnapshot(liveMeterSnapshotFromStore(), meterText);
            if (offset != null) void useSettingsStore.getState().updateSettings({ splCalibrationOffsetDb: offset });
          }}
        >
          Calibrate
        </button>
      </div>
      <div className="ai-enable-row">
        <span className="settings-row-label">Calibration: {view.offsetText}</span>
        {view.calibrated && (
          <button
            type="button"
            id="spl-cal-reset"
            className="btn btn-secondary sm"
            /* c8 ignore next -- click dispatch, no jsdom */
            onClick={() => { void useSettingsStore.getState().updateSettings({ splCalibrationOffsetDb: null }); }}
          >
            Reset
          </button>
        )}
      </div>
    </>
  );
}
