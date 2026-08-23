// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import LiveEqPane, { applyEqPaneClassificationChange, applyEqPaneInspectorChange, type ClassificationChangeDeps, type EqPaneInspectorChangeDeps } from './LiveEqPane';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useSettingsStore } from './stores/settingsStore';
import { useSoundcheckStore } from './stores/soundcheckStore';
import { deviceChannelCount, deviceNameFor, deviceOptionLabel, eqPaneClassificationHTML, eqPaneHTML, eqPaneInspectorHTML, eqPaneView, type EqPaneInspectorView, type EqPaneView } from './live-capture-panel';
import { currentEqPaneChannels, eqPaneLevelTilesView, liveWorkspaceViewState } from './live-workspace-view';
import type { LiveEvent } from './live-capture-panel';
import type { AppSettings } from '../../electron/ipc/api';

const trackWorkspace = require('../track-workspace.js');
const armState = require('../arm-state.js');
const groupState = require('../group-state.js');
const rigReconcile = require('../rig-reconcile.js');
const instrumentProfiles = require('../instrument-profiles.js');
const liveSetupState = require('../live-setup-state.js');
const liveAdjustmentsState = require('../live-adjustments-state.js');
const dawWorkspaceState = require('../daw-workspace-state.js');
const dawPlayheadState = require('../daw-playhead-state.js');
const dawWaveformState = require('../daw-waveform-state.js');
const grading = require('../grading.js');

const CONFIG = [
  { kind: 'mono' as const, a: 0, b: 1, armed: true },
  { kind: 'mono' as const, a: 1, b: 2, armed: true },
];

const TICK_CHANNELS = [
  { index: 0, name: 'Vocals', rms: -18, peak: -6, clipping: false, centroid: 2400, rolloff: 8000,
    bands: { sub_bass: -58, bass: -30, low_mid: -24, mid: -12, high_mid: -20, presence: -28, brilliance: -80 } },
  { index: 1, name: 'Band', rms: -22, peak: -9, clipping: false, centroid: 300, rolloff: 5000,
    bands: { sub_bass: -20, bass: -10, low_mid: -26, mid: -30, high_mid: -34, presence: -40, brilliance: -50 } },
];

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    idealProfile: '', customIdealProfiles: [], storageDir: '', rigs: [], activeRigId: null,
    usageSignalEnabled: false, channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {},
    crashReportingEnabled: false, liveAdjustmentsEnabled: false,
    reportFirstUxEnabled: false, shareChurchName: '', weeklyReminderEnabled: false,
    weeklyReminderServiceDay: 0, liveEqPaneWidth: 400,
    measurementDeviceName: '', gradingProfile: 'casual', consoleNetworkConsentGranted: false,
    soundcheckBuses: [],
    ...overrides,
  };
}

function renderMarkup(): string {
  return renderToString(createElement(LiveEqPane));
}

// The exact output eqPaneHTML would produce for the current discrete slots —
// pinned so a change to the pane's own logic (not the store wiring) is what
// fails when it drifts.
function expectedPaneHTML(): string {
  const s = useLiveCaptureStore.getState();
  const channels = s.lastLiveChannels || CONFIG.map(() => trackWorkspace.idleChannel(['sub_bass', 'bass', 'low_mid', 'mid', 'high_mid', 'presence', 'brilliance']));
  const secondaryActive = s.secondaryMeasurement.status === 'active' && s.secondaryWindows.length > 0;
  const override = secondaryActive && s.lastMeasurementChannels
    ? { ch: s.lastMeasurementChannels[0], label: s.secondaryMeasurement.deviceName }
    : null;
  const view: EqPaneView = eqPaneView(channels, s.channelConfig, s.measurementSource, s.selectedChannel, override, expectedInspectorView());
  return eqPaneHTML(view);
}

function expectedClassificationHTML(): string {
  const s = useLiveCaptureStore.getState();
  const selectedIndex = s.selectedChannel;
  const strip = selectedIndex != null && selectedIndex >= 0 ? s.channelConfig[selectedIndex] : null;
  if (!strip || selectedIndex == null) return '';
  const token = armState.stripToken(strip);
  const allSavedProfiles = (useSettingsStore.getState().settings || {}).inputInstrumentProfiles || {};
  const savedProfiles = allSavedProfiles[deviceNameFor(s.selectedDevice, s.devices)] || {};
  const savedProfile = savedProfiles[token];
  return eqPaneClassificationHTML({
    selectedIndex,
    groupIndex: groupState.groupOf(s.channelGroups, selectedIndex),
    groups: s.channelGroups,
    profiles: instrumentProfiles.PROFILES,
    effectiveProfileId: instrumentProfiles.effectiveProfileId(savedProfiles, token, strip.label),
    instrumentAuto: !(savedProfile && instrumentProfiles.isKnownProfileId(savedProfile)),
    disabled: s.isCapturing || s.demoting,
  });
}

function expectedInspectorView(): EqPaneInspectorView | null {
  const live = useLiveCaptureStore.getState();
  const soundcheck = useSoundcheckStore.getState();
  const selectedIndex = live.selectedChannel;
  const strip = selectedIndex != null && selectedIndex >= 0 ? live.channelConfig[selectedIndex] : null;
  if (!strip || selectedIndex == null) return null;
  const channel = currentEqPaneChannels(liveWorkspaceViewState(live, useSettingsStore.getState().settings))[selectedIndex];
  const stats = eqPaneLevelTilesView(channel);
  return {
    selectedIndex,
    strip,
    deviceOptions: [{ value: '', label: 'Default Device' }, ...live.devices.map((device) => ({ value: String(device.index), label: deviceOptionLabel(device) }))],
    selectedDevice: live.selectedDevice,
    deviceChannels: deviceChannelCount(live.selectedDevice, live.devices),
    disabled: live.isCapturing || live.demoting,
    playbackTrack: soundcheck.manifest?.tracks[selectedIndex] ?? null,
    playbackRoute: soundcheck.routes[selectedIndex] ?? [0],
    playbackDeviceChannels: soundcheck.deviceChannels,
    levelTiles: stats ? {
      rms: stats.rms, rmsTone: stats.rmsTone,
      peak: stats.peak, peakTone: stats.peakTone,
      headroom: stats.headroom, headroomTone: stats.headroomTone,
      clip: stats.clip, clipTone: stats.clipTone,
    } : null,
  };
}

function expectedInspectorHTML(): string {
  return eqPaneInspectorHTML(expectedInspectorView());
}

function expectedMarkup(): string {
  return `<div><div>${expectedPaneHTML()}</div><div>${expectedInspectorHTML()}</div><div>${expectedClassificationHTML()}</div><footer class="eq-pane-footer">Sound Buddy does not write to your console.</footer></div>`;
}

beforeEach(() => {
  (globalThis as { window?: unknown }).window = {
    trackWorkspace, armState, groupState, rigReconcile, instrumentProfiles,
    liveSetupState, liveAdjustmentsState, dawWorkspaceState, dawPlayheadState,
    dawWaveformState, grading,
  };
  useLiveCaptureStore.setState({
    channelConfig: CONFIG,
    channelGroups: [],
    devices: [{ index: 0, name: 'Scarlett 18i20', channels: 8, default_sr: 48000 }],
    selectedDevice: '',
    isCapturing: false,
    liveMode: 'monitor',
    appMode: 'live',
    selectedChannel: null,
    measurementSource: null,
    focusedInputIndex: null,
    lapCoaching: null,
    liveWindows: [],
    lastTick: null,
    lastLiveChannels: TICK_CHANNELS as never,
    secondaryMeasurement: { status: 'off', deviceName: '' },
    secondaryWindows: [],
    lastMeasurementChannels: null,
  });
  useSettingsStore.setState({ settings: settings() });
  useSoundcheckStore.setState({ manifest: null, routes: [], deviceChannels: 0 });
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useLiveCaptureStore.setState({
    appMode: 'reportcard', selectedChannel: null, measurementSource: null, lastLiveChannels: null,
    secondaryMeasurement: { status: 'off', deviceName: '' }, secondaryWindows: [], lastMeasurementChannels: null,
  });
  useSettingsStore.setState({ settings: null, settingsError: null });
  useSoundcheckStore.setState({ manifest: null, routes: [], deviceChannels: 0 });
});

describe('LiveEqPane', () => {
  it('renders the Room section, empty selected guidance, and read-only footer until a strip is selected', () => {
    const html = renderMarkup();
    expect(html).toBe(expectedMarkup());
    expect(html).toContain('eq-pane-primary');
    expect(html).toContain('Room — Track 1');
    expect(html).toContain('eq-pane-empty-hint');
    expect(html).toContain('Sound Buddy does not write to your console.');
    expect(html).not.toContain('eq-pane-classification');
  });

  it('keeps a stale selected index in the Room-plus-empty-selected state without inspector markup', () => {
    useLiveCaptureStore.setState({ selectedChannel: 9 });
    const html = renderMarkup();
    expect(html).toBe(expectedMarkup());
    expect(html).toContain('eq-pane-primary');
    expect(html).toContain('Room — Track 1');
    expect(html).toContain('eq-pane-empty-hint');
    expect(html).toContain('Sound Buddy does not write to your console.');
    expect(html).not.toContain('eq-pane-inspector');
    expect(html).not.toContain('eq-pane-classification');
  });

  it('adds the Selected section for the clicked strip with the measurement-source suffix when it is also the room', () => {
    useLiveCaptureStore.setState({ selectedChannel: 0 });
    useSoundcheckStore.setState({ manifest: { tracks: [{ kind: 'mono' }] }, routes: [[1]], deviceChannels: 4 });
    const html = renderMarkup();
    expect(html).toBe(expectedMarkup());
    expect(html).toContain('eq-pane-inspector');
    expect(html).toContain('<option value="1" selected>Ch 2</option>');
    expect(html).toContain('Selected — Track 1 · Measurement source');
    expect(html).not.toContain('eq-pane-empty-hint');
  });

  it('shows a distinct Selected label for a non-room strip', () => {
    useLiveCaptureStore.setState({ selectedChannel: 1 });
    const html = renderMarkup();
    expect(html).toBe(expectedMarkup());
    expect(html).toContain('Selected — Track 2');
  });

  it('keeps the analyser sections above selected-channel controls', () => {
    useLiveCaptureStore.setState({ selectedChannel: 1 });
    const html = renderMarkup();
    expect(html.indexOf('eq-pane-primary')).toBeLessThan(html.indexOf('eq-pane-inspector'));
    expect(html.indexOf('eq-pane-secondary')).toBeLessThan(html.indexOf('eq-pane-classification'));
  });

  it('seeds inspector level tiles from the selected channel, not the Room channel', () => {
    useLiveCaptureStore.setState({ selectedChannel: 1, measurementSource: 0 });
    const html = renderMarkup();
    expect(html).toContain('data-eq-pane-level="rms" class="eq-pane-level-value">-22.0</span>');
    expect(html).toContain('data-eq-pane-level="peak" class="eq-pane-level-value">-9.0</span>');
    expect(html).toContain('data-eq-pane-level="headroom" class="eq-pane-level-value">9.0</span>');
    expect(html).not.toContain('>-18.0</span>');
  });

  it('renders unavailable level tiles for a selected synthetic idle channel', () => {
    useLiveCaptureStore.setState({
      selectedChannel: 1,
      lastLiveChannels: CONFIG.map(() => trackWorkspace.idleChannel(['sub_bass', 'bass', 'low_mid', 'mid', 'high_mid', 'presence', 'brilliance'])),
    });
    const html = renderMarkup();
    expect(html.match(/class="eq-pane-level-value">—<\/span>/g)).toHaveLength(4);
  });

  it('renders the selected channel classification with its group and Auto profile', () => {
    useLiveCaptureStore.setState({
      selectedChannel: 0,
      channelGroups: [{ name: 'Drums', members: [0] }],
    });
    const html = renderMarkup();
    expect(html).toContain('eq-pane-classification');
    expect(html).toContain('<option value="0" selected>Drums</option>');
    expect(html).toContain('Auto — Generic');
  });

  it('binds an explicit profile override and ungrouped state to the selected channel', () => {
    useLiveCaptureStore.setState({ selectedChannel: 1 });
    useSettingsStore.setState({ settings: settings({ inputInstrumentProfiles: { '': { '1': 'vocal' } } }) });
    const html = renderMarkup();
    expect(html).toContain('<option value="-1" selected>Ungrouped</option>');
    expect(html).toContain('<option value="vocal" selected>Vocal</option>');
  });

  it('does not render editable classification controls without a selected configured channel', () => {
    const html = renderMarkup();
    expect(html).not.toContain('eq-pane-classification-profile');
    expect(html).not.toContain('eq-pane-classification-group');
  });

  it('locks classification controls while the live board is running', () => {
    useLiveCaptureStore.setState({ selectedChannel: 0, isCapturing: true });
    const html = renderMarkup();
    expect(html).toContain('eq-pane-classification-profile" aria-label="Instrument profile" disabled');
    expect(html).toContain('eq-pane-classification-group" aria-label="Assign track to group" disabled');
  });

  it('keeps classification controls locked while a record capture demotes to monitoring (#847)', () => {
    useLiveCaptureStore.setState({ selectedChannel: 0, isCapturing: false, demoting: true });
    const html = renderMarkup();
    expect(html).toContain('eq-pane-classification-profile" aria-label="Instrument profile" disabled');
    expect(html).toContain('eq-pane-classification-group" aria-label="Assign track to group" disabled');
  });

  it('swaps the Room slot to the secondary room mic when active (#460)', () => {
    useLiveCaptureStore.setState({
      selectedChannel: 0,
      secondaryMeasurement: { status: 'active', deviceName: 'Room Mic' },
      secondaryWindows: [{ type: 'window', window: 1, ts: 0, channels: TICK_CHANNELS, masking: [] } as LiveEvent],
      lastMeasurementChannels: [TICK_CHANNELS[0]] as never,
    });
    const html = renderMarkup();
    expect(html).toBe(expectedMarkup());
    expect(html).toContain('Room — Room Mic');
  });

  it('composes inspector controls with the active secondary Room override (#1066)', () => {
    useLiveCaptureStore.setState({
      selectedChannel: 1,
      secondaryMeasurement: { status: 'active', deviceName: 'Room Mic' },
      secondaryWindows: [{ type: 'window', window: 1, ts: 0, channels: TICK_CHANNELS, masking: [] } as LiveEvent],
      lastMeasurementChannels: [TICK_CHANNELS[0]] as never,
    });
    const html = renderMarkup();
    expect(html).toBe(expectedMarkup());
    expect(html).toContain('eq-pane-inspector');
    expect(html).toContain('data-selected-index="1"');
    expect(html).toContain('Room — Room Mic');
    expect(html).not.toContain('Room — Track 2');
  });

  it('keeps the board Room slot byte-identical while the secondary source is merely selected but not active', () => {
    useLiveCaptureStore.setState({
      selectedChannel: 0,
      secondaryMeasurement: { status: 'off', deviceName: 'Room Mic' },
      secondaryWindows: [],
      lastMeasurementChannels: null,
    });
    const html = renderMarkup();
    expect(html).toContain('Room — Track 1');
    expect(html).not.toContain('Room — Room Mic');
  });
});

describe('applyEqPaneClassificationChange', () => {
  function changeDeps(selectedChannel: number | null = 0): ClassificationChangeDeps {
    return {
      liveCapture: {
        selectedChannel,
        channelConfig: CONFIG,
        selectedDevice: '',
        devices: [],
        assignGroup: vi.fn(),
      },
      settings: { settings: settings(), updateSettings: vi.fn() },
      instrumentProfiles: { recordOverride: vi.fn(() => ({ '': { '0': 'vocal' } })) },
      armState: { stripToken: vi.fn(() => '0') },
    };
  }

  it('assigns the currently selected channel through the existing group action', () => {
    const deps = changeDeps(1);
    applyEqPaneClassificationChange('group', '0', deps);
    expect(deps.liveCapture.assignGroup).toHaveBeenCalledWith(1, 0);
  });

  it('records a selected channel profile override and persists the full override map', () => {
    const deps = changeDeps();
    applyEqPaneClassificationChange('profile', 'vocal', deps);
    expect(deps.instrumentProfiles.recordOverride).toHaveBeenCalledWith({}, '', '0', 'vocal');
    expect(deps.settings.updateSettings).toHaveBeenCalledWith({ inputInstrumentProfiles: { '': { '0': 'vocal' } } });
  });

  it('does not write when a selected channel is stale or missing', () => {
    const deps = changeDeps(9);
    applyEqPaneClassificationChange('group', '0', deps);
    applyEqPaneClassificationChange('profile', 'vocal', deps);
    expect(deps.liveCapture.assignGroup).not.toHaveBeenCalled();
    expect(deps.instrumentProfiles.recordOverride).not.toHaveBeenCalled();
    expect(deps.settings.updateSettings).not.toHaveBeenCalled();
  });
});

describe('applyEqPaneInspectorChange (#1064)', () => {
  function changeDeps(selectedChannel: number | null = 1): EqPaneInspectorChangeDeps {
    return {
      liveCapture: {
        selectedChannel,
        channelConfig: CONFIG,
        selectDevice: vi.fn(),
        setStripLabel: vi.fn(),
        setStripKind: vi.fn(),
        setStripSource: vi.fn(),
        toggleArm: vi.fn(),
      },
      soundcheck: { manifest: { tracks: [{ kind: 'mono' }, { kind: 'stereo' }] }, setRoute: vi.fn() },
    };
  }

  it.each([
    ['label', 'Lead Vox', 'setStripLabel', [1, 'Lead Vox']],
    ['kind', 'stereo', 'setStripKind', [1, 'stereo']],
    ['source', '3', 'setStripSource', [1, 'a', 3]],
    ['arm', '', 'toggleArm', [1]],
    ['device', '4', 'selectDevice', ['4']],
    ['output', '2', 'setRoute', [1, 2]],
  ] as const)('routes %s changes through the established store action', (kind, value, action, args) => {
    const deps = changeDeps();
    applyEqPaneInspectorChange(kind, value, deps);
    const target = action === 'setRoute' ? deps.soundcheck.setRoute : deps.liveCapture[action];
    expect(target).toHaveBeenCalledWith(...args);
  });

  it('uses the requested stereo leg when source changes carry that field', () => {
    const deps = changeDeps();
    applyEqPaneInspectorChange('source', '4:b', deps);
    expect(deps.liveCapture.setStripSource).toHaveBeenCalledWith(1, 'b', 4);
  });

  it('rejects malformed or negative source and output values', () => {
    const deps = changeDeps();
    applyEqPaneInspectorChange('source', 'bad', deps);
    applyEqPaneInspectorChange('source', '-1:b', deps);
    applyEqPaneInspectorChange('source', '3:not-a-leg', deps);
    applyEqPaneInspectorChange('output', 'bad', deps);
    applyEqPaneInspectorChange('output', '-1', deps);
    expect(deps.liveCapture.setStripSource).not.toHaveBeenCalled();
    expect(deps.soundcheck.setRoute).not.toHaveBeenCalled();
  });

  it('does not write for null, negative, stale, or route-less selections', () => {
    for (const selectedChannel of [null, -1, 9]) {
      const deps = changeDeps(selectedChannel);
      applyEqPaneInspectorChange('label', 'No write', deps);
      expect(deps.liveCapture.setStripLabel).not.toHaveBeenCalled();
    }
    const noTrack = changeDeps();
    noTrack.soundcheck.manifest = { tracks: [{ kind: 'mono' }] };
    applyEqPaneInspectorChange('output', '2', noTrack);
    expect(noTrack.soundcheck.setRoute).not.toHaveBeenCalled();
  });
});
