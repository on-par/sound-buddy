// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import LiveControls, { LiveTransportControls, startLiveCapture, stopLiveCapture, recordCapture, changeDevice, type LiveCaptureRuntime } from './LiveControls';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useSettingsStore } from './stores/settingsStore';
import type { LiveDevice, StripConfig } from './live-capture-panel';

// The pure classic scripts liveTransitionState/armState/groupState/rigKind/
// channelLabels — real modules (not hand-rolled stubs), same convention as
// liveCaptureStore.test.ts.
const liveTransitionState = require('../live-transition-state.js');
const armState = require('../arm-state.js');
const groupState = require('../group-state.js');
const rigKind = require('../rig-kind.js');
const channelLabels = require('../channel-labels.js');

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { liveTransitionState, armState, groupState, rigKind, channelLabels };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useLiveCaptureStore.setState({
    devices: [], deviceHint: null, selectedDevice: '', channelConfig: [], measurementSource: null,
    liveMode: 'monitor', recordDir: '', isCapturing: false, promoting: false,
  });
  useSettingsStore.setState({ settings: null, settingsError: null });
});

const DEVICES: LiveDevice[] = [
  { index: 0, name: 'Scarlett 18i20', channels: 8, default_sr: 48000 },
];
const CONFIG: StripConfig[] = [{ kind: 'mono', a: 0, b: 1, label: 'Vocal' }];

function renderMarkup(): string {
  return renderToString(createElement(LiveControls));
}

function renderTransportMarkup(): string {
  return renderToString(createElement(LiveTransportControls));
}

describe('LiveControls', () => {
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

  it('marks the active mode button from liveMode', () => {
    useLiveCaptureStore.setState({ liveMode: 'record' });
    const html = renderMarkup();
    expect(html).toMatch(/data-mode="record" class="active"/);
    expect(html).not.toMatch(/data-mode="monitor" class="active"/);
  });

  it('shows the record-folder row only in record mode', () => {
    expect(renderMarkup()).toContain('id="record-folder-row" style="display:none"');
    useLiveCaptureStore.setState({ liveMode: 'record' });
    expect(renderMarkup()).toContain('id="record-folder-row" style="display:flex"');
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

  it('disables device/mode/record-folder controls while capturing', () => {
    useLiveCaptureStore.setState({ isCapturing: true, liveMode: 'record' });
    const html = renderMarkup();
    expect(html).toMatch(/id="device-select"[^>]*disabled=""/);
    expect(html).toMatch(/id="device-refresh-btn"[^>]*disabled=""/);
    expect(html).toMatch(/data-mode="monitor"[^>]*disabled=""/);
    expect(html).toMatch(/id="record-folder-btn"[^>]*disabled=""/);
  });

  it('reflects the lock as aria-disabled too (tests/rigs.spec.ts checks both, since the workspace toolbar bakes in `disabled` on rebuild without aria-disabled)', () => {
    const idle = renderMarkup();
    expect(idle).toMatch(/id="device-select"[^>]*aria-disabled="false"/);
    expect(idle).toMatch(/id="device-refresh-btn"[^>]*aria-disabled="false"/);
    expect(idle).toMatch(/id="record-folder-btn"[^>]*aria-disabled="false"/);

    useLiveCaptureStore.setState({ isCapturing: true });
    const locked = renderMarkup();
    expect(locked).toMatch(/id="device-select"[^>]*aria-disabled="true"/);
    expect(locked).toMatch(/id="device-refresh-btn"[^>]*aria-disabled="true"/);
    expect(locked).toMatch(/id="record-folder-btn"[^>]*aria-disabled="true"/);
  });
});

describe('LiveTransportControls', () => {
  it('shows Start Capture (not Stop) while idle', () => {
    const html = renderTransportMarkup();
    expect(html).toContain('id="live-start-btn" style="display:inline-flex"');
    expect(html).toContain('id="live-stop-btn" style="display:none"');
  });

  it('shows Stop Capture (not Start) while capturing, and hides the record button in record mode', () => {
    useLiveCaptureStore.setState({ isCapturing: true, liveMode: 'record' });
    const html = renderTransportMarkup();
    expect(html).toContain('id="live-start-btn" style="display:none"');
    expect(html).toContain('id="live-stop-btn" style="display:inline-flex"');
    expect(html).not.toContain('id="live-record-btn"');
  });

  it('shows the Start Recording button while monitoring', () => {
    useLiveCaptureStore.setState({ isCapturing: true, liveMode: 'monitor' });
    const html = renderTransportMarkup();
    expect(html).toContain('id="live-record-btn"');
    expect(html).toContain('Start Recording');
  });

  it('shows a disabled Starting… record button mid-promotion', () => {
    useLiveCaptureStore.setState({ isCapturing: true, liveMode: 'monitor', promoting: true });
    const html = renderTransportMarkup();
    expect(html).toContain('id="live-record-btn"');
    expect(html).toMatch(/id="live-record-btn" disabled=""/);
    expect(html).toContain('Starting…');
  });
});

// Extracted handlers (startLiveCapture/stopLiveCapture/recordCapture/
// changeDevice) are tested directly here rather than by clicking rendered
// buttons — LiveControls uses hooks internally, so calling the component
// function outside a React render throws "invalid hook call" (no jsdom in
// this harness to mount it for real); the click-path integration is covered
// by tests/e2e/live-capture.spec.ts.
describe('startLiveCapture / stopLiveCapture / recordCapture / changeDevice', () => {
  function mockRuntime(overrides: Partial<LiveCaptureRuntime> = {}): LiveCaptureRuntime {
    return {
      loadDevices: vi.fn(async () => {}),
      selectDevice: vi.fn(),
      changeMeasurementSource: vi.fn(),
      chooseRecordFolder: vi.fn(async () => {}),
      beforeStartCapture: vi.fn(() => ({ ok: true }) as const),
      onCaptureStarting: vi.fn(),
      onCaptureStarted: vi.fn(),
      onCaptureStopping: vi.fn(),
      onCaptureStopped: vi.fn(),
      promoteToRecording: vi.fn(async () => {}),
      ...overrides,
    };
  }

  it('startLiveCapture bails out without touching the store when beforeStartCapture blocks it', async () => {
    const rt = mockRuntime({ beforeStartCapture: vi.fn(() => ({ ok: false, reason: 'Add at least one track before starting capture.' })) });
    const startCapture = vi.spyOn(useLiveCaptureStore.getState(), 'startCapture');

    await startLiveCapture(rt, 3, 0.1);

    expect(startCapture).not.toHaveBeenCalled();
    expect(rt.onCaptureStarting).not.toHaveBeenCalled();
    expect(rt.onCaptureStarted).not.toHaveBeenCalled();
  });

  it('startLiveCapture calls onCaptureStarting synchronously before the IPC result resolves, then onCaptureStarted with the result + rate', async () => {
    const order: string[] = [];
    const rt = mockRuntime({
      onCaptureStarting: vi.fn(() => order.push('starting')),
      onCaptureStarted: vi.fn(() => order.push('started')),
    });
    useLiveCaptureStore.setState({
      // Mirrors the real action's shape: synchronous prelude (none needed
      // here), then an actual await point (the real store awaits the IPC
      // call) before continuing — a fake with no await would run to
      // completion before startLiveCapture ever gets to call
      // onCaptureStarting(), which is exactly the ordering bug this test
      // guards against.
      startCapture: vi.fn(async (opts) => {
        await Promise.resolve();
        order.push('ipc:' + JSON.stringify(opts));
        return { success: true };
      }),
    });

    await startLiveCapture(rt, 3, 0.1);

    expect(order).toEqual(['starting', 'ipc:{"windowSecs":3,"intervalSecs":0.1}', 'started']);
    expect(rt.onCaptureStarted).toHaveBeenCalledWith({ success: true }, 10);
  });

  it('stopLiveCapture calls onCaptureStopping before the IPC result resolves, then onCaptureStopped', async () => {
    const order: string[] = [];
    const rt = mockRuntime({
      onCaptureStopping: vi.fn(() => order.push('stopping')),
      onCaptureStopped: vi.fn(() => order.push('stopped')),
    });
    useLiveCaptureStore.setState({
      stopCapture: vi.fn(async () => {
        await Promise.resolve();
        order.push('ipc');
        return { success: true, sessionDir: '/tmp/session' };
      }),
    });

    await stopLiveCapture(rt);

    expect(order).toEqual(['stopping', 'ipc', 'stopped']);
    expect(rt.onCaptureStopped).toHaveBeenCalledWith({ success: true, sessionDir: '/tmp/session' });
  });

  it('recordCapture delegates to the bridged promoteToRecording', async () => {
    const rt = mockRuntime();
    await recordCapture(rt);
    expect(rt.promoteToRecording).toHaveBeenCalledTimes(1);
  });

  it('recordCapture is a safe no-op when no runtime is bridged yet', async () => {
    await expect(recordCapture(undefined)).resolves.toBeUndefined();
  });

  it('changeDevice writes the selection into the store and delegates the re-seed to the runtime', () => {
    const rt = mockRuntime();
    const selectDevice = vi.spyOn(useLiveCaptureStore.getState(), 'selectDevice');

    changeDevice(rt, '0');

    expect(selectDevice).toHaveBeenCalledWith('0');
    expect(rt.selectDevice).toHaveBeenCalledWith('0');
  });
});
