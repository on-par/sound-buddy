// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import LiveSourceSettings, { changeDevice } from './LiveSourceSettings';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useSettingsStore } from './stores/settingsStore';
import type { LiveDevice, StripConfig } from './live-capture-panel';
import type { LiveCaptureRuntime } from './LiveControls';

// The pure classic scripts liveTransitionState/armState/groupState/rigKind/
// channelLabels — real modules (not hand-rolled stubs), same convention as
// liveCaptureStore.test.ts.
const liveTransitionState = require('../live-transition-state.js');
const armState = require('../arm-state.js');
const groupState = require('../group-state.js');
const rigKind = require('../rig-kind.js');
const channelLabels = require('../channel-labels.js');
const INITIAL_LIVE_CAPTURE_STATE = useLiveCaptureStore.getInitialState();

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { liveTransitionState, armState, groupState, rigKind, channelLabels };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useLiveCaptureStore.setState({
    devices: [], deviceHint: null, selectedDevice: '', channelConfig: [], measurementSource: null,
    liveMode: 'monitor', recordDir: '', isCapturing: false, promoting: false, stopping: false, demoting: false,
    startCapture: INITIAL_LIVE_CAPTURE_STATE.startCapture,
    stopCapture: INITIAL_LIVE_CAPTURE_STATE.stopCapture,
  });
  useSettingsStore.setState({ settings: null, settingsError: null });
});

const DEVICES: LiveDevice[] = [
  { index: 0, name: 'Scarlett 18i20', channels: 8, default_sr: 48000 },
];
const CONFIG: StripConfig[] = [{ kind: 'mono', a: 0, b: 1, label: 'Vocal' }];

function renderMarkup(): string {
  return renderToString(createElement(LiveSourceSettings));
}

describe('LiveSourceSettings', () => {
  it('renders the device select with a Default Device placeholder when no devices are loaded', () => {
    const html = renderMarkup();
    expect(html).toContain('id="device-select"');
    expect(html).toContain('Loading devices…');
  });

  it('renders real devices plus the Default Device option', () => {
    useLiveCaptureStore.setState({ devices: DEVICES });
    const html = renderMarkup();
    expect(html).toContain('<option value="" selected="">Default Device</option>');
    expect(html).toContain('Scarlett 18i20');
  });

  it('shows the device hint text when present', () => {
    useLiveCaptureStore.setState({ deviceHint: { text: 'No microphone or audio interface is connected.', isError: false } });
    const html = renderMarkup();
    expect(html).toContain('id="device-hint"');
    expect(html).toContain('No microphone or audio interface is connected.');
    expect(html).not.toContain('is-error');
  });

  it('flags an error device hint with the is-error class', () => {
    useLiveCaptureStore.setState({ deviceHint: { text: 'Blocked.', isError: true } });
    const html = renderMarkup();
    expect(html).toContain('class="device-hint is-error"');
  });

  it('renders measurement-source options from channelConfig, selecting the store value', () => {
    useLiveCaptureStore.setState({ channelConfig: CONFIG, measurementSource: 0 });
    const html = renderMarkup();
    expect(html).toContain('id="measurement-source"');
    expect(html).toContain('Vocal');
  });

  it('renders the board source-quality hint under the Measurement Source select (#461), capturing or not', () => {
    expect(renderMarkup()).toContain('id="measurement-source-hint"');
    expect(renderMarkup()).toContain('may already be EQ');

    useLiveCaptureStore.setState({ isCapturing: true });
    const locked = renderMarkup();
    expect(locked).toContain('id="measurement-source-hint"');
    expect(locked).toContain('may already be EQ');
  });

  it('always shows the record-folder row (#757 — the mode toggle that gated it is gone)', () => {
    expect(renderMarkup()).toContain('id="record-folder-row"');
    useLiveCaptureStore.setState({ liveMode: 'record' });
    expect(renderMarkup()).toContain('id="record-folder-row"');
  });

  it('shows the configured recordDir, falling back to the settings storageDir default', () => {
    useLiveCaptureStore.setState({ liveMode: 'record', recordDir: '/tmp/takes' });
    expect(renderMarkup()).toContain('/tmp/takes');

    useLiveCaptureStore.setState({ recordDir: '' });
    useSettingsStore.setState({ settings: { storageDir: '/Volumes/Audio' } as never });
    expect(renderMarkup()).toContain('/Volumes/Audio');

    useSettingsStore.setState({ settings: { storageDir: '' } as never });
    expect(renderMarkup()).toContain('~/Music/Sound Buddy');
  });

  it('keeps the input-device select enabled while capturing, but still locks refresh and record folder', () => {
    useLiveCaptureStore.setState({ isCapturing: true, liveMode: 'record' });
    const html = renderMarkup();
    const deviceSelect = html.match(/<select id="device-select"[^>]*>/)?.[0] ?? '';
    expect(deviceSelect).not.toContain(' disabled');
    expect(html).toMatch(/id="device-refresh-btn"[^>]*disabled=""/);
    expect(html).toMatch(/id="record-folder-btn"[^>]*disabled=""/);
  });

  it('does not disable the measurement-source select while capturing (#457: safe to switch mid-capture)', () => {
    useLiveCaptureStore.setState({ isCapturing: true, channelConfig: CONFIG, measurementSource: 0 });
    const html = renderMarkup();
    expect(html).not.toMatch(/id="measurement-source"[^>]*disabled/);
  });

  it('reflects the remaining locked controls as aria-disabled too', () => {
    const idle = renderMarkup();
    expect(idle).toMatch(/id="device-select"[^>]*aria-disabled="false"/);
    expect(idle).toMatch(/id="device-refresh-btn"[^>]*aria-disabled="false"/);
    expect(idle).toMatch(/id="record-folder-btn"[^>]*aria-disabled="false"/);

    useLiveCaptureStore.setState({ isCapturing: true });
    const locked = renderMarkup();
    expect(locked).toMatch(/id="device-select"[^>]*aria-disabled="false"/);
    expect(locked).toMatch(/id="device-refresh-btn"[^>]*aria-disabled="true"/);
    expect(locked).toMatch(/id="record-folder-btn"[^>]*aria-disabled="true"/);
  });
});

// changeDevice is tested directly here rather than by clicking a rendered
// select — LiveSourceSettings uses hooks internally, so calling the component
// function outside a React render throws "invalid hook call" (no jsdom in
// this harness to mount it for real); the click-path integration is covered
// by tests/e2e/live-capture.spec.ts.
describe('changeDevice', () => {
  function mockRuntime(): LiveCaptureRuntime {
    return {
      changeMeasurementSource: vi.fn(),
      chooseRecordFolder: vi.fn(async () => {}),
      beforeStartCapture: vi.fn(() => ({ ok: true }) as const),
      onCaptureStarting: vi.fn(),
      onCaptureStarted: vi.fn(),
      onCaptureStopping: vi.fn(),
      onCaptureStopped: vi.fn(),
      promoteToRecording: vi.fn(async () => {}),
      stopPlaybackIfRunning: vi.fn(async () => {}),
    };
  }

  it('writes the selection into the store, which re-seeds the config and clears the runtime selections (TD-001 slice 6h, #711)', async () => {
    const selectDevice = vi.spyOn(useLiveCaptureStore.getState(), 'selectDevice');

    await changeDevice('0');

    expect(selectDevice).toHaveBeenCalledWith('0');
  });

  it('stops a running capture, switches the selected input, then restarts with the current cadence', async () => {
    const order: string[] = [];
    const rt = mockRuntime();
    useLiveCaptureStore.setState({
      devices: DEVICES,
      selectedDevice: '',
      isCapturing: true,
      windowSecs: 5,
      meterIntervalMs: 250,
      stopCapture: vi.fn(async () => {
        order.push('stop');
        useLiveCaptureStore.setState({ isCapturing: false });
        return { success: true, sessionDir: null };
      }),
      startCapture: vi.fn(async (opts) => {
        order.push(`start:${opts.windowSecs}/${opts.intervalSecs}`);
        useLiveCaptureStore.setState({ isCapturing: true });
        return { success: true };
      }),
    });

    await changeDevice('0', rt);

    expect(order).toEqual(['stop', 'start:5/0.25']);
    expect(useLiveCaptureStore.getState().selectedDevice).toBe('0');
    expect(useLiveCaptureStore.getState().isCapturing).toBe(true);
    expect(rt.onCaptureStopping).toHaveBeenCalledTimes(1);
    expect(rt.onCaptureStarting).toHaveBeenCalledTimes(1);
  });
});
