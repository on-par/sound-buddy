// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createRequire } from 'node:module';
import ReportCardIsland from './ReportCardIsland';
import { ElectronContext } from './useElectron';
import { useAnalysisStore } from './stores/analysisStore';
import { useSpectrumStore } from './stores/spectrumStore';
import { useSettingsStore } from './stores/settingsStore';
import { createMockSoundBuddy } from './mock-sound-buddy';
import type { GradingPillApi, BandDiffApi } from './report-card';
import type { AppSettings } from '../../electron/ipc/api';

const require = createRequire(import.meta.url);
const reportFirstUxState = require('../report-first-ux-state.js');

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
  CONFIG: { bandBalance: { hotDiff: 5, quietDiff: -5, severeHotDiff: 15 } },
};

const phaseDoublingStateMock = { detectPhaseSignal: () => false };
const feedbackRingoutMock = {
  detectFeedbackSignal: (): { freq: number; prominence: number } | null => null,
  reportCardCallout: () => ({
    detected: false,
    title: 'Fighting feedback in your monitors?',
    sub: 'Walk through ringing out a mic step by step — no console access needed.',
    buttonLabel: 'Open the ring-out wizard',
  }),
};
const audioEngineSpectralMock = { findSpectralPeaks: () => [] };
const inlineDialogsMock = { openPhaseDoublingDialog: () => {}, openFeedbackRingout: () => {}, openBuildGuide: () => {} };

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
    reportFirstUxState,
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
    prevSummary: null,
    lastSavedSummaryFile: null,
  });
  useSpectrumStore.setState({
    spectrumData: null,
    bands: {},
    spectralCentroid: null,
    rolloff: null,
    idealProfile: null,
    isAutoProfile: false,
  });
  useSettingsStore.setState({ settings: null, settingsError: null, dialogOpen: false });
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

  it('shows the "vs. last time" delta on the fresh file-analysis card when prevSummary is set (#259)', () => {
    useAnalysisStore.setState({
      currentAnalysis: ANALYSIS,
      prevSummary: { score: 83, gradeLetter: 'B' },
    });

    const html = renderMarkup();

    expect(html).toContain('id="rc-delta"');
    expect(html).toContain('+9 pts vs. last service (B → A)');
  });

  it('omits the delta on a first-ever analysis (no prevSummary, AC2)', () => {
    useAnalysisStore.setState({ currentAnalysis: ANALYSIS, prevSummary: null });

    const html = renderMarkup();

    expect(html).not.toContain('rc-delta');
  });

  it('shows the delta on the frozen history card from its stored score/letter', () => {
    useAnalysisStore.setState({
      historySummary: {
        sourceFilename: 'sermon.wav',
        date: '2026-07-01T09:00:00.000Z',
        gradeLetter: 'A',
        score: 92,
        recordingType: 'Music',
        topFixes: [],
      },
      prevSummary: { score: 83, gradeLetter: 'B' },
    });

    const html = renderMarkup();

    expect(html).toContain('id="rc-delta"');
    expect(html).toContain('+9 pts vs. last service (B → A)');
  });

  it('never shows a delta on a live-capture card, even with prevSummary set (source-type gate)', () => {
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
      prevSummary: { score: 83, gradeLetter: 'B' },
    });

    const html = renderMarkup();

    expect(html).not.toContain('rc-delta');
  });

  it('renders the score-circle metric rows when the report-first-ux flag is enabled (#540)', () => {
    useAnalysisStore.setState({ currentAnalysis: ANALYSIS, status: 'done' });
    // cast comment: minimal settings slice for the gate — only the flag it reads matters here
    useSettingsStore.setState({ settings: { reportFirstUxEnabled: true } as unknown as AppSettings });

    const html = renderMarkup();

    expect(html).toContain('rc-metric-rows');
    expect(html).not.toContain('metric-table');
  });

  it('renders the legacy metric table when the report-first-ux flag is off', () => {
    useAnalysisStore.setState({ currentAnalysis: ANALYSIS, status: 'done' });
    useSettingsStore.setState({ settings: { reportFirstUxEnabled: false } as unknown as AppSettings });

    const html = renderMarkup();

    expect(html).toContain('metric-table');
    expect(html).not.toContain('rc-metric-rows');
  });

  it('renders the legacy metric table when settings are still null/loading (strict gate)', () => {
    useAnalysisStore.setState({ currentAnalysis: ANALYSIS, status: 'done' });
    useSettingsStore.setState({ settings: null });

    const html = renderMarkup();

    expect(html).toContain('metric-table');
    expect(html).not.toContain('rc-metric-rows');
  });
});

describe('ReportCardIsland — contextual links (#545)', () => {
  it('shows the Ring-Out link and the Build Guide link when the flag is on and a feedback peak is detected', () => {
    useAnalysisStore.setState({ currentAnalysis: ANALYSIS, status: 'done' });
    useSettingsStore.setState({ settings: { reportFirstUxEnabled: true } as unknown as AppSettings });
    (globalThis as { window?: { feedbackRingout?: typeof feedbackRingoutMock } }).window!.feedbackRingout = {
      ...feedbackRingoutMock,
      detectFeedbackSignal: () => ({ freq: 3150, prominence: 12 }),
    };

    const html = renderMarkup();

    expect(html).toContain('rc-ringout-link');
    expect(html).toContain('rc-build-guide-link');
  });

  it('shows the Build Guide link but not the Ring-Out link when the flag is on with no feedback peak', () => {
    useAnalysisStore.setState({ currentAnalysis: ANALYSIS, status: 'done' });
    useSettingsStore.setState({ settings: { reportFirstUxEnabled: true } as unknown as AppSettings });

    const html = renderMarkup();

    expect(html).toContain('rc-build-guide-link');
    expect(html).not.toContain('rc-ringout-link');
  });

  it('shows neither contextual link when the flag is off, even with a feedback peak', () => {
    useAnalysisStore.setState({ currentAnalysis: ANALYSIS, status: 'done' });
    useSettingsStore.setState({ settings: { reportFirstUxEnabled: false } as unknown as AppSettings });
    (globalThis as { window?: { feedbackRingout?: typeof feedbackRingoutMock } }).window!.feedbackRingout = {
      ...feedbackRingoutMock,
      detectFeedbackSignal: () => ({ freq: 3150, prominence: 12 }),
    };

    const html = renderMarkup();

    expect(html).not.toContain('rc-ringout-link');
    expect(html).not.toContain('rc-build-guide-link');
  });

  it('shows neither contextual link when settings are still null/loading (strict gate)', () => {
    useAnalysisStore.setState({ currentAnalysis: ANALYSIS, status: 'done' });
    useSettingsStore.setState({ settings: null });

    const html = renderMarkup();

    expect(html).not.toContain('rc-ringout-link');
    expect(html).not.toContain('rc-build-guide-link');
  });
});

describe('ReportCardIsland — handoff note (#267)', () => {
  it('leaves the note input disabled on a fresh card before the save round trip resolves', () => {
    useAnalysisStore.setState({ currentAnalysis: ANALYSIS, status: 'done', lastSavedSummaryFile: null });

    const html = renderMarkup();

    expect(html).toMatch(/id="rc-note-input"[^>]*disabled=""/);
  });

  it('enables the note input once lastSavedSummaryFile is set', () => {
    useAnalysisStore.setState({ currentAnalysis: ANALYSIS, status: 'done', lastSavedSummaryFile: 'x.json' });

    const html = renderMarkup();

    expect(html).not.toMatch(/id="rc-note-input"[^>]*disabled=""/);
  });

  it('renders a saved note as read-only text on the frozen history card', () => {
    useAnalysisStore.setState({
      historySummary: {
        sourceFilename: 'sermon.wav',
        date: '2026-07-01T09:00:00.000Z',
        gradeLetter: 'B',
        score: 84,
        recordingType: 'Music',
        topFixes: ['Reduce low mids'],
        note: 'board tech was out',
      },
    });

    const html = renderMarkup();

    expect(html).toContain('id="rc-note-text"');
    expect(html).toContain('board tech was out');
    expect(html).not.toContain('id="rc-note-input"');
  });

  it('omits the note paragraph on a history card with no saved note', () => {
    useAnalysisStore.setState({
      historySummary: {
        sourceFilename: 'sermon.wav',
        date: '2026-07-01T09:00:00.000Z',
        gradeLetter: 'B',
        score: 84,
        recordingType: 'Music',
        topFixes: [],
      },
    });

    const html = renderMarkup();

    expect(html).not.toContain('id="rc-note-text"');
  });
});

describe('ReportCardIsland — "save this mix as your target" CTA (#263)', () => {
  const CURVE_ANALYSIS = {
    ...ANALYSIS,
    spectrum: { ...ANALYSIS.spectrum, curve: { freqs: [100, 200, 300], db: [-10, -12, -14] } },
  };

  afterEach(() => {
    gradingMock.computeGrade = () => 'A';
  });

  it('shows the CTA for an A grade with a usable curve', () => {
    useAnalysisStore.setState({ currentAnalysis: CURVE_ANALYSIS, status: 'done' });

    const html = renderMarkup();

    expect(html).toContain('id="rc-save-target"');
    expect(html).toContain('Save this mix’s tone as your target');
  });

  it('flips to the saved/disabled state once the matching custom profile is active', () => {
    useAnalysisStore.setState({ currentAnalysis: CURVE_ANALYSIS, status: 'done' });
    useSpectrumStore.setState({
      idealProfile: {
        id: 'strongmix-silence', source: 'custom', label: 'Target from silence', dbOffsets: [-10, -12, -14],
      } as unknown as { label: string; dbOffsets: number[] },
    });

    const html = renderMarkup();

    expect(html).toContain('Saved as a target curve');
    expect(html).toMatch(/id="rc-save-target-btn"[^>]*disabled=""/);
  });

  it('hides the CTA for a C-or-below grade', () => {
    gradingMock.computeGrade = () => 'C';
    useAnalysisStore.setState({ currentAnalysis: CURVE_ANALYSIS, status: 'done' });

    const html = renderMarkup();

    expect(html).not.toContain('id="rc-save-target"');
  });

  it('hides the CTA for an A grade with no usable curve', () => {
    useAnalysisStore.setState({ currentAnalysis: ANALYSIS, status: 'done' });

    const html = renderMarkup();

    expect(html).not.toContain('id="rc-save-target"');
  });
});
