// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The first-run onboarding welcome overlay (#69, TD-001 slice 6f, #704) —
// portaled by App.tsx onto #onboarding-island, replacing inline-app.js's
// initOnboarding. Markup is copied verbatim from the old static
// root-markup.html (same ids/classes) so tests/onboarding.spec.ts's
// selectors keep working unmodified. Icons render inline
// (dangerouslySetInnerHTML) rather than via data-icon — see
// CurveEditorDialog.tsx's identical note.

import { useEffect, type JSX } from 'react';
import { iconSvg } from './report-card';
import { useStoreShallow } from './stores/useStoreShallow';
import { useOnboardingStore } from './stores/onboardingStore';

const DEFAULT_COPY = 'Sound Buddy scores your mix and hands back a clear report card — an overall '
  + 'grade, level and dynamics readouts, and the EQ moves that matter. No setup, no settings, and no '
  + 'audio gear required to get started. Run your first analysis on a sample recording and see your '
  + 'report card in seconds.';

export default function OnboardingDialog(): JSX.Element {
  const { dialogOpen, phase, copyOverride, runButtonLabel } = useStoreShallow(useOnboardingStore, (s) => ({
    dialogOpen: s.dialogOpen,
    phase: s.phase,
    copyOverride: s.copyOverride,
    runButtonLabel: s.runButtonLabel,
  }));

  /* c8 ignore start -- document-level Escape close, no jsdom in this harness;
     covered by app/tests/onboarding.spec.ts's skip-flow test. */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const s = useOnboardingStore.getState();
      if (e.key === 'Escape' && s.dialogOpen && s.phase !== 'progress') useOnboardingStore.getState().close();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
  /* c8 ignore stop */

  return (
    <div
      id="onboarding-dialog"
      className="rig-dialog"
      style={{ display: dialogOpen ? 'flex' : 'none' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      /* c8 ignore next -- click dispatch, no jsdom */
      onClick={(e) => { if (e.target === e.currentTarget && phase !== 'progress') useOnboardingStore.getState().close(); }}
    >
      <div className="rig-dialog-card onboarding-card">
        <div className="onboarding-mark" aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconSvg('waveform', 16) }} />
        <h2 id="onboarding-title" className="onboarding-title">Welcome to Sound Buddy</h2>
        <p className="onboarding-copy" id="onboarding-copy">{copyOverride ?? DEFAULT_COPY}</p>
        <div className="onboarding-actions" id="onboarding-actions">
          <button
            type="button"
            id="onboarding-skip"
            className="btn btn-secondary"
            /* c8 ignore next -- click dispatch, no jsdom */
            onClick={() => useOnboardingStore.getState().close()}
          >
            Skip for now
          </button>
          <button
            type="button"
            id="onboarding-run"
            className="btn btn-primary"
            dangerouslySetInnerHTML={{ __html: iconSvg('waveform', 16) + runButtonLabel }}
            /* c8 ignore next -- click dispatch, no jsdom */
            onClick={() => { void useOnboardingStore.getState().runFirstAnalysis(); }}
          />
        </div>
        <div className="onboarding-progress" id="onboarding-progress" style={{ display: phase === 'progress' ? 'flex' : 'none' }}>
          <span className="spin" />
          <span id="onboarding-progress-text">Analyzing your first recording…</span>
        </div>
      </div>
    </div>
  );
}
