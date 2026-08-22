// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The persistent top-bar Record control (#729), portaled by App.tsx onto
// #record-button-island in #header-right. The SOLE Live-capture transport
// (#757): the Live tab's old in-tab Mode toggle and Start/Stop CTA are gone,
// so this button alone cycles Record (idle) → Recording → Stopping → Record.
// An idle press flows into recordCapture(runtime()), which starts monitoring
// first when no session is live and then promotes in place (#458) via the
// same bridged recordCapture helper LiveControls.tsx exports; a Recording
// press stops via stopLiveCapture. It stays visible off Live through recording
// and transitions so Stop remains reachable, and is Pro-gated via the shared
// body.not-pro CSS hook on #record-button-island (app.css) rather than
// re-deriving license status here.

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

  const phase = window.liveTransitionState.capturePhase({ liveRunning: isCapturing, liveMode, promoting, stopping });
  const view = recordButtonView(phase);

  if (appMode !== 'live' && view.phase === 'idle') return null;

  function onClick() {
    const action = recordButtonAction(view.phase);
    if (action === 'record') void recordCapture(runtime());
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
      dangerouslySetInnerHTML={{ __html: iconSvg('circle', 16) }}
    />
  );
}
