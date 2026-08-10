// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The meter-rate (#meter-interval) and window (#window-secs) sliders on the
// Live tab, ported off static markup + inline-app.js's imperative label-
// repaint/capture-lock-sweep wiring into React (#725) — the last of the
// "conspicuous leftovers" setCaptureControlsLocked's old comment called out.
// Backed directly by liveCaptureStore's meterIntervalMs/windowSecs fields,
// portaled by App.tsx onto #capture-cadence-island (root-markup.html),
// mirroring SecondaryMeasurementPanel.tsx's pattern. Element ids/classnames/
// min/max/step/default-value match today's static markup exactly, so the
// untouched Playwright specs (tests/rigs.spec.ts, tests/e2e/live-capture.spec.ts)
// keep locating and asserting on the same nodes with no spec changes.

import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { meterIntervalLabel, windowSecsLabel } from './measurement-device-state';

const METER_INTERVAL_MIN_MS = 50;
const METER_INTERVAL_MAX_MS = 500;
const METER_INTERVAL_STEP_MS = 10;
const WINDOW_SECS_MIN = 1;
const WINDOW_SECS_MAX = 10;
const WINDOW_SECS_STEP = 0.5;

export default function CaptureCadenceControls() {
  const { meterIntervalMs, windowSecs, isCapturing } = useStoreShallow(useLiveCaptureStore, (s) => ({
    meterIntervalMs: s.meterIntervalMs,
    windowSecs: s.windowSecs,
    isCapturing: s.isCapturing,
  }));

  return (
    <>
      <div className="slider">
        <div className="slider-head">
          <span className="lbl">Meter rate</span>
          <span className="val" id="interval-label">{meterIntervalLabel(meterIntervalMs)}</span>
        </div>
        <input
          type="range"
          className="sb-slider"
          id="meter-interval"
          min={METER_INTERVAL_MIN_MS}
          max={METER_INTERVAL_MAX_MS}
          step={METER_INTERVAL_STEP_MS}
          value={meterIntervalMs}
          disabled={isCapturing}
          aria-disabled={isCapturing}
          onChange={(e) => useLiveCaptureStore.getState().setMeterIntervalMs(parseInt(e.target.value, 10))}
        />
      </div>
      <div className="slider">
        <div className="slider-head">
          <span className="lbl">Window</span>
          <span className="val" id="window-secs-label">{windowSecsLabel(windowSecs)}</span>
        </div>
        <input
          type="range"
          className="sb-slider"
          id="window-secs"
          min={WINDOW_SECS_MIN}
          max={WINDOW_SECS_MAX}
          step={WINDOW_SECS_STEP}
          value={windowSecs}
          disabled={isCapturing}
          aria-disabled={isCapturing}
          onChange={(e) => useLiveCaptureStore.getState().setWindowSecs(parseFloat(e.target.value))}
        />
      </div>
    </>
  );
}
