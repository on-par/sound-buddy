// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import LiveStatsRow from './LiveStatsRow';
import { useSpectrumStore } from './stores/spectrumStore';
import { useAnalysisStore } from './stores/analysisStore';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import type { ChannelWindowData } from './live-capture-panel';

const FILE_ANALYSIS = {
  filePath: '/tmp/service.wav',
  sox: { rmsDbfs: -18, peakDbfs: -0.5, dynamicRangeDb: 12, clipping: false },
  spectrum: { spectralCentroid: 1200 },
} as never;

function liveChannels(): ChannelWindowData[] {
  return [
    { index: 0, name: 'Vocals', rms: -18, peak: -0.5, clipping: false, centroid: 2400, rolloff: 8000,
      bands: { sub_bass: -58, bass: -30, low_mid: -24, mid: -12, high_mid: -20, presence: -28, brilliance: -80 } },
    { index: 1, name: 'Band', rms: -22, peak: -9, clipping: false, centroid: 300, rolloff: 5000,
      bands: { sub_bass: -20, bass: -10, low_mid: -26, mid: -30, high_mid: -34, presence: -40, brilliance: -50 } },
  ];
}

beforeEach(() => {
  useSpectrumStore.setState({ panelState: 'empty', panelText: '' });
  useAnalysisStore.setState({ currentAnalysis: null });
  useLiveCaptureStore.setState({
    appMode: 'reportcard',
    isCapturing: false,
    lastTick: null,
    measurementSource: null,
    lastMeasurementChannels: null,
    secondaryMeasurement: { status: 'off', deviceName: '' },
    secondaryWindows: [],
  });
});

afterEach(() => {
  useSpectrumStore.setState({ panelState: 'empty', panelText: '' });
  useAnalysisStore.setState({ currentAnalysis: null });
  useLiveCaptureStore.setState({
    appMode: 'reportcard',
    isCapturing: false,
    lastTick: null,
    measurementSource: null,
    lastMeasurementChannels: null,
    secondaryMeasurement: { status: 'off', deviceName: '' },
    secondaryWindows: [],
  });
});

function renderMarkup(): string {
  return renderToString(createElement(LiveStatsRow));
}

describe('LiveStatsRow', () => {
  it('renders the five stat cells with the root-markup labels', () => {
    const html = renderMarkup();
    ['RMS', 'Peak', 'DR', 'Clip', 'Centroid'].forEach((label) => {
      expect(html).toContain(`<span class="stat-label">${label}</span>`);
    });
    ['stat-rms', 'stat-peak', 'stat-dr', 'stat-clip', 'stat-centroid'].forEach((id) => {
      expect(html).toContain(`id="${id}"`);
    });
  });

  it('file mode (populated) renders the fileStatsRowView values + tones', () => {
    useAnalysisStore.setState({ currentAnalysis: FILE_ANALYSIS });
    useSpectrumStore.setState({ panelState: 'populated' });
    const html = renderMarkup();
    expect(html).toContain('id="stat-rms">-18.0</span>');
    expect(html).toContain('id="stat-peak">-0.5</span>');
    expect(html).toContain('id="stat-dr">12.0</span>');
    expect(html).toContain('id="stat-clip">No</span>');
    expect(html).toContain('id="stat-centroid">1,200</span>');
    // Peak at -0.5 dBFS (> -1) tones issue.
    expect(html).toMatch(/class="stat-num issue" id="stat-peak"/);
  });

  it('live mode renders the snapshot Room channel values', () => {
    const channels = liveChannels();
    useLiveCaptureStore.setState({
      appMode: 'live',
      isCapturing: true,
      lastTick: { type: 'meter', ts: 0, channels } as never,
      lastLiveChannels: channels,
      measurementSource: null,
    });
    const html = renderMarkup();
    expect(html).toContain('id="stat-rms">-18.0</span>');
    expect(html).toContain('id="stat-peak">-0.5</span>');
    expect(html).toContain('id="stat-dr">—</span>');
    expect(html).toContain('id="stat-centroid">2,400</span>');
    expect(html).toMatch(/class="stat-num issue" id="stat-peak"/);
  });

  it('live mode reads the measurement-source strip, not channel 0', () => {
    const channels = liveChannels();
    useLiveCaptureStore.setState({
      appMode: 'live',
      isCapturing: true,
      lastTick: { type: 'meter', ts: 0, channels } as never,
      lastLiveChannels: channels,
      measurementSource: 1,
    });
    const html = renderMarkup();
    expect(html).toContain('id="stat-rms">-22.0</span>');
  });

  it('live mode reads the secondary device channel 0 when it is active (ADR-0003)', () => {
    const channels = liveChannels();
    useLiveCaptureStore.setState({
      appMode: 'live',
      isCapturing: true,
      lastTick: { type: 'meter', ts: 0, channels } as never,
      lastLiveChannels: channels,
      secondaryMeasurement: { status: 'active', deviceName: 'USB Mic' },
      secondaryWindows: [{ type: 'window', window: 1 } as never],
      lastMeasurementChannels: [{ ...channels[0], rms: -24, peak: -12, centroid: 900 }],
    });
    const html = renderMarkup();
    expect(html).toContain('id="stat-rms">-24.0</span>');
    expect(html).toContain('id="stat-centroid">900</span>');
  });

  it('renders — placeholders when no file analysis or live channel backs the row', () => {
    const html = renderMarkup();
    expect(html).toContain('id="stat-rms">—</span>');
    expect(html).toContain('id="stat-centroid">—</span>');
  });
});
