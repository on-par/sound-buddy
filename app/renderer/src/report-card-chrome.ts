// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure report-card-chrome logic (TD-001 slice 6e, #703) — ports
// inline-app.js's resolveReportCardChromeSource/syncReportCardChrome/
// getReportCardSource/persistSummary into a real ES module.
// ReportCardToolbar.tsx/UpgradeMomentum.tsx both derive from
// reportCardChromeView, replacing the two independent copies of this
// priority logic inline-app.js used to keep (the toolbar sync + the Share
// Image click handler).

import { useAnalysisStore } from './stores/analysisStore';
import { getSoundBuddy } from './useElectron';
import {
  reportCardSourceFromAnalysis,
  buildAnalysisSummaryInput,
  type ReportCardSource,
  type AnalysisSummarySource,
} from './report-card';
import type { AnalysisPayload } from '@sound-buddy/shared';
import type { AnalysisSummary } from '../../electron/ipc/api';

export interface ReportCardChromeView {
  isHistoryCard: boolean;
  isLiveCard: boolean;
  hasCard: boolean;
  lastReportGrade: string | null;
  printDisabled: boolean;
  shareDisabled: boolean;
  gradeOwnDisabled: boolean;
  loadDisabled: boolean;
  loadVisible: boolean;
  clearDisabled: boolean;
}

interface ChromeSourceState {
  currentAnalysis: AnalysisPayload | null;
  liveSource: ReportCardSource | null;
  historySummary: AnalysisSummary | null;
}

// grading.js stays a classic script — read via a typed window cast, matching
// ReportCardIsland.tsx's getGrading()-style pattern.
interface GradingApi {
  computeGrade(src: ReportCardSource): string;
  computeScore(src: ReportCardSource): number;
  analyzeRecordingType(src: ReportCardSource): { label: string };
  computeRecommendations(src: ReportCardSource): string[];
  getGradingProfile(): { label: string };
}
function getGrading(): GradingApi {
  return (window as unknown as { grading: GradingApi }).grading;
}

// Verbatim port of resolveReportCardChromeSource (inline-app.js) — shared by
// reportCardChromeView below and ReportCardToolbar.tsx's Share Image handler
// so both derive "what card is showing" from one place.
export function resolveReportCardChromeSource(
  state: ChromeSourceState
): { isHistoryCard: boolean; chromeSource: ReportCardSource | null } {
  const isHistoryCard = !!state.historySummary && !state.currentAnalysis && !state.liveSource;
  const chromeSource = state.currentAnalysis
    ? reportCardSourceFromAnalysis(state.currentAnalysis)
    : (state.liveSource || null);
  return { isHistoryCard, chromeSource };
}

// Port of getReportCardSource (inline-app.js) as a pure function taking both
// values as params instead of closing over curAnalysis()/anaStore. Still
// used by saveMixAsTarget, the file-analysis persistSummary call site, and
// (indirectly, via ReportCardIsland.tsx's already-computed locals) the
// phase-doubling dialog's open() call — resolveReportCardChromeSource above
// supersedes it for chrome.
export function getReportCardSource(currentAnalysis: AnalysisPayload | null, liveSource: ReportCardSource | null): ReportCardSource | null {
  return currentAnalysis ? reportCardSourceFromAnalysis(currentAnalysis) : liveSource;
}

// The single source both ReportCardToolbar.tsx and UpgradeMomentum.tsx
// derive from — port of syncReportCardChrome's button-disabled/
// lastReportGrade derivations (inline-app.js), minus the status-transition
// side effects (ReportCardToolbar.tsx's own useEffect owns those).
export function reportCardChromeView(
  state: ChromeSourceState & { status: string }
): ReportCardChromeView {
  const { isHistoryCard, chromeSource } = resolveReportCardChromeSource(state);
  const isLiveCard = !state.currentAnalysis && !!state.liveSource;
  const hasCard = isHistoryCard || !!chromeSource;

  const lastReportGrade = isHistoryCard && state.historySummary
    ? state.historySummary.gradeLetter
    : chromeSource
      ? getGrading().computeGrade(chromeSource)
      : null;

  return {
    isHistoryCard,
    isLiveCard,
    hasCard,
    lastReportGrade,
    printDisabled: !hasCard,
    shareDisabled: !hasCard,
    gradeOwnDisabled: !hasCard,
    loadDisabled: state.status === 'analyzing',
    loadVisible: isLiveCard,
    clearDisabled: state.status === 'analyzing' || !state.currentAnalysis,
  };
}

// Guards persistSummary's async chain against out-of-order resolution
// (#267): each call gets the next generation number, and a chain only
// applies its resolved state if it's still the newest call.
let persistGeneration = 0;

// Persist a discrete report-card summary for the recent-services list
// (#147), tagged with its source ('file' | 'live', #261). Fire-and-forget:
// never block or fail the report card on a storage error. Verbatim port of
// persistSummary (inline-app.js).
export function persistSummary(src: ReportCardSource | null, source: AnalysisSummarySource): void {
  try {
    if (!src) return;
    const summary = buildAnalysisSummaryInput(src, getGrading(), source);
    const generation = ++persistGeneration;
    const sb = getSoundBuddy();
    // The handoff note field (#267) is add-at-save-time only — disabled
    // until this run's own save resolves with the record it wrote.
    useAnalysisStore.getState().setLastSavedSummaryFile(null);
    // Read the previous newest entry BEFORE saving this run, so summaries[0]
    // is genuinely "last time" and never the record we are about to write.
    sb.listAnalysisSummaries()
      .then((res) => {
        if (generation !== persistGeneration) return; // superseded by a newer analysis
        const prev = res && res.success && Array.isArray(res.summaries) && res.summaries[0] ? res.summaries[0] : null;
        useAnalysisStore.getState().setPrevSummary(prev);
      })
      .catch(() => {
        if (generation === persistGeneration) useAnalysisStore.getState().setPrevSummary(null);
      })
      .then(() => sb.saveAnalysisSummary(summary))
      .then((r) => {
        if (generation !== persistGeneration) return; // superseded by a newer analysis
        useAnalysisStore.getState().setLastSavedSummaryFile(r && r.success ? r.file || null : null);
      })
      .catch((err: unknown) => console.warn('persistSummary failed', err));
  } catch (err) {
    console.warn('persistSummary failed', err);
  }
}
