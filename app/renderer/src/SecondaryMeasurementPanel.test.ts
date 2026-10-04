// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import SecondaryMeasurementPanel, {
  selectSecondaryDevice,
  secondaryReconnectTick,
  secondaryCaptureOpts,
} from './SecondaryMeasurementPanel';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
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
    meterIntervalMs: INITIAL_LIVE_CAPTURE_STATE.meterIntervalMs,
    windowSecs: INITIAL_LIVE_CAPTURE_STATE.windowSecs,
    startSecondaryMeasurement: INITIAL_LIVE_CAPTURE_STATE.startSecondaryMeasurement,
    stopSecondaryMeasurement: INITIAL_LIVE_CAPTURE_STATE.stopSecondaryMeasurement,
    setSecondaryDeviceName: INITIAL_LIVE_CAPTURE_STATE.setSecondaryDeviceName,
    pollSecondaryReconnect: INITIAL_LIVE_CAPTURE_STATE.pollSecondaryReconnect,
  });
});

const DEVICES: LiveDevice[] = [
  { index: 0, name: 'Built-in Microphone', channels: 2, default_sr: 48000 },
  { index: 2, name: 'USB Mic', channels: 1, default_sr: 48000 },
];

function renderMarkup(): string {
  return renderToString(createElement(SecondaryMeasurementPanel));
}

describe('SecondaryMeasurementPanel', () => {
  it('renders the picker defaulted to None with no warning when no device is selected', () => {
    useLiveCaptureStore.setState({
      secondaryMeasurement: { status: 'off', deviceName: '' },
    });

    const html = renderMarkup();

    expect(html).toContain('id="secondary-measurement-device"');
    expect(html).not.toMatch(/<option value="[^"]+" selected>/);
    expect(html).toMatch(/id="secondary-measurement-warning"[^>]*><\/p>/);
  });

  it('renders no "(experimental)" copy anywhere in its markup', () => {
    const html = renderMarkup();
    expect(html).not.toContain('experimental');
  });

  it('shows the starting status text and the alignment warning while starting', () => {
    useLiveCaptureStore.setState({
      secondaryMeasurement: { status: 'starting', deviceName: 'USB Mic' },
      devices: DEVICES,
    });

    const html = renderMarkup();

    expect(html).toContain('Starting measurement source…');
    expect(html).toContain('This room source may not be time-aligned');
  });

  it('shows the active status text, the alignment warning, and resolves the select value to the device index', () => {
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
    useLiveCaptureStore.setState({
      secondaryMeasurement: { status: 'blocked', deviceName: 'USB Mic', micAccess: 'denied' },
      devices: DEVICES,
    });

    const html = renderMarkup();

    expect(html).toContain('Microphone access is blocked');
  });

  it('shows the disconnected status text', () => {
    useLiveCaptureStore.setState({
      secondaryMeasurement: { status: 'disconnected', deviceName: 'USB Mic' },
      devices: DEVICES,
    });

    const html = renderMarkup();

    expect(html).toContain('disconnected — reconnect the device to resume.');
  });

  describe('measurement-source quality hint (#461)', () => {
    it('renders no device hint when None is selected', () => {
      useLiveCaptureStore.setState({
        secondaryMeasurement: { status: 'off', deviceName: '' },
        devices: DEVICES,
      });

      expect(renderMarkup()).not.toContain('id="secondary-measurement-hint"');
    });

    it('cautions that a built-in computer microphone is not a calibrated measurement', () => {
      useLiveCaptureStore.setState({
        secondaryMeasurement: { status: 'active', deviceName: 'Built-in Microphone' },
        devices: DEVICES,
      });

      const html = renderMarkup();

      expect(html).toContain('id="secondary-measurement-hint"');
      expect(html).toContain('not a calibrated measurement');
    });

    it('marks a dedicated measurement mic as a stronger source', () => {
      useLiveCaptureStore.setState({
        secondaryMeasurement: { status: 'active', deviceName: 'USB Measurement Mic' },
        devices: DEVICES,
      });

      expect(renderMarkup()).toContain('stronger source');
    });

    it('labels an unrecognized external device with the external-input copy', () => {
      useLiveCaptureStore.setState({
        secondaryMeasurement: { status: 'active', deviceName: 'Scarlett 18i20' },
        devices: DEVICES,
      });

      expect(renderMarkup()).toContain('Fine for rough trends');
    });
  });

  describe('secondaryCaptureOpts (#725)', () => {
    it('reads the store cadence fields and converts ms to secs — no DOM stubbing needed', () => {
      useLiveCaptureStore.setState({ meterIntervalMs: 200, windowSecs: 5 });

      expect(secondaryCaptureOpts()).toEqual({ windowSecs: 5, intervalSecs: 0.2 });
    });
  });

  describe('secondaryReconnectTick', () => {
    it('resolves false and does not call pollSecondaryReconnect while the remembered device is still absent', async () => {
      const pollSecondaryReconnect = vi.fn().mockResolvedValue(false);
      useLiveCaptureStore.setState({
        secondaryMeasurement: { status: 'disconnected', deviceName: 'USB Measurement Mic' },
        pollSecondaryReconnect,
      });

      const restarted = await secondaryReconnectTick({ windowSecs: 3, intervalSecs: 0.1 });

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

      const restarted = await secondaryReconnectTick({ windowSecs: 3, intervalSecs: 0.1 });

      expect(restarted).toBe(true);
      expect(useLiveCaptureStore.getState().secondaryMeasurement.status).toBe('active');
    });

    it('resolves false without calling pollSecondaryReconnect when status is not disconnected', async () => {
      const pollSecondaryReconnect = vi.fn();
      useLiveCaptureStore.setState({
        secondaryMeasurement: { status: 'active', deviceName: 'USB Measurement Mic' },
        pollSecondaryReconnect,
      });

      const restarted = await secondaryReconnectTick({ windowSecs: 3, intervalSecs: 0.1 });

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
