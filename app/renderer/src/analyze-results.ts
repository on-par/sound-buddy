// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure view fold for the Analyze results rail (#1487) — the grade, pills, and
// recommendations that fold into Analyze chrome once a file- or live-derived
// analysis produces a result. Reuses getReportCardSource's exact
// currentAnalysis-then-liveSource priority (report-card-chrome.ts) rather
// than re-deriving it, so this never becomes a second, divergent source of
// "what's the current result" from ReportCardIsland's. The grading API is
// injected (constitution: side effects injected, not imported globally) —
// AnalyzeResultsPanel.tsx supplies the real window.grading, tests supply a
// fake.

import { getReportCardSource } from './report-card-chrome';
import type { ReportCardSource, RecordingType } from './report-card';
import type { AnalysisPayload } from '@sound-buddy/shared';

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
  | { kind: 'result'; source: ReportCardSource; grade: AnalyzeResultsGrade };

export function analyzeResultsView(
  currentAnalysis: AnalysisPayload | null,
  liveSource: ReportCardSource | null,
  listening: boolean,
  grading: AnalyzeResultsGradingApi,
): AnalyzeResultsView {
  const source = getReportCardSource(currentAnalysis, liveSource);
  if (!source) return { kind: 'empty', state: listening ? 'listening' : 'idle' };
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
