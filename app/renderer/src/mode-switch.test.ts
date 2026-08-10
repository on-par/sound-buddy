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
let renderLiveMeters: ReturnType<typeof vi.fn>;
let renderLiveWorkspace: ReturnType<typeof vi.fn>;
let renderEqPane: ReturnType<typeof vi.fn>;
let currentEqPaneChannels: ReturnType<typeof vi.fn>;
let liveIsRunning: ReturnType<typeof vi.fn>;
let liveWindowsFn: ReturnType<typeof vi.fn>;
let mock: ReturnType<typeof createMockSoundBuddy>;

beforeEach(() => {
  elements = {
    'spectrum-title': makeFakeElement(),
    'live-eq-pane': makeFakeElement(),
    'reportcard-view': makeFakeElement(),
    'tab-live': makeFakeElement(),
    'tab-recent': makeFakeElement(),
  };
  tabContentEls = [makeFakeElement(), makeFakeElement()];
  bodyClassList = makeClassList();
  isSingleColumn = vi.fn(() => false);
  isEnabled = vi.fn(() => false);
  renderLiveMeters = vi.fn();
  renderLiveWorkspace = vi.fn();
  renderEqPane = vi.fn();
  currentEqPaneChannels = vi.fn(() => ['ch']);
  liveIsRunning = vi.fn(() => false);
  liveWindowsFn = vi.fn(() => []);
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
    renderLiveMeters, renderLiveWorkspace, renderEqPane, currentEqPaneChannels,
    liveCapture: { isRunning: liveIsRunning, windows: liveWindowsFn },
  };
});

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { window?: unknown }).window;
  vi.restoreAllMocks();
  useLiveCaptureStore.setState({ appMode: 'reportcard' });
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
    weeklyReminderServiceDay: 0, liveEqPaneWidth: 360, secondaryMeasurementEnabled: false,
    measurementDeviceName: '', gradingProfile: 'casual', consoleNetworkConsentGranted: false,
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
  it('live: shows the docked EQ pane and renders the workspace when not running', () => {
    useSettingsStore.setState({ settings: settings({ liveEqPaneWidth: 400 }) });
    applySpectrumForMode('live');
    expect(elements['spectrum-title'].textContent).toBe('Spectrum · Live EQ');
    expect(elements['live-eq-pane'].style.display).toBe('flex');
    expect(elements['live-eq-pane'].style.width).toBe('400px');
    expect(renderLiveWorkspace).toHaveBeenCalled();
    expect(renderEqPane).toHaveBeenCalledWith(['ch']);
  });

  it('live: renders the latest meter window when running with data', () => {
    liveIsRunning.mockReturnValue(true);
    liveWindowsFn.mockReturnValue(['w1', 'w2']);
    applySpectrumForMode('live');
    expect(renderLiveMeters).toHaveBeenCalledWith('w2');
    expect(renderLiveWorkspace).not.toHaveBeenCalled();
  });

  it('soundcheck: shows meters while playing', () => {
    useSoundcheckStore.setState({ playing: true });
    applySpectrumForMode('soundcheck');
    expect(elements['spectrum-title'].textContent).toBe('Soundcheck · Meters');
    expect(useSpectrumStore.getState().panelState).toBe('meters');
  });

  it('soundcheck: shows an empty prompt when not playing', () => {
    applySpectrumForMode('soundcheck');
    expect(useSpectrumStore.getState().panelState).toBe('empty');
    expect(useSpectrumStore.getState().panelText).toBe('Load a session and press Play to see per-track meters');
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
});
