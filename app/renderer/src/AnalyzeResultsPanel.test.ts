// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import AnalyzeResultsPanel from './AnalyzeResultsPanel';
import { useAnalysisStore } from './stores/analysisStore';
import { useAnalyzeEntryStore } from './stores/analyzeEntryStore';
import { ElectronContext } from './useElectron';
import { createMockSoundBuddy } from './mock-sound-buddy';
import type { ReportCardSource, RecordingType } from './report-card';
import type { AnalysisPayload } from '@sound-buddy/shared';

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

beforeEach(() => {
  (globalThis as { window?: unknown }).window = {
    grading: {
      computeGrade: () => 'B',
      computeScore: () => 82,
      analyzeRecordingType: () => REC_TYPE,
      computeRecommendations: () => ['Tighten the low mid', 'CRITICAL: Check for phase issues'],
      getGradingProfile: () => ({ label: 'Casual' }),
    },
  };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useAnalysisStore.setState({ currentAnalysis: null, liveSource: null, lastSavedSummaryFile: null });
  useAnalyzeEntryStore.setState({ listening: false, analyzeStage: false });
});

function renderMarkup(): string {
  const mock = createMockSoundBuddy();
  return renderToString(
    createElement(ElectronContext.Provider, { value: mock.api }, createElement(AnalyzeResultsPanel))
  );
}

describe('AnalyzeResultsPanel (#1487)', () => {
  it('shows an idle empty state with no analysis and not listening', () => {
    const html = renderMarkup();

    expect(html).toContain('id="arc-empty"');
    expect(html).toContain('Load a file or start listening');
  });

  it('shows a listening empty state with no analysis while listening', () => {
    useAnalyzeEntryStore.setState({ listening: true });

    const html = renderMarkup();

    expect(html).toContain('id="arc-empty"');
    expect(html).toContain('Listening');
  });

  it('folds a completed file analysis into the grade ring, rec-type pill, and recommendations', () => {
    useAnalysisStore.setState({ currentAnalysis: ANALYSIS });

    const html = renderMarkup();

    expect(html).toContain('id="arc-content"');
    expect(html).toContain('id="arc-ring"');
    expect(html).toContain('id="arc-rec-type"');
    expect(html).toContain('Full mix');
    expect(html).toContain('id="arc-recommendations"');
    expect(html).toContain('Tighten the low mid');
    expect(html).toContain('Casual');
  });

  it('falls back to the live source when there is no file analysis', () => {
    useAnalysisStore.setState({ liveSource: makeLiveSource('live.wav') });

    const html = renderMarkup();

    expect(html).toContain('id="arc-content"');
  });

  it('never renders an rc-* id — only arc-* ids, so ReportCardIsland never gets a duplicate DOM id', () => {
    useAnalysisStore.setState({ currentAnalysis: ANALYSIS });

    expect(renderMarkup()).not.toContain('id="rc-');
  });

  it('disables the handoff note input until a save has landed (no file to patch yet)', () => {
    useAnalysisStore.setState({ currentAnalysis: ANALYSIS, lastSavedSummaryFile: null });

    const html = renderMarkup();

    expect(html).toContain('id="arc-note-input"');
    expect(html).toMatch(/id="arc-note-input"[^>]*disabled/);
  });

  it('enables the handoff note input once a save has landed', () => {
    useAnalysisStore.setState({ currentAnalysis: ANALYSIS, lastSavedSummaryFile: 'summary-1.json' });

    const html = renderMarkup();

    expect(html).not.toMatch(/id="arc-note-input"[^>]*disabled/);
  });
});
