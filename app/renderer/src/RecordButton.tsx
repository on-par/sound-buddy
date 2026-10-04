// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The persistent top-bar Record control (#729), portaled by App.tsx onto
// #record-button-island in the header's fixed center slot (#1650). #1648: it
// records a Main + Measurement take (recordTakeStore) — the board's mix out
// plus the room mic, each mono or stereo — with no Session tab and no
// multitrack grid. The control is the circle (idle) or the square stop glyph
// (recording) and nothing else: no elapsed / Saving / saved-take text and no
// Show in Finder, so the pinned center slot never grows (#1650). The take runs on
// its own record processes, so the Live RTA keeps listening untouched. The
// Session tab's live-capture transport (#757) still owns this button while a
// Session recording is running or stopping, so its Stop stays reachable from
// any tab (flag-on builds only). Pro-gated via the shared body.not-pro CSS
// hook on #record-button-island (app.css) rather than re-deriving license
// status here.

import { type JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useRecordTakeStore } from './stores/recordTakeStore';
import { iconSvg } from './report-card';
import { runtime, stopLiveCapture } from './LiveControls';
import { recordButtonView, recordButtonAction, recordButtonGlyph } from './record-transport';
import { recordTakeView } from './record-take';

// Session capture phases that own the header button (a recording to stop).
const SESSION_OWNED_PHASES = new Set(['starting-record', 'recording', 'stopping']);

export default function RecordButton(): JSX.Element {
  const { liveMode, isCapturing, promoting, stopping, demoting } = useStoreShallow(useLiveCaptureStore, (s) => ({
    liveMode: s.liveMode,
    isCapturing: s.isCapturing,
    promoting: s.promoting,
    stopping: s.stopping,
    demoting: s.demoting,
  }));
  const takePhase = useStoreShallow(useRecordTakeStore, (s) => s.phase);

  const sessionPhase = window.liveTransitionState.capturePhase({ liveRunning: isCapturing, liveMode, promoting, stopping, demoting });
  if (takePhase === 'idle' && SESSION_OWNED_PHASES.has(sessionPhase)) {
    const view = recordButtonView(sessionPhase);
    /* c8 ignore next 3 -- click dispatch, no jsdom; routing is recordButtonAction (record-transport.test.ts) */
    const onSessionClick = () => {
      if (recordButtonAction(view.phase) === 'stop') void stopLiveCapture(runtime());
    };
    return (
      <button
        type="button"
        id="record-button"
        className={`record-btn record-btn--${view.phase}`}
        disabled={view.disabled}
        aria-label={view.ariaLabel}
        aria-pressed={view.phase === 'recording' || view.phase === 'stopping'}
        onClick={onSessionClick}
        dangerouslySetInnerHTML={{ __html: iconSvg(recordButtonGlyph(view.phase), 16) }}
      />
    );
  }

  // Record/stop only (#1650 follow-up): the header shows the circle or the
  // square. Elapsed, Saving, the saved take, the error, and Show in Finder
  // are not rendered beside it.
  const view = recordTakeView({ phase: takePhase, startedAt: null, lastTake: null, error: null }, 0);
  const { button } = view;

  /* c8 ignore start -- click dispatch, no jsdom; the store transitions are recordTakeStore.test.ts */
  function onClick() {
    const store = useRecordTakeStore.getState();
    if (store.phase === 'idle') void store.start();
    else if (store.phase === 'recording') void store.stop();
  }
  /* c8 ignore stop */

  return (
    <button
      type="button"
      id="record-button"
      className={`record-btn record-btn--${button.phase}`}
      disabled={button.disabled}
      aria-label={button.ariaLabel}
      aria-pressed={button.phase === 'recording' || button.phase === 'stopping'}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: iconSvg(recordButtonGlyph(button.phase), 16) }}
    />
  );
}
