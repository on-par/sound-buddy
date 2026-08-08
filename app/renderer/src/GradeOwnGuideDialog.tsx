// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The #guide-dialog "Grade your own service" guide (#142, reworked #295,
// TD-001 slice 6f, #704) — portaled by App.tsx onto #guide-dialog-island.
// Markup is copied verbatim from the old static index.html (every id
// preserved) so app/tests/e2e/utility-dialogs.spec.ts's selectors work.
// Icons render inline (dangerouslySetInnerHTML) rather than via data-icon —
// see CurveEditorDialog.tsx's identical note.

import { useEffect, type JSX } from 'react';
import { useElectron } from './useElectron';
import { iconSvg } from './report-card';
import { escapeHtml } from './spectrum-display';
import { useStoreShallow } from './stores/useStoreShallow';
import { useGradeOwnGuideStore } from './stores/gradeOwnGuideStore';

interface GradeOwnStateApi {
  pathsHtml(escape: typeof escapeHtml): string;
}
// grade-own-state.js stays a classic script — read via a typed window cast,
// matching RingoutPanel.tsx's getFeedbackRingout() pattern.
function getGradeOwnState(): GradeOwnStateApi {
  return (window as unknown as { gradeOwnState: GradeOwnStateApi }).gradeOwnState;
}

export default function GradeOwnGuideDialog(): JSX.Element {
  const sb = useElectron();
  const dialogOpen = useStoreShallow(useGradeOwnGuideStore, (s) => s.dialogOpen);

  /* c8 ignore start -- document-level Escape close, no jsdom in this harness;
     covered by app/tests/e2e/utility-dialogs.spec.ts. */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && useGradeOwnGuideStore.getState().dialogOpen) {
        useGradeOwnGuideStore.getState().close();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
  /* c8 ignore stop */

  // openCaptureGuide()'s promise/preload-missing handling mirrors
  // handlePathAction's 'open-guide' branch (stores/gradeOwnGuideStore.ts) —
  // this button sits outside the guide-paths list, so it can't reach that
  // branch through ctaAction().
  /* c8 ignore start -- click dispatch + preload guard, no jsdom */
  function openSite() {
    try { sb.openCaptureGuide()?.catch(() => {}); } catch { /* preload missing */ }
    useGradeOwnGuideStore.getState().close();
  }
  /* c8 ignore stop */

  return (
    <div
      id="guide-dialog"
      className="rig-dialog"
      style={{ display: dialogOpen ? 'flex' : 'none' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="guide-dialog-title"
      /* c8 ignore next -- click dispatch, no jsdom */
      onClick={(e) => { if (e.target === e.currentTarget) useGradeOwnGuideStore.getState().close(); }}
    >
      <div className="rig-dialog-card guide-dialog-card">
        <div className="rig-dialog-title" id="guide-dialog-title">Grade your own service</div>
        <div className="ai-dialog-sub">Start from what you already have — a recording, a livestream video, or neither.</div>
        <div className="guide-have-file">
          <div className="guide-have-file-heading">Already have a recording or livestream file?</div>
          <button
            type="button"
            id="guide-choose-file"
            className="btn btn-primary"
            dangerouslySetInnerHTML={{ __html: iconSvg('file-audio', 16) + 'Choose a file to grade…' }}
            /* c8 ignore next -- click dispatch, no jsdom */
            onClick={() => { void useGradeOwnGuideStore.getState().chooseFile(); }}
          />
          <div className="guide-have-file-hint">wav · aif · aiff · flac · mp3 · ogg · m4a — or a video file; Sound Buddy grades its audio track. You can also drop a file on the Report Card anytime.</div>
        </div>
        <div className="guide-need-capture-heading">Need to capture one first? Pick what fits your setup:</div>
        <div
          className="guide-list"
          id="guide-paths"
          dangerouslySetInnerHTML={{ __html: getGradeOwnState().pathsHtml(escapeHtml) }}
          /* c8 ignore next -- click delegation, no jsdom */
          onClick={(e) => {
            const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-guide-path]');
            if (!btn?.dataset.guidePath) return;
            useGradeOwnGuideStore.getState().handlePathAction(btn.dataset.guidePath);
          }}
        />
        <div className="rig-dialog-actions">
          <button
            type="button"
            id="guide-dialog-close"
            className="btn btn-secondary sm"
            /* c8 ignore next -- click dispatch, no jsdom */
            onClick={() => useGradeOwnGuideStore.getState().close()}
          >
            Close
          </button>
          <button
            type="button"
            id="guide-dialog-open-site"
            className="btn btn-secondary sm"
            dangerouslySetInnerHTML={{ __html: iconSvg('external-link', 16) + 'Read the full capture guide' }}
            onClick={openSite}
          />
        </div>
      </div>
    </div>
  );
}
