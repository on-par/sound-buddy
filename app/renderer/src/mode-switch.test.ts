// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resolveModeSwitch,
  switchMode,
  applySpectrumForMode,
  applySingleColumnSync,
} from './mode-switch';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useRigStore } from './stores/rigStore';
import { useSettingsStore } from './stores/settingsStore';
import { useSpectrumStore } from './stores/spectrumStore';
import { useAnalysisStore } from './stores/analysisStore';
import { useSoundcheckStore } from './stores/soundcheckStore';
import { spectrumTransport } from './spectrum-transport';
import { createMockSoundBuddy } from './mock-sound-buddy';
import type { AppSettings } from '../../electron/ipc/api';

function makeClassList() {
  const classes = new Set<string>();
  return {
    add: (c: string) => { classes.add(c); },
    remove: (c: string) => { classes.delete(c); },
    toggle: (c: string, force?: boolean) => {
      const on = force === undefined ? !classes.has(c) : force;
      if (on) classes.add(c); else classes.delete(c);
      return on;
    },
    contains: (c: string) => classes.has(c),
  };
}

function makeFakeElement() {
  return { style: {} as Record<string, string>, textContent: '', classList: makeClassList() };
}

type FakeElement = ReturnType<typeof makeFakeElement>;

let elements: Record<string, FakeElement>;
let tabContentEls: FakeElement[];
let bodyClassList: ReturnType<typeof makeClassList>;
let isSingleColumn: ReturnType<typeof vi.fn>;
let isEnabled: ReturnType<typeof vi.fn>;
let mock: ReturnType<typeof createMockSoundBuddy>;

// zustand's `set` copies the current state's own properties (including a
// vi.spyOn-replaced startCapture) forward into every later state object, so
// vi.restoreAllMocks() — which only restores the exact object it was spied
// on — can't undo a mock once a later setState call has propagated it past
// that snapshot. Force it back to the pristine action after every test
// instead of relying on restoreAllMocks for this one store method.
const REAL_START_CAPTURE = useLiveCaptureStore.getState().startCapture;

beforeEach(() => {
  elements = {
    'spectrum-title': makeFakeElement(),
    'reportcard-view': makeFakeElement(),
    'tab-live': makeFakeElement(),
    'tab-recent': makeFakeElement(),
  };
  tabContentEls = [makeFakeElement(), makeFakeElement()];
  bodyClassList = makeClassList();
  isSingleColumn = vi.fn(() => false);
  isEnabled = vi.fn(() => false);
  mock = createMockSoundBuddy();

  (globalThis as { document?: unknown }).document = {
    getElementById: (id: string) => elements[id] ?? null,
    querySelectorAll: (sel: string) => (sel === '.tab-content' ? tabContentEls : []),
    body: { classList: bodyClassList },
  };
  (globalThis as { window?: unknown }).window = {
    soundBuddy: mock.api,
    singleColumnState: { isSingleColumn },
    reportFirstUxState: { isEnabled },
    liveCaptureRuntime: {
      beforeStartCapture: () => ({ ok: true }),
      onCaptureStarting: vi.fn(),
      onCaptureStarted: vi.fn(),
    },
  };
});

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { window?: unknown }).window;
  vi.restoreAllMocks();
  useLiveCaptureStore.setState({ appMode: 'reportcard', isCapturing: false, liveMode: 'monitor', deviceHint: null, rigApplyNotice: null, startCapture: REAL_START_CAPTURE });
  useRigStore.setState({ activeRigId: null });
  useSettingsStore.setState({ settings: null, settingsError: null });
  useAnalysisStore.setState({ currentAnalysis: null });
  useSoundcheckStore.setState({ playing: false });
});

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    idealProfile: '', customIdealProfiles: [], storageDir: '', rigs: [], activeRigId: null,
    usageSignalEnabled: false, channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {},
    crashReportingEnabled: false, dawWorkspaceEnabled: false, liveAdjustmentsEnabled: false,
    reportFirstUxEnabled: false, shareChurchName: '', weeklyReminderEnabled: false,
    weeklyReminderServiceDay: 0, liveEqPaneWidth: 360,
    measurementDeviceName: '', gradingProfile: 'casual', consoleNetworkConsentGranted: false,
    soundcheckBuses: [],
    ...overrides,
  };
}

describe('resolveModeSwitch', () => {
  it('opens the source picker for "analyze"', () => {
    expect(resolveModeSwitch('analyze', 'reportcard')).toEqual({ type: 'openPicker' });
  });

  it('redirects "history" to "recent"', () => {
    expect(resolveModeSwitch('history', 'reportcard')).toEqual({ type: 'redirect', mode: 'recent' });
  });

  it('no-ops when the requested mode is already current', () => {
    expect(resolveModeSwitch('live', 'live')).toEqual({ type: 'noop' });
  });

  it('switches to any other requested mode', () => {
    expect(resolveModeSwitch('live', 'reportcard')).toEqual({ type: 'switch', mode: 'live' });
  });
});

describe('applySpectrumForMode', () => {
  it('live: writes the live title only — the board/EQ pane render reactively from appMode (#710)', () => {
    useSettingsStore.setState({ settings: settings({ liveEqPaneWidth: 400 }) });
    applySpectrumForMode('live');
    expect(elements['spectrum-title'].textContent).toBe('Spectrum · Live EQ');
  });

  it('soundcheck: keeps the panel empty (no meters) while playing', () => {
    useSoundcheckStore.setState({ playing: true });
    applySpectrumForMode('soundcheck');
    expect(elements['spectrum-title'].textContent).toBe('Soundcheck');
    expect(useSpectrumStore.getState().panelState).toBe('empty');
    expect(useSpectrumStore.getState().panelText).toBe('Playing — use the waveform playhead to navigate');
  });

  it('soundcheck: shows an empty prompt when not playing', () => {
    applySpectrumForMode('soundcheck');
    expect(useSpectrumStore.getState().panelState).toBe('empty');
    expect(useSpectrumStore.getState().panelText).toBe('Load a session and press Play to start playback');
  });

  it.each(['recent', 'guide', 'dir'] as const)('%s: shows a tailored empty state with no analysis', (mode) => {
    applySpectrumForMode(mode);
    expect(useSpectrumStore.getState().panelState).toBe('empty');
  });

  it.each(['recent', 'guide', 'dir'] as const)('%s: shows populated once an analysis exists', (mode) => {
    useAnalysisStore.setState({ currentAnalysis: { sox: {}, spectrum: {}, ffprobe: { format: {} } } as never });
    applySpectrumForMode(mode);
    expect(useSpectrumStore.getState().panelState).toBe('populated');
  });

  it('falls back to the generic curve empty state for any other mode', () => {
    applySpectrumForMode('reportcard');
    expect(elements['spectrum-title'].textContent).toBe('Spectrum · Curve');
    expect(useSpectrumStore.getState().panelState).toBe('empty');
    expect(useSpectrumStore.getState().panelText).toBe('Load a file to see the spectrum');
  });

  it('falls back to populated for any other mode once an analysis exists', () => {
    useAnalysisStore.setState({ currentAnalysis: { sox: {}, spectrum: {}, ffprobe: { format: {} } } as never });
    applySpectrumForMode('reportcard');
    expect(useSpectrumStore.getState().panelState).toBe('populated');
  });
});

describe('applySingleColumnSync', () => {
  it('reads the report-first-ux flag and current mode through to singleColumnState', () => {
    useSettingsStore.setState({ settings: settings({ reportFirstUxEnabled: true }) });
    useLiveCaptureStore.setState({ appMode: 'guide' });
    isEnabled.mockReturnValue(true);
    isSingleColumn.mockReturnValue(true);

    applySingleColumnSync();

    expect(isEnabled).toHaveBeenCalledWith(settings({ reportFirstUxEnabled: true }));
    expect(isSingleColumn).toHaveBeenCalledWith(true, 'guide');
    expect(bodyClassList.contains('single-column')).toBe(true);
  });

  it('removes single-column when not applicable', () => {
    bodyClassList.add('single-column');
    isSingleColumn.mockReturnValue(false);

    applySingleColumnSync();

    expect(bodyClassList.contains('single-column')).toBe(false);
  });
});

describe('switchMode', () => {
  it('records a screen breadcrumb named after the mode', () => {
    const spy = vi.spyOn(mock.api, 'recordAppEvent');
    switchMode('recent');
    expect(spy).toHaveBeenCalledWith('screen.recent');
  });

  it('records "screen.reportcard" for the report card', () => {
    const spy = vi.spyOn(mock.api, 'recordAppEvent');
    switchMode('reportcard');
    expect(spy).toHaveBeenCalledWith('screen.reportcard');
  });

  it('pauses playback when entering live or soundcheck', () => {
    const spy = vi.spyOn(spectrumTransport, 'pauseIfPlaying');
    switchMode('live');
    expect(spy).toHaveBeenCalled();
    spy.mockClear();
    switchMode('soundcheck');
    expect(spy).toHaveBeenCalled();
  });

  it('does not pause playback for other modes', () => {
    const spy = vi.spyOn(spectrumTransport, 'pauseIfPlaying');
    switchMode('recent');
    expect(spy).not.toHaveBeenCalled();
  });

  it('writes the new mode onto liveCaptureStore.appMode', () => {
    switchMode('guide');
    expect(useLiveCaptureStore.getState().appMode).toBe('guide');
  });

  it('report card: adds rc-active/active and skips the tab-content sweep', () => {
    switchMode('reportcard');
    expect(bodyClassList.contains('rc-active')).toBe(true);
    expect(elements['reportcard-view'].classList.contains('active')).toBe(true);
    expect(elements['spectrum-title'].textContent).toBe('Spectrum · Curve');
  });

  it('other modes: clears rc-active/reportcard-view, sweeps tab-content, activates the target tab', () => {
    bodyClassList.add('rc-active');
    elements['reportcard-view'].classList.add('active');
    tabContentEls.forEach((el) => el.classList.add('active'));

    switchMode('live');

    expect(bodyClassList.contains('rc-active')).toBe(false);
    expect(elements['reportcard-view'].classList.contains('active')).toBe(false);
    tabContentEls.forEach((el) => expect(el.classList.contains('active')).toBe(false));
    expect(elements['tab-live'].classList.contains('active')).toBe(true);
  });

  it('re-syncs the single-column layout after every switch', () => {
    isSingleColumn.mockReturnValue(true);
    switchMode('recent');
    expect(bodyClassList.contains('single-column')).toBe(true);
  });

  // #727: #tab-live relocated out of #source-panel into #spectrum-panel;
  // app.css's `body.live-active #source-panel { display:none; }` (mirroring
  // the existing rc-active rule) collapses the now-empty left column
  // whenever the Live tab is the active mode.
  it('adds live-active to body when switching to live', () => {
    switchMode('live');
    expect(bodyClassList.contains('live-active')).toBe(true);
  });

  it('removes live-active when switching away from live', () => {
    switchMode('live');
    switchMode('recent');
    expect(bodyClassList.contains('live-active')).toBe(false);
  });

  // #728: entering the Live tab with a last-used (active) rig auto-starts
  // board monitoring, the same startCapture path the Start Capture button
  // uses — no manual click required.
  it('auto-starts monitoring when entering live with an active rig', () => {
    useRigStore.setState({ activeRigId: 'rig-1' });
    const startCapture = vi.spyOn(useLiveCaptureStore.getState(), 'startCapture')
      .mockResolvedValue(undefined);

    switchMode('live');

    expect(startCapture).toHaveBeenCalledTimes(1);
  });

  it('does not auto-start when no rig is active', () => {
    const startCapture = vi.spyOn(useLiveCaptureStore.getState(), 'startCapture')
      .mockResolvedValue(undefined);

    switchMode('live');

    expect(startCapture).not.toHaveBeenCalled();
  });

  it('does not auto-start a second time when already capturing', () => {
    useRigStore.setState({ activeRigId: 'rig-1' });
    useLiveCaptureStore.setState({ isCapturing: true });
    const startCapture = vi.spyOn(useLiveCaptureStore.getState(), 'startCapture')
      .mockResolvedValue(undefined);

    switchMode('live');

    expect(startCapture).not.toHaveBeenCalled();
  });

  // #776: a record-mode last-used rig hydrates liveMode='record' (rig-panel.ts's
  // applyRigPatch keeps the rig's saved record intent), but auto-start is
  // monitoring ONLY (#728/ADR-0008) — the start-live payload mode is derived
  // from the store field, so normalizing it first guarantees the auto-start can
  // never begin a record session.
  it('auto-start normalizes a record-mode rig to monitor before starting, never recording (#776)', () => {
    useRigStore.setState({ activeRigId: 'rig-1' });
    useLiveCaptureStore.setState({ liveMode: 'record' });
    const startCapture = vi.spyOn(useLiveCaptureStore.getState(), 'startCapture')
      .mockResolvedValue(undefined);

    switchMode('live');

    expect(useLiveCaptureStore.getState().liveMode).toBe('monitor');
    expect(startCapture).toHaveBeenCalledTimes(1);
  });

  it('does not auto-start when the device hint is an error', () => {
    useRigStore.setState({ activeRigId: 'rig-1' });
    useLiveCaptureStore.setState({ deviceHint: { text: 'blocked', isError: true } });
    const startCapture = vi.spyOn(useLiveCaptureStore.getState(), 'startCapture')
      .mockResolvedValue(undefined);

    switchMode('live');

    expect(startCapture).not.toHaveBeenCalled();
  });

  it('does not auto-start when switching to a mode other than live', () => {
    useRigStore.setState({ activeRigId: 'rig-1' });
    const startCapture = vi.spyOn(useLiveCaptureStore.getState(), 'startCapture')
      .mockResolvedValue(undefined);

    switchMode('recent');

    expect(startCapture).not.toHaveBeenCalled();
  });

  // Regression (PR #740 CI, round 1): the active rig's named device no
  // longer being enumerated must block auto-start even though deviceHint
  // itself is fine (other devices exist, no permission error) — mirrors
  // tests/rigs.spec.ts's "loading a rig whose device is absent shows a
  // fallback and does not auto-start". rigStore.applyRigById is what sets
  // rigApplyNotice from rig-panel.ts's reconciliation; this test exercises
  // the auto-start gate's read side directly.
  it('does not auto-start when the just-applied rig left a rigApplyNotice (device not found)', () => {
    useRigStore.setState({ activeRigId: 'rig-1' });
    useLiveCaptureStore.setState({ rigApplyNotice: 'Rig device "Scarlett 18i20" not found — select a device.' });
    const startCapture = vi.spyOn(useLiveCaptureStore.getState(), 'startCapture')
      .mockResolvedValue(undefined);

    switchMode('live');

    expect(startCapture).not.toHaveBeenCalled();
  });

  // Regression (PR #740 CI, round 2): a rig applying successfully but needing
  // its channels clamped ALSO produces a rigApplyNotice (rig-panel.ts's
  // applyRigPatch returns the same notice field for both cases) — this must
  // block auto-start too, otherwise inline-app.js's reactive #live-status
  // renderer (driven by isCapturing/meterRate) overwrites the clamp notice
  // with "Monitoring…" before anyone can see it. Mirrors tests/rigs.spec.ts's
  // "loading a rig with out-of-range channels clamps them without throwing".
  it('does not auto-start when the just-applied rig left a rigApplyNotice (channels clamped)', () => {
    useRigStore.setState({ activeRigId: 'rig-1' });
    useLiveCaptureStore.setState({ rigApplyNotice: 'Some rig channels were out of range for this device and were clamped.' });
    const startCapture = vi.spyOn(useLiveCaptureStore.getState(), 'startCapture')
      .mockResolvedValue(undefined);

    switchMode('live');

    expect(startCapture).not.toHaveBeenCalled();
  });

  it('auto-starts when the active rig applied with no notice', () => {
    useRigStore.setState({ activeRigId: 'rig-1' });
    useLiveCaptureStore.setState({ rigApplyNotice: null });
    const startCapture = vi.spyOn(useLiveCaptureStore.getState(), 'startCapture')
      .mockResolvedValue(undefined);

    switchMode('live');

    expect(startCapture).toHaveBeenCalledTimes(1);
  });
});
