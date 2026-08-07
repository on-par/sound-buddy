// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The #tab-guide Pass Mode toggle + Channel Build-Order Guide (#365, #367,
// TD-001 slice 6e, #703) — portaled by App.tsx onto #tab-guide, replacing
// inline-app.js's renderPassMode/renderBuildGuide + their delegated
// listeners with a component driven by liveCaptureStore.appMode.
// Component-local state (no new store). pass-mode-state.js/
// build-order-state.js stay classic scripts whose HTML-string functions are
// injected wholesale via dangerouslySetInnerHTML (same functions the old
// imperative renderers called) — only the click delegation moves to React.

import { useEffect, useRef, useState, type JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { switchMode } from './mode-switch';
import { escapeHtml } from './spectrum-display';
import { iconSvg } from './report-card';

interface PassModeState {
  loadPhase(storage: Storage): string;
  savePhase(storage: Storage, id: string): void;
  getPhase(id: string): unknown;
  toggleHtml(activeId: string, escape: typeof escapeHtml): string;
  reminderHtml(phase: unknown, escape: typeof escapeHtml): string;
}
interface BuildProgress {
  completed: string[];
}
interface BuildStep {
  id: string;
  label: string;
}
interface BuildOrderState {
  STEPS: BuildStep[];
  emptyProgress(): BuildProgress;
  loadProgress(storage: Storage): BuildProgress;
  saveProgress(storage: Storage, progress: BuildProgress): void;
  toggle(progress: BuildProgress, id: string): BuildProgress;
  completedCount(progress: BuildProgress): number;
  totalSteps(): number;
  isAllComplete(progress: BuildProgress): boolean;
  stepRowHtml(step: BuildStep, index: number, progress: BuildProgress, escape: typeof escapeHtml): string;
  completeMomentHtml(progress: BuildProgress, escape: typeof escapeHtml): string;
}
// pass-mode-state.js/build-order-state.js stay classic scripts — read via a
// typed window cast, matching ReportCardIsland.tsx's getGrading()-style
// pattern.
function getPassModeState(): PassModeState {
  return (window as unknown as { passModeState: PassModeState }).passModeState;
}
function getBuildOrderState(): BuildOrderState {
  return (window as unknown as { buildOrderState: BuildOrderState }).buildOrderState;
}
function getHydrateIcons(): (root: Element) => void {
  // hydrateIcons is a top-level `function` declaration in inline-app.js, so
  // it attaches to `window` automatically (same as window.renderChannelConfig).
  return (window as unknown as { hydrateIcons: (root: Element) => void }).hydrateIcons;
}

export default function BuildGuidePanel(): JSX.Element {
  const appMode = useStoreShallow(useLiveCaptureStore, (s) => s.appMode);
  const [phase, setPhase] = useState(() => getPassModeState().loadPhase(sessionStorage));
  const [progress, setProgress] = useState(() => getBuildOrderState().loadProgress(localStorage));
  const completeRef = useRef<HTMLDivElement>(null);

  /* c8 ignore start -- storage re-read on tab entry, no jsdom in this
     harness; reload-on-every-visit is exercised by
     tests/e2e/report-first-ux.spec.ts. The state transitions themselves
     (setPhase/setProgress) are unit-tested via the handler functions below. */
  useEffect(() => {
    if (appMode !== 'guide') return;
    setPhase(getPassModeState().loadPhase(sessionStorage));
    setProgress(getBuildOrderState().loadProgress(localStorage));
  }, [appMode]);
  /* c8 ignore stop */

  const bo = getBuildOrderState();
  const pm = getPassModeState();
  const done = bo.completedCount(progress);
  const total = bo.totalSteps();
  const allComplete = bo.isAllComplete(progress);
  const completeHtml = bo.completeMomentHtml(progress, escapeHtml);

  /* c8 ignore start -- icon-injection DOM pass, no jsdom in this harness;
     exercised end-to-end by tests/e2e/report-first-ux.spec.ts. */
  useEffect(() => {
    if (completeRef.current) getHydrateIcons()(completeRef.current);
  }, [completeHtml]);
  /* c8 ignore stop */

  function setPhaseAndSave(id: string): void {
    pm.savePhase(sessionStorage, id);
    setPhase(id);
  }

  function toggleStep(id: string): void {
    const next = bo.toggle(progress, id);
    bo.saveProgress(localStorage, next);
    setProgress(next);
  }

  function resetProgress(): void {
    const empty = bo.emptyProgress();
    bo.saveProgress(localStorage, empty);
    setProgress(empty);
  }

  return (
    <>
      <div className="pass-mode" role="group" aria-label="Mixing pass">
        <div
          className="pass-toggle"
          id="pass-mode-toggle"
          dangerouslySetInnerHTML={{ __html: pm.toggleHtml(phase, escapeHtml) }}
          /* c8 ignore next -- click delegation, no jsdom */
          onClick={(e) => {
            const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-phase]');
            if (btn?.dataset.phase) setPhaseAndSave(btn.dataset.phase);
          }}
        />
        <div
          className="pass-reminder"
          id="pass-mode-reminder"
          dangerouslySetInnerHTML={{ __html: pm.reminderHtml(pm.getPhase(phase), escapeHtml) }}
        />
      </div>
      <div className="bg-head">
        <span className="section-label">Build Order</span>
        <span className="bg-progress" id="build-guide-progress">{`${done}/${total} done`}</span>
        <button
          type="button"
          id="build-guide-reset"
          className="ghost-btn sm"
          title="Clear progress"
          onClick={resetProgress}
        >
          Reset
        </button>
      </div>
      <div
        className="bg-list"
        id="build-guide-list"
        dangerouslySetInnerHTML={{ __html: bo.STEPS.map((step, i) => bo.stepRowHtml(step, i, progress, escapeHtml)).join('') }}
        /* c8 ignore next -- click delegation, no jsdom */
        onClick={(e) => {
          const target = e.target as HTMLElement;
          const row = target.closest<HTMLElement>('[data-step-id]');
          if (!row?.dataset.stepId) return;
          if (target.closest('.bg-check')) toggleStep(row.dataset.stepId);
          else if (target.closest('.bg-label')) row.classList.toggle('expanded');
        }}
      />
      <div
        className="bg-complete"
        id="build-complete"
        hidden={!allComplete}
        ref={completeRef}
        dangerouslySetInnerHTML={{ __html: completeHtml }}
        /* c8 ignore next -- click dispatch, no jsdom */
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('#build-complete-share')) switchMode('reportcard');
        }}
      />
      <button
        type="button"
        id="build-guide-review"
        className="btn btn-secondary sm full"
        dangerouslySetInnerHTML={{ __html: iconSvg('clipboard-check', 16) + 'Review in Report Card' }}
        /* c8 ignore next -- click dispatch, no jsdom */
        onClick={() => switchMode('reportcard')}
      />
    </>
  );
}
