// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure view fold for the Analyze results rail (#1487, refined by #1522) — the
// grade, pills, and recommendations that fold into Analyze chrome once a
// file- or live-derived analysis produces a result, or a stored History
// summary (#1521) when neither is present. In File mode this reuses
// getReportCardSource's exact currentAnalysis-then-liveSource priority
// (report-card-chrome.ts) rather than re-deriving it, so this never becomes a
// second, divergent source of "what's the current result" from
// ReportCardIsland's; historySummary sits behind both, matching
// ReportCardIsland's own priority.
//
// #1522 (ADR): Live mode reads liveSource alone, never currentAnalysis or
// historySummary. Before this, a file grade permanently shadowed a later live
// listen (getReportCardSource always prefers currentAnalysis), so live
// coaching was invisible once any file had ever been graded — AC1/AC3. The
// mode is derived from analyzeEntryStore.listening via analyzeModeOf, never a
// second stored flag, so it can't disagree with `listening`. Neither mode
// transition clears the other mode's source — this is scoping at read time
// only, so toggling Live -> File -> Live always shows each mode's own result.
// The grading API is injected (constitution: side effects injected, not
// imported globally) — AnalyzeResultsPanel.tsx supplies the real
// window.grading, tests supply a fake.

import { getReportCardSource } from './report-card-chrome';
import type { AnalyzeMode } from './analyze-entry';
import type { ReportCardSource, RecordingType } from './report-card';
import type { AnalysisPayload } from '@sound-buddy/shared';
import type { AnalysisSummary } from '../../electron/ipc/api';

export interface AnalyzeResultsGradingApi {
  computeGrade(src: ReportCardSource): string;
  computeScore(src: ReportCardSource): number;
  analyzeRecordingType(src: ReportCardSource): RecordingType;
  computeRecommendations(src: ReportCardSource): string[];
  getGradingProfile(): { label: string };
}

export interface AnalyzeResultsGrade {
  letter: string;
  score: number;
  recType: RecordingType;
  recommendations: string[];
  gradingProfileLabel: string;
}

// AC3 (#1487): "no completed analysis exists yet (live listening active or
// idle)" — the two empty states named directly in the issue's acceptance
// criteria, kept as their own discriminant rather than folded into a single
// boolean so the panel's copy can name each one honestly.
export type AnalyzeResultsView =
  | { kind: 'empty'; state: 'listening' | 'idle' }
  | { kind: 'result'; source: ReportCardSource; grade: AnalyzeResultsGrade }
  | { kind: 'history'; summary: AnalysisSummary };

export function analyzeResultsView(
  currentAnalysis: AnalysisPayload | null,
  liveSource: ReportCardSource | null,
  historySummary: AnalysisSummary | null,
  mode: AnalyzeMode,
  grading: AnalyzeResultsGradingApi,
): AnalyzeResultsView {
  const source = mode === 'live' ? liveSource : getReportCardSource(currentAnalysis, liveSource);
  if (!source) {
    if (mode === 'live') return { kind: 'empty', state: 'listening' };
    if (historySummary) return { kind: 'history', summary: historySummary };
    return { kind: 'empty', state: 'idle' };
  }
  return {
    kind: 'result',
    source,
    grade: {
      letter: grading.computeGrade(source),
      score: grading.computeScore(source),
      recType: grading.analyzeRecordingType(source),
      recommendations: grading.computeRecommendations(source),
      gradingProfileLabel: grading.getGradingProfile().label,
    },
  };
}
