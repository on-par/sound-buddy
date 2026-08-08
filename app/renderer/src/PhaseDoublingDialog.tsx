// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The #phase-doubling-dialog Doubling/Phase Bug Detector checklist (#370,
// TD-001 slice 6f, #704) — portaled by App.tsx onto
// #phase-doubling-dialog-island. Markup is copied verbatim from the old
// static index.html (every id preserved) so app/tests/e2e/utility-dialogs.spec.ts's
// selectors work. phase-doubling-state.js stays a classic script, read via a
// typed window cast — matching RingoutPanel.tsx's getFeedbackRingout()
// pattern.

import { useEffect, type JSX } from 'react';
import { escapeHtml } from './spectrum-display';
import { useStoreShallow } from './stores/useStoreShallow';
import { usePhaseDoublingStore, type PhaseDoublingContext } from './stores/phaseDoublingStore';

interface PhaseDoublingStep {
  id: string;
  title: string;
  explanation: string;
  resolution: string;
}
interface PhaseDoublingStateApi {
  getStep(i: number): PhaseDoublingStep;
  stepCount(): number;
  isLastStep(i: number): boolean;
  stepHtml(step: PhaseDoublingStep, index: number, total: number, escape: typeof escapeHtml): string;
  progressDotsHtml(index: number, total: number): string;
  contextLineHtml(ctx: PhaseDoublingContext | null, escape: typeof escapeHtml): string;
}
function getPhaseDoublingState(): PhaseDoublingStateApi {
  return (window as unknown as { phaseDoublingState: PhaseDoublingStateApi }).phaseDoublingState;
}

export default function PhaseDoublingDialog(): JSX.Element {
  const { dialogOpen, step, context } = useStoreShallow(usePhaseDoublingStore, (s) => ({
    dialogOpen: s.dialogOpen,
    step: s.step,
    context: s.context,
  }));

  /* c8 ignore start -- document-level Escape close, no jsdom in this harness;
     covered by app/tests/e2e/utility-dialogs.spec.ts. */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && usePhaseDoublingStore.getState().dialogOpen) {
        usePhaseDoublingStore.getState().close();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
  /* c8 ignore stop */

  const pd = getPhaseDoublingState();
  const total = pd.stepCount();

  return (
    <div
      id="phase-doubling-dialog"
      className="rig-dialog"
      style={{ display: dialogOpen ? 'flex' : 'none' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="phase-doubling-title"
      /* c8 ignore next -- click dispatch, no jsdom */
      onClick={(e) => { if (e.target === e.currentTarget) usePhaseDoublingStore.getState().close(); }}
    >
      <div className="rig-dialog-card guide-dialog-card">
        <div className="rig-dialog-title" id="phase-doubling-title">Phase &amp; Doubling Check</div>
        <div className="ai-dialog-sub">A guided walkthrough of the routing mistakes behind a weird, robotic, or doubled system sound. No console access needed.</div>
        <div id="phase-doubling-context" className="pd-context-slot" dangerouslySetInnerHTML={{ __html: pd.contextLineHtml(context, escapeHtml) }} />
        <div id="phase-doubling-progress" className="pd-progress" dangerouslySetInnerHTML={{ __html: pd.progressDotsHtml(step, total) }} />
        <div id="phase-doubling-body" className="pd-body" dangerouslySetInnerHTML={{ __html: pd.stepHtml(pd.getStep(step), step, total, escapeHtml) }} />
        <div className="rig-dialog-actions">
          <button
            type="button"
            id="phase-doubling-back"
            className="btn btn-secondary sm"
            disabled={step === 0}
            /* c8 ignore next -- click dispatch, no jsdom */
            onClick={() => usePhaseDoublingStore.getState().prev()}
          >
            Back
          </button>
          <button
            type="button"
            id="phase-doubling-next"
            className="btn btn-primary sm"
            style={{ display: pd.isLastStep(step) ? 'none' : undefined }}
            /* c8 ignore next -- click dispatch, no jsdom */
            onClick={() => usePhaseDoublingStore.getState().next()}
          >
            Next
          </button>
          <button
            type="button"
            id="phase-doubling-close"
            className="btn btn-secondary sm"
            /* c8 ignore next -- click dispatch, no jsdom */
            onClick={() => usePhaseDoublingStore.getState().close()}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
