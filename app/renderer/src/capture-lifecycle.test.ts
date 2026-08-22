// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createCaptureLifecycle, liveIndicatorView, type CaptureLifecycleDeps } from './capture-lifecycle';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useAnalysisStore } from './stores/analysisStore';
import { useSpectrumStore } from './stores/spectrumStore';
import { useRigStore } from './stores/rigStore';
import { useSettingsStore } from './stores/settingsStore';
import { shouldOfferReportCard, liveSessionReportCardSource, normalizeMeasurementSource, type WindowData, type LiveDevice } from './live-capture-panel';
import { SPECTRUM_TITLE } from './spectrum-chrome';
import { createMockSoundBuddy } from './mock-sound-buddy';

// The pure classic scripts the lifecycle reads through its injected accessors
// (liveTransition/preflight/rigReconcile/armState) or the store's own window
// accessors (resetLapCoaching → liveAdjustmentsState) — real modules, same
// convention as rigStore.test.ts / LiveControls.test.ts.
const liveTransitionState = require('../live-transition-state.js');
const armState = require('../arm-state.js');
const preflight = require('../preflight.js');
const rigReconcile = require('../rig-reconcile.js');
const liveAdjustmentsState = require('../live-adjustments-state.js');

const INITIAL_LIVE_CAPTURE_STATE = useLiveCaptureStore.getInitialState();

const DEVICES: LiveDevice[] = [{ index: 0, name: 'Scarlett 18i20', channels: 8, default_sr: 48000 }];

// A usable live window tick (masking + channels carry the session report-card
// source's per-channel bands).
function windowTick(n: number): WindowData {
  return {
    type: 'window',
    window: n,
    ts: n * 1000,
    channels: [{ index: 0, name: 'Main', rms: -18, peak: -6, clipping: false, centroid: 1200, rolloff: 4800, bands: { sub_bass: -58, bass: -30, low_mid: -24, mid: -12, high_mid: -20, presence: -28, brilliance: -80 } }],
    masking: [],
  };
}

function makeFakeEl() {
  return {
    style: {} as Record<string, string>,
    textContent: '',
    classList: { toggle: vi.fn() },
    querySelector: vi.fn(),
    remove: vi.fn(),
  };
}

function makeDoc() {
  const els: Record<string, ReturnType<typeof makeFakeEl>> = {};
  // Pre-create the elements the lifecycle touches so tests can reach in and
  // configure their querySelector/querySelectorAll return values before a
  // callback runs.
  ['live-indicator', 'spectrum-title', 'spectrum-body'].forEach((id) => { els[id] = makeFakeEl(); });
  return {
    getElementById: (id: string): ReturnType<typeof makeFakeEl> | null => {
      els[id] ??= makeFakeEl();
      return els[id];
    },
    els,
  };
}

function makeLifecycle(overrides: Partial<CaptureLifecycleDeps> = {}) {
  const doc = makeDoc();
  const sb = {
    startLive: vi.fn(async () => ({ success: true }) as { success: boolean; error?: string }),
    revealPath: vi.fn(async () => ({ success: true })),
    openDirDialog: vi.fn(async () => null as string | null),
  };
  const dawShell = { startPlayhead: vi.fn(), stopPlayhead: vi.fn(), resetWaveform: vi.fn() };
  const reportCardChrome = { persistSummary: vi.fn() };
  const liveSetupState = { markSetupComplete: vi.fn(), hasCompletedSetup: vi.fn(), shouldShowGuide: vi.fn(), setupSteps: vi.fn(), showAdvancedControls: vi.fn() };
  const storage = {} as Storage;
  const deps: CaptureLifecycleDeps = {
    getLc: () => useLiveCaptureStore.getState(),
    getAna: () => useAnalysisStore.getState(),
    getSpec: () => useSpectrumStore.getState(),
    getRig: () => useRigStore.getState(),
    sb,
    liveTransition: () => liveTransitionState,
    preflight: () => preflight,
    rigReconcile: () => rigReconcile,
    armState: () => armState,
    liveSetupState: () => liveSetupState,
    storage,
    liveCapturePanelApi: { shouldOfferReportCard, liveSessionReportCardSource, normalizeMeasurementSource },
    reportCardChrome,
    dawShell: () => dawShell,
    doc: doc as unknown as Pick<Document, 'getElementById'>,
    ...overrides,
  };
  const lifecycle = createCaptureLifecycle(deps);
  return { lifecycle, deps, doc, sb, dawShell, reportCardChrome, liveSetupState };
}

beforeEach(() => {
  (globalThis as { window?: unknown }).window = {
    liveTransitionState, armState, preflight, rigReconcile, liveAdjustmentsState,
    soundBuddy: createMockSoundBuddy().api,
    liveSetupState: { markSetupComplete: vi.fn() },
    localStorage: {},
  };
  useLiveCaptureStore.setState({ advanceLapCoaching: vi.fn() });
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useLiveCaptureStore.setState({
    devices: [], deviceHint: null, selectedDevice: '', channelConfig: [], channelGroups: [],
    liveMode: 'monitor', recordDir: '', isCapturing: false, promoting: false, stopping: false,
    measurementSource: null, appMode: 'reportcard', meterIntervalMs: 100, windowSecs: 3,
    liveWindows: [], sessionOffers: { sessionDir: null, reportCard: false, notEnoughData: false },
    liveCueVisible: true, liveStatusText: null, armHint: { visible: false, text: '' },
    startCapture: INITIAL_LIVE_CAPTURE_STATE.startCapture,
    stopCapture: INITIAL_LIVE_CAPTURE_STATE.stopCapture,
    resetLapCoaching: INITIAL_LIVE_CAPTURE_STATE.resetLapCoaching,
    advanceLapCoaching: INITIAL_LIVE_CAPTURE_STATE.advanceLapCoaching,
  });
  useAnalysisStore.setState({ historySummary: null, liveSource: null });
  useSpectrumStore.setState({ panelState: 'empty', panelText: '' });
  useRigStore.setState({ rigs: [], activeRigId: null, locked: false });
  useSettingsStore.setState({ settings: null, settingsError: null });
});

describe('liveIndicatorView (TD-001 slice 6i, #712)', () => {
  it('idle is hidden with no text', () => {
    const view = liveIndicatorView(liveTransitionState, { isCapturing: false, liveMode: 'monitor', promoting: false, stopping: false });
    expect(view).toEqual({ visible: false, text: '', recording: false });
  });

  it('monitoring shows LIVE', () => {
    const view = liveIndicatorView(liveTransitionState, { isCapturing: true, liveMode: 'monitor', promoting: false, stopping: false });
    expect(view).toEqual({ visible: true, text: 'LIVE', recording: false });
  });

  it('recording shows REC', () => {
    const view = liveIndicatorView(liveTransitionState, { isCapturing: true, liveMode: 'record', promoting: false, stopping: false });
    expect(view).toEqual({ visible: true, text: 'REC', recording: true });
  });

  it('starting-record shows REC', () => {
    const view = liveIndicatorView(liveTransitionState, { isCapturing: true, liveMode: 'monitor', promoting: true, stopping: false });
    expect(view).toEqual({ visible: true, text: 'REC', recording: true });
  });
});

describe('createCaptureLifecycle — beforeStartCapture', () => {
  it('blocks an empty channel config and surfaces the arm hint', () => {
    const { lifecycle } = makeLifecycle();
    useLiveCaptureStore.setState({ channelConfig: [], liveMode: 'monitor' });
    const r = lifecycle.runtime.beforeStartCapture();
    expect(r).toEqual({ ok: false, reason: 'Add at least one track before starting listening.' });
    expect(useLiveCaptureStore.getState().armHint).toEqual({ visible: true, text: 'Add at least one track before starting listening.' });
  });

  it('blocks record mode with nothing armed', () => {
    const { lifecycle } = makeLifecycle();
    useLiveCaptureStore.setState({ channelConfig: [{ kind: 'mono', a: 0, b: 1, armed: false }], liveMode: 'record' });
    const r = lifecycle.runtime.beforeStartCapture();
    expect(r).toEqual({ ok: false, reason: 'Arm at least one strip to record.' });
    expect(useLiveCaptureStore.getState().armHint.visible).toBe(true);
  });

  it('a valid config clears the hint and is ok', () => {
    const { lifecycle } = makeLifecycle();
    useLiveCaptureStore.setState({ channelConfig: [{ kind: 'mono', a: 0, b: 1, armed: true }], liveMode: 'monitor' });
    useLiveCaptureStore.getState().showArmHint('stale');
    const r = lifecycle.runtime.beforeStartCapture();
    expect(r).toEqual({ ok: true });
    expect(useLiveCaptureStore.getState().armHint.visible).toBe(false);
  });
});

describe('createCaptureLifecycle — onCaptureStarting', () => {
  it('a fresh start clears offers, hides the cue, sets Connecting…, locks the rig, resets coaching, and drives the DAW shell', () => {
    const { lifecycle, doc } = makeLifecycle();
    const txt = { textContent: '' };
    doc.els['live-indicator'].querySelector.mockReturnValue(txt);
    const resetLapCoaching = vi.fn();
    useLiveCaptureStore.setState({
      meterIntervalMs: 100,
      channelConfig: [{ kind: 'mono', a: 0, b: 1 }],
      isCapturing: true,
      liveMode: 'monitor',
      sessionOffers: { sessionDir: '/tmp/old', reportCard: true, notEnoughData: false },
      liveCueVisible: false,
      resetLapCoaching,
    });

    lifecycle.runtime.onCaptureStarting();

    expect(doc.els['live-indicator'].style.display).toBe('flex');
    expect(txt.textContent).toBe('LIVE');
    expect(doc.els['live-indicator'].classList.toggle).toHaveBeenCalledWith('capture-record', false);
    expect(useLiveCaptureStore.getState().sessionOffers).toEqual({ sessionDir: null, reportCard: false, notEnoughData: false });
    expect(useLiveCaptureStore.getState().liveCueVisible).toBe(false);
    expect(useLiveCaptureStore.getState().liveStatusText).toBe('Connecting…');
    expect(useRigStore.getState().locked).toBe(true);
    expect(resetLapCoaching).toHaveBeenCalled();
    expect(useAnalysisStore.getState().historySummary).toBeNull();
    expect(doc.els['spectrum-title'].textContent).toBe(SPECTRUM_TITLE.live);
  });

  it('calls dawShell.startPlayhead with now and resetWaveform with the meter interval', () => {
    const { lifecycle, dawShell } = makeLifecycle();
    useLiveCaptureStore.setState({ meterIntervalMs: 200, isCapturing: true });
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      lifecycle.runtime.onCaptureStarting();
    } finally {
      vi.restoreAllMocks();
    }
    expect(dawShell.startPlayhead).toHaveBeenCalledWith(now);
    expect(dawShell.resetWaveform).toHaveBeenCalledWith(0.2);
  });

  it('a resume preserves the just-shown offers and restores the frozen live source (#776)', () => {
    const { lifecycle } = makeLifecycle();
    // A stopped record session first leaves a frozen source + report-card offer.
    useLiveCaptureStore.setState({
      liveWindows: [windowTick(1), windowTick(2), windowTick(3)],
      measurementSource: 0,
      channelConfig: [{ kind: 'mono', a: 0, b: 1 }],
      isCapturing: true,
    });
    lifecycle.onWindowTick(windowTick(1));
    lifecycle.onWindowTick(windowTick(2));
    lifecycle.onWindowTick(windowTick(3));
    lifecycle.runtime.onCaptureStopped({ success: true, sessionDir: '/tmp/session' });
    expect(useLiveCaptureStore.getState().sessionOffers).toEqual({ sessionDir: '/tmp/session', reportCard: true, notEnoughData: false });

    const setLiveSource = vi.spyOn(useAnalysisStore.getState(), 'setLiveSource');
    lifecycle.runtime.onResumeMonitoringStart?.();
    useLiveCaptureStore.setState({ isCapturing: true, liveCueVisible: true, resetLapCoaching: vi.fn() });
    lifecycle.runtime.onCaptureStarting();

    expect(setLiveSource).toHaveBeenCalledTimes(1);
    expect(useLiveCaptureStore.getState().sessionOffers).toEqual({ sessionDir: '/tmp/session', reportCard: true, notEnoughData: false });
    expect(useLiveCaptureStore.getState().liveCueVisible).toBe(true);
  });
});

describe('createCaptureLifecycle — onCaptureStarted', () => {
  it('a failed start stops the session and shows the error state', async () => {
    const { lifecycle } = makeLifecycle();
    const order: string[] = [];
    useLiveCaptureStore.setState({
      isCapturing: true,
      appMode: 'live',
      stopCapture: vi.fn(async () => {
        await Promise.resolve();
        order.push('ipc');
        useLiveCaptureStore.setState({ isCapturing: false });
        return { success: true, sessionDir: null };
      }),
    });

    lifecycle.runtime.onCaptureStarted({ success: false, error: 'mic denied' }, 10);
    await new Promise((r) => setTimeout(r, 0));

    expect(order).toEqual(['ipc']);
    expect(useSpectrumStore.getState().panelState).toBe('error');
    expect(useSpectrumStore.getState().panelText).toBe('mic denied');
    expect(useLiveCaptureStore.getState().isCapturing).toBe(false);
  });

  it('a failed start with no result uses the default error text', async () => {
    const { lifecycle } = makeLifecycle();
    useLiveCaptureStore.setState({ isCapturing: true, stopCapture: vi.fn(async () => { useLiveCaptureStore.setState({ isCapturing: false }); return { success: true, sessionDir: null }; }) });
    lifecycle.runtime.onCaptureStarted(undefined, 10);
    await new Promise((r) => setTimeout(r, 0));
    expect(useSpectrumStore.getState().panelText).toBe('Failed to start live listening');
  });

  it('a successful start sets the phase status, marks setup complete, and removes the banner', () => {
    const { lifecycle, doc, liveSetupState, deps } = makeLifecycle();
    const banner = makeFakeEl();
    doc.els['spectrum-body'].querySelector.mockReturnValue(banner);
    useLiveCaptureStore.setState({ isCapturing: true, liveMode: 'monitor', promoting: false });

    lifecycle.runtime.onCaptureStarted({ success: true }, 10);

    expect(useLiveCaptureStore.getState().liveStatusText).toBe('Monitoring · meters 10/s');
    expect(doc.els['spectrum-body'].querySelector).toHaveBeenCalledWith('.live-setup-banner');
    expect(banner.remove).toHaveBeenCalled();
    expect(liveSetupState.markSetupComplete).toHaveBeenCalledWith(deps.storage);
  });
});

describe('createCaptureLifecycle — promoteToRecording', () => {
  function recordReadyState() {
    useLiveCaptureStore.setState({
      devices: DEVICES,
      selectedDevice: '0',
      channelConfig: [{ kind: 'mono', a: 0, b: 1, armed: true, label: 'Kick' }],
      isCapturing: true,
      liveMode: 'monitor',
      recordDir: '/tmp/rec',
      meterIntervalMs: 100,
      windowSecs: 3,
    });
  }

  it('blocks on a failed preflight and surfaces the failing detail', async () => {
    const { lifecycle, sb } = makeLifecycle();
    useRigStore.setState({
      rigs: [{
        id: 'r1', name: 'Main Board', deviceName: 'Scarlett 18i20',
        channelConfig: [{ kind: 'mono', a: 0, b: 0 }], mode: 'monitor', recordDir: '',
        intervalMs: 100, windowSecs: 3,
        baseline: { deviceName: 'Scarlett 18i20', strips: [{ kind: 'mono', a: 0, b: 0 }], savedAt: '2026-01-01T00:00:00Z' },
      }],
      activeRigId: 'r1',
    });
    useLiveCaptureStore.setState({
      devices: DEVICES, selectedDevice: '0',
      channelConfig: [{ kind: 'mono', a: 1, b: 2, armed: true }],
      isCapturing: true, liveMode: 'monitor',
    });

    await lifecycle.runtime.promoteToRecording();

    expect(sb.startLive).not.toHaveBeenCalled();
    expect(useLiveCaptureStore.getState().armHint.visible).toBe(true);
    expect(useLiveCaptureStore.getState().armHint.text).toBe('Ch 1 reassigned 0 → 1 — update routing or re-save the baseline');
  });

  it('blocks on the canPromoteToRecording guard when not live', async () => {
    const { lifecycle, sb } = makeLifecycle();
    useLiveCaptureStore.setState({
      devices: DEVICES, selectedDevice: '0',
      channelConfig: [{ kind: 'mono', a: 0, b: 1, armed: true }],
      isCapturing: false, liveMode: 'monitor',
    });

    await lifecycle.runtime.promoteToRecording();

    expect(sb.startLive).not.toHaveBeenCalled();
    expect(useLiveCaptureStore.getState().armHint.text).toBe('Recording can only start from an active monitor session.');
  });

  it('promotes an active monitor session with the exact record payload', async () => {
    const { lifecycle, sb } = makeLifecycle();
    recordReadyState();

    await lifecycle.runtime.promoteToRecording();

    expect(sb.startLive).toHaveBeenCalledWith({
      device: '0',
      channels: ['0'],
      windowSecs: 3,
      intervalSecs: 0.1,
      mode: 'record',
      recordDir: '/tmp/rec',
      arm: ['0'],
      labels: ['Kick'],
    });
    expect(useLiveCaptureStore.getState().liveMode).toBe('record');
    expect(useLiveCaptureStore.getState().promoting).toBe(false);
    expect(useLiveCaptureStore.getState().liveStatusText).toBe('Recording · meters 10/s');
    // #776 stale-offer clear before the promote.
    expect(useLiveCaptureStore.getState().sessionOffers).toEqual({ sessionDir: null, reportCard: false, notEnoughData: false });
    expect(useLiveCaptureStore.getState().liveCueVisible).toBe(false);
  });

  it('preserves monitor mute and solo maps when promoting to recording (#1058)', async () => {
    const { lifecycle } = makeLifecycle();
    recordReadyState();
    const mutedChannels = { 0: true, 2: true };
    const soloedChannels = { 1: true };
    useLiveCaptureStore.setState({ mutedChannels, soloedChannels });

    await lifecycle.runtime.promoteToRecording();

    expect(useLiveCaptureStore.getState().liveMode).toBe('record');
    expect(useLiveCaptureStore.getState().mutedChannels).toEqual(mutedChannels);
    expect(useLiveCaptureStore.getState().soloedChannels).toEqual(soloedChannels);
  });

  it('a failed promote demotes to monitor, shows the error, and stops the session', async () => {
    const { lifecycle, sb } = makeLifecycle();
    sb.startLive.mockResolvedValue({ success: false, error: 'boom' });
    useLiveCaptureStore.setState({
      devices: DEVICES, selectedDevice: '0',
      channelConfig: [{ kind: 'mono', a: 0, b: 1, armed: true }],
      isCapturing: true, liveMode: 'monitor', recordDir: '',
      meterIntervalMs: 100, windowSecs: 3,
      stopCapture: vi.fn(async () => {
        useLiveCaptureStore.setState({ isCapturing: false });
        return { success: true, sessionDir: null };
      }),
    });

    await lifecycle.runtime.promoteToRecording();

    expect(useLiveCaptureStore.getState().liveMode).toBe('monitor');
    expect(useSpectrumStore.getState().panelState).toBe('error');
    expect(useSpectrumStore.getState().panelText).toBe('boom');
    expect(useLiveCaptureStore.getState().isCapturing).toBe(false);
  });
});

describe('createCaptureLifecycle — onCaptureStopping', () => {
  it('syncLiveIndicator is a no-op when the #live-indicator pill is absent (defensive)', () => {
    const doc = makeDoc();
    const origGet = doc.getElementById.bind(doc);
    doc.getElementById = (id: string) => (id === 'live-indicator' ? null : origGet(id));
    const { lifecycle } = makeLifecycle({ doc: doc as unknown as Pick<Document, 'getElementById'> });
    useLiveCaptureStore.setState({ isCapturing: true, liveMode: 'monitor', resetLapCoaching: vi.fn() });
    expect(() => lifecycle.runtime.onCaptureStarting()).not.toThrow();
    expect(useLiveCaptureStore.getState().liveStatusText).toBe('Connecting…');
  });

  it('afterSecondaryMeasurementChange is a documented no-op until 6k', () => {
    const { lifecycle } = makeLifecycle();
    expect(lifecycle.runtime.afterSecondaryMeasurementChange?.()).toBeUndefined();
  });

  it('stops the DAW playhead and unlocks the rig', () => {
    const { lifecycle, dawShell } = makeLifecycle();
    useRigStore.setState({ locked: true });
    lifecycle.runtime.onCaptureStopping();
    expect(dawShell.stopPlayhead).toHaveBeenCalled();
    expect(useRigStore.getState().locked).toBe(false);
  });
});

describe('createCaptureLifecycle — onCaptureStopped', () => {
  it('hides the pill, clears the status, shows the cue, and sets the live-stopped title', () => {
    const { lifecycle, doc } = makeLifecycle();
    useLiveCaptureStore.setState({
      isCapturing: false, appMode: 'live', liveStatusText: 'x',
      sessionOffers: { sessionDir: null, reportCard: false, notEnoughData: false },
    });
    lifecycle.runtime.onCaptureStopped({ success: true, sessionDir: null });
    expect(doc.els['live-indicator'].style.display).toBe('none');
    expect(useLiveCaptureStore.getState().liveStatusText).toBeNull();
    expect(useLiveCaptureStore.getState().liveCueVisible).toBe(true);
    expect(doc.els['spectrum-title'].textContent).toBe(SPECTRUM_TITLE.liveStopped);
  });

  it('offers the session folder when a sessionDir is returned', () => {
    const { lifecycle } = makeLifecycle();
    useLiveCaptureStore.setState({ isCapturing: false, appMode: 'live' });
    lifecycle.runtime.onCaptureStopped({ success: true, sessionDir: '/tmp/session' });
    expect(useLiveCaptureStore.getState().sessionOffers).toEqual({ sessionDir: '/tmp/session', reportCard: false, notEnoughData: false });
  });

  it('builds the session report-card offer from the whole sessionWindows buffer', () => {
    const { lifecycle, reportCardChrome } = makeLifecycle();
    useLiveCaptureStore.setState({
      liveWindows: [windowTick(1), windowTick(2), windowTick(3)],
      measurementSource: 0,
      channelConfig: [{ kind: 'mono', a: 0, b: 1 }],
      isCapturing: false,
    });
    lifecycle.onWindowTick(windowTick(1));
    lifecycle.onWindowTick(windowTick(2));
    lifecycle.onWindowTick(windowTick(3));
    lifecycle.runtime.onCaptureStopped({ success: true, sessionDir: null });

    const offers = useLiveCaptureStore.getState().sessionOffers;
    expect(offers.reportCard).toBe(true);
    expect(offers.notEnoughData).toBe(false);
    expect(offers.sessionDir).toBeNull();
    expect(useAnalysisStore.getState().liveSource).not.toBeNull();
    expect(reportCardChrome.persistSummary).toHaveBeenCalledWith(useAnalysisStore.getState().liveSource, 'live');
  });

  it('degrades to the not-enough-data offer when the session is too short to grade', () => {
    const { lifecycle } = makeLifecycle();
    useLiveCaptureStore.setState({
      liveWindows: [windowTick(1)],
      measurementSource: 0,
      channelConfig: [{ kind: 'mono', a: 0, b: 1 }],
      isCapturing: false,
    });
    lifecycle.onWindowTick(windowTick(1));
    lifecycle.runtime.onCaptureStopped({ success: true, sessionDir: null });
    expect(useLiveCaptureStore.getState().sessionOffers).toEqual({ sessionDir: null, reportCard: false, notEnoughData: true });
  });

  it('skips the report-card offer entirely when no window accumulated', () => {
    const { lifecycle, reportCardChrome } = makeLifecycle();
    useLiveCaptureStore.setState({ liveWindows: [], measurementSource: 0, channelConfig: [], isCapturing: false });
    lifecycle.runtime.onCaptureStopped({ success: true, sessionDir: null });
    expect(useLiveCaptureStore.getState().sessionOffers).toEqual({ sessionDir: null, reportCard: false, notEnoughData: false });
    expect(reportCardChrome.persistSummary).not.toHaveBeenCalled();
  });
});

describe('createCaptureLifecycle — stopLive ordering + onWindowTick', () => {
  it('stopLive runs onCaptureStopping before the IPC resolves and onCaptureStopped after', async () => {
    const order: string[] = [];
    const dawShell = {
      startPlayhead: vi.fn(),
      resetWaveform: vi.fn(),
      stopPlayhead: vi.fn(() => order.push('stopping')),
    };
    const { lifecycle } = makeLifecycle({ dawShell: () => dawShell });
    useLiveCaptureStore.setState({
      isCapturing: true,
      appMode: 'live',
      stopCapture: vi.fn(async () => {
        await Promise.resolve();
        order.push('ipc');
        useLiveCaptureStore.setState({ isCapturing: false });
        return { success: true, sessionDir: null };
      }),
    });

    lifecycle.runtime.onCaptureStarted({ success: false, error: 'x' }, 10);
    await new Promise((r) => setTimeout(r, 0));

    expect(order).toEqual(['stopping', 'ipc']);
    expect(useLiveCaptureStore.getState().liveCueVisible).toBe(true); // onCaptureStopped ran after the IPC
    expect(useSpectrumStore.getState().panelText).toBe('x');
  });

  it('onWindowTick accumulates windows and advances the coaching store', () => {
    const { lifecycle } = makeLifecycle();
    const advance = vi.spyOn(useLiveCaptureStore.getState(), 'advanceLapCoaching');
    lifecycle.onWindowTick(windowTick(1));
    lifecycle.onWindowTick(windowTick(2));
    expect(advance).toHaveBeenCalledTimes(2);
    // Accumulation feeds the session report-card source (pinned by the
    // report-card offer test above).
  });
});

describe('createCaptureLifecycle — runtime members', () => {
  it('changeMeasurementSource normalizes against the current strip count', () => {
    const { lifecycle } = makeLifecycle();
    useLiveCaptureStore.setState({ channelConfig: [{ kind: 'mono', a: 0, b: 1 }, { kind: 'mono', a: 1, b: 2 }] });
    lifecycle.runtime.changeMeasurementSource('1');
    expect(useLiveCaptureStore.getState().measurementSource).toBe(1);
    lifecycle.runtime.changeMeasurementSource('7'); // out of range → normalized to null
    expect(useLiveCaptureStore.getState().measurementSource).toBeNull();
    lifecycle.runtime.changeMeasurementSource('');
    expect(useLiveCaptureStore.getState().measurementSource).toBeNull();
  });

  it('chooseRecordFolder stores the picked directory; null is ignored', async () => {
    const { lifecycle, sb } = makeLifecycle();
    sb.openDirDialog.mockResolvedValue('/tmp/rec');
    await lifecycle.runtime.chooseRecordFolder();
    expect(useLiveCaptureStore.getState().recordDir).toBe('/tmp/rec');
    sb.openDirDialog.mockResolvedValue(null);
    await lifecycle.runtime.chooseRecordFolder();
    expect(useLiveCaptureStore.getState().recordDir).toBe('/tmp/rec');
  });

  it('onResumeMonitoringStart + a fresh start clears offers (the one-way flag)', () => {
    const { lifecycle } = makeLifecycle();
    useLiveCaptureStore.setState({
      isCapturing: true, liveCueVisible: true, resetLapCoaching: vi.fn(),
      sessionOffers: { sessionDir: '/tmp/s', reportCard: false, notEnoughData: false },
    });
    lifecycle.runtime.onResumeMonitoringStart?.();
    lifecycle.runtime.onCaptureStarting();
    // Resume branch preserves the offers (no setSessionOffers clear).
    expect(useLiveCaptureStore.getState().sessionOffers).toEqual({ sessionDir: '/tmp/s', reportCard: false, notEnoughData: false });
    expect(useLiveCaptureStore.getState().liveCueVisible).toBe(true);
  });
});
