// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import LiveEqPane from './LiveEqPane';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { eqPaneHTML, eqPaneView, type StripConfig, type LiveMeterChannel, type ChannelWindowData } from './live-capture-panel';
import { idleChannelsFor } from './live-board';

// window.trackWorkspace is the one classic script LiveEqPane's render reads
// (idleChannelsFor). Real module, same convention as live-board.test.ts.
const trackWorkspace = require('../track-workspace.js');
const LIVE_BAND_KEYS = ['sub_bass', 'bass', 'low_mid', 'mid', 'high_mid', 'presence', 'brilliance'];

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { trackWorkspace };
  useLiveCaptureStore.setState({
    appMode: 'live',
    isCapturing: false,
    channelConfig: [{ kind: 'mono', a: 0, b: 1 }, { kind: 'mono', a: 1, b: 2 }] as StripConfig[],
    selectedChannel: null,
    measurementSource: null,
    lastTick: null,
    lastLiveChannels: null,
    secondaryMeasurement: { status: 'off', deviceName: '' },
    secondaryWindows: [],
    lastMeasurementChannels: null,
    boardShapeVersion: 0,
  });
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useLiveCaptureStore.setState({
    appMode: 'reportcard',
    isCapturing: false,
    channelConfig: [],
    selectedChannel: null,
    measurementSource: null,
    lastTick: null,
    lastLiveChannels: null,
    secondaryMeasurement: { status: 'off', deviceName: '' },
    secondaryWindows: [],
    lastMeasurementChannels: null,
    boardShapeVersion: 0,
  });
});

const CONFIG: StripConfig[] = [{ kind: 'mono', a: 0, b: 1 }, { kind: 'mono', a: 1, b: 2 }];

function tickChannels(): ChannelWindowData[] {
  return [
    { index: 0, name: 'Vocals', rms: -18, peak: -6, clipping: false, centroid: 2400, rolloff: 8000,
      bands: { sub_bass: -58, bass: -30, low_mid: -24, mid: -12, high_mid: -20, presence: -28, brilliance: -80 } },
    { index: 1, name: 'Band', rms: -22, peak: -9, clipping: false, centroid: 300, rolloff: 5000,
      bands: { sub_bass: -20, bass: -10, low_mid: -26, mid: -30, high_mid: -34, presence: -40, brilliance: -50 } },
  ];
}

function renderMarkup(): string {
  return renderToString(createElement(LiveEqPane));
}

function idleChannels(config: StripConfig[]): LiveMeterChannel[] {
  return config.map(() => trackWorkspace.idleChannel(LIVE_BAND_KEYS));
}

describe('LiveEqPane', () => {
  it('renders the Room section from the idle placeholder channels while idle (markup identity with eqPaneHTML)', () => {
    const html = renderMarkup();
    const channels = idleChannels(CONFIG);
    const expected = eqPaneHTML(eqPaneView(channels, CONFIG, null, null, null));
    expect(html).toContain(expected);
    expect(html).toContain('Room — Track 1');
    expect(html).toContain('eq-pane-empty-hint');
  });

  it('renders the tick snapshot channels while capturing (markup identity)', () => {
    const channels = tickChannels();
    useLiveCaptureStore.setState({
      isCapturing: true,
      lastTick: { type: 'meter', ts: 0, channels } as never,
      lastLiveChannels: channels,
      boardShapeVersion: 1,
    });
    const html = renderMarkup();
    const expected = eqPaneHTML(eqPaneView(channels, CONFIG, null, null, null));
    expect(html).toContain(expected);
    expect(html).toContain('Room — Track 1');
  });

  it('adds the Selected section once a strip is clicked (#668)', () => {
    const channels = tickChannels();
    useLiveCaptureStore.setState({
      isCapturing: true,
      lastTick: { type: 'meter', ts: 0, channels } as never,
      lastLiveChannels: channels,
      selectedChannel: 1,
      boardShapeVersion: 1,
    });
    const html = renderMarkup();
    const expected = eqPaneHTML(eqPaneView(channels, CONFIG, null, 1, null));
    expect(html).toContain(expected);
    expect(html).toContain('Selected — Track 2');
  });

  it('swaps the Room primary slot to the secondary device when it is active (#460)', () => {
    const channels = tickChannels();
    useLiveCaptureStore.setState({
      isCapturing: true,
      lastTick: { type: 'meter', ts: 0, channels } as never,
      lastLiveChannels: channels,
      secondaryMeasurement: { status: 'active', deviceName: 'USB Measurement Mic' },
      secondaryWindows: [{ type: 'window', window: 1 } as never],
      lastMeasurementChannels: [channels[0]],
      boardShapeVersion: 1,
    });
    const html = renderMarkup();
    // Room slot now reads the secondary device's channel 0 + device name.
    expect(html).toContain('Room — USB Measurement Mic');
    const expected = eqPaneHTML(eqPaneView(channels, CONFIG, null, null, {
      ch: channels[0],
      label: 'USB Measurement Mic',
    }));
    expect(html).toContain(expected);
  });

  it('renders the empty-state hint when no channels exist at all', () => {
    useLiveCaptureStore.setState({ channelConfig: [] });
    const html = renderMarkup();
    expect(html).toContain('eq-pane-empty-hint');
    expect(html).toContain('Click a channel to inspect it here');
    expect(html).not.toContain('eq-pane-primary');
  });
});
