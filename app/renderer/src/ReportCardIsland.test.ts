// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import ReportCardIsland from './ReportCardIsland';
import { ElectronContext } from './useElectron';
import { useAnalysisStore } from './stores/analysisStore';
import { useSpectrumStore } from './stores/spectrumStore';
import { createMockSoundBuddy } from './mock-sound-buddy';
import type { GradingPillApi, BandDiffApi } from './report-card';

const gradingMock: GradingPillApi & BandDiffApi & {
  computeGrade(): string;
  computeScore(): number;
  analyzeRecordingType(): { type: string; label: string; note: string; tone: 'good' };
  explainGrade(): { grade: string; clipping: boolean; deductions: never[]; notMeasured: never[] };
  computeRecommendations(): string[];
} = {
  computeGrade: () => 'A',
  computeScore: () => 92,
  analyzeRecordingType: () => ({ type: 'music', label: 'Music', note: 'Balanced', tone: 'good' }),
  explainGrade: () => ({ grade: 'A', clipping: false, deductions: [], notMeasured: [] }),
  computeRecommendations: () => ['Sounds great'],
  rcPeakStatus: () => 'good',
  rcRmsStatus: () => 'good',
  rcDrStatus: () => 'good',
  rcCentroidStatus: () => 'good',
  rcLufsStatus: () => 'good',
  rcTruePeakStatus: () => 'good',
  rcMetricTarget: () => null,
  bandDiffFromOthers: () => 0,
  CONFIG: { bandBalance: { hotDiff: 5, quietDiff: -5 } },
};

const phaseDoublingStateMock = { detectPhaseSignal: () => false };
const feedbackRingoutMock = {
  detectFeedbackSignal: () => null,
  reportCardCallout: () => ({
    detected: false,
    title: 'Fighting feedback in your monitors?',
    sub: 'Walk through ringing out a mic step by step — no console access needed.',
    buttonLabel: 'Open the ring-out wizard',
  }),
};
const audioEngineSpectralMock = { findSpectralPeaks: () => [] };
const inlineDialogsMock = { openPhaseDoublingDialog: () => {}, openFeedbackRingout: () => {} };

const ANALYSIS = {
  sox: { rmsDbfs: -18, peakDbfs: -6, dynamicRangeDb: 12, clipping: false },
  spectrum: {
    spectralCentroid: 1200,
    bands: { subBass: -20, bass: -18, lowMid: -22, mid: -16, highMid: -25, presence: -30, brilliance: -35 },
    curve: null,
    contentType: 'speech',
    segments: null,
    frames: [],
  },
  ffprobe: { format: { filename: '/fake/silence.wav' } },
  loudness: null,
};

beforeEach(() => {
  (globalThis as { window?: unknown }).window = {
    grading: gradingMock,
    phaseDoublingState: phaseDoublingStateMock,
    feedbackRingout: feedbackRingoutMock,
    audioEngineSpectral: audioEngineSpectralMock,
    inlineDialogs: inlineDialogsMock,
  };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useAnalysisStore.setState({
    currentAnalysis: null,
    isAnalyzing: false,
    status: 'idle',
    analysisProgress: null,
    analysisError: null,
    selectedFilePath: null,
    historySummary: null,
    liveSource: null,
  });
  useSpectrumStore.setState({
    spectrumData: null,
    bands: {},
    spectralCentroid: null,
    rolloff: null,
    idealProfile: null,
    isAutoProfile: false,
  });
});

function renderMarkup(): string {
  const mock = createMockSoundBuddy();
  return renderToString(
    createElement(ElectronContext.Provider, { value: mock.api }, createElement(ReportCardIsland))
  );
}

describe('ReportCardIsland', () => {
  it('renders the empty dropzone state when there is no analysis/live/history data', () => {
    const html = renderMarkup();

    expect(html).toContain('id="rc-empty"');
    expect(html).toContain('style="display:flex"');
    expect(html).toContain('Drop audio file here');
    expect(html).toContain('id="analyze-btn"');
    expect(html).toMatch(/id="analyze-btn"[^>]*disabled/);
    expect(html).not.toContain('id="rc-content"><div class="rc-header"');
  });

  it('shows the picked filename and enables Analyze once a file is selected', () => {
    useAnalysisStore.setState({ selectedFilePath: '/fake/path/silence.wav' });

    const html = renderMarkup();

    expect(html).toContain('dropzone loaded');
    expect(html).toContain('silence.wav');
    expect(html).not.toMatch(/id="analyze-btn"[^>]*disabled/);
    expect(html).toContain('>Analyze<');
  });

  it('disables Analyze while a run is in flight', () => {
    useAnalysisStore.setState({ selectedFilePath: '/fake/path/silence.wav', status: 'analyzing' });

    const html = renderMarkup();

    expect(html).toMatch(/id="analyze-btn"[^>]*disabled/);
  });

  it('shows "Re-analyze" once status is done', () => {
    useAnalysisStore.setState({ selectedFilePath: '/fake/path/silence.wav', status: 'done' });

    const html = renderMarkup();

    expect(html).toContain('>Re-analyze<');
  });

  it('hides the empty state and renders the full report card once currentAnalysis lands', () => {
    useAnalysisStore.setState({ currentAnalysis: ANALYSIS, status: 'done' });

    const html = renderMarkup();

    expect(html).toMatch(/id="rc-empty"[^>]*style="display:none"/);
    expect(html).toContain('id="rc-content"');
    expect(html).toContain('silence.wav');
    expect(html).toContain('rc-contenttype speech');
    expect(html).toContain('rc-bands-section');
    expect(html).toContain('rc-phase-doubling');
    expect(html).toContain('rc-feedback-ringout');
  });

  it('renders the live-capture card from liveSource when there is no currentAnalysis', () => {
    useAnalysisStore.setState({
      liveSource: {
        filename: 'Live capture — Main (window #1)',
        rms: -18,
        peak: -6,
        dynamicRange: null,
        clipping: false,
        centroid: 1200,
        bands: { subBass: -20, bass: -18, lowMid: -22, mid: -16, highMid: -25, presence: -30, brilliance: -35 },
      },
    });

    const html = renderMarkup();

    expect(html).toContain('Live capture — Main (window #1)');
    expect(html).toContain('id="rc-content"');
  });

  it('currentAnalysis wins over liveSource when both are present', () => {
    useAnalysisStore.setState({
      currentAnalysis: ANALYSIS,
      liveSource: { filename: 'Live capture — Main (window #1)', rms: -1, peak: -1, dynamicRange: null, clipping: false, centroid: 1, bands: {} },
    });

    const html = renderMarkup();

    expect(html).toContain('silence.wav');
    expect(html).not.toContain('Live capture');
  });

  it('renders the frozen history card when only historySummary is present', () => {
    useAnalysisStore.setState({
      historySummary: {
        sourceFilename: 'sermon.wav',
        date: '2026-07-01T09:00:00.000Z',
        gradeLetter: 'B',
        score: 84,
        recordingType: 'Music',
        topFixes: ['Reduce low mids'],
      },
    });

    const html = renderMarkup();

    expect(html).toMatch(/id="rc-empty"[^>]*style="display:none"/);
    expect(html).toContain('id="rc-content"');
    expect(html).toContain('sermon.wav');
    expect(html).toContain('Reduce low mids');
    expect(html).not.toContain('rc-metrics-section');
    expect(html).not.toContain('rc-why-section');
    expect(html).not.toContain('rc-bands-section');
    expect(html).not.toContain('rc-frames-section');
    expect(html).not.toContain('rc-profile-section');
  });

  it('a real analysis wins over a stale historySummary', () => {
    useAnalysisStore.setState({
      currentAnalysis: ANALYSIS,
      historySummary: { sourceFilename: 'old.wav', date: '2026-01-01T00:00:00.000Z', gradeLetter: 'C', score: 60, recordingType: 'Music', topFixes: [] },
    });

    const html = renderMarkup();

    expect(html).toContain('silence.wav');
    expect(html).not.toContain('old.wav');
  });

  it('renders the tonal-balance section when an ideal profile and usable curve are both present', () => {
    const curveAnalysis = {
      ...ANALYSIS,
      spectrum: { ...ANALYSIS.spectrum, curve: { freqs: [100, 200, 300], db: [-10, -12, -14] } },
    };
    useAnalysisStore.setState({ currentAnalysis: curveAnalysis });
    useSpectrumStore.setState({ idealProfile: { label: 'Flat / neutral', dbOffsets: [-10, -12, -14] }, isAutoProfile: true });

    const html = renderMarkup();

    expect(html).toContain('rc-profile-section');
    expect(html).toContain('Flat / neutral');
  });
});
