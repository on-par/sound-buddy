// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Analyze's record-to-file control (#1636), rendered inside
// AnalyzeLiveEqPanel's .analyze-live-eq-actions row. Backed by
// analyzeRecordStore, which calls the existing start-live/stop-live IPC
// directly — see the #1636 ADR for why this never goes through Session's
// capture-lifecycle/recordCapture path.

import { useEffect, useState, type JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useAnalyzeRecordStore } from './stores/analyzeRecordStore';
import { useAnalyzeEntryStore } from './stores/analyzeEntryStore';
import { analyzeRecordView } from './analyze-record';
import { iconSvg } from './report-card';

const RECORD_TICK_MS = 1000;

export default function AnalyzeRecordControl(): JSX.Element | null {
  const record = useStoreShallow(useAnalyzeRecordStore, (s) => ({
    phase: s.phase,
    startedAt: s.startedAt,
    lastSessionDir: s.lastSessionDir,
    error: s.error,
  }));
  const { listening, listenChannel } = useStoreShallow(useAnalyzeEntryStore, (s) => ({
    listening: s.listening,
    listenChannel: s.listenChannel,
  }));
  const [now, setNow] = useState(() => Date.now());

  /* c8 ignore start -- interval tick, no jsdom timer assertions in this harness */
  useEffect(() => {
    if (record.phase !== 'recording') return;
    const id = setInterval(() => setNow(Date.now()), RECORD_TICK_MS);
    return () => clearInterval(id);
  }, [record.phase]);
  /* c8 ignore stop */

  if (!listening && record.phase === 'idle' && !record.lastSessionDir) return null;

  const view = analyzeRecordView(record, now);

  return (
    <div className="analyze-record" data-phase={record.phase}>
      <button
        type="button"
        id="analyze-record"
        className="btn btn-secondary sm analyze-record-btn"
        aria-pressed={view.recording}
        disabled={view.disabled || (!listening && record.phase === 'idle')}
        /* c8 ignore next -- click dispatch, no jsdom */
        onClick={() => { if (record.phase === 'recording') void useAnalyzeRecordStore.getState().stop(); else void useAnalyzeRecordStore.getState().start(listenChannel); }}
        dangerouslySetInnerHTML={{ __html: iconSvg('circle', 12) + view.buttonLabel }}
      />
      {view.statusText && (
        <span id="analyze-record-status" role="status" className="analyze-record-status">{view.statusText}</span>
      )}
      {view.sessionDir && (
        <>
          <span className="analyze-record-saved">Saved to {view.sessionDir}</span>
          <button
            type="button"
            id="analyze-record-reveal"
            className="btn btn-secondary sm"
            /* c8 ignore next -- click dispatch, no jsdom */
            onClick={() => { void useAnalyzeRecordStore.getState().reveal(); }}
          >
            Show in Finder
          </button>
        </>
      )}
      {view.error && (
        <span className="analyze-record-error" role="alert">{view.error}</span>
      )}
    </div>
  );
}
