// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import AnalyzeLiveEqPanel from './AnalyzeLiveEqPanel';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useAnalyzeEntryStore } from './stores/analyzeEntryStore';
import { useSpectrumStore } from './stores/spectrumStore';
import { ANALYZER_GRID_FREQS, type ChannelWindowData } from './live-capture-panel';
import type { IdealProfileLike } from './spectrum-display';

const ROOM_CH: ChannelWindowData = {
  index: 0, name: 'Room', rms: -30, peak: -12, clipping: false, centroid: 1000, rolloff: 0,
  bands: { sub_bass: -40, bass: -34, low_mid: -28, mid: -24, high_mid: -32, presence: -44, brilliance: -60 },
};

const GRID_ROOM_CH: ChannelWindowData = { ...ROOM_CH, curve: new Array(48).fill(-30) };

const PROFILE_A: IdealProfileLike = { id: 'flat', label: 'Flat / neutral', dbOffsets: new Array(48).fill(0) };
const PROFILE_B: IdealProfileLike = {
  id: 'speech', label: 'Speech clarity',
  dbOffsets: ANALYZER_GRID_FREQS.map((f) => (f > 1000 ? 3 : -2)),
};

function renderMarkup(): string {
  return renderToString(createElement(AnalyzeLiveEqPanel));
}

afterEach(() => {
  useAnalyzeEntryStore.setState({ listening: false });
  useLiveCaptureStore.setState({
    appMode: 'reportcard',
    secondaryMeasurement: { status: 'off', deviceName: '' },
    secondaryWindows: [],
    lastMeasurementChannels: null,
  });
  useSpectrumStore.setState({ idealProfile: null, isAutoProfile: false });
});

describe('AnalyzeLiveEqPanel (#1469, lc-06)', () => {
  it('renders nothing while not listening', () => {
    useAnalyzeEntryStore.setState({ listening: false });
    useLiveCaptureStore.setState({
      appMode: 'reportcard',
      secondaryMeasurement: { status: 'active', deviceName: 'MacBook Pro Microphone' },
      lastMeasurementChannels: [ROOM_CH],
    });

    expect(renderMarkup()).toBe('');
  });

  it('renders nothing on the Session (live) workspace, even while listening (AC2)', () => {
    useAnalyzeEntryStore.setState({ listening: true });
    useLiveCaptureStore.setState({
      appMode: 'live',
      secondaryMeasurement: { status: 'active', deviceName: 'MacBook Pro Microphone' },
      lastMeasurementChannels: [ROOM_CH],
    });

    expect(renderMarkup()).toBe('');
  });

  it('renders the room-mic EQ as the primary section once listening and connected', () => {
    useAnalyzeEntryStore.setState({ listening: true });
    useLiveCaptureStore.setState({
      appMode: 'reportcard',
      secondaryMeasurement: { status: 'active', deviceName: 'MacBook Pro Microphone' },
      lastMeasurementChannels: [ROOM_CH],
    });

    const html = renderMarkup();

    expect(html).toContain('eq-pane-primary');
    expect(html).toContain('Room — MacBook Pro Microphone');
    expect(html).toContain('analyze-live-eq-stop');
    expect(html).toContain('Stop listening');
    expect(html).toContain('id="analyze-live-eq-choose-file"');
    expect(html).toContain('Load file');
  });

  it('renders nothing (including the Load file button) while not listening', () => {
    useAnalyzeEntryStore.setState({ listening: false });
    useLiveCaptureStore.setState({
      appMode: 'reportcard',
      secondaryMeasurement: { status: 'off', deviceName: '' },
      lastMeasurementChannels: null,
    });

    expect(renderMarkup()).toBe('');
  });

  it('never renders LiveEqPane\'s docked-pane markup (AC2 — no reuse of the Session pane)', () => {
    useAnalyzeEntryStore.setState({ listening: true });
    useLiveCaptureStore.setState({
      appMode: 'reportcard',
      secondaryMeasurement: { status: 'active', deviceName: 'MacBook Pro Microphone' },
      lastMeasurementChannels: [ROOM_CH],
    });

    expect(renderMarkup()).not.toContain('eq-pane-inspector');
  });

  it('honestly reflects DISCONNECTED instead of freezing on the last reading (AC3)', () => {
    useAnalyzeEntryStore.setState({ listening: true });
    useLiveCaptureStore.setState({
      appMode: 'reportcard',
      secondaryMeasurement: { status: 'disconnected', deviceName: 'MacBook Pro Microphone' },
      lastMeasurementChannels: [ROOM_CH],
    });

    const html = renderMarkup();

    expect(html).toContain('disconnected');
    expect(html).not.toContain('class="veq"');
  });

  it('still offers a Stop listening control while showing a notice', () => {
    useAnalyzeEntryStore.setState({ listening: true });
    useLiveCaptureStore.setState({
      appMode: 'reportcard',
      secondaryMeasurement: { status: 'starting', deviceName: 'MacBook Pro Microphone' },
    });

    expect(renderMarkup()).toContain('analyze-live-eq-stop');
  });

  describe('#1497 ideal-curve overlay on the room arc', () => {
    it('draws the overlay and a legend naming the active profile', () => {
      useAnalyzeEntryStore.setState({ listening: true });
      useLiveCaptureStore.setState({
        appMode: 'reportcard',
        secondaryMeasurement: { status: 'active', deviceName: 'MacBook Pro Microphone' },
        lastMeasurementChannels: [GRID_ROOM_CH],
      });
      useSpectrumStore.setState({ idealProfile: PROFILE_A, isAutoProfile: false });

      const html = renderMarkup();

      expect(html).toContain('sb-target-line');
      expect(html).toContain('spectrum-legend');
      expect(html).toContain('Flat / neutral');
    });

    it('draws neither the overlay nor the legend when no profile is active', () => {
      useAnalyzeEntryStore.setState({ listening: true });
      useLiveCaptureStore.setState({
        appMode: 'reportcard',
        secondaryMeasurement: { status: 'active', deviceName: 'MacBook Pro Microphone' },
        lastMeasurementChannels: [GRID_ROOM_CH],
      });
      useSpectrumStore.setState({ idealProfile: null, isAutoProfile: false });

      const html = renderMarkup();

      expect(html).not.toContain('sb-target-line');
      expect(html).not.toContain('spectrum-legend');
    });

    it('re-renders a different overlay path when the selected profile changes (AC3)', () => {
      useAnalyzeEntryStore.setState({ listening: true });
      useLiveCaptureStore.setState({
        appMode: 'reportcard',
        secondaryMeasurement: { status: 'active', deviceName: 'MacBook Pro Microphone' },
        lastMeasurementChannels: [GRID_ROOM_CH],
      });

      useSpectrumStore.setState({ idealProfile: PROFILE_A, isAutoProfile: false });
      const firstD = renderMarkup().match(/<path class="sb-target-line" d="([^"]+)"/)?.[1];

      useSpectrumStore.setState({ idealProfile: PROFILE_B, isAutoProfile: false });
      const secondD = renderMarkup().match(/<path class="sb-target-line" d="([^"]+)"/)?.[1];

      expect(firstD).toBeTruthy();
      expect(secondD).toBeTruthy();
      expect(secondD).not.toBe(firstD);
    });

    it('suffixes the legend with " (auto)" when the profile was auto-resolved', () => {
      useAnalyzeEntryStore.setState({ listening: true });
      useLiveCaptureStore.setState({
        appMode: 'reportcard',
        secondaryMeasurement: { status: 'active', deviceName: 'MacBook Pro Microphone' },
        lastMeasurementChannels: [GRID_ROOM_CH],
      });
      useSpectrumStore.setState({ idealProfile: PROFILE_A, isAutoProfile: true });

      expect(renderMarkup()).toContain('(auto)');
    });

    it('still names the active profile in the legend when the channel only has the 7-band fallback curve', () => {
      useAnalyzeEntryStore.setState({ listening: true });
      useLiveCaptureStore.setState({
        appMode: 'reportcard',
        secondaryMeasurement: { status: 'active', deviceName: 'MacBook Pro Microphone' },
        lastMeasurementChannels: [ROOM_CH],
      });
      useSpectrumStore.setState({ idealProfile: PROFILE_A, isAutoProfile: false });

      const html = renderMarkup();

      expect(html).not.toContain('sb-target-line');
      expect(html).toContain('spectrum-legend');
      expect(html).toContain('Flat / neutral');
    });
  });
});
