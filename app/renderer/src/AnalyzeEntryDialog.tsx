// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The Analyze tab's two-choice entry point (#1468, lc-05): analyzeEntryStore's
// enterAnalyze() opens this as the fallback for the no-room-mic-configured
// case (#1485 made live room-mic listening the default when a device is
// configured, so this dialog is reached only when analyze-entry.ts's
// resolveAnalyzeEntry says 'openDialog'). "Listen live" is the primary,
// focused affordance — it starts the existing room-mic secondary-source
// machinery (measurement-device-state.ts) via analyzeEntryStore — never a
// console/multitrack connection. Mounted directly in App.tsx (not portaled),
// same rig-dialog/rig-dialog-card markup family as
// ConsoleNetworkConsentDialog.tsx — no new island div, no new CSS.

import { useEffect, useRef, type JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useAnalyzeEntryStore } from './stores/analyzeEntryStore';

export default function AnalyzeEntryDialog(): JSX.Element {
  const { dialogOpen } = useStoreShallow(useAnalyzeEntryStore, (s) => ({ dialogOpen: s.dialogOpen }));
  const listenLiveRef = useRef<HTMLButtonElement>(null);

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

  /* c8 ignore start -- focus effect; renderToString runs no effects and this
     harness has no jsdom. Gated end to end by tests/e2e/analyze-listen-live.spec.ts,
     which asserts #analyze-entry-listen-live is focused when the dialog opens. */
  useEffect(() => {
    if (dialogOpen) listenLiveRef.current?.focus();
  }, [dialogOpen]);
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
        <p>Listen live through a room mic, or load a recording from disk.</p>
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
            ref={listenLiveRef}
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
