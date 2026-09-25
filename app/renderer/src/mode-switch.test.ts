// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resolveModeSwitch,
  isWorkspaceMode,
  switchMode,
  showAnalyzeStage,
  applyInitialMode,
  applySpectrumForMode,
  applySingleColumnSync,
  maybeAutoStartLive,
  restoreBootMode,
} from './mode-switch';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useRigStore } from './stores/rigStore';
import { useSettingsStore } from './stores/settingsStore';
import { useSpectrumStore } from './stores/spectrumStore';
import { useAnalysisStore } from './stores/analysisStore';
import { useAnalyzeEntryStore } from './stores/analyzeEntryStore';
import { spectrumTransport } from './spectrum-transport';
import { createMockSoundBuddy } from './mock-sound-buddy';
import { ALL_TAB_MODES } from './simple-mode';
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
    'tab-console': makeFakeElement(),
    'tab-recent': makeFakeElement(),
  };
  tabContentEls = [makeFakeElement(), makeFakeElement()];
  bodyClassList = makeClassList();
  isSingleColumn = vi.fn(() => false);
  mock = createMockSoundBuddy();

  (globalThis as { document?: unknown }).document = {
    getElementById: (id: string) => elements[id] ?? null,
    querySelectorAll: (sel: string) => (sel === '.tab-content' ? tabContentEls : []),
    body: { classList: bodyClassList },
  };
  (globalThis as { window?: unknown }).window = {
    soundBuddy: mock.api,
    singleColumnState: { isSingleColumn },
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
  useAnalyzeEntryStore.setState({ analyzeStage: false });
});

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    idealProfile: '', customIdealProfiles: [], storageDir: '', rigs: [], activeRigId: null,
    usageSignalEnabled: false, channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {},
    crashReportingEnabled: false, liveAdjustmentsEnabled: false, advancedFeaturesEnabled: true, lineCheckCalibrationEnabled: false, shareChurchName: '', weeklyReminderEnabled: false,
    weeklyReminderServiceDay: 0, liveEqPaneWidth: 360,
    measurementDeviceName: '', gradingProfile: 'casual', gradingRubric: {}, consoleNetworkConsentGranted: false,
    soundcheckBuses: [],
    splCalibrationOffsetDb: null,
    lastAppMode: '',
    ...overrides,
  };
}

describe('resolveModeSwitch', () => {
  it.each(['dir', 'live', 'console', 'recent', 'guide', 'ringout', 'reportcard'])('%s is a supported workspace mode', (mode) => {
    expect(isWorkspaceMode(mode)).toBe(true);
  });

  it('rejects an unsupported workspace mode', () => {
    expect(isWorkspaceMode("soundcheck")).toBe(false);
  });

  // #1485: the Analyze tab always resolves to the entry point, regardless of
  // the current workspace mode or whether 'analyze' is itself "current" —
  // analyze is not a workspace mode, so the noop same-mode rule must not
  // swallow it.
  it('opens the Analyze entry point from the Report Card workspace', () => {
    expect(resolveModeSwitch('analyze', 'reportcard')).toEqual({ type: 'analyzeEntry' });
  });

  it('opens the Analyze entry point even when "analyze" is already the current mode', () => {
    expect(resolveModeSwitch('analyze', 'analyze')).toEqual({ type: 'analyzeEntry' });
  });

  it('opens the Analyze entry point from the Session (live) workspace', () => {
    expect(resolveModeSwitch('analyze', 'live')).toEqual({ type: 'analyzeEntry' });
  });

  it('never returns a chooseFile decision for any input', () => {
    for (const mode of ALL_TAB_MODES) {
      const decision = resolveModeSwitch(mode, 'reportcard');
      expect(decision.type as string).not.toBe('chooseFile');
    }
  });

  it('redirects "history" to "recent"', () => {
    expect(resolveModeSwitch('history', 'reportcard')).toEqual({ type: 'redirect', mode: 'recent' });
  });

  it('no-ops when the requested mode is already current', () => {
    expect(resolveModeSwitch('live', 'live')).toEqual({ type: 'noop' });
  });

  it('switches to a supported workspace mode', () => {
    expect(resolveModeSwitch('live', 'reportcard')).toEqual({ type: 'switch', mode: 'live' });
  });

  it('no-ops for the retired legacy request', () => {
    expect(resolveModeSwitch("soundcheck", 'reportcard')).toEqual({ type: 'noop' });
  });
});

describe('applySpectrumForMode', () => {
  it('live: writes the live title only — the board/EQ pane render reactively from appMode (#710)', () => {
    useSettingsStore.setState({ settings: settings({ liveEqPaneWidth: 400 }) });
    applySpectrumForMode('live');
    expect(elements['spectrum-title'].textContent).toBe('Spectrum · Live EQ');
  });

  it.each(['recent', 'guide', 'dir', 'console'] as const)('%s: shows a tailored empty state with no analysis', (mode) => {
    applySpectrumForMode(mode);
    expect(useSpectrumStore.getState().panelState).toBe('empty');
  });

  it.each(['recent', 'guide', 'dir', 'console'] as const)('%s: shows populated once an analysis exists', (mode) => {
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
  it('reads Simple mode and current mode through to singleColumnState', () => {
    useSettingsStore.setState({ settings: settings({ advancedFeaturesEnabled: false }) });
    useLiveCaptureStore.setState({ appMode: 'recent' });
    isSingleColumn.mockReturnValue(true);

    applySingleColumnSync();

    expect(isSingleColumn).toHaveBeenCalledWith(true, 'recent');
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

  it('pauses spectrum playback when entering live', () => {
    const spy = vi.spyOn(spectrumTransport, 'pauseIfPlaying');
    switchMode('live');
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

  // #1405: a real (non-boot) switch is what makes the mode survive a relaunch.
  it('persists the new mode to settings on a real switch', () => {
    const spy = vi.spyOn(mock.api, 'updateSettings');
    switchMode('live');
    expect(spy).toHaveBeenCalledWith({ lastAppMode: 'live' });
  });

  // #1405: App.tsx's synchronous first-paint call passes { boot: true } — it
  // fires before settings have loaded, so persisting here would clobber a
  // saved 'live' with the hardcoded initial 'reportcard' default every launch.
  it('boot: true does not persist the mode', () => {
    const spy = vi.spyOn(mock.api, 'updateSettings');
    switchMode('reportcard', { boot: true });
    expect(spy).not.toHaveBeenCalled();
  });

  // #1405: the boot call fires before device/rig hydration settles, so
  // auto-starting here would race decideLiveAutoStart against an empty
  // rigStore and skip with a false 'no-last-used-device'. restoreBootMode
  // performs the real auto-start after hydration.
  it('boot: true does not auto-start even with an active rig', () => {
    useRigStore.setState({ activeRigId: 'rig-1' });
    const startCapture = vi.spyOn(useLiveCaptureStore.getState(), 'startCapture')
      .mockResolvedValue(undefined);

    switchMode('live', { boot: true });

    expect(startCapture).not.toHaveBeenCalled();
  });

  it('boot: true still applies the mode and DOM side effects', () => {
    switchMode('live', { boot: true });
    expect(useLiveCaptureStore.getState().appMode).toBe('live');
    expect(bodyClassList.contains('live-active')).toBe(true);
  });

  // #1487: clicking any workspace tab is always a navigation away from
  // Analyze (the Analyze tab itself never reaches switchMode — see
  // resolveModeSwitch's 'analyzeEntry' branch), so every switch closes the
  // Analyze results stage.
  it('clears the Analyze stage flag on every switch', () => {
    useAnalyzeEntryStore.setState({ analyzeStage: true });

    switchMode('recent');

    expect(useAnalyzeEntryStore.getState().analyzeStage).toBe(false);
  });

  it('clears the Analyze stage flag even on a boot switch', () => {
    useAnalyzeEntryStore.setState({ analyzeStage: true });

    switchMode('reportcard', { boot: true });

    expect(useAnalyzeEntryStore.getState().analyzeStage).toBe(false);
  });

  // #1510: Report Card is hidden in Simple mode (#1512); its results now live
  // in Analyze's results rail (#1505), so every switchMode('reportcard') call
  // while in Simple mode must redirect to the Analyze stage instead.
  describe('reportcard redirect in Simple mode (#1510)', () => {
    it('redirects to the Analyze stage instead of switching to Report Card', () => {
      useSettingsStore.setState({ settings: settings({ advancedFeaturesEnabled: false }) });

      switchMode('reportcard');

      expect(useLiveCaptureStore.getState().appMode).toBe('analyze');
      expect(bodyClassList.contains('rc-active')).toBe(false);
      expect(elements['reportcard-view'].classList.contains('active')).toBe(false);
      expect(useAnalyzeEntryStore.getState().analyzeStage).toBe(true);
    });

    it('does not record screen.reportcard or add rc-active', () => {
      useSettingsStore.setState({ settings: settings({ advancedFeaturesEnabled: false }) });
      const spy = vi.spyOn(mock.api, 'recordAppEvent');

      switchMode('reportcard');

      expect(spy).not.toHaveBeenCalledWith('screen.reportcard');
      expect(spy).toHaveBeenCalledWith('screen.analyze');
      expect(bodyClassList.contains('rc-active')).toBe(false);
    });

    it('switches to Report Card as usual in Advanced mode', () => {
      useSettingsStore.setState({ settings: settings({ advancedFeaturesEnabled: true }) });

      switchMode('reportcard');

      expect(useLiveCaptureStore.getState().appMode).toBe('reportcard');
      expect(bodyClassList.contains('rc-active')).toBe(true);
    });

    it('switches to Report Card as usual with settings still null', () => {
      switchMode('reportcard');

      expect(useLiveCaptureStore.getState().appMode).toBe('reportcard');
      expect(bodyClassList.contains('rc-active')).toBe(true);
    });
  });
});

describe('showAnalyzeStage (#1510)', () => {
  it('sets appMode analyze, clears the Report Card/Live DOM state, opens the stage, and records + persists', () => {
    bodyClassList.add('rc-active');
    bodyClassList.add('live-active');
    elements['reportcard-view'].classList.add('active');
    tabContentEls.forEach((el) => el.classList.add('active'));
    const eventSpy = vi.spyOn(mock.api, 'recordAppEvent');
    const settingsSpy = vi.spyOn(mock.api, 'updateSettings');

    showAnalyzeStage();

    expect(useLiveCaptureStore.getState().appMode).toBe('analyze');
    expect(bodyClassList.contains('rc-active')).toBe(false);
    expect(bodyClassList.contains('live-active')).toBe(false);
    expect(elements['reportcard-view'].classList.contains('active')).toBe(false);
    tabContentEls.forEach((el) => expect(el.classList.contains('active')).toBe(false));
    expect(useAnalyzeEntryStore.getState().analyzeStage).toBe(true);
    expect(eventSpy).toHaveBeenCalledWith('screen.analyze');
    expect(settingsSpy).toHaveBeenCalledWith({ lastAppMode: 'analyze' });
    expect(useAnalyzeEntryStore.getState().listening).toBe(false);
    expect(useAnalyzeEntryStore.getState().dialogOpen).toBe(false);
  });

  it('boot: true does not persist the mode', () => {
    const settingsSpy = vi.spyOn(mock.api, 'updateSettings');

    showAnalyzeStage({ boot: true });

    expect(settingsSpy).not.toHaveBeenCalled();
    expect(useLiveCaptureStore.getState().appMode).toBe('analyze');
  });
});

describe('applyInitialMode (#1510)', () => {
  it("'analyze' shows the stage and never writes settings", () => {
    const settingsSpy = vi.spyOn(mock.api, 'updateSettings');

    applyInitialMode('analyze');

    expect(useLiveCaptureStore.getState().appMode).toBe('analyze');
    expect(useAnalyzeEntryStore.getState().analyzeStage).toBe(true);
    expect(settingsSpy).not.toHaveBeenCalled();
  });

  it('a workspace mode boots through switchMode without auto-start or a settings write', () => {
    useRigStore.setState({ activeRigId: 'rig-1' });
    const startCapture = vi.spyOn(useLiveCaptureStore.getState(), 'startCapture').mockResolvedValue(undefined);
    const settingsSpy = vi.spyOn(mock.api, 'updateSettings');

    applyInitialMode('live');

    expect(useLiveCaptureStore.getState().appMode).toBe('live');
    expect(startCapture).not.toHaveBeenCalled();
    expect(settingsSpy).not.toHaveBeenCalled();
  });

  it('an unknown mode is a no-op', () => {
    applyInitialMode('bogus');

    expect(useLiveCaptureStore.getState().appMode).toBe('reportcard');
  });
});

describe('maybeAutoStartLive', () => {
  it('logs a live-auto-start line with the start decision', () => {
    useRigStore.setState({ activeRigId: 'rig-1' });
    vi.spyOn(useLiveCaptureStore.getState(), 'startCapture').mockResolvedValue(undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    maybeAutoStartLive();

    expect(logSpy).toHaveBeenCalledWith('live-auto-start', { type: 'start' });
  });

  it('logs a live-auto-start line with the skip reason', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    maybeAutoStartLive();

    expect(logSpy).toHaveBeenCalledWith('live-auto-start', { type: 'skip', reason: 'no-last-used-device' });
  });
});

describe('restoreBootMode', () => {
  it('awaits hydration before reading settings or rigStore state', async () => {
    let resolveHydration!: () => void;
    const hydration = new Promise<void>((resolve) => { resolveHydration = resolve; });
    useSettingsStore.setState({ settings: settings({ lastAppMode: 'live' }) });
    const spy = vi.spyOn(mock.api, 'recordAppEvent');

    const done = restoreBootMode({
      hydration,
      getLastAppMode: () => useSettingsStore.getState().settings?.lastAppMode,
      getCurrentMode: () => useLiveCaptureStore.getState().appMode,
      getSettings: () => useSettingsStore.getState().settings,
    });

    expect(spy).not.toHaveBeenCalled();
    resolveHydration();
    await done;
    expect(spy).toHaveBeenCalledWith('screen.live');
  });

  it('restores a saved mode that differs from the current (boot-default) mode', async () => {
    useSettingsStore.setState({ settings: settings({ lastAppMode: 'live' }) });

    await restoreBootMode({
      hydration: Promise.resolve(),
      getLastAppMode: () => useSettingsStore.getState().settings?.lastAppMode,
      getCurrentMode: () => 'reportcard',
      getSettings: () => useSettingsStore.getState().settings,
    });

    expect(useLiveCaptureStore.getState().appMode).toBe('live');
  });

  it('runs the auto-start decision (no mode switch) when the saved mode matches the current mode', async () => {
    useLiveCaptureStore.setState({ appMode: 'live' });
    useSettingsStore.setState({ settings: settings({ lastAppMode: 'live' }) });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await restoreBootMode({
      hydration: Promise.resolve(),
      getLastAppMode: () => useSettingsStore.getState().settings?.lastAppMode,
      getCurrentMode: () => useLiveCaptureStore.getState().appMode,
      getSettings: () => useSettingsStore.getState().settings,
    });

    expect(logSpy).toHaveBeenCalledWith('live-auto-start', expect.anything());
  });

  it('does nothing when no mode was ever saved and the current mode is not live', async () => {
    useSettingsStore.setState({ settings: settings({ lastAppMode: '' }) });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await restoreBootMode({
      hydration: Promise.resolve(),
      getLastAppMode: () => useSettingsStore.getState().settings?.lastAppMode,
      getCurrentMode: () => 'reportcard',
      getSettings: () => useSettingsStore.getState().settings,
    });

    expect(useLiveCaptureStore.getState().appMode).toBe('reportcard');
    expect(logSpy).not.toHaveBeenCalled();
  });

  // #1510: clampBootMode's fallback is 'analyze' for every unrecognized mode
  // now, not just hidden Simple-mode ones — a stale saved value lands on the
  // Analyze stage rather than silently staying on the boot default.
  it('clamps a stale/unrecognized saved mode to analyze', async () => {
    useSettingsStore.setState({ settings: settings({ lastAppMode: 'soundcheck' }) });

    await restoreBootMode({
      hydration: Promise.resolve(),
      getLastAppMode: () => useSettingsStore.getState().settings?.lastAppMode,
      getCurrentMode: () => 'reportcard',
      getSettings: () => useSettingsStore.getState().settings,
    });

    expect(useLiveCaptureStore.getState().appMode).toBe('analyze');
  });

  it('clamps a saved hidden mode to analyze in Simple mode (#1510)', async () => {
    useSettingsStore.setState({ settings: settings({ advancedFeaturesEnabled: false, lastAppMode: 'live' }) });

    await restoreBootMode({
      hydration: Promise.resolve(),
      getLastAppMode: () => useSettingsStore.getState().settings?.lastAppMode,
      getCurrentMode: () => 'reportcard',
      getSettings: () => useSettingsStore.getState().settings,
    });

    expect(useLiveCaptureStore.getState().appMode).toBe('analyze');
  });

  // #1510: a Simple-mode user's persisted 'reportcard' (saved before #1512
  // hid the tab, or written by a stale build) must clamp to 'analyze' and
  // land there, never on a tab-less Report Card workspace.
  it('a saved reportcard mode in Simple mode with current already analyze stays put with no switch', async () => {
    useSettingsStore.setState({ settings: settings({ advancedFeaturesEnabled: false, lastAppMode: 'reportcard' }) });
    useLiveCaptureStore.setState({ appMode: 'analyze' });
    const spy = vi.spyOn(mock.api, 'recordAppEvent');

    await restoreBootMode({
      hydration: Promise.resolve(),
      getLastAppMode: () => useSettingsStore.getState().settings?.lastAppMode,
      getCurrentMode: () => useLiveCaptureStore.getState().appMode,
      getSettings: () => useSettingsStore.getState().settings,
    });

    expect(useLiveCaptureStore.getState().appMode).toBe('analyze');
    expect(spy).not.toHaveBeenCalledWith('screen.analyze');
  });

  it('a saved reportcard mode in Simple mode with a different current mode shows the Analyze stage', async () => {
    useSettingsStore.setState({ settings: settings({ advancedFeaturesEnabled: false, lastAppMode: 'reportcard' }) });

    await restoreBootMode({
      hydration: Promise.resolve(),
      getLastAppMode: () => useSettingsStore.getState().settings?.lastAppMode,
      getCurrentMode: () => 'recent',
      getSettings: () => useSettingsStore.getState().settings,
    });

    expect(useLiveCaptureStore.getState().appMode).toBe('analyze');
    expect(useAnalyzeEntryStore.getState().analyzeStage).toBe(true);
  });

  it('a saved reportcard mode in Advanced mode still switches to Report Card', async () => {
    useSettingsStore.setState({ settings: settings({ advancedFeaturesEnabled: true, lastAppMode: 'reportcard' }) });

    await restoreBootMode({
      hydration: Promise.resolve(),
      getLastAppMode: () => useSettingsStore.getState().settings?.lastAppMode,
      getCurrentMode: () => 'analyze',
      getSettings: () => useSettingsStore.getState().settings,
    });

    expect(useLiveCaptureStore.getState().appMode).toBe('reportcard');
    expect(bodyClassList.contains('rc-active')).toBe(true);
  });
});
