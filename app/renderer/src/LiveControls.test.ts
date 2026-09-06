// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { startLiveCapture, stopLiveCapture, stopCaptureIfRunning, recordCapture, type LiveCaptureRuntime } from './LiveControls';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useSettingsStore } from './stores/settingsStore';
import { recordButtonAction } from './record-transport';

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

  // #1383: the stop ceremony must fail open — a rejected stop-live IPC or a
  // throwing bridge hook must never leave `stopping` (and therefore both
  // Stop affordances) wedged, because every test here awaits its ceremonies
  // to settle before the next one runs, the module-level in-flight handle
  // never needs an explicit reset between tests.
  describe('stop ceremony hardening (#1383)', () => {
    it('stopLiveCapture clears the stopping flag even when the stop IPC rejects (#1383)', async () => {
      const rt = mockRuntime();
      useLiveCaptureStore.setState({
        liveMode: 'monitor',
        isCapturing: true,
        stopCapture: vi.fn(async () => {
          throw new Error('ipc gone');
        }),
      });

      await expect(stopLiveCapture(rt)).rejects.toThrow('ipc gone');

      expect(useLiveCaptureStore.getState().stopping).toBe(false);
      expect(useLiveCaptureStore.getState().demoting).toBe(false);
    });

    it('stopLiveCapture clears the stopping flag when a bridged post-stop hook throws (#1383)', async () => {
      const rt = mockRuntime({
        onCaptureStopped: vi.fn(() => {
          throw new Error('boom');
        }),
      });
      useLiveCaptureStore.setState({
        liveMode: 'monitor',
        isCapturing: true,
        stopCapture: vi.fn(async () => ({ success: true, sessionDir: null })),
      });

      await expect(stopLiveCapture(rt)).rejects.toThrow('boom');

      expect(useLiveCaptureStore.getState().stopping).toBe(false);
    });

    it('stopLiveCapture runs the stop ceremony exactly once for two overlapping Stop presses (#1383)', async () => {
      const rt = mockRuntime();
      let resolveStop!: (result: { success: boolean; sessionDir: string | null }) => void;
      const stopCapture = vi.fn(
        () =>
          new Promise<{ success: boolean; sessionDir: string | null }>((resolve) => {
            resolveStop = resolve;
          }),
      );
      useLiveCaptureStore.setState({
        liveMode: 'record',
        isCapturing: true,
        windowSecs: 3,
        meterIntervalMs: 100,
        stopCapture,
        startCapture: vi.fn(async () => {
          useLiveCaptureStore.setState({ isCapturing: true });
          return { success: true };
        }),
      });

      const first = stopLiveCapture(rt);
      const second = stopLiveCapture(rt);
      resolveStop({ success: true, sessionDir: '/tmp/session' });
      await Promise.all([first, second]);

      expect(stopCapture).toHaveBeenCalledTimes(1);
      expect(rt.onCaptureStopping).toHaveBeenCalledTimes(1);
      expect(rt.onCaptureStopped).toHaveBeenCalledTimes(1);
      expect(useLiveCaptureStore.getState().startCapture).toHaveBeenCalledTimes(1);
    });

    it('stopCaptureIfRunning joins an in-flight ceremony instead of issuing a second stop (#1383)', async () => {
      const rt = mockRuntime();
      let resolveStop!: (result: { success: boolean; sessionDir: string | null }) => void;
      const stopCapture = vi.fn(
        () =>
          new Promise<{ success: boolean; sessionDir: string | null }>((resolve) => {
            resolveStop = resolve;
          }),
      );
      useLiveCaptureStore.setState({
        liveMode: 'monitor',
        isCapturing: true,
        stopCapture,
      });

      const first = stopLiveCapture(rt);
      const second = stopCaptureIfRunning(rt);
      resolveStop({ success: true, sessionDir: null });
      await Promise.all([first, second]);

      expect(stopCapture).toHaveBeenCalledTimes(1);
    });

    it('stopLiveCapture does not resume monitoring when the stop failed (#1383)', async () => {
      const rt = mockRuntime({ onResumeMonitoringStart: vi.fn() });
      useLiveCaptureStore.setState({
        liveMode: 'record',
        isCapturing: true,
        stopCapture: vi.fn(async () => ({ success: false, sessionDir: null })),
        startCapture: vi.fn(async () => {
          useLiveCaptureStore.setState({ isCapturing: true });
          return { success: true };
        }),
      });

      await stopLiveCapture(rt);

      expect(useLiveCaptureStore.getState().startCapture).not.toHaveBeenCalled();
      expect(rt.onResumeMonitoringStart).not.toHaveBeenCalled();
      expect(rt.onCaptureStopped).not.toHaveBeenCalled();
    });

    it('a Stop press after a completed ceremony starts a fresh one (#1383)', async () => {
      const rt = mockRuntime();
      const stopCapture = vi.fn(async () => ({ success: true, sessionDir: null }));
      useLiveCaptureStore.setState({
        liveMode: 'monitor',
        isCapturing: true,
        stopCapture,
      });

      await stopLiveCapture(rt);
      useLiveCaptureStore.setState({ liveMode: 'monitor', isCapturing: true });
      await stopLiveCapture(rt);

      expect(stopCapture).toHaveBeenCalledTimes(2);
    });
  });

  // #1385: regression guard for "Stop silently fails to end an active
  // recording" (#1381), fixed by #1386 (single-flight, fail-open stop
  // ceremony) and #1387 (demote-window capture phase). These tests assert the
  // user-visible invariant — the derived capture phase, the one the transport
  // itself renders from — rather than call counts or store flags alone.
  describe('Stop during an active recording (#1385)', () => {
    // The phase the transport actually renders from — derived with the
    // production live-transition-state model over the live store flags,
    // never re-derived here (ADR-0131 / #1384: capturePhase is the single
    // source of truth).
    function phaseNow(): string {
      const s = useLiveCaptureStore.getState();
      return liveTransitionState.capturePhase({
        liveRunning: s.isCapturing, liveMode: s.liveMode,
        promoting: s.promoting, stopping: s.stopping, demoting: s.demoting,
      });
    }

    it('a Stop press during an active recording ends the take and never leaves the phase recording (#1385)', async () => {
      const rt = mockRuntime();
      const phases: string[] = [];
      useLiveCaptureStore.setState({
        liveMode: 'record',
        isCapturing: true,
        windowSecs: 3,
        meterIntervalMs: 100,
        stopCapture: vi.fn(async () => {
          phases.push(phaseNow());
          useLiveCaptureStore.setState({ isCapturing: false });
          return { success: true, sessionDir: '/tmp/session' };
        }),
        // This resume runs inside the demote window (demoting true,
        // isCapturing false, liveMode still 'record') — precisely the state
        // #1387 fixed; pre-fix this phase read 'idle' instead of 'monitoring'.
        startCapture: vi.fn(async () => {
          phases.push(phaseNow());
          useLiveCaptureStore.setState({ isCapturing: true });
          return { success: true };
        }),
      });

      await stopLiveCapture(rt);

      expect(phases).not.toContain('recording');
      expect(phases).toContain('monitoring');
      expect(phaseNow()).toBe('monitoring');
      expect(useLiveCaptureStore.getState().liveMode).toBe('monitor');
      expect(rt.onCaptureStopped).toHaveBeenCalledWith({ success: true, sessionDir: '/tmp/session' });
    });

    it('two Stop presses during one recording stop the take exactly once (#1385)', async () => {
      const rt = mockRuntime();
      let resolveStop!: (result: { success: boolean; sessionDir: string | null }) => void;
      const stopCapture = vi.fn(
        () =>
          new Promise<{ success: boolean; sessionDir: string | null }>((resolve) => {
            resolveStop = resolve;
          }),
      );
      useLiveCaptureStore.setState({
        liveMode: 'record',
        isCapturing: true,
        windowSecs: 3,
        meterIntervalMs: 100,
        stopCapture,
        startCapture: vi.fn(async () => {
          useLiveCaptureStore.setState({ isCapturing: true });
          return { success: true };
        }),
      });

      const first = stopLiveCapture(rt);
      const second = stopLiveCapture(rt);
      resolveStop({ success: true, sessionDir: '/tmp/session' });
      await Promise.all([first, second]);

      expect(stopCapture).toHaveBeenCalledTimes(1);
      expect(rt.onCaptureStopped).toHaveBeenCalledTimes(1);
      // Pre-#1386 the second ceremony's own resume tail killed the monitor
      // session the first ceremony had just restarted, landing on 'idle'.
      expect(phaseNow()).toBe('monitoring');
      expect(useLiveCaptureStore.getState().isCapturing).toBe(true);
    });

    it('a Stop that fails leaves the transport pressable instead of wedged in stopping (#1385)', async () => {
      const rt = mockRuntime();
      useLiveCaptureStore.setState({
        liveMode: 'record',
        isCapturing: true,
        windowSecs: 3,
        meterIntervalMs: 100,
        // Mirrors the real store's failed-stop shape: the child never actually
        // stopped, so isCapturing stays true.
        stopCapture: vi.fn(async () => ({ success: false, sessionDir: null })),
        startCapture: vi.fn(async () => {
          useLiveCaptureStore.setState({ isCapturing: true });
          return { success: true };
        }),
      });

      await stopLiveCapture(rt);

      // The take really is still recording — 'recording' is the CORRECT phase
      // here, not a bug: a stop that never reached the child must not paint an
      // idle/monitoring board over a live take. Pre-#1386 the phase stayed
      // pinned to 'stopping', whose recordButtonAction is null (disabled).
      expect(phaseNow()).not.toBe('stopping');
      expect(recordButtonAction(phaseNow() as never)).toBe('stop');
      expect(rt.onCaptureStopped).not.toHaveBeenCalled();
      expect(useLiveCaptureStore.getState().startCapture).not.toHaveBeenCalled();
    });

    it('stopCaptureIfRunning drives an active recording fully idle (#1385)', async () => {
      const rt = mockRuntime();
      useLiveCaptureStore.setState({
        liveMode: 'record',
        isCapturing: true,
        stopCapture: vi.fn(async () => {
          useLiveCaptureStore.setState({ isCapturing: false });
          return { success: true, sessionDir: '/tmp/session' };
        }),
      });
      const startCapture = vi.spyOn(useLiveCaptureStore.getState(), 'startCapture');

      await stopCaptureIfRunning(rt);

      expect(useLiveCaptureStore.getState().isCapturing).toBe(false);
      expect(phaseNow()).toBe('idle');
      expect(useLiveCaptureStore.getState().stopping).toBe(false);
      expect(startCapture).not.toHaveBeenCalled();
    });
  });
});
