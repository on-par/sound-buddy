// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The #rc-toolbar buttons (TD-001 slice 6e, #703) — portaled by App.tsx onto
// #rc-toolbar, replacing inline-app.js's syncReportCardChrome + the 6
// toolbar-button listeners with a component driven by
// report-card-chrome.ts#reportCardChromeView.

import { useEffect, type JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useAnalysisStore } from './stores/analysisStore';
import { useSettingsStore } from './stores/settingsStore';
import { useSpectrumStore } from './stores/spectrumStore';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useFeedbackDialogStore } from './stores/feedbackDialogStore';
import { useGradeOwnGuideStore } from './stores/gradeOwnGuideStore';
import { spectrumTransport } from './spectrum-transport';
import { resolveReportCardChromeSource, reportCardChromeView, getReportCardSource, persistSummary } from './report-card-chrome';
import { iconSvg, buildMetricRows, type ReportCardSource, type GradingPillApi } from './report-card';
import type { AnalysisPayload } from '@sound-buddy/shared';
import * as reportExport from './report-export';
import * as shareCard from './share-card';

// grading.js/analyzeSourceState.js/reportFirstUxState.js stay classic
// scripts — read via a typed window cast, matching ReportCardIsland.tsx's
// getGrading()-style pattern.
interface GradingApi extends GradingPillApi {
  computeGrade(src: ReportCardSource): string;
  computeScore(src: ReportCardSource): number;
}
interface AnalyzeSourceStateApi {
  isPickerEnabled(reportFirstUxEnabled: boolean): boolean;
}
interface ReportFirstUxStateApi {
  isEnabled(settings: unknown): boolean;
}
interface AnalyzeSourcePickerApi {
  open(): void;
}
interface LiveCaptureRunningApi {
  isRunning(): boolean;
}
interface LiveCoachingApi {
  reset(): void;
}
function getGrading(): GradingApi {
  return (window as unknown as { grading: GradingApi }).grading;
}
function getAnalyzeSourceState(): AnalyzeSourceStateApi {
  return (window as unknown as { analyzeSourceState: AnalyzeSourceStateApi }).analyzeSourceState;
}
function getReportFirstUxState(): ReportFirstUxStateApi {
  return (window as unknown as { reportFirstUxState: ReportFirstUxStateApi }).reportFirstUxState;
}
function getAnalyzeSourcePicker(): AnalyzeSourcePickerApi | undefined {
  return (window as unknown as { analyzeSourcePicker?: AnalyzeSourcePickerApi }).analyzeSourcePicker;
}
function getLiveCapture(): LiveCaptureRunningApi {
  return (window as unknown as { liveCapture: LiveCaptureRunningApi }).liveCapture;
}
function getLiveCoaching(): LiveCoachingApi | undefined {
  return (window as unknown as { liveCoaching?: LiveCoachingApi }).liveCoaching;
}
function getChooseAndAnalyzeFile(): (() => Promise<void>) | undefined {
  return (window as unknown as { chooseAndAnalyzeFile?: () => Promise<void> }).chooseAndAnalyzeFile;
}
function getUpdateStatsRow(): ((sox: unknown, spectrum: unknown) => void) | undefined {
  return (window as unknown as { updateStatsRow?: (sox: unknown, spectrum: unknown) => void }).updateStatsRow;
}

// Share Image (#265): a one-click, purpose-built 1200×630 PNG for social
// posting — distinct from Export PDF (window.print()). Model → draw ops →
// render is entirely the pure share-card.ts module; this is only the impure
// glue (source lookup, canvas, save dialog), same split report-export.ts
// already established for Export PNG (#368). Verbatim port of the old
// reportcard-share-btn listener (inline-app.js).
/* c8 ignore start -- canvas/save-dialog glue, no jsdom canvas in this
   harness; exercised by tests/e2e/report-card-basics.spec.ts. */
async function shareImage(): Promise<void> {
  try {
    const state = useAnalysisStore.getState();
    const { isHistoryCard, chromeSource } = resolveReportCardChromeSource(state);
    const grading = getGrading();

    let grade: string;
    let score: number;
    let metrics: { label: string; value: string }[];
    if (chromeSource) {
      const src = chromeSource as ReportCardSource;
      grade = grading.computeGrade(src);
      score = grading.computeScore(src);
      metrics = buildMetricRows(src, grading)
        .slice(0, shareCard.MAX_SHARE_METRICS)
        .map((m) => ({ label: m.name, value: m.unit ? `${m.value} ${m.unit}` : m.value }));
    } else if (isHistoryCard) {
      const summary = state.historySummary as { gradeLetter: string; score: number };
      grade = summary.gradeLetter;
      score = summary.score;
      metrics = [];
    } else {
      return; // no card on screen to share
    }

    const churchNameSetting = (useSettingsStore.getState().settings || {}).shareChurchName || '';
    const model = shareCard.buildShareCardModel({
      grade, score, headline: 'Mix graded by Sound Buddy', metrics, churchName: churchNameSetting,
    });
    const ops = shareCard.shareCardDrawOps(model);

    // AC-2 privacy guard: the image must carry no identifying information by
    // default — assert the source filename/path never leaked into an op.
    const basename = chromeSource
      ? ((chromeSource as ReportCardSource).filename || '')
      : ((state.historySummary as { sourceFilename?: string })?.sourceFilename || '');
    const fullPath = (state.currentAnalysis as { ffprobe?: { format?: { filename?: string } } } | null)
      ?.ffprobe?.format?.filename || '';
    shareCard.assertNoIdentifyingText(ops, [basename, fullPath, model.churchName === null ? churchNameSetting : '']);

    const canvas = document.createElement('canvas');
    canvas.width = shareCard.SHARE_CARD_WIDTH;
    canvas.height = shareCard.SHARE_CARD_HEIGHT;
    // CanvasRenderingContext2D's fillStyle/strokeStyle accept gradients/
    // patterns too (wider than CanvasLike's string-only surface); this call
    // only ever assigns strings to them, so the structural mismatch is safe.
    const ctx = canvas.getContext('2d')! as unknown as shareCard.CanvasLike;
    shareCard.renderShareCard(ctx, ops);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))), 'image/png');
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    reportExport.assertPngMetadataStripped(bytes);

    const dateEl = document.getElementById('rc-date');
    const dateText = (dateEl && dateEl.textContent) || '';
    const sb = (window as unknown as { soundBuddy: { saveReportImage(bytes: Uint8Array, filename: string): Promise<unknown> } }).soundBuddy;
    await sb.saveReportImage(bytes, shareCard.buildShareFilename(dateText));
    // { saved: false } just means the user cancelled the native save dialog.
  } catch (err) {
    console.error('share image failed:', err);
    const reason = err instanceof Error ? err.message : String(err);
    window.alert(`Could not create the share image: ${reason}. Try again, or use Export PDF instead.`);
  }
}
/* c8 ignore stop */

// Verbatim port of syncReportCardChrome's status-transition side effects
// (inline-app.js) — extracted to a standalone function so it's testable
// without a real DOM (no jsdom in this harness); the useEffect below is
// thin wiring only.
export function applyStatusTransition(status: string, currentAnalysis: AnalysisPayload | null, liveSource: ReportCardSource | null): void {
  if (status === 'analyzing') {
    spectrumTransport.pauseIfPlaying(); // don't let a previous file's playback bleed through the loading state (#180)
    useSpectrumStore.getState().setPanelState('loading');
  } else if (status === 'error') {
    useSpectrumStore.getState().setPanelState('error', useAnalysisStore.getState().analysisError || 'Analysis failed');
  } else if (status === 'cancelled') {
    useSpectrumStore.getState().setPanelState('empty');
  } else if (status === 'done' && currentAnalysis) {
    getUpdateStatsRow()?.(currentAnalysis.sox, currentAnalysis.spectrum);
    persistSummary(getReportCardSource(currentAnalysis, liveSource), 'file');
  }
}

export default function ReportCardToolbar(): JSX.Element {
  const { status, currentAnalysis, liveSource, historySummary } = useStoreShallow(useAnalysisStore, (s) => ({
    status: s.status,
    currentAnalysis: s.currentAnalysis,
    liveSource: s.liveSource,
    historySummary: s.historySummary,
  }));
  const settings = useStoreShallow(useSettingsStore, (s) => s.settings);

  const view = reportCardChromeView({ currentAnalysis, liveSource, historySummary, status });

  /* c8 ignore start -- effect wiring only; applyStatusTransition's own logic
     is exhaustively unit-tested above. No jsdom in this harness to run a
     real effect — exercised end-to-end by
     tests/e2e/report-card-basics.spec.ts and report-first-ux.spec.ts. */
  useEffect(() => {
    applyStatusTransition(status, currentAnalysis, liveSource);
    // Deliberately keyed on `status` alone, matching syncReportCardChrome's
    // original `state.status !== prevState.status` guard — currentAnalysis/
    // liveSource are read for their value at the moment status transitions,
    // not to re-run this effect on their own changes.
  }, [status]);
  /* c8 ignore stop */

  return (
    <>
      <span className="panel-title">Report Card</span>
      <div className="rc-toolbar-actions">
        <button
          type="button"
          className="btn btn-secondary sm"
          id="reportcard-clear-btn"
          disabled={view.clearDisabled}
          dangerouslySetInnerHTML={{ __html: iconSvg('x', 16) + 'Clear' }}
          /* c8 ignore next -- click dispatch, no jsdom */
          onClick={() => {
            if (!currentAnalysis) return;
            spectrumTransport.reset();
            useAnalysisStore.getState().clearAnalysis();
            if (!getLiveCapture().isRunning()) {
              useLiveCaptureStore.getState().clearLiveWindows();
              getLiveCoaching()?.reset();
              const rcOffer = document.getElementById('rc-offer');
              const rcNotEnough = document.getElementById('rc-not-enough');
              if (rcOffer) rcOffer.style.display = 'none';
              if (rcNotEnough) rcNotEnough.style.display = 'none';
            }
            useSpectrumStore.getState().setPanelState('empty');
          }}
        />
        <button
          type="button"
          className="btn btn-secondary sm"
          id="reportcard-load-btn"
          style={{ display: view.loadVisible ? '' : 'none' }}
          disabled={view.loadDisabled}
          dangerouslySetInnerHTML={{ __html: iconSvg('file-audio', 16) + 'Load a file…' }}
          /* c8 ignore next -- click dispatch, no jsdom */
          onClick={() => {
            if (getAnalyzeSourceState().isPickerEnabled(getReportFirstUxState().isEnabled(settings))) {
              getAnalyzeSourcePicker()?.open();
            } else {
              void getChooseAndAnalyzeFile()?.();
            }
          }}
        />
        <button
          type="button"
          className="btn btn-secondary sm"
          id="reportcard-feedback-btn"
          dangerouslySetInnerHTML={{ __html: iconSvg('info', 16) + 'Send Feedback' }}
          /* c8 ignore next -- click dispatch, no jsdom */
          onClick={() => useFeedbackDialogStore.getState().open()}
        />
        <button
          type="button"
          className="btn btn-secondary sm"
          id="reportcard-share-btn"
          disabled={view.shareDisabled}
          dangerouslySetInnerHTML={{ __html: iconSvg('download', 16) + 'Share Image' }}
          /* c8 ignore next -- click dispatch, no jsdom */
          onClick={() => { void shareImage(); }}
        />
        <button
          type="button"
          className="btn btn-secondary sm"
          id="reportcard-print-btn"
          disabled={view.printDisabled}
          dangerouslySetInnerHTML={{ __html: iconSvg('download', 16) + 'Export PDF' }}
          /* c8 ignore next -- click dispatch, no jsdom */
          onClick={() => window.print()}
        />
        <button
          type="button"
          className="btn btn-secondary sm"
          id="grade-own-btn"
          disabled={view.gradeOwnDisabled}
          dangerouslySetInnerHTML={{ __html: iconSvg('waveform', 16) + 'Grade your own service' }}
          /* c8 ignore next -- click dispatch, no jsdom */
          onClick={() => useGradeOwnGuideStore.getState().open()}
        />
      </div>
    </>
  );
}
