// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The Analyze tab's two-choice entry point (#1468, lc-05): ModeTabs.tsx opens
// this instead of jumping straight to the file chooser once analyze-entry.ts's
// shouldOfferListenLive gate is on (Advanced features + lineCheckCalibrationEnabled).
// "Listen live" starts the existing room-mic secondary-source machinery
// (measurement-device-state.ts) via analyzeEntryStore — never a console/
// multitrack connection. Mounted directly in App.tsx (not portaled), same
// rig-dialog/rig-dialog-card markup family as ConsoleNetworkConsentDialog.tsx —
// no new island div, no new CSS.

import { useEffect, type JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useAnalyzeEntryStore } from './stores/analyzeEntryStore';

export default function AnalyzeEntryDialog(): JSX.Element {
  const { dialogOpen } = useStoreShallow(useAnalyzeEntryStore, (s) => ({ dialogOpen: s.dialogOpen }));

  /* c8 ignore start -- document-level Escape close, no jsdom in this harness;
     mirrors ConsoleNetworkConsentDialog.tsx's identical, justified ignore. */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && useAnalyzeEntryStore.getState().dialogOpen) {
        useAnalyzeEntryStore.getState().close();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
  /* c8 ignore stop */

  return (
    <div
      id="analyze-entry-dialog"
      className="rig-dialog"
      style={{ display: dialogOpen ? 'flex' : 'none' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="analyze-entry-title"
      /* c8 ignore next -- click dispatch, no jsdom; backdrop click cancels, takes no action. */
      onClick={(e) => { if (e.target === e.currentTarget) useAnalyzeEntryStore.getState().close(); }}
    >
      <div className="rig-dialog-card">
        <h2 id="analyze-entry-title" className="rig-dialog-title">
          Analyze
        </h2>
        <p>Choose a recording to analyze, or listen live via a room mic.</p>
        <div className="rig-dialog-actions">
          <button
            type="button"
            id="analyze-entry-choose-file"
            className="btn btn-secondary"
            /* c8 ignore next -- click dispatch, no jsdom */
            onClick={() => { void useAnalyzeEntryStore.getState().chooseFile(); }}
          >
            Choose file…
          </button>
          <button
            type="button"
            id="analyze-entry-listen-live"
            className="btn btn-primary"
            /* c8 ignore next -- click dispatch, no jsdom */
            onClick={() => { void useAnalyzeEntryStore.getState().listenLive(); }}
          >
            Listen live
          </button>
        </div>
      </div>
    </div>
  );
}
