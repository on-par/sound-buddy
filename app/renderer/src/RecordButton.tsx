// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The persistent top-bar Record control (#729), portaled by App.tsx onto
// #record-button-island in #header-right. #1648: it records a Main +
// Measurement take (recordTakeStore) — the board's mix out plus the room
// mic, each mono or stereo — with no Session tab and no multitrack grid, and
// beside the circle shows elapsed / saving / the saved take / an actionable
// error. The take runs on its own record processes, so the Live RTA keeps
// listening untouched. The Session tab's live-capture transport (#757) still
// owns this button while a Session recording is running or stopping, so its
// Stop stays reachable from any tab (flag-on builds only). Pro-gated via the
// shared body.not-pro CSS hook on #record-button-island (app.css) rather than
// re-deriving license status here.

import { useEffect, useState, type JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useRecordTakeStore } from './stores/recordTakeStore';
import { iconSvg } from './report-card';
import { runtime, stopLiveCapture } from './LiveControls';
import { recordButtonView, recordButtonAction } from './record-transport';
import { recordTakeView, savedFileNames, savedFilePaths, takeName } from './record-take';

const RECORD_TICK_MS = 1000;
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
  const take = useStoreShallow(useRecordTakeStore, (s) => ({
    phase: s.phase,
    startedAt: s.startedAt,
    sources: s.sources,
    lastTake: s.lastTake,
    error: s.error,
  }));
  const [now, setNow] = useState(() => Date.now());

  /* c8 ignore start -- interval tick, no jsdom timer assertions in this harness */
  useEffect(() => {
    if (take.phase !== 'recording') return;
    const id = setInterval(() => setNow(Date.now()), RECORD_TICK_MS);
    return () => clearInterval(id);
  }, [take.phase]);
  /* c8 ignore stop */

  const sessionPhase = window.liveTransitionState.capturePhase({ liveRunning: isCapturing, liveMode, promoting, stopping, demoting });
  if (take.phase === 'idle' && SESSION_OWNED_PHASES.has(sessionPhase)) {
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
        dangerouslySetInnerHTML={{ __html: iconSvg('circle', 16) }}
      />
    );
  }

  const view = recordTakeView(take, now);
  const { button } = view;

  /* c8 ignore start -- click dispatch, no jsdom; the store transitions are recordTakeStore.test.ts */
  function onClick() {
    const store = useRecordTakeStore.getState();
    if (store.phase === 'idle') void store.start();
    else if (store.phase === 'recording') void store.stop();
  }
  /* c8 ignore stop */

  return (
    <>
      <button
        type="button"
        id="record-button"
        className={`record-btn record-btn--${button.phase}`}
        disabled={button.disabled}
        aria-label={button.ariaLabel}
        aria-pressed={button.phase === 'recording' || button.phase === 'stopping'}
        onClick={onClick}
        dangerouslySetInnerHTML={{ __html: iconSvg('circle', 16) }}
      />
      {view.statusText && (
        <span
          id="record-status"
          role="status"
          className="record-status"
          title={take.sources ? `Main: ${take.sources.main}\nMeasurement: ${take.sources.measurement}` : undefined}
        >
          {view.statusText}
        </span>
      )}
      {view.saved && (
        <>
          <span className="record-take-info">
            <span id="record-saved" className="record-saved" title={view.saved.dir}>
              {`Saved · ${takeName(view.saved.dir)}`}
            </span>
            <span id="record-saved-files" className="record-saved" title={savedFilePaths(view.saved)}>
              {savedFileNames(view.saved)}
            </span>
          </span>
          <button
            type="button"
            id="record-reveal"
            className="btn btn-secondary sm"
            /* c8 ignore next -- click dispatch, no jsdom */
            onClick={() => { void useRecordTakeStore.getState().reveal(); }}
          >
            Show in Finder
          </button>
        </>
      )}
      {view.error && (
        <span id="record-error" role="alert" className="record-error">{view.error}</span>
      )}
    </>
  );
}
