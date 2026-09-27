// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// #1579: call-through spy so the silent-redirect tests can assert the
// auto-listen decision helper is never consulted outside restoreBootMode's
// post-hydration tail. Every other export (and the helper's real behavior)
// is untouched.
vi.mock('./analyze-entry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./analyze-entry')>();
  return { ...actual, decideAnalyzeHomeAutoListen: vi.fn(actual.decideAnalyzeHomeAutoListen) };
});
import {
  resolveModeSwitch,
  isWorkspaceMode,
  switchMode,
  openReportCard,
  showAnalyzeStage,
  enterAnalyzeFromTab,
  applyInitialMode,
  applySpectrumForMode,
  applySingleColumnSync,
  maybeAutoStartLive,
  maybeAutoListenAnalyzeHome,
  restoreBootMode,
} from './mode-switch';
import { analyzeLiveEqView } from './analyze-live-eq';
import { decideAnalyzeHomeAutoListen, analyzeModeOf } from './analyze-entry';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useRigStore } from './stores/rigStore';
import { useSettingsStore } from './stores/settingsStore';
import { useSpectrumStore } from './stores/spectrumStore';
import { useAnalysisStore } from './stores/analysisStore';
import { useAnalyzeEntryStore } from './stores/analyzeEntryStore';
import { spectrumTransport } from './spectrum-transport';
import { createMockSoundBuddy } from './mock-sound-buddy';
import { ALL_TAB_MODES } from './simple-mode';
import { loadHistoryEntry } from './RecentServicesPanel';
import { createOnboardingStore, type OnboardingApi } from './stores/onboardingStore';
import type { AppSettings, AnalysisSummary } from '../../electron/ipc/api';
import { ALL_FEATURE_FLAGS_OFF, resolveFeatureFlags } from '../../electron/feature-flags';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ALL_FEATURE_FLAGS_ON = resolveFeatureFlags({ SOUND_BUDDY_FEATURES: 'all' });

// #1619: loadHistoryEntry's clear path calls resetLapCoaching (store-owned
// coaching state, TD-001 slice 6g #710) — the classic script it reads off
// window, same require as RecentServicesPanel.test.ts.
const liveAdjustmentsState = require('../live-adjustments-state.js');

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
// Same zustand set-forwarding gotcha as REAL_START_CAPTURE above, for #1577's
// secondary-measurement auto-listen tests.
const REAL_START_SECONDARY_MEASUREMENT = useLiveCaptureStore.getState().startSecondaryMeasurement;
// Same gotcha, for #1619's onboarding redirect tests, which stub startAnalysis.
const REAL_START_ANALYSIS = useAnalysisStore.getState().startAnalysis;

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
  // #1520: this file's tests exercise real workspace switches, so default to
  // every flag on here — the dedicated 'feature-flag gate' describe block
  // below overrides this per-test to exercise the off/on redirect itself.
  useSettingsStore.setState({ featureFlags: ALL_FEATURE_FLAGS_ON });

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
    // #1619: loadHistoryEntry's clear path calls resetLapCoaching, which
    // reads this classic-script global (same require as RecentServicesPanel.test.ts).
    liveAdjustmentsState,
  };
});

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { window?: unknown }).window;
  vi.restoreAllMocks();
  useLiveCaptureStore.setState({
    appMode: 'reportcard', isCapturing: false, liveMode: 'monitor', deviceHint: null, rigApplyNotice: null,
    startCapture: REAL_START_CAPTURE, startSecondaryMeasurement: REAL_START_SECONDARY_MEASUREMENT,
    secondaryMeasurement: { status: 'off', deviceName: '' },
  });
  useRigStore.setState({ activeRigId: null });
  useSettingsStore.setState({ settings: null, settingsError: null, featureFlags: ALL_FEATURE_FLAGS_OFF });
  useAnalysisStore.setState({
    currentAnalysis: null, startAnalysis: REAL_START_ANALYSIS, historySummary: null,
    selectedFilePath: null, prevSummary: null,
  });
  useAnalyzeEntryStore.setState({ analyzeStage: false, listening: false, dialogOpen: false });
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

  // #1520: the non-hedgehog workspace gate — switchMode is the single
  // chokepoint every programmatic caller and restoreBootMode's restored
  // lastAppMode flow through.
  describe('feature-flag gate (#1520)', () => {
    it.each(['console', 'live', 'reportcard'] as const)(
      '%s redirects to the Analyze stage in Advanced mode when its flag is off',
      (mode) => {
        useSettingsStore.setState({ settings: settings({ advancedFeaturesEnabled: true }), featureFlags: ALL_FEATURE_FLAGS_OFF });

        switchMode(mode);

        expect(useLiveCaptureStore.getState().appMode).toBe('analyze');
        expect(bodyClassList.contains('rc-active')).toBe(false);
        expect(bodyClassList.contains('live-active')).toBe(false);
      },
    );

    it('console proceeds as usual once its flag is on', () => {
      useSettingsStore.setState({
        settings: settings({ advancedFeaturesEnabled: true }),
        featureFlags: resolveFeatureFlags({ SOUND_BUDDY_FEATURES: 'console' }),
      });

      switchMode('console');

      expect(useLiveCaptureStore.getState().appMode).toBe('console');
    });

    it("'recent' (the History path) still works with every flag off", () => {
      useSettingsStore.setState({ settings: settings({ advancedFeaturesEnabled: true }), featureFlags: ALL_FEATURE_FLAGS_OFF });

      switchMode('recent');

      expect(useLiveCaptureStore.getState().appMode).toBe('recent');
    });
  });
});

// #1508: the one programmatic path to Report Card that does not click the
// peer .mode-tab button (#1507 removes it from Advanced). Must match a tab
// click's resolve -> switch sequence exactly, including its noop and
// Simple-mode-redirect behavior.
describe('openReportCard (#1508)', () => {
  it('switches to Report Card from another workspace mode', () => {
    useSettingsStore.setState({ settings: settings({ advancedFeaturesEnabled: true }) });
    useLiveCaptureStore.setState({ appMode: 'recent' });
    const spy = vi.spyOn(mock.api, 'recordAppEvent');

    openReportCard();

    expect(useLiveCaptureStore.getState().appMode).toBe('reportcard');
    expect(bodyClassList.contains('rc-active')).toBe(true);
    expect(spy).toHaveBeenCalledWith('screen.reportcard');
  });

  it('is a noop when already on Report Card, same as a tab click', () => {
    useSettingsStore.setState({ settings: settings({ advancedFeaturesEnabled: true }) });
    useLiveCaptureStore.setState({ appMode: 'reportcard' });
    const spy = vi.spyOn(mock.api, 'recordAppEvent');

    openReportCard();

    expect(spy).not.toHaveBeenCalled();
    expect(useLiveCaptureStore.getState().appMode).toBe('reportcard');
  });

  it('redirects to the Analyze stage in Simple mode', () => {
    useSettingsStore.setState({ settings: settings({ advancedFeaturesEnabled: false }) });
    useLiveCaptureStore.setState({ appMode: 'recent' });

    openReportCard();

    expect(useLiveCaptureStore.getState().appMode).toBe('analyze');
    expect(bodyClassList.contains('rc-active')).toBe(false);
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

describe('enterAnalyzeFromTab (#1588)', () => {
  let startSecondaryMeasurement: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.mocked(decideAnalyzeHomeAutoListen).mockClear();
    startSecondaryMeasurement = vi.spyOn(useLiveCaptureStore.getState(), 'startSecondaryMeasurement')
      .mockResolvedValue(undefined);
  });

  it('Session -> Analyze with a configured room mic lands appMode and starts listening (AC1 + AC2)', async () => {
    useLiveCaptureStore.setState({
      appMode: 'live',
      secondaryMeasurement: { status: 'off', deviceName: 'UMIK-1' },
    });
    bodyClassList.add('live-active');

    await enterAnalyzeFromTab();

    const live = useLiveCaptureStore.getState();
    const entry = useAnalyzeEntryStore.getState();
    expect(live.appMode).toBe('analyze');
    expect(bodyClassList.contains('live-active')).toBe(false);
    expect(entry.analyzeStage).toBe(true);
    expect(entry.listening).toBe(true);
    expect(entry.dialogOpen).toBe(false);
    expect(startSecondaryMeasurement).toHaveBeenCalledTimes(1);
    expect(analyzeLiveEqView({
      listening: entry.listening,
      analyzeStage: entry.analyzeStage,
      appMode: live.appMode,
      secondary: live.secondaryMeasurement,
      override: null,
    })).not.toEqual({ kind: 'hidden' });
  });

  it('Session -> Analyze with no room mic opens the entry dialog instead (AC2 dialog fork)', async () => {
    useLiveCaptureStore.setState({
      appMode: 'live',
      secondaryMeasurement: { status: 'off', deviceName: '' },
    });
    bodyClassList.add('live-active');

    await enterAnalyzeFromTab();

    expect(useLiveCaptureStore.getState().appMode).toBe('analyze');
    expect(bodyClassList.contains('live-active')).toBe(false);
    expect(useAnalyzeEntryStore.getState().dialogOpen).toBe(true);
    expect(useAnalyzeEntryStore.getState().listening).toBe(false);
    expect(startSecondaryMeasurement).not.toHaveBeenCalled();
  });

  it('clears Report Card / tab-content chrome too, and records + persists the landing', async () => {
    useLiveCaptureStore.setState({
      appMode: 'reportcard',
      secondaryMeasurement: { status: 'off', deviceName: '' },
    });
    bodyClassList.add('rc-active');
    elements['reportcard-view'].classList.add('active');
    tabContentEls.forEach((el) => el.classList.add('active'));
    const eventSpy = vi.spyOn(mock.api, 'recordAppEvent');
    const settingsSpy = vi.spyOn(mock.api, 'updateSettings');

    await enterAnalyzeFromTab();

    expect(bodyClassList.contains('rc-active')).toBe(false);
    expect(elements['reportcard-view'].classList.contains('active')).toBe(false);
    tabContentEls.forEach((el) => expect(el.classList.contains('active')).toBe(false));
    expect(eventSpy).toHaveBeenCalledWith('screen.analyze');
    expect(settingsSpy).toHaveBeenCalledWith({ lastAppMode: 'analyze' });
  });

  it('already on Analyze does no teardown, writes no settings and records no event', async () => {
    useLiveCaptureStore.setState({
      appMode: 'analyze',
      secondaryMeasurement: { status: 'off', deviceName: '' },
    });
    bodyClassList.add('live-active');
    const eventSpy = vi.spyOn(mock.api, 'recordAppEvent');
    const settingsSpy = vi.spyOn(mock.api, 'updateSettings');

    await enterAnalyzeFromTab();

    expect(eventSpy).not.toHaveBeenCalled();
    expect(settingsSpy).not.toHaveBeenCalled();
    expect(bodyClassList.contains('live-active')).toBe(true);
    expect(useAnalyzeEntryStore.getState().dialogOpen).toBe(true);
  });

  it('an already-listening capture is a no-op for the room mic', async () => {
    useLiveCaptureStore.setState({
      appMode: 'live',
      secondaryMeasurement: { status: 'off', deviceName: 'UMIK-1' },
    });
    useAnalyzeEntryStore.setState({ listening: true });

    await enterAnalyzeFromTab();

    expect(useLiveCaptureStore.getState().appMode).toBe('analyze');
    expect(startSecondaryMeasurement).not.toHaveBeenCalled();
  });

  it('never consults the cold-boot auto-listen decision', async () => {
    useLiveCaptureStore.setState({
      appMode: 'live',
      secondaryMeasurement: { status: 'off', deviceName: 'UMIK-1' },
    });

    await enterAnalyzeFromTab();

    expect(vi.mocked(decideAnalyzeHomeAutoListen)).not.toHaveBeenCalled();
  });

  // #1603: the AC is an ordering guarantee, not just an end-state — pins
  // that the workspace teardown (appMode -> 'analyze', live-active cleared)
  // has already happened by the time enterAnalyze()'s listen/dialog entry
  // rule runs, not merely by the time enterAnalyzeFromTab() resolves.
  it('lands appMode analyze and clears live-active before the entry rule runs (#1603)', async () => {
    useLiveCaptureStore.setState({
      appMode: 'live',
      secondaryMeasurement: { status: 'off', deviceName: '' },
    });
    bodyClassList.add('live-active');
    const seen: { appMode: string; liveActive: boolean }[] = [];
    const enterSpy = vi.spyOn(useAnalyzeEntryStore.getState(), 'enterAnalyze')
      .mockImplementation(async () => {
        seen.push({
          appMode: useLiveCaptureStore.getState().appMode,
          liveActive: bodyClassList.contains('live-active'),
        });
      });

    await enterAnalyzeFromTab();

    expect(enterSpy).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([{ appMode: 'analyze', liveActive: false }]);
    enterSpy.mockRestore();
  });
});

// #1606: pins ADR-0141's structural isolation (Session's docked LiveEqPane
// vs. Analyze's live-EQ island) through the real switchMode/enterAnalyzeFromTab
// composition, guarding against a future mode-switch change silently showing
// both surfaces or leaving appMode wrong on return to Session.
describe('ADR-0141 isolation across Session <-> Analyze (#1606)', () => {
  beforeEach(() => {
    vi.spyOn(useLiveCaptureStore.getState(), 'startSecondaryMeasurement').mockResolvedValue(undefined);
  });

  // Mirrors LiveEqPane.tsx:269's `pane.style.display = s.appMode === 'live'
  // ? 'flex' : 'none'` (sessionPane) and AnalyzeLiveEqPanel's use of
  // analyzeLiveEqView (analyzeIsland) — the same two visibility rules the
  // real DOM renders from.
  function surfaces(): { sessionPane: boolean; analyzeIsland: boolean } {
    const live = useLiveCaptureStore.getState();
    const entry = useAnalyzeEntryStore.getState();
    return {
      sessionPane: live.appMode === 'live',
      analyzeIsland: analyzeLiveEqView({
        listening: entry.listening, analyzeStage: entry.analyzeStage, appMode: live.appMode,
        secondary: live.secondaryMeasurement, override: null,
      }).kind !== 'hidden',
    };
  }

  it('Session -> Analyze -> Session -> Analyze never shows both surfaces at once', async () => {
    useLiveCaptureStore.setState({ secondaryMeasurement: { status: 'off', deviceName: 'UMIK-1' } });
    const snapshots: { sessionPane: boolean; analyzeIsland: boolean }[] = [];

    switchMode('live');
    snapshots.push(surfaces());
    expect(surfaces()).toEqual({ sessionPane: true, analyzeIsland: false });

    await enterAnalyzeFromTab();
    snapshots.push(surfaces());
    expect(surfaces()).toEqual({ sessionPane: false, analyzeIsland: true });
    expect(useAnalyzeEntryStore.getState().listening).toBe(true);

    switchMode('live');
    snapshots.push(surfaces());
    expect(surfaces()).toEqual({ sessionPane: true, analyzeIsland: false });

    await enterAnalyzeFromTab();
    snapshots.push(surfaces());
    expect(surfaces()).toEqual({ sessionPane: false, analyzeIsland: true });

    expect(snapshots.every((s) => !(s.sessionPane && s.analyzeIsland))).toBe(true);
  });

  it('returning to Session after an Analyze listen restores appMode live and hides the island', async () => {
    useLiveCaptureStore.setState({
      appMode: 'live',
      secondaryMeasurement: { status: 'off', deviceName: 'UMIK-1' },
    });

    await enterAnalyzeFromTab();
    expect(useAnalyzeEntryStore.getState().listening).toBe(true);

    switchMode('live');

    expect(useLiveCaptureStore.getState().appMode).toBe('live');
    expect(bodyClassList.contains('live-active')).toBe(true);
    expect(elements['tab-live'].classList.contains('active')).toBe(true);
    expect(useAnalyzeEntryStore.getState().analyzeStage).toBe(false);
    // ADR-0145: switchMode never touches `listening` — the appMode gate
    // alone is what keeps the island hidden here.
    expect(useAnalyzeEntryStore.getState().listening).toBe(true);
    expect(surfaces()).toEqual({ sessionPane: true, analyzeIsland: false });
  });

  it('the entry-dialog fork (no room mic) also leaves Session with the pane and no island', async () => {
    useLiveCaptureStore.setState({
      appMode: 'live',
      secondaryMeasurement: { status: 'off', deviceName: '' },
    });

    switchMode('live');
    await enterAnalyzeFromTab();

    expect(useAnalyzeEntryStore.getState().dialogOpen).toBe(true);
    // analyzeStage true + !listening -> analyzeLiveEqView's { kind: 'file' }
    // branch, so the island itself is visible even before a device is set.
    expect(surfaces()).toEqual({ sessionPane: false, analyzeIsland: true });

    switchMode('live');

    expect(surfaces()).toEqual({ sessionPane: true, analyzeIsland: false });
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

// #1579: regression guard for the ADR-0146 amendment — restoreBootMode's tail
// is the ONE permitted auto-listen call site. Every redirect route that also
// reaches showAnalyzeStage (History/File>Open/onboarding, the Simple-mode and
// flag-off Report Card redirects, openReportCard, restoreBootMode's own
// restored-mode redirect) and the pre-hydration boot paint
// (applyInitialMode('analyze')) must stay silent even with a configured
// measurement device present — the exact state in which auto-listen would
// otherwise fire.
describe('silent showAnalyzeStage redirects (#1579)', () => {
  let startSecondaryMeasurement: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.mocked(decideAnalyzeHomeAutoListen).mockClear();
    // The exact state in which maybeAutoListenAnalyzeHome would decide 'startListening'.
    useLiveCaptureStore.setState({ appMode: 'recent', secondaryMeasurement: { status: 'off', deviceName: 'UMIK-1' } });
    startSecondaryMeasurement = vi.spyOn(useLiveCaptureStore.getState(), 'startSecondaryMeasurement')
      .mockResolvedValue(undefined);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  function expectSilent() {
    expect(useLiveCaptureStore.getState().appMode).toBe('analyze');
    expect(vi.mocked(decideAnalyzeHomeAutoListen)).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalledWith('analyze-auto-listen', expect.anything());
    expect(useAnalyzeEntryStore.getState().listening).toBe(false);
    expect(useAnalyzeEntryStore.getState().dialogOpen).toBe(false);
    expect(startSecondaryMeasurement).not.toHaveBeenCalled();
  }

  it('showAnalyzeStage() — the History, File > Open and onboarding route — never runs the auto-listen decision', () => {
    showAnalyzeStage();

    expectSilent();
  });

  it('Simple-mode Report Card redirect stays silent', () => {
    useSettingsStore.setState({ settings: settings({ advancedFeaturesEnabled: false }) });

    switchMode('reportcard');

    expectSilent();
  });

  it('flag-off Report Card redirect stays silent', () => {
    useSettingsStore.setState({
      settings: settings({ advancedFeaturesEnabled: true }),
      featureFlags: ALL_FEATURE_FLAGS_OFF,
    });

    switchMode('reportcard');

    expectSilent();
  });

  it('openReportCard() in Simple mode stays silent', () => {
    useSettingsStore.setState({ settings: settings({ advancedFeaturesEnabled: false }) });

    openReportCard();

    expectSilent();
  });

  // #1619: the flag-off redirect's openReportCard() variant — the direct
  // switchMode('reportcard') call above already pins the flag-off path, but
  // openReportCard() is the other real caller (#1508) and had no dedicated
  // flag-off case yet.
  it('flag-off Report Card redirect via openReportCard() stays silent', () => {
    useSettingsStore.setState({
      settings: settings({ advancedFeaturesEnabled: true }),
      featureFlags: ALL_FEATURE_FLAGS_OFF,
    });
    useLiveCaptureStore.setState({ appMode: 'recent', secondaryMeasurement: { status: 'off', deviceName: 'UMIK-1' } });

    openReportCard();

    expectSilent();
  });

  // #1619: the REAL History caller — #1579 above only exercises
  // showAnalyzeStage() directly as a stand-in. RecentServicesPanel's row
  // click calls loadHistoryEntry(), which does its own store writes before
  // landing on showAnalyzeStage(); this proves that real route stays silent
  // too, and that it actually ran (not just a vacuous pass) via the
  // historySummary assertion.
  it('History route: loadHistoryEntry() stays silent with a configured measurement device', () => {
    const summary: AnalysisSummary = {
      date: '2026-08-01T12:00:00Z', sourceFilename: 'sunday.wav', gradeLetter: 'A', score: 95,
      recordingType: 'Full Mix', topFixes: [],
    };

    loadHistoryEntry(summary, null);

    expectSilent();
    expect(useAnalysisStore.getState().historySummary).toEqual(summary);
  });

  // #1619: the REAL onboarding caller — createOnboardingStore(getApi)'s
  // runFirstAnalysis, exercised on both its demo and no-demo (file-picker
  // fallback) branches. Neither branch may consult the auto-listen decision.
  describe('onboarding redirect (runFirstAnalysis)', () => {
    function onboardingApi(overrides: Partial<OnboardingApi> = {}): OnboardingApi {
      return {
        isOnboardingDisabled: vi.fn().mockResolvedValue(false),
        getDemoAudio: vi.fn().mockResolvedValue('/demo/first-run.wav'),
        openFileDialog: vi.fn().mockResolvedValue(null),
        ...overrides,
      };
    }

    it('runFirstAnalysis with the bundled demo stays silent', async () => {
      useAnalysisStore.setState({ startAnalysis: vi.fn().mockResolvedValue(undefined) });
      const store = createOnboardingStore(() => onboardingApi());

      await store.getState().runFirstAnalysis();

      expectSilent();
      expect(useAnalysisStore.getState().selectedFilePath).toBe('/demo/first-run.wav');
    });

    it('runFirstAnalysis with no bundled demo (file-picker fallback) stays silent', async () => {
      useAnalysisStore.setState({ startAnalysis: vi.fn().mockResolvedValue(undefined) });
      const openFileDialog = vi.fn().mockResolvedValue(null);
      const store = createOnboardingStore(() => onboardingApi({ getDemoAudio: vi.fn().mockResolvedValue(null), openFileDialog }));

      await store.getState().runFirstAnalysis();

      expectSilent();
      expect(openFileDialog).toHaveBeenCalledTimes(1);
    });
  });

  // #1619: static guard keeping the auto-listen call site (and the decision
  // helper it consults) unique, so a future redirect can't silently re-wire
  // itself onto the cold-boot auto-listen path without this suite going red.
  it('redirect guard: maybeAutoListenAnalyzeHome is called only from restoreBootMode and decideAnalyzeHomeAutoListen only from mode-switch.ts', () => {
    const srcDir = fileURLToPath(new URL('.', import.meta.url));

    function listRendererSources(dir: string): string[] {
      const out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          out.push(...listRendererSources(full));
        } else if (/\.(ts|tsx|js)$/.test(entry.name) && !/\.test\.(ts|tsx|js)$/.test(entry.name)) {
          out.push(full);
        }
      }
      return out;
    }

    const files = listRendererSources(srcDir);
    const modeSwitchFile = files.find((f) => f.endsWith('/mode-switch.ts'));
    if (!modeSwitchFile) throw new Error('mode-switch.ts not found under renderer src');
    const modeSwitchSrc = fs.readFileSync(modeSwitchFile, 'utf8');

    // Auto-listen call sites: exactly one, and it lives in mode-switch.ts.
    let callSiteCount = 0;
    let callSiteFile = '';
    let callSiteIndexInModeSwitch = -1;
    for (const file of files) {
      const src = file === modeSwitchFile ? modeSwitchSrc : fs.readFileSync(file, 'utf8');
      const matches = src.match(/\bmaybeAutoListenAnalyzeHome\(\)/g) ?? [];
      // Exclude the function's own definition site.
      const defMarker = 'function maybeAutoListenAnalyzeHome()';
      const defIdx = src.indexOf(defMarker);
      const callCount = defIdx === -1 ? matches.length : matches.length - 1;
      if (callCount <= 0) continue;
      callSiteCount += callCount;
      callSiteFile = file;
      if (file === modeSwitchFile) {
        callSiteIndexInModeSwitch = src.indexOf('maybeAutoListenAnalyzeHome()', defIdx + defMarker.length);
      }
    }
    expect(callSiteCount).toBe(1);
    expect(callSiteFile).toBe(modeSwitchFile);

    // The call must fall inside restoreBootMode, the last function in the file.
    const restoreBootModeStart = modeSwitchSrc.indexOf('export async function restoreBootMode(');
    expect(restoreBootModeStart).toBeGreaterThan(-1);
    expect(callSiteIndexInModeSwitch).toBeGreaterThan(restoreBootModeStart);

    // decideAnalyzeHomeAutoListen is referenced by no non-test renderer module
    // other than analyze-entry.ts (its definition) and mode-switch.ts (its
    // one consumer).
    const referencingFiles = files.filter((file) => {
      const src = file === modeSwitchFile ? modeSwitchSrc : fs.readFileSync(file, 'utf8');
      return src.includes('decideAnalyzeHomeAutoListen');
    });
    const referencingBasenames = referencingFiles.map((f) => f.slice(f.lastIndexOf('/') + 1)).sort();
    expect(referencingBasenames).toEqual(['analyze-entry.ts', 'mode-switch.ts']);
  });

  it("restoreBootMode's restored-analyze redirect stays silent", async () => {
    useSettingsStore.setState({ settings: settings({ lastAppMode: 'reportcard', advancedFeaturesEnabled: false }) });

    await restoreBootMode({
      hydration: Promise.resolve(),
      getLastAppMode: () => useSettingsStore.getState().settings?.lastAppMode,
      getCurrentMode: () => useLiveCaptureStore.getState().appMode,
      getSettings: () => useSettingsStore.getState().settings,
    });

    expectSilent();
  });

  it("pre-hydration boot paint (applyInitialMode('analyze')) stays silent", () => {
    applyInitialMode('analyze');

    expectSilent();
    expect(useAnalyzeEntryStore.getState().analyzeStage).toBe(true);
  });

  it('showAnalyzeStage({ boot: true }) stays silent', () => {
    showAnalyzeStage({ boot: true });

    expectSilent();
  });

  // Positive control: proves the spy is wired and the negative assertions
  // above are not passing vacuously.
  it('restoreBootMode on the still-analyze boot home is the one path that consults the decision', async () => {
    useLiveCaptureStore.setState({ appMode: 'analyze', secondaryMeasurement: { status: 'off', deviceName: 'UMIK-1' } });
    useSettingsStore.setState({ settings: settings({ lastAppMode: 'analyze' }) });

    await restoreBootMode({
      hydration: Promise.resolve(),
      getLastAppMode: () => useSettingsStore.getState().settings?.lastAppMode,
      getCurrentMode: () => useLiveCaptureStore.getState().appMode,
      getSettings: () => useSettingsStore.getState().settings,
    });

    expect(vi.mocked(decideAnalyzeHomeAutoListen)).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith('analyze-auto-listen', { decision: 'startListening' });
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

describe('maybeAutoListenAnalyzeHome (#1577, #1578)', () => {
  it('logs and starts listening when on the Analyze home with a configured device', () => {
    useLiveCaptureStore.setState({ appMode: 'analyze', secondaryMeasurement: { status: 'off', deviceName: 'UMIK-1' } });
    const startSecondaryMeasurement = vi.spyOn(useLiveCaptureStore.getState(), 'startSecondaryMeasurement')
      .mockResolvedValue(undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    maybeAutoListenAnalyzeHome();

    expect(logSpy).toHaveBeenCalledWith('analyze-auto-listen', { decision: 'startListening' });
    expect(useAnalyzeEntryStore.getState().listening).toBe(true);
    expect(useAnalyzeEntryStore.getState().dialogOpen).toBe(false);
    expect(startSecondaryMeasurement).toHaveBeenCalledTimes(1);
  });

  it('logs noDevice and never opens a dialog or the Settings > Audio surface when no device is configured (#1578)', () => {
    useLiveCaptureStore.setState({ appMode: 'analyze', secondaryMeasurement: { status: 'off', deviceName: '' } });
    const startSecondaryMeasurement = vi.spyOn(useLiveCaptureStore.getState(), 'startSecondaryMeasurement')
      .mockResolvedValue(undefined);
    const openDialog = vi.spyOn(useSettingsStore.getState(), 'openDialog');
    const listenLive = vi.spyOn(useAnalyzeEntryStore.getState(), 'listenLive');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    maybeAutoListenAnalyzeHome();

    expect(logSpy).toHaveBeenCalledWith('analyze-auto-listen', { decision: 'noDevice' });
    expect(useAnalyzeEntryStore.getState().listening).toBe(false);
    expect(useAnalyzeEntryStore.getState().dialogOpen).toBe(false);
    expect(startSecondaryMeasurement).not.toHaveBeenCalled();
    expect(openDialog).not.toHaveBeenCalled();
    expect(listenLive).not.toHaveBeenCalled();
  });

  it('does not start a second listen when already listening', () => {
    useLiveCaptureStore.setState({ appMode: 'analyze', secondaryMeasurement: { status: 'active', deviceName: 'UMIK-1' } });
    useAnalyzeEntryStore.setState({ listening: true });
    const startSecondaryMeasurement = vi.spyOn(useLiveCaptureStore.getState(), 'startSecondaryMeasurement')
      .mockResolvedValue(undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    maybeAutoListenAnalyzeHome();

    expect(startSecondaryMeasurement).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('analyze-auto-listen', { decision: 'skip' });
  });

  it('does nothing when the current mode is not analyze', () => {
    useLiveCaptureStore.setState({ appMode: 'live', secondaryMeasurement: { status: 'off', deviceName: 'UMIK-1' } });
    const startSecondaryMeasurement = vi.spyOn(useLiveCaptureStore.getState(), 'startSecondaryMeasurement')
      .mockResolvedValue(undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    maybeAutoListenAnalyzeHome();

    expect(startSecondaryMeasurement).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('analyze-auto-listen', { decision: 'skip' });
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

  it('a saved reportcard mode in Advanced mode lands on the Analyze stage (#1507)', async () => {
    useSettingsStore.setState({ settings: settings({ advancedFeaturesEnabled: true, lastAppMode: 'reportcard' }) });

    await restoreBootMode({
      hydration: Promise.resolve(),
      getLastAppMode: () => useSettingsStore.getState().settings?.lastAppMode,
      getCurrentMode: () => 'recent',
      getSettings: () => useSettingsStore.getState().settings,
    });

    expect(useLiveCaptureStore.getState().appMode).toBe('analyze');
    expect(useAnalyzeEntryStore.getState().analyzeStage).toBe(true);
    expect(bodyClassList.contains('rc-active')).toBe(false);
  });

  // #1507: hydration is a real IPC round trip (settings + devices/rigs) that
  // can outlast a user who navigates to Report Card (Recent/Build
  // Guide/Live/onboarding) before it settles. Advanced now clamps a
  // persisted 'reportcard' to 'analyze' same as Simple, so without the
  // boot-mode snapshot guard this would yank that real navigation back to
  // Analyze the moment hydration finally resolves.
  it('does not clobber a mode the user already switched to while hydration was still pending', async () => {
    useLiveCaptureStore.setState({ appMode: 'analyze' });
    useSettingsStore.setState({ settings: settings({ advancedFeaturesEnabled: true, lastAppMode: 'reportcard' }) });
    let resolveHydration!: () => void;
    const hydration = new Promise<void>((resolve) => { resolveHydration = resolve; });

    const done = restoreBootMode({
      hydration,
      getLastAppMode: () => useSettingsStore.getState().settings?.lastAppMode,
      getCurrentMode: () => useLiveCaptureStore.getState().appMode,
      getSettings: () => useSettingsStore.getState().settings,
    });

    // The user reaches Report Card on their own (not via restoreBootMode)
    // while hydration is still in flight.
    switchMode('reportcard');
    resolveHydration();
    await done;

    expect(useLiveCaptureStore.getState().appMode).toBe('reportcard');
    expect(bodyClassList.contains('rc-active')).toBe(true);
  });

  // #1520: restoreBootMode's restore flows entirely through switchMode, so a
  // persisted mode whose flag is off lands on Analyze exactly like a live
  // programmatic switchMode('console') call would.
  it('a persisted lastAppMode whose flag is off ends on analyze (#1520)', async () => {
    useSettingsStore.setState({
      settings: settings({ advancedFeaturesEnabled: true, lastAppMode: 'console' }),
      featureFlags: ALL_FEATURE_FLAGS_OFF,
    });

    await restoreBootMode({
      hydration: Promise.resolve(),
      getLastAppMode: () => useSettingsStore.getState().settings?.lastAppMode,
      getCurrentMode: () => 'reportcard',
      getSettings: () => useSettingsStore.getState().settings,
    });

    expect(useLiveCaptureStore.getState().appMode).toBe('analyze');
  });

  // #1577: ADR-0146 amendment's one permitted auto-listen — the tail branch
  // runs only after the #1507 boot-mode-unchanged guard passes and only when
  // no restore switch/redirect happened, landing squarely on the still-analyze
  // boot home.
  describe('configured-device auto-listen on the Analyze home (#1577)', () => {
    it('starts listening when landed on analyze with a configured device', async () => {
      useLiveCaptureStore.setState({ appMode: 'analyze', secondaryMeasurement: { status: 'off', deviceName: 'UMIK-1' } });
      useSettingsStore.setState({ settings: settings({ lastAppMode: 'analyze' }) });
      const startSecondaryMeasurement = vi.spyOn(useLiveCaptureStore.getState(), 'startSecondaryMeasurement')
        .mockResolvedValue(undefined);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await restoreBootMode({
        hydration: Promise.resolve(),
        getLastAppMode: () => useSettingsStore.getState().settings?.lastAppMode,
        getCurrentMode: () => useLiveCaptureStore.getState().appMode,
        getSettings: () => useSettingsStore.getState().settings,
      });

      expect(useAnalyzeEntryStore.getState().listening).toBe(true);
      expect(useAnalyzeEntryStore.getState().dialogOpen).toBe(false);
      expect(startSecondaryMeasurement).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith('analyze-auto-listen', { decision: 'startListening' });
    });

    it('does not start listening or open any dialog with no device configured, and leaves the File-mode stage up (#1578)', async () => {
      useLiveCaptureStore.setState({ appMode: 'analyze', secondaryMeasurement: { status: 'off', deviceName: '' } });
      useSettingsStore.setState({ settings: settings({ lastAppMode: 'analyze' }) });
      useAnalyzeEntryStore.setState({ analyzeStage: true });
      const startSecondaryMeasurement = vi.spyOn(useLiveCaptureStore.getState(), 'startSecondaryMeasurement')
        .mockResolvedValue(undefined);
      const openDialog = vi.spyOn(useSettingsStore.getState(), 'openDialog');
      const listenLive = vi.spyOn(useAnalyzeEntryStore.getState(), 'listenLive');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await restoreBootMode({
        hydration: Promise.resolve(),
        getLastAppMode: () => useSettingsStore.getState().settings?.lastAppMode,
        getCurrentMode: () => useLiveCaptureStore.getState().appMode,
        getSettings: () => useSettingsStore.getState().settings,
      });

      expect(useAnalyzeEntryStore.getState().listening).toBe(false);
      expect(useAnalyzeEntryStore.getState().dialogOpen).toBe(false);
      expect(useAnalyzeEntryStore.getState().analyzeStage).toBe(true);
      expect(startSecondaryMeasurement).not.toHaveBeenCalled();
      expect(openDialog).not.toHaveBeenCalled();
      expect(listenLive).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith('analyze-auto-listen', { decision: 'noDevice' });
    });

    it('does not start a second listen when Analyze is already listening', async () => {
      useLiveCaptureStore.setState({ appMode: 'analyze', secondaryMeasurement: { status: 'active', deviceName: 'UMIK-1' } });
      useAnalyzeEntryStore.setState({ listening: true });
      useSettingsStore.setState({ settings: settings({ lastAppMode: 'analyze' }) });
      const startSecondaryMeasurement = vi.spyOn(useLiveCaptureStore.getState(), 'startSecondaryMeasurement')
        .mockResolvedValue(undefined);

      await restoreBootMode({
        hydration: Promise.resolve(),
        getLastAppMode: () => useSettingsStore.getState().settings?.lastAppMode,
        getCurrentMode: () => useLiveCaptureStore.getState().appMode,
        getSettings: () => useSettingsStore.getState().settings,
      });

      expect(startSecondaryMeasurement).not.toHaveBeenCalled();
    });

    it('does not auto-listen when the user navigated away before hydration settled (#1507)', async () => {
      useLiveCaptureStore.setState({ appMode: 'analyze', secondaryMeasurement: { status: 'off', deviceName: 'UMIK-1' } });
      useSettingsStore.setState({ settings: settings({ lastAppMode: 'analyze' }) });
      const startSecondaryMeasurement = vi.spyOn(useLiveCaptureStore.getState(), 'startSecondaryMeasurement')
        .mockResolvedValue(undefined);
      let resolveHydration!: () => void;
      const hydration = new Promise<void>((resolve) => { resolveHydration = resolve; });

      const done = restoreBootMode({
        hydration,
        getLastAppMode: () => useSettingsStore.getState().settings?.lastAppMode,
        getCurrentMode: () => useLiveCaptureStore.getState().appMode,
        getSettings: () => useSettingsStore.getState().settings,
      });
      useLiveCaptureStore.setState({ appMode: 'live' });
      resolveHydration();
      await done;

      expect(startSecondaryMeasurement).not.toHaveBeenCalled();
    });

    it('does not auto-listen when restoreBootMode switches to another mode', async () => {
      useLiveCaptureStore.setState({ appMode: 'analyze', secondaryMeasurement: { status: 'off', deviceName: 'UMIK-1' } });
      useSettingsStore.setState({ settings: settings({ advancedFeaturesEnabled: true, lastAppMode: 'live' }) });
      const startSecondaryMeasurement = vi.spyOn(useLiveCaptureStore.getState(), 'startSecondaryMeasurement')
        .mockResolvedValue(undefined);

      await restoreBootMode({
        hydration: Promise.resolve(),
        getLastAppMode: () => useSettingsStore.getState().settings?.lastAppMode,
        getCurrentMode: () => useLiveCaptureStore.getState().appMode,
        getSettings: () => useSettingsStore.getState().settings,
      });

      expect(useLiveCaptureStore.getState().appMode).toBe('live');
      expect(startSecondaryMeasurement).not.toHaveBeenCalled();
    });
  });
});

// #1618: pins the real two-phase cold boot (applyInitialMode('analyze') then
// restoreBootMode) with no secondary device configured — the exact path
// #1577/#1578 already guard piecemeal, but nothing before this ran the two
// calls together while spying on every dialog/listen entry point
// (enterAnalyze, open, listenLive, startSecondaryMeasurement,
// settingsStore.openDialog). Every `it` title contains "no secondary device"
// to match the issue's own `-t "no secondary device"` verification filter.
describe('cold Analyze home with no secondary device (#1618)', () => {
  let enterAnalyze: ReturnType<typeof vi.fn>;
  let open: ReturnType<typeof vi.fn>;
  let listenLive: ReturnType<typeof vi.fn>;
  let startSecondaryMeasurement: ReturnType<typeof vi.fn>;
  let openDialog: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    enterAnalyze = vi.spyOn(useAnalyzeEntryStore.getState(), 'enterAnalyze');
    open = vi.spyOn(useAnalyzeEntryStore.getState(), 'open');
    listenLive = vi.spyOn(useAnalyzeEntryStore.getState(), 'listenLive');
    startSecondaryMeasurement = vi.spyOn(useLiveCaptureStore.getState(), 'startSecondaryMeasurement')
      .mockResolvedValue(undefined);
    openDialog = vi.spyOn(useSettingsStore.getState(), 'openDialog');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  async function coldBoot(lastAppMode: AppSettings['lastAppMode'] | undefined) {
    useSettingsStore.setState({ settings: settings({ lastAppMode, measurementDeviceName: '' }) });
    useLiveCaptureStore.setState({ secondaryMeasurement: { status: 'off', deviceName: '' } });
    applyInitialMode('analyze');
    await restoreBootMode({
      hydration: Promise.resolve(),
      getLastAppMode: () => useSettingsStore.getState().settings?.lastAppMode,
      getCurrentMode: () => useLiveCaptureStore.getState().appMode,
      getSettings: () => useSettingsStore.getState().settings,
    });
  }

  function expectNoDialogAndNoListen() {
    expect(enterAnalyze).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(listenLive).not.toHaveBeenCalled();
    expect(startSecondaryMeasurement).not.toHaveBeenCalled();
    expect(openDialog).not.toHaveBeenCalled();
    expect(useAnalyzeEntryStore.getState().dialogOpen).toBe(false);
    expect(useAnalyzeEntryStore.getState().listening).toBe(false);
  }

  it('fresh install (no lastAppMode) with no secondary device: cold boot opens no dialog and starts no listen', async () => {
    await coldBoot(undefined);

    expectNoDialogAndNoListen();
    expect(useLiveCaptureStore.getState().appMode).toBe('analyze');
  });

  it('persisted analyze lastAppMode with no secondary device: cold boot opens no dialog and starts no listen', async () => {
    await coldBoot('analyze');

    expectNoDialogAndNoListen();
    expect(useLiveCaptureStore.getState().appMode).toBe('analyze');
  });

  it('no secondary device: cold boot preserves the non-modal File-mode stage', async () => {
    await coldBoot('analyze');

    expect(useAnalyzeEntryStore.getState().analyzeStage).toBe(true);
    expect(useAnalyzeEntryStore.getState().listening).toBe(false);
    expect(useLiveCaptureStore.getState().appMode).toBe('analyze');
    expect(analyzeModeOf(useAnalyzeEntryStore.getState().listening)).toBe('file');
    expect(logSpy).toHaveBeenCalledWith('analyze-auto-listen', { decision: 'noDevice' });
  });
});
