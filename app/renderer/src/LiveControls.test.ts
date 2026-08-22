// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { startLiveCapture, stopLiveCapture, stopCaptureIfRunning, recordCapture, stopPlaybackIfRunning, type LiveCaptureRuntime } from './LiveControls';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useSettingsStore } from './stores/settingsStore';

// The pure classic scripts liveTransitionState/armState/groupState/rigKind/
// channelLabels — real modules (not hand-rolled stubs), same convention as
// liveCaptureStore.test.ts.
const liveTransitionState = require('../live-transition-state.js');
const armState = require('../arm-state.js');
const groupState = require('../group-state.js');
const rigKind = require('../rig-kind.js');
const channelLabels = require('../channel-labels.js');

// The store's real actions, captured once so afterEach can restore any
// startCapture/stopCapture a test stubbed out — otherwise a leftover mock's
// call history leaks into a later test's vi.spyOn on the same property.
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

// Extracted handlers (startLiveCapture/stopLiveCapture/recordCapture) are
// tested directly here — the old LiveControls/LiveTransportControls
// components are gone (#757), so there are no rendered buttons to click;
// the click-path integration is covered by tests/e2e/live-capture.spec.ts.
// changeDevice moved to LiveSourceSettings.test.ts (#727) along with the
// component it now backs.
describe('startLiveCapture / stopLiveCapture / recordCapture', () => {
  function mockRuntime(overrides: Partial<LiveCaptureRuntime> = {}): LiveCaptureRuntime {
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

  it('stopLiveCapture flips the store\'s stopping flag true before stopCapture() and false after the IPC result resolves (#729)', async () => {
    const order: string[] = [];
    const rt = mockRuntime({
      onCaptureStopping: vi.fn(() => order.push('bridge:onCaptureStopping')),
      onCaptureStopped: vi.fn(() => order.push('bridge:onCaptureStopped')),
    });
    useLiveCaptureStore.setState({
      stopCapture: vi.fn(async () => {
        order.push('ipc:stopping=' + useLiveCaptureStore.getState().stopping);
        await Promise.resolve();
        return { success: true, sessionDir: null };
      }),
    });

    expect(useLiveCaptureStore.getState().stopping).toBe(false);
    const stopPromise = stopLiveCapture(rt);
    expect(useLiveCaptureStore.getState().stopping).toBe(true);
    await stopPromise;

    expect(order).toEqual(['ipc:stopping=true', 'bridge:onCaptureStopping', 'bridge:onCaptureStopped']);
    expect(useLiveCaptureStore.getState().stopping).toBe(false);
  });

  // #776: the Live tab is always-monitoring (ADR-0014) — a record stop must
  // demote back to a live monitor session (Record button idle, meters running)
  // instead of fully ending capture. The exact call order pins the ceremony:
  // stop IPC → onCaptureStopping → onCaptureStopped → resume flag →
  // beforeStartCapture → start IPC → onCaptureStarting → onCaptureStarted.
  it('stopLiveCapture stops a recording then resumes monitoring, keeping the board live (#776)', async () => {
    const order: string[] = [];
    const rt = mockRuntime({
      onCaptureStopping: vi.fn(() => order.push('stopping')),
      onCaptureStopped: vi.fn(() => order.push('stopped')),
      onResumeMonitoringStart: vi.fn(() => order.push('resume-flag')),
      beforeStartCapture: vi.fn(() => {
        order.push('before');
        return { ok: true } as const;
      }),
      onCaptureStarting: vi.fn(() => order.push('starting')),
      onCaptureStarted: vi.fn(() => order.push('started')),
    });
    useLiveCaptureStore.setState({
      liveMode: 'record',
      isCapturing: true,
      windowSecs: 3,
      meterIntervalMs: 100,
      stopCapture: vi.fn(async () => {
        useLiveCaptureStore.setState({ isCapturing: false });
        order.push('ipc-stop');
        await Promise.resolve();
        return { success: true, sessionDir: '/tmp/session' };
      }),
      startCapture: vi.fn(async () => {
        useLiveCaptureStore.setState({ isCapturing: true });
        order.push('ipc-start');
        await Promise.resolve();
        return { success: true };
      }),
    });

    await stopLiveCapture(rt);

    expect(order).toEqual(['ipc-stop', 'stopping', 'stopped', 'resume-flag', 'before', 'ipc-start', 'starting', 'started']);
    expect(useLiveCaptureStore.getState().liveMode).toBe('monitor');
    expect(useLiveCaptureStore.getState().isCapturing).toBe(true);
    expect(useLiveCaptureStore.getState().stopping).toBe(false);
    expect(rt.onCaptureStopped).toHaveBeenCalledWith({ success: true, sessionDir: '/tmp/session' });
    expect(rt.onResumeMonitoringStart).toHaveBeenCalledTimes(1);
  });

  it('preserves monitor mute and solo maps when a recording resumes monitoring (#1058)', async () => {
    const rt = mockRuntime();
    const mutedChannels = { 0: true, 2: true };
    const soloedChannels = { 1: true };
    useLiveCaptureStore.setState({
      liveMode: 'record',
      isCapturing: true,
      windowSecs: 3,
      meterIntervalMs: 100,
      mutedChannels,
      soloedChannels,
      stopCapture: vi.fn(async () => {
        useLiveCaptureStore.setState({ isCapturing: false });
        return { success: true, sessionDir: '/tmp/session' };
      }),
      startCapture: vi.fn(async () => {
        useLiveCaptureStore.setState({ isCapturing: true });
        return { success: true };
      }),
    });

    await stopLiveCapture(rt);

    expect(useLiveCaptureStore.getState().liveMode).toBe('monitor');
    expect(useLiveCaptureStore.getState().isCapturing).toBe(true);
    expect(useLiveCaptureStore.getState().mutedChannels).toEqual(mutedChannels);
    expect(useLiveCaptureStore.getState().soloedChannels).toEqual(soloedChannels);
  });

  // Defensive branch: RecordButton only ever issues 'stop' for a record
  // session, so stopping a monitor session must stay a plain full stop — no
  // resume, no startCapture call (#776).
  it('stopLiveCapture does not resume monitoring when stopping a monitor session (#776)', async () => {
    const rt = mockRuntime({ onResumeMonitoringStart: vi.fn() });
    useLiveCaptureStore.setState({
      liveMode: 'monitor',
      isCapturing: true,
      stopCapture: vi.fn(async () => {
        useLiveCaptureStore.setState({ isCapturing: false });
        return { success: true, sessionDir: null };
      }),
      startCapture: vi.fn(async () => {
        useLiveCaptureStore.setState({ isCapturing: true });
        return { success: true };
      }),
    });

    await stopLiveCapture(rt);

    expect(useLiveCaptureStore.getState().isCapturing).toBe(false);
    expect(useLiveCaptureStore.getState().liveMode).toBe('monitor');
    expect(rt.onResumeMonitoringStart).not.toHaveBeenCalled();
    expect(useLiveCaptureStore.getState().startCapture).not.toHaveBeenCalled();
  });

  // #847: demoting must already be true by the time stopCapture() flips
  // isCapturing false (so the board never paints its idle shape), must still
  // be true through the resumed monitor start, and must be false once
  // stopLiveCapture has fully resolved.
  it('stopLiveCapture holds demoting true across the whole record-stop demote, clearing it only after the resume resolves (#847)', async () => {
    const rt = mockRuntime();
    const demotingDuringStop: boolean[] = [];
    const demotingDuringStart: boolean[] = [];
    useLiveCaptureStore.setState({
      liveMode: 'record',
      isCapturing: true,
      stopCapture: vi.fn(async () => {
        demotingDuringStop.push(useLiveCaptureStore.getState().demoting);
        useLiveCaptureStore.setState({ isCapturing: false });
        await Promise.resolve();
        return { success: true, sessionDir: null };
      }),
      startCapture: vi.fn(async () => {
        demotingDuringStart.push(useLiveCaptureStore.getState().demoting);
        useLiveCaptureStore.setState({ isCapturing: true });
        await Promise.resolve();
        return { success: true };
      }),
    });

    expect(useLiveCaptureStore.getState().demoting).toBe(false);
    await stopLiveCapture(rt);

    expect(demotingDuringStop).toEqual([true]);
    expect(demotingDuringStart).toEqual([true]);
    expect(useLiveCaptureStore.getState().demoting).toBe(false);
  });

  // Defensive branch: a monitor-session stop is a genuine full stop (no
  // resume tail), so it must never hold the board in its running shape.
  it('stopLiveCapture never sets demoting when stopping a monitor session (#847)', async () => {
    const rt = mockRuntime();
    let demotingDuringStop: boolean | undefined;
    useLiveCaptureStore.setState({
      liveMode: 'monitor',
      isCapturing: true,
      stopCapture: vi.fn(async () => {
        demotingDuringStop = useLiveCaptureStore.getState().demoting;
        useLiveCaptureStore.setState({ isCapturing: false });
        return { success: true, sessionDir: null };
      }),
    });

    await stopLiveCapture(rt);

    expect(demotingDuringStop).toBe(false);
    expect(useLiveCaptureStore.getState().demoting).toBe(false);
  });

  // A failed/thrown resumed start must not leave the board frozen in its
  // running shape with stale meters — the finally clears demoting regardless.
  it('stopLiveCapture clears demoting even when the resumed monitor start fails (#847)', async () => {
    const rt = mockRuntime();
    useLiveCaptureStore.setState({
      liveMode: 'record',
      isCapturing: true,
      stopCapture: vi.fn(async () => {
        useLiveCaptureStore.setState({ isCapturing: false });
        return { success: true, sessionDir: null };
      }),
      startCapture: vi.fn(async () => {
        return { success: false };
      }),
    });

    await stopLiveCapture(rt);

    expect(useLiveCaptureStore.getState().demoting).toBe(false);
  });

  // #776: stopCaptureIfRunning is the one production entry point for "drive
  // the board fully idle" — bridged onto window.stopLiveCaptureIfRunning
  // (App.tsx) for e2e/automation callers that need this and can't use the
  // Record button (whose idle press promotes rather than stops, #757).
  it('stopCaptureIfRunning is a no-op when nothing is capturing', async () => {
    const rt = mockRuntime();
    useLiveCaptureStore.setState({ isCapturing: false });
    const stopCapture = vi.spyOn(useLiveCaptureStore.getState(), 'stopCapture');

    await stopCaptureIfRunning(rt);

    expect(stopCapture).not.toHaveBeenCalled();
    expect(rt.onCaptureStopping).not.toHaveBeenCalled();
    expect(rt.onCaptureStopped).not.toHaveBeenCalled();
  });

  // Distinguishes stopCaptureIfRunning from stopLiveCapture: stopping a
  // record session must NOT take stopLiveCapture's resume-to-monitoring
  // branch — callers of this helper need a genuinely idle board, not one
  // that's been restarted into monitoring.
  it('stopCaptureIfRunning stops a recording without resuming monitoring (#776)', async () => {
    const rt = mockRuntime({ onResumeMonitoringStart: vi.fn() });
    useLiveCaptureStore.setState({
      liveMode: 'record',
      isCapturing: true,
      stopCapture: vi.fn(async () => {
        useLiveCaptureStore.setState({ isCapturing: false });
        return { success: true, sessionDir: '/tmp/session' };
      }),
      startCapture: vi.fn(async () => {
        useLiveCaptureStore.setState({ isCapturing: true });
        return { success: true };
      }),
    });

    await stopCaptureIfRunning(rt);

    expect(useLiveCaptureStore.getState().isCapturing).toBe(false);
    expect(useLiveCaptureStore.getState().stopping).toBe(false);
    expect(rt.onCaptureStopped).toHaveBeenCalledWith({ success: true, sessionDir: '/tmp/session' });
    expect(rt.onResumeMonitoringStart).not.toHaveBeenCalled();
    expect(useLiveCaptureStore.getState().startCapture).not.toHaveBeenCalled();
  });

  // #847: stopCaptureIfRunning is the "drive fully idle" entry point — it
  // never demotes, it stops, so the board must not hold its running shape.
  it('stopCaptureIfRunning never sets demoting on a record session (#847)', async () => {
    const rt = mockRuntime();
    let demotingDuringStop: boolean | undefined;
    useLiveCaptureStore.setState({
      liveMode: 'record',
      isCapturing: true,
      stopCapture: vi.fn(async () => {
        demotingDuringStop = useLiveCaptureStore.getState().demoting;
        useLiveCaptureStore.setState({ isCapturing: false });
        return { success: true, sessionDir: '/tmp/session' };
      }),
    });

    await stopCaptureIfRunning(rt);

    expect(demotingDuringStop).toBe(false);
    expect(useLiveCaptureStore.getState().demoting).toBe(false);
  });

  it('recordCapture promotes directly when a monitor session is already running', async () => {
    const rt = mockRuntime();
    useLiveCaptureStore.setState({ isCapturing: true, liveMode: 'monitor' });
    const startCapture = vi.spyOn(useLiveCaptureStore.getState(), 'startCapture');

    await recordCapture(rt);

    expect(startCapture).not.toHaveBeenCalled();
    expect(rt.promoteToRecording).toHaveBeenCalledTimes(1);
  });

  it('recordCapture stops active soundcheck playback before promoting to recording', async () => {
    const order: string[] = [];
    const rt = mockRuntime({
      stopPlaybackIfRunning: vi.fn(async () => { order.push('stop playback'); }),
      promoteToRecording: vi.fn(async () => { order.push('promote recording'); }),
    });
    useLiveCaptureStore.setState({ isCapturing: true, liveMode: 'monitor' });

    await recordCapture(rt);

    expect(order).toEqual(['stop playback', 'promote recording']);
  });

  it('recordCapture starts monitoring first, then promotes, when idle (#757)', async () => {
    const rt = mockRuntime();
    useLiveCaptureStore.setState({
      isCapturing: false,
      liveMode: 'monitor',
      windowSecs: 3,
      meterIntervalMs: 100,
      // Mirrors the real action's synchronous prelude: startCapture flips
      // isCapturing true before its own await point, so recordCapture sees a
      // live session right after startLiveCapture resolves it.
      startCapture: vi.fn(async () => {
        useLiveCaptureStore.setState({ isCapturing: true });
        return { success: true };
      }),
    });

    await recordCapture(rt);

    expect(rt.beforeStartCapture).toHaveBeenCalledTimes(1);
    expect(useLiveCaptureStore.getState().isCapturing).toBe(true);
    expect(rt.promoteToRecording).toHaveBeenCalledTimes(1);
  });

  it('recordCapture does not promote when beforeStartCapture blocked the start', async () => {
    const rt = mockRuntime({ beforeStartCapture: vi.fn(() => ({ ok: false, reason: 'Add at least one track before starting capture.' })) });
    useLiveCaptureStore.setState({ isCapturing: false, liveMode: 'monitor' });

    await recordCapture(rt);

    expect(useLiveCaptureStore.getState().isCapturing).toBe(false);
    expect(rt.promoteToRecording).not.toHaveBeenCalled();
  });

  it('recordCapture normalizes liveMode back to monitor after a stopped record session (#757)', async () => {
    const rt = mockRuntime();
    useLiveCaptureStore.setState({
      isCapturing: false,
      liveMode: 'record',
      startCapture: vi.fn(async () => {
        useLiveCaptureStore.setState({ isCapturing: true });
        return { success: true };
      }),
    });

    await recordCapture(rt);

    expect(useLiveCaptureStore.getState().liveMode).toBe('monitor');
    expect(rt.promoteToRecording).toHaveBeenCalledTimes(1);
  });

  it('recordCapture never crashes with no runtime bridged — it still starts via the store, then simply has nothing to promote', async () => {
    useLiveCaptureStore.setState({
      isCapturing: false,
      liveMode: 'monitor',
      startCapture: vi.fn(async () => {
        useLiveCaptureStore.setState({ isCapturing: true });
        return { success: true };
      }),
    });

    await expect(recordCapture(undefined)).resolves.toBeUndefined();

    expect(useLiveCaptureStore.getState().isCapturing).toBe(true);
  });
});

describe('stopPlaybackIfRunning', () => {
  it('stops only active Session playback', async () => {
    const stop = vi.fn(async () => {});

    await stopPlaybackIfRunning({ playing: false, stop });
    expect(stop).not.toHaveBeenCalled();

    await stopPlaybackIfRunning({ playing: true, stop });
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
