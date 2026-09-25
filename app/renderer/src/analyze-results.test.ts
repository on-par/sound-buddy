// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import { analyzeResultsView, type AnalyzeResultsGradingApi } from './analyze-results';
import type { ReportCardSource, RecordingType } from './report-card';
import type { AnalysisPayload } from '@sound-buddy/shared';
import type { AnalysisSummary } from '../../electron/ipc/api';

const ANALYSIS = {
  filePath: '/tmp/service.wav',
  sox: {
    samplesRead: 441000, lengthSeconds: 10, scaledBy: 1, maximumAmplitude: 0.9, minimumAmplitude: -0.9,
    midlineAmplitude: 0, meanNorm: 0.2, meanAmplitude: 0.1, rmsAmplitude: 0.2, maximumDelta: 0.8,
    minimumDelta: 0, meanDelta: 0.1, rmsDelta: 0.15, roughFrequency: 440, volumeAdjustment: 0,
    rmsDbfs: -18, peakDbfs: -3, dynamicRangeDb: 12, clipping: false,
  },
  spectrum: {
    spectralCentroid: 1200, spectralRolloff85: 4800, dynamicRange: 12,
    bands: { subBass: -30, bass: -3, lowMid: -20, mid: -16, highMid: -19, presence: -21, brilliance: -23 },
  },
  ffprobe: {
    format: {
      filename: '/tmp/service.wav', formatName: 'wav', formatLongName: 'WAV / WAVE (Waveform Audio)',
      durationSeconds: 10, sizeBytes: 441000, bitRate: 1411200, tags: {},
    },
    stream: {
      codecName: 'pcm_s16le', codecLongName: 'PCM signed 16-bit little-endian', channels: 1,
      channelLayout: 'mono', sampleRate: 44100, bitDepth: 16, bitRate: 705600, durationSeconds: 10,
    },
  },
  loudness: { integratedLufs: -20, loudnessRange: 5, truePeakDbtp: -1 },
} satisfies AnalysisPayload;

function makeLiveSource(filename: string): ReportCardSource {
  return {
    filename, rms: -18, peak: -6, dynamicRange: null, clipping: false, centroid: 1200,
    bands: { subBass: -30, bass: -22, lowMid: -18, mid: -16, highMid: -18, presence: -20, brilliance: -24 },
  };
}

const REC_TYPE: RecordingType = { type: 'full-mix', label: 'Full mix', note: 'Detected from spectral balance', tone: 'info' };

const HISTORY_SUMMARY: AnalysisSummary = {
  date: '2026-08-01T12:00:00Z', sourceFilename: 'sunday.wav', gradeLetter: 'A', score: 95,
  recordingType: 'Full Mix', topFixes: ['Cut 250 Hz'],
};

function fakeGrading(overrides: Partial<AnalyzeResultsGradingApi> = {}): AnalyzeResultsGradingApi {
  return {
    computeGrade: vi.fn(() => 'B'),
    computeScore: vi.fn(() => 82),
    analyzeRecordingType: vi.fn(() => REC_TYPE),
    computeRecommendations: vi.fn(() => ['Tighten the low mid']),
    getGradingProfile: vi.fn(() => ({ label: 'Casual' })),
    ...overrides,
  };
}

describe('analyzeResultsView (#1487)', () => {
  it('is empty/idle with no analysis in File mode', () => {
    const view = analyzeResultsView(null, null, null, 'file', fakeGrading());
    expect(view).toEqual({ kind: 'empty', state: 'idle' });
  });

  it('is empty/listening with no analysis in Live mode', () => {
    const view = analyzeResultsView(null, null, null, 'live', fakeGrading());
    expect(view).toEqual({ kind: 'empty', state: 'listening' });
  });

  it('never touches the grading API in the empty branch', () => {
    const grading = fakeGrading();
    analyzeResultsView(null, null, null, 'file', grading);
    expect(grading.computeGrade).not.toHaveBeenCalled();
  });

  it('folds a file analysis into grade/pill/recommendations in File mode, currentAnalysis winning over liveSource', () => {
    const grading = fakeGrading();
    const live = makeLiveSource('live.wav');

    const view = analyzeResultsView(ANALYSIS, live, null, 'file', grading);

    expect(view.kind).toBe('result');
    if (view.kind !== 'result') throw new Error('unreachable');
    expect(view.source.filename).not.toBe('live.wav');
    expect(view.grade).toEqual({
      letter: 'B',
      score: 82,
      recType: REC_TYPE,
      recommendations: ['Tighten the low mid'],
      gradingProfileLabel: 'Casual',
    });
    expect(grading.computeGrade).toHaveBeenCalledWith(view.source);
  });

  it('falls back to the live source in File mode when there is no file analysis', () => {
    const grading = fakeGrading();
    const live = makeLiveSource('live.wav');

    const view = analyzeResultsView(null, live, null, 'file', grading);

    expect(view.kind).toBe('result');
    if (view.kind !== 'result') throw new Error('unreachable');
    expect(view.source.filename).toBe('live.wav');
  });

  // #1522 AC1/AC3: Live mode reads liveSource only — a prior file grade must
  // never leak into the rail once the room mic is listening, and toggling
  // back to File must show the file grade again (asserted in the store/panel
  // tests, since this pure fold never mutates either input).
  it('Live mode reads only liveSource, even with a currentAnalysis present (#1522)', () => {
    const grading = fakeGrading();
    const live = makeLiveSource('live.wav');

    const view = analyzeResultsView(ANALYSIS, live, null, 'live', grading);

    expect(view.kind).toBe('result');
    if (view.kind !== 'result') throw new Error('unreachable');
    expect(view.source.filename).toBe('live.wav');
  });

  it('Live mode with a currentAnalysis but no liveSource is empty/listening, never the file grade (#1522)', () => {
    const grading = fakeGrading();

    const view = analyzeResultsView(ANALYSIS, null, null, 'live', grading);

    expect(view).toEqual({ kind: 'empty', state: 'listening' });
  });

  it('Live mode with only a historySummary is empty/listening, never the history card (#1522)', () => {
    const grading = fakeGrading();

    const view = analyzeResultsView(null, null, HISTORY_SUMMARY, 'live', grading);

    expect(view).toEqual({ kind: 'empty', state: 'listening' });
  });

  it('renders a history kind when only a stored summary is present in File mode (#1521)', () => {
    const grading = fakeGrading();

    const view = analyzeResultsView(null, null, HISTORY_SUMMARY, 'file', grading);

    expect(view).toEqual({ kind: 'history', summary: HISTORY_SUMMARY });
  });

  it('never touches the grading API in the history branch (#1521)', () => {
    const grading = fakeGrading();

    analyzeResultsView(null, null, HISTORY_SUMMARY, 'file', grading);

    expect(grading.computeGrade).not.toHaveBeenCalled();
    expect(grading.computeScore).not.toHaveBeenCalled();
    expect(grading.analyzeRecordingType).not.toHaveBeenCalled();
    expect(grading.computeRecommendations).not.toHaveBeenCalled();
    expect(grading.getGradingProfile).not.toHaveBeenCalled();
  });

  it('currentAnalysis wins over historySummary in File mode (#1521)', () => {
    const grading = fakeGrading();

    const view = analyzeResultsView(ANALYSIS, null, HISTORY_SUMMARY, 'file', grading);

    expect(view.kind).toBe('result');
  });

  it('liveSource wins over historySummary in File mode (#1521)', () => {
    const grading = fakeGrading();
    const live = makeLiveSource('live.wav');

    const view = analyzeResultsView(null, live, HISTORY_SUMMARY, 'file', grading);

    expect(view.kind).toBe('result');
  });
});
