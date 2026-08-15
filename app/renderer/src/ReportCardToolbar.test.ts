// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import ReportCardToolbar, { applyStatusTransition } from './ReportCardToolbar';

// slice 6g (#710): the file-analysis header stats row is written through
// live-board.ts's fileStatsRowView/patchStatsRow (the old window.updateStatsRow
// bridge is deleted) — mock the module so the status-transition effect can be
// asserted without a real DOM.
const { fileStatsRowViewMock, patchStatsRowMock } = vi.hoisted(() => ({
  fileStatsRowViewMock: vi.fn(() => ({
    rms: { text: '-18.0', tone: '' },
    peak: { text: '-3.0', tone: '' },
    dr: { text: '12.0', tone: '' },
    clip: { text: 'No', tone: '' },
    centroid: '1,200',
  })),
  patchStatsRowMock: vi.fn(),
}));
vi.mock('./live-board', () => ({
  fileStatsRowView: fileStatsRowViewMock,
  patchStatsRow: patchStatsRowMock,
}));
import { useAnalysisStore } from './stores/analysisStore';
import { useSettingsStore } from './stores/settingsStore';
import { useSpectrumStore } from './stores/spectrumStore';
import { spectrumTransport } from './spectrum-transport';
import { createMockSoundBuddy } from './mock-sound-buddy';
import type { ReportCardSource } from './report-card';
import type { AnalysisPayload } from '@sound-buddy/shared';

const ANALYSIS = {
  filePath: '/tmp/service.wav',
  sox: {
    samplesRead: 441000,
    lengthSeconds: 10,
    scaledBy: 1,
    maximumAmplitude: 0.9,
    minimumAmplitude: -0.9,
    midlineAmplitude: 0,
    meanNorm: 0.2,
    meanAmplitude: 0.1,
    rmsAmplitude: 0.2,
    maximumDelta: 0.8,
    minimumDelta: 0,
    meanDelta: 0.1,
    rmsDelta: 0.15,
    roughFrequency: 440,
    volumeAdjustment: 0,
    rmsDbfs: -18,
    peakDbfs: -3,
    dynamicRangeDb: 12,
    clipping: false,
  },
  spectrum: {
    spectralCentroid: 1200,
    spectralRolloff85: 4800,
    dynamicRange: 12,
    bands: { subBass: -30, bass: -3, lowMid: -20, mid: -16, highMid: -19, presence: -21, brilliance: -23 },
  },
  ffprobe: {
    format: {
      filename: '/tmp/service.wav',
      formatName: 'wav',
      formatLongName: 'WAV / WAVE (Waveform Audio)',
      durationSeconds: 10,
      sizeBytes: 441000,
      bitRate: 1411200,
      tags: {},
    },
    stream: {
      codecName: 'pcm_s16le',
      codecLongName: 'PCM signed 16-bit little-endian',
      channels: 1,
      channelLayout: 'mono',
      sampleRate: 44100,
      bitDepth: 16,
      bitRate: 705600,
      durationSeconds: 10,
    },
  },
  loudness: { integratedLufs: -20, loudnessRange: 5, truePeakDbtp: -1 },
} satisfies AnalysisPayload;

function makeLiveSource(filename: string): ReportCardSource {
  return {
    filename,
    rms: -18,
    peak: -6,
    dynamicRange: null,
    clipping: false,
    centroid: 1200,
    bands: { subBass: -30, bass: -22, lowMid: -18, mid: -16, highMid: -18, presence: -20, brilliance: -24 },
  };
}

function renderMarkup(): string {
  return renderToString(createElement(ReportCardToolbar));
}

let mock: ReturnType<typeof createMockSoundBuddy>;

beforeEach(() => {
  mock = createMockSoundBuddy();
  mock.api.listAnalysisSummaries = vi.fn().mockResolvedValue({ success: true, summaries: [] });
  mock.api.saveAnalysisSummary = vi.fn().mockResolvedValue({ success: true, file: 'x.json' });
  (globalThis as { window?: unknown }).window = {
    soundBuddy: mock.api,
    grading: {
      computeGrade: () => 'A',
      computeScore: () => 95,
      analyzeRecordingType: () => ({ label: 'Full Mix' }),
      computeRecommendations: () => [],
      getGradingProfile: () => ({ label: 'Casual / volunteer' }),
    },
  };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.restoreAllMocks();
  useAnalysisStore.setState({
    currentAnalysis: null, liveSource: null, historySummary: null, status: 'idle', analysisError: null,
    prevSummary: null, lastSavedSummaryFile: null,
  });
  useSettingsStore.setState({ settings: null, settingsError: null });
  useSpectrumStore.setState({ panelState: 'empty', panelText: '' });
});

describe('ReportCardToolbar', () => {
  it('no card: every action disabled/hidden', () => {
    const html = renderMarkup();
    expect(html).toContain('id="reportcard-clear-btn"');
    expect(html).toMatch(/id="reportcard-clear-btn"[^>]*disabled=""/);
    expect(html).toMatch(/id="reportcard-share-btn"[^>]*disabled=""/);
    expect(html).toMatch(/id="reportcard-print-btn"[^>]*disabled=""/);
    expect(html).toMatch(/id="grade-own-btn"[^>]*disabled=""/);
  });

  it('file card: Clear enabled, Load hidden', () => {
    useAnalysisStore.setState({ currentAnalysis: ANALYSIS, status: 'done' });
    const html = renderMarkup();
    expect(html).not.toMatch(/id="reportcard-clear-btn"[^>]*disabled=""/);
    expect(html).toMatch(/id="reportcard-load-btn"[^>]*style="display:none"/);
    expect(html).not.toMatch(/id="reportcard-share-btn"[^>]*disabled=""/);
  });

  it('live card: Load visible, Clear stays disabled (no file to clear)', () => {
    useAnalysisStore.setState({ liveSource: makeLiveSource('Live capture') });
    const html = renderMarkup();
    expect(html).not.toMatch(/id="reportcard-load-btn"[^>]*style="display:none"/);
    expect(html).toMatch(/id="reportcard-clear-btn"[^>]*disabled=""/);
  });

  it('analyzing: Load and Clear both disabled', () => {
    useAnalysisStore.setState({ currentAnalysis: ANALYSIS, status: 'analyzing' });
    const html = renderMarkup();
    expect(html).toMatch(/id="reportcard-clear-btn"[^>]*disabled=""/);
    expect(html).toMatch(/id="reportcard-load-btn"[^>]*disabled=""/);
  });

  it('renders the icon + label content for every button', () => {
    const html = renderMarkup();
    expect(html).toContain('Clear');
    expect(html).toContain('Load a file…');
    expect(html).toContain('Send Feedback');
    expect(html).toContain('Share Image');
    expect(html).toContain('Export PDF');
    expect(html).toContain('Grade your own service');
  });
});

describe('applyStatusTransition', () => {
  it('analyzing: pauses playback and shows the loading panel', () => {
    const spy = vi.spyOn(spectrumTransport, 'pauseIfPlaying');
    applyStatusTransition('analyzing', null, null);
    expect(spy).toHaveBeenCalled();
    expect(useSpectrumStore.getState().panelState).toBe('loading');
  });

  it('error: shows the error panel with the stored message', () => {
    useAnalysisStore.setState({ analysisError: 'boom' });
    applyStatusTransition('error', null, null);
    expect(useSpectrumStore.getState().panelState).toBe('error');
    expect(useSpectrumStore.getState().panelText).toBe('boom');
  });

  it('error: falls back to a generic message with no stored error', () => {
    applyStatusTransition('error', null, null);
    expect(useSpectrumStore.getState().panelText).toBe('Analysis failed');
  });

  it('cancelled: returns to the empty panel', () => {
    applyStatusTransition('cancelled', null, null);
    expect(useSpectrumStore.getState().panelState).toBe('empty');
  });

  it('done: writes the file stats row via fileStatsRowView/patchStatsRow and persists the summary', async () => {
    // No DOM in this harness — the row lookup is guarded on element presence,
    // so absent #stats-row means the applier is skipped (still covered below).
    const statsRowEl = { querySelector: () => null };
    (globalThis as { document?: unknown }).document = {
      getElementById: (id: string) => (id === 'stats-row' ? statsRowEl : null),
    };
    applyStatusTransition('done', ANALYSIS, null);
    expect(fileStatsRowViewMock).toHaveBeenCalledWith(ANALYSIS.sox, ANALYSIS.spectrum);
    expect(patchStatsRowMock).toHaveBeenCalledWith(statsRowEl, expect.objectContaining({ centroid: '1,200' }));
    await vi.waitFor(() => expect(mock.api.saveAnalysisSummary).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'file', sourceFilename: 'service.wav' })
    ));
    delete (globalThis as { document?: unknown }).document;
  });

  it('done with no currentAnalysis: no-ops (defensive — should not happen in practice)', () => {
    applyStatusTransition('done', null, null);
    expect(mock.api.saveAnalysisSummary).not.toHaveBeenCalled();
  });

  it('idle: no-ops', () => {
    applyStatusTransition('idle', null, null);
    expect(mock.api.saveAnalysisSummary).not.toHaveBeenCalled();
  });
});
