// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The persistent top-bar Record control (#729), portaled by App.tsx onto
// #record-button-island in #header-right. Additive to LiveControls.tsx's
// Mode toggle and LiveTransportControls' Start/Stop transport (both left
// unchanged) — this button owns only promoting a running monitor session to
// a recording (#458) and stopping it, via the same bridged
// recordCapture/stopLiveCapture helpers LiveControls.tsx already exports.
// Visible only while the Live tab is the active mode (`appMode === 'live'`)
// and Pro-gated via the shared body.not-pro CSS hook on
// #record-button-island (app.css) rather than re-deriving license status
// here — see the #729 plan's ADR (the #727 postmortem this pattern guards
// against).

import type { JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { iconSvg } from './report-card';
import { runtime, recordCapture, stopLiveCapture } from './LiveControls';
import { recordButtonView, recordButtonAction } from './record-transport';

export default function RecordButton(): JSX.Element | null {
  const { appMode, liveMode, isCapturing, promoting, stopping } = useStoreShallow(useLiveCaptureStore, (s) => ({
    appMode: s.appMode,
    liveMode: s.liveMode,
    isCapturing: s.isCapturing,
    promoting: s.promoting,
    stopping: s.stopping,
  }));

  if (appMode !== 'live') return null;

  const view = recordButtonView({ liveRunning: isCapturing, liveMode, promoting, stopping });

  function onClick() {
    const action = recordButtonAction(view.phase, view.disabled);
    if (action === 'promote') void recordCapture(runtime());
    else if (action === 'stop') void stopLiveCapture(runtime());
  }

  return (
    <button
      type="button"
      id="record-button"
      className={`record-btn record-btn--${view.phase}`}
      disabled={view.disabled}
      aria-label={view.ariaLabel}
      aria-pressed={view.phase === 'recording' || view.phase === 'stopping'}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: iconSvg('circle', 16) + view.label }}
    />
  );
}
