// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import SecondaryMeasurementPanel, {
  selectSecondaryDevice,
  secondaryReconnectTick,
} from './SecondaryMeasurementPanel';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useSettingsStore } from './stores/settingsStore';
import type { LiveDevice } from './live-capture-panel';

const INITIAL_LIVE_CAPTURE_STATE = useLiveCaptureStore.getInitialState();

beforeEach(() => {
  // window.liveCaptureRuntime.afterSecondaryMeasurementChange is optional
  // (`?.()`) — an empty window object is enough for these tests, which don't
  // assert on that repaint call itself.
  (globalThis as { window?: unknown }).window = {};
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useLiveCaptureStore.setState({
    devices: [],
    secondaryMeasurement: { status: 'off', deviceName: '' },
    startSecondaryMeasurement: INITIAL_LIVE_CAPTURE_STATE.startSecondaryMeasurement,
    stopSecondaryMeasurement: INITIAL_LIVE_CAPTURE_STATE.stopSecondaryMeasurement,
    setSecondaryDeviceName: INITIAL_LIVE_CAPTURE_STATE.setSecondaryDeviceName,
    pollSecondaryReconnect: INITIAL_LIVE_CAPTURE_STATE.pollSecondaryReconnect,
  });
  useSettingsStore.setState({ settings: null, settingsError: null });
});

const DEVICES: LiveDevice[] = [
  { index: 0, name: 'Built-in Microphone', channels: 2, default_sr: 48000 },
  { index: 2, name: 'USB Mic', channels: 1, default_sr: 48000 },
];

function renderMarkup(): string {
  return renderToString(createElement(SecondaryMeasurementPanel));
}

describe('SecondaryMeasurementPanel', () => {
  it('renders nothing when secondaryMeasurementEnabled is off', () => {
    useSettingsStore.setState({ settings: { secondaryMeasurementEnabled: false } as never });
    expect(renderMarkup()).toBe('');
  });

  it('renders nothing when settings have not loaded yet', () => {
    useSettingsStore.setState({ settings: null });
    expect(renderMarkup()).toBe('');
  });

  it('shows the starting status text and the alignment warning while starting', () => {
    useSettingsStore.setState({ settings: { secondaryMeasurementEnabled: true } as never });
    useLiveCaptureStore.setState({
      secondaryMeasurement: { status: 'starting', deviceName: 'USB Mic' },
      devices: DEVICES,
    });

    const html = renderMarkup();

    expect(html).toContain('Starting measurement source…');
    expect(html).toContain('This room source may not be time-aligned');
  });

  it('shows the active status text, the alignment warning, and resolves the select value to the device index', () => {
    useSettingsStore.setState({ settings: { secondaryMeasurementEnabled: true } as never });
    useLiveCaptureStore.setState({
      secondaryMeasurement: { status: 'active', deviceName: 'USB Mic' },
      devices: DEVICES,
    });

    const html = renderMarkup();

    expect(html).toContain('Measuring room via');
    expect(html).toContain('USB Mic');
    expect(html).toContain('This room source may not be time-aligned');
    expect(html).toMatch(/<option value="2" selected>USB Mic<\/option>/);
  });

  it('shows the blocked status text', () => {
    useSettingsStore.setState({ settings: { secondaryMeasurementEnabled: true } as never });
    useLiveCaptureStore.setState({
      secondaryMeasurement: { status: 'blocked', deviceName: 'USB Mic', micAccess: 'denied' },
      devices: DEVICES,
    });

    const html = renderMarkup();

    expect(html).toContain('Microphone access is blocked');
  });

  it('shows the disconnected status text', () => {
    useSettingsStore.setState({ settings: { secondaryMeasurementEnabled: true } as never });
    useLiveCaptureStore.setState({
      secondaryMeasurement: { status: 'disconnected', deviceName: 'USB Mic' },
      devices: DEVICES,
    });

    const html = renderMarkup();

    expect(html).toContain('disconnected — reconnect the device to resume.');
  });

  describe('secondaryReconnectTick', () => {
    it('resolves false and does not call pollSecondaryReconnect while the remembered device is still absent', async () => {
      const pollSecondaryReconnect = vi.fn().mockResolvedValue(false);
      useLiveCaptureStore.setState({
        secondaryMeasurement: { status: 'disconnected', deviceName: 'USB Measurement Mic' },
        pollSecondaryReconnect,
      });

      const restarted = await secondaryReconnectTick(true, { windowSecs: 3, intervalSecs: 0.1 });

      expect(restarted).toBe(false);
      expect(pollSecondaryReconnect).toHaveBeenCalledWith({ windowSecs: 3, intervalSecs: 0.1 });
    });

    it('resolves true and ends active once the remembered device reappears', async () => {
      const pollSecondaryReconnect = vi.fn().mockImplementation(async () => {
        useLiveCaptureStore.setState((s) => ({
          secondaryMeasurement: { status: 'active', deviceName: s.secondaryMeasurement.deviceName },
        }));
        return true;
      });
      useLiveCaptureStore.setState({
        secondaryMeasurement: { status: 'disconnected', deviceName: 'USB Measurement Mic' },
        pollSecondaryReconnect,
      });

      const restarted = await secondaryReconnectTick(true, { windowSecs: 3, intervalSecs: 0.1 });

      expect(restarted).toBe(true);
      expect(useLiveCaptureStore.getState().secondaryMeasurement.status).toBe('active');
    });

    it('resolves false without calling pollSecondaryReconnect when the flag is off', async () => {
      const pollSecondaryReconnect = vi.fn();
      useLiveCaptureStore.setState({
        secondaryMeasurement: { status: 'disconnected', deviceName: 'USB Measurement Mic' },
        pollSecondaryReconnect,
      });

      const restarted = await secondaryReconnectTick(false, { windowSecs: 3, intervalSecs: 0.1 });

      expect(restarted).toBe(false);
      expect(pollSecondaryReconnect).not.toHaveBeenCalled();
    });

    it('resolves false without calling pollSecondaryReconnect when status is not disconnected', async () => {
      const pollSecondaryReconnect = vi.fn();
      useLiveCaptureStore.setState({
        secondaryMeasurement: { status: 'active', deviceName: 'USB Measurement Mic' },
        pollSecondaryReconnect,
      });

      const restarted = await secondaryReconnectTick(true, { windowSecs: 3, intervalSecs: 0.1 });

      expect(restarted).toBe(false);
      expect(pollSecondaryReconnect).not.toHaveBeenCalled();
    });
  });

  describe('selectSecondaryDevice', () => {
    it('picking None stops the stream and clears the device name', async () => {
      const stopSecondaryMeasurement = vi.fn().mockResolvedValue(undefined);
      const setSecondaryDeviceName = vi.fn();
      useLiveCaptureStore.setState({ stopSecondaryMeasurement, setSecondaryDeviceName });

      await selectSecondaryDevice('', DEVICES, { windowSecs: 3, intervalSecs: 0.1 });

      expect(stopSecondaryMeasurement).toHaveBeenCalled();
      expect(setSecondaryDeviceName).toHaveBeenCalledWith('');
    });

    it('picking a device sets its name and starts the stream with the exact opts passed in', async () => {
      const startSecondaryMeasurement = vi.fn().mockResolvedValue(undefined);
      const setSecondaryDeviceName = vi.fn();
      useLiveCaptureStore.setState({ startSecondaryMeasurement, setSecondaryDeviceName });
      const opts = { windowSecs: 5, intervalSecs: 0.2 };

      await selectSecondaryDevice('2', DEVICES, opts);

      expect(setSecondaryDeviceName).toHaveBeenCalledWith('USB Mic');
      expect(startSecondaryMeasurement).toHaveBeenCalledWith(opts);
    });
  });
});
