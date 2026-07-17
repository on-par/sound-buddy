// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  createLiveCaptureStore,
  useLiveCaptureStore,
  LIVE_WINDOWS_CAP,
  MAX_LABEL_LEN,
  type LiveCaptureApi,
} from './liveCaptureStore';
import { createMockSoundBuddy } from '../mock-sound-buddy';
import { useSettingsStore } from './settingsStore';
import type { StripConfig, LiveDevice } from '../live-capture-panel';

// The pure helper classic-scripts the store reads off `window` — real modules
// (not hand-rolled stubs), same convention as arm-state.test.ts/group-state.test.ts.
const armState = require('../../arm-state.js');
const groupState = require('../../group-state.js');
const collapseState = require('../../collapse-state.js');
const rigKind = require('../../rig-kind.js');
const channelLabels = require('../../channel-labels.js');

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { armState, groupState, collapseState, rigKind, channelLabels };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.useRealTimers();
  useSettingsStore.setState({ settings: null, llmConfig: null, settingsError: null });
});

const DEVICES: LiveDevice[] = [
  { index: 0, name: 'Scarlett 18i20', channels: 8, default_sr: 48000 },
];

function makeStore(overrides: Partial<Parameters<typeof createMockSoundBuddy>[0]> = {}) {
  const mock = createMockSoundBuddy(overrides);
  const store = createLiveCaptureStore(() => mock.api as unknown as LiveCaptureApi);
  return { store, mock };
}

describe('createLiveCaptureStore', () => {
  it('starts with an idle, empty state', () => {
    const { store } = makeStore();
    const s = store.getState();
    expect(s.devices).toEqual([]);
    expect(s.channelConfig).toEqual([]);
    expect(s.isCapturing).toBe(false);
    expect(s.liveWindows).toEqual([]);
    expect(s.collapsed.size).toBe(0);
    expect(s.appMode).toBe('reportcard');
    expect(s.ringout).toEqual({ stepIndex: 0, cut: null });
  });

  describe('loadDevices / selectDevice', () => {
    it('seeds a 2-strip default channel config once devices are found', async () => {
      const { store } = makeStore({
        listDevices: async () => ({ success: true, micAccess: 'granted', devices: DEVICES }),
      });
      await store.getState().loadDevices();
      expect(store.getState().devices).toEqual(DEVICES);
      expect(store.getState().channelConfig).toEqual([
        { kind: 'mono', a: 0, b: 1, armed: true },
        { kind: 'mono', a: 1, b: 2, armed: true },
      ]);
      expect(store.getState().deviceHint).toBeNull();
    });

    it('does not reset channel config when no devices are found', async () => {
      const { store } = makeStore({
        listDevices: async () => ({ success: true, devices: [] }),
      });
      store.setState({ channelConfig: [{ kind: 'mono', a: 0, b: 1 }] });
      await store.getState().loadDevices();
      expect(store.getState().channelConfig).toEqual([{ kind: 'mono', a: 0, b: 1 }]);
      expect(store.getState().deviceHint?.isError).toBe(false);
    });

    it('surfaces a blocked-mic hint', async () => {
      const { store } = makeStore({
        listDevices: async () => ({ success: true, micAccess: 'denied' }),
      });
      await store.getState().loadDevices();
      expect(store.getState().deviceHint?.isError).toBe(true);
    });

    it('selectDevice resets the config to the newly selected device default', () => {
      const { store } = makeStore();
      store.setState({ devices: DEVICES });
      store.getState().selectDevice('0');
      expect(store.getState().selectedDevice).toBe('0');
      expect(store.getState().channelConfig).toHaveLength(2);
    });

    it('loadDevices overlays saved labels (#482) for the resolved device onto the seeded config', async () => {
      useSettingsStore.setState({
        settings: { channelLabels: { 'Scarlett 18i20': { '0': 'Kick', '1': 'Snare' } } } as never,
      });
      const { store } = makeStore({
        listDevices: async () => ({ success: true, micAccess: 'granted', devices: DEVICES }),
      });
      store.setState({ selectedDevice: '0' });
      await store.getState().loadDevices();
      expect(store.getState().channelConfig.map((s: StripConfig) => s.label)).toEqual(['Kick', 'Snare']);
    });

    it('selectDevice overlays saved labels (#482) for the newly selected device', () => {
      useSettingsStore.setState({
        settings: { channelLabels: { 'Scarlett 18i20': { '0': 'Kick' } } } as never,
      });
      const { store } = makeStore();
      store.setState({ devices: DEVICES });
      store.getState().selectDevice('0');
      expect(store.getState().channelConfig[0].label).toBe('Kick');
    });

    it('selectDevice resolves the "" (Default Device) key for the saved-labels lookup', () => {
      useSettingsStore.setState({
        settings: { channelLabels: { '': { '0': 'Default label' } } } as never,
      });
      const { store } = makeStore();
      store.setState({ devices: DEVICES });
      store.getState().selectDevice('');
      expect(store.getState().channelConfig[0].label).toBe('Default label');
    });
  });

  describe('strip mutators', () => {
    it('addStrip appends a mono strip at the next free channel', () => {
      const { store } = makeStore();
      store.setState({ devices: DEVICES, channelConfig: [{ kind: 'mono', a: 0, b: 1, armed: true }] });
      store.getState().addStrip();
      expect(store.getState().channelConfig).toHaveLength(2);
      expect(store.getState().channelConfig[1]).toEqual({ kind: 'mono', a: 1, b: 2, armed: true });
    });

    it('removeStrip drops the strip and prunes it from groups', () => {
      const { store } = makeStore();
      store.setState({
        channelConfig: [{ kind: 'mono', a: 0, b: 1 }, { kind: 'mono', a: 1, b: 2 }],
        channelGroups: [{ name: 'Drums', members: [0, 1] }],
      });
      store.getState().removeStrip(0);
      expect(store.getState().channelConfig).toHaveLength(1);
      expect(store.getState().channelGroups[0].members).toEqual([0]); // strip 1 shifted to 0
    });

    it('setStripKind switches mono to stereo via window.rigKind', () => {
      const { store } = makeStore();
      store.setState({ devices: DEVICES, channelConfig: [{ kind: 'mono', a: 0, b: 0 }] });
      store.getState().setStripKind(0, 'stereo');
      expect(store.getState().channelConfig[0]).toEqual({ kind: 'stereo', a: 0, b: 1 });
    });

    it('setStripKind is a no-op for an out-of-range index', () => {
      const { store } = makeStore();
      store.getState().setStripKind(5, 'stereo');
      expect(store.getState().channelConfig).toEqual([]);
    });

    it('setStripSource updates one field of one strip', () => {
      const { store } = makeStore();
      store.setState({ channelConfig: [{ kind: 'stereo', a: 0, b: 1 }] });
      store.getState().setStripSource(0, 'b', 5);
      expect(store.getState().channelConfig[0]).toEqual({ kind: 'stereo', a: 0, b: 5 });
    });

    it('setStripLabel trims and caps at MAX_LABEL_LEN', () => {
      const { store } = makeStore();
      store.setState({ channelConfig: [{ kind: 'mono', a: 0, b: 1 }] });
      store.getState().setStripLabel(0, '  ' + 'x'.repeat(50) + '  ');
      expect(store.getState().channelConfig[0].label).toBe('x'.repeat(MAX_LABEL_LEN));
    });

    it('setStripLabel persists the computed channelLabels map via useSettingsStore (#482)', () => {
      const updateSettingsSpy = vi.fn().mockResolvedValue(undefined);
      useSettingsStore.setState({
        settings: { channelLabels: { 'Scarlett 18i20': { '1': 'Snare' } } } as never,
        updateSettings: updateSettingsSpy,
      });
      const { store } = makeStore();
      store.setState({ devices: DEVICES, selectedDevice: '0', channelConfig: [{ kind: 'mono', a: 0, b: 1 }] });

      store.getState().setStripLabel(0, 'Kick');

      expect(updateSettingsSpy).toHaveBeenCalledWith({
        channelLabels: { 'Scarlett 18i20': { '0': 'Kick', '1': 'Snare' } },
      });
    });

    it('setStripLabel clearing a label deletes its persisted entry (#482)', () => {
      const updateSettingsSpy = vi.fn().mockResolvedValue(undefined);
      useSettingsStore.setState({
        settings: { channelLabels: { 'Scarlett 18i20': { '0': 'Kick' } } } as never,
        updateSettings: updateSettingsSpy,
      });
      const { store } = makeStore();
      store.setState({ devices: DEVICES, selectedDevice: '0', channelConfig: [{ kind: 'mono', a: 0, b: 1, label: 'Kick' }] });

      store.getState().setStripLabel(0, '   ');

      expect(updateSettingsSpy).toHaveBeenCalledWith({ channelLabels: {} });
    });

    it('toggleArm flips the armed flag, defaulting an unset flag to armed', () => {
      const { store } = makeStore();
      store.setState({ channelConfig: [{ kind: 'mono', a: 0, b: 1 }] });
      store.getState().toggleArm(0);
      expect(store.getState().channelConfig[0].armed).toBe(false);
      store.getState().toggleArm(0);
      expect(store.getState().channelConfig[0].armed).toBe(true);
    });

    it('setAllArmed arms/disarms every strip', () => {
      const { store } = makeStore();
      store.setState({ channelConfig: [{ kind: 'mono', a: 0, b: 1 }, { kind: 'mono', a: 1, b: 2 }] });
      store.getState().setAllArmed(false);
      expect(store.getState().channelConfig.every((s: StripConfig) => s.armed === false)).toBe(true);
    });
  });

  describe('groups', () => {
    it('addGroup/assignGroup/renameGroup/removeGroup round-trip', () => {
      const { store } = makeStore();
      store.getState().addGroup('Drums');
      expect(store.getState().channelGroups).toEqual([{ name: 'Drums', members: [] }]);
      store.getState().assignGroup(0, 0);
      expect(store.getState().channelGroups[0].members).toEqual([0]);
      store.getState().renameGroup(0, 'Percussion');
      expect(store.getState().channelGroups[0].name).toBe('Percussion');
      store.getState().removeGroup(0);
      expect(store.getState().channelGroups).toEqual([]);
    });
  });

  describe('collapse', () => {
    it('toggleCollapse/collapseAll/expandAll', () => {
      const { store } = makeStore();
      store.getState().toggleCollapse(1);
      expect(store.getState().collapsed.has(1)).toBe(true);
      store.getState().collapseAll(3);
      expect([...store.getState().collapsed]).toEqual([0, 1, 2]);
      store.getState().expandAll();
      expect(store.getState().collapsed.size).toBe(0);
    });

    it('setGroupCollapsed folds every member to the target state', () => {
      const { store } = makeStore();
      store.setState({ channelGroups: [{ name: 'Drums', members: [0, 1] }] });
      store.getState().setGroupCollapsed(0, true);
      expect(store.getState().collapsed.has(0)).toBe(true);
      expect(store.getState().collapsed.has(1)).toBe(true);
      store.getState().setGroupCollapsed(0, false);
      expect(store.getState().collapsed.size).toBe(0);
    });
  });

  describe('startCapture', () => {
    it('assembles the sb.startLive payload from state + opts', async () => {
      const { store, mock } = makeStore({
        startLive: async (opts) => {
          mock.calls.push({ method: 'startLive', args: [opts] });
          return { success: true };
        },
      });
      store.setState({
        selectedDevice: '0',
        channelConfig: [{ kind: 'mono', a: 0, b: 1 }, { kind: 'stereo', a: 2, b: 3 }],
        liveMode: 'monitor',
        recordDir: '',
      });
      await store.getState().startCapture({ windowSecs: 3, intervalSecs: 0.1, llmIntervalSecs: 0 });
      expect(mock.calls).toContainEqual({
        method: 'startLive',
        args: [{
          device: '0',
          channels: ['0', '2-3'],
          windowSecs: 3,
          intervalSecs: 0.1,
          llmIntervalSecs: 0,
          mode: 'monitor',
          recordDir: undefined,
          arm: undefined,
        }],
      });
      expect(store.getState().isCapturing).toBe(true);
      expect(store.getState().liveWindows).toEqual([]);
    });

    it('includes armedTokens only in record mode', async () => {
      const { store, mock } = makeStore({
        startLive: async (opts) => {
          mock.calls.push({ method: 'startLive', args: [opts] });
          return { success: true };
        },
      });
      store.setState({
        channelConfig: [{ kind: 'mono', a: 0, b: 1, armed: true }, { kind: 'mono', a: 1, b: 2, armed: false }],
        liveMode: 'record',
      });
      await store.getState().startCapture({ windowSecs: 3, intervalSecs: 0.1, llmIntervalSecs: 0 });
      const call = mock.calls.find((c) => c.method === 'startLive');
      expect((call!.args[0] as { arm: string[] }).arm).toEqual(['0']);
    });

    it('record mode: labels payload is aligned index-for-index with channelConfig (#482)', async () => {
      const { store, mock } = makeStore({
        startLive: async (opts) => {
          mock.calls.push({ method: 'startLive', args: [opts] });
          return { success: true };
        },
      });
      store.setState({
        channelConfig: [
          { kind: 'mono', a: 0, b: 1, label: 'Kick' },
          { kind: 'mono', a: 1, b: 2, label: '  ' },
        ],
        liveMode: 'record',
      });
      await store.getState().startCapture({ windowSecs: 3, intervalSecs: 0.1, llmIntervalSecs: 0 });
      const call = mock.calls.find((c) => c.method === 'startLive');
      expect((call!.args[0] as { labels: string[] }).labels).toEqual(['Kick', '']);
    });

    it('monitor mode: labels is undefined (#482)', async () => {
      const { store, mock } = makeStore({
        startLive: async (opts) => {
          mock.calls.push({ method: 'startLive', args: [opts] });
          return { success: true };
        },
      });
      store.setState({
        channelConfig: [{ kind: 'mono', a: 0, b: 1, label: 'Kick' }],
        liveMode: 'monitor',
      });
      await store.getState().startCapture({ windowSecs: 3, intervalSecs: 0.1, llmIntervalSecs: 0 });
      const call = mock.calls.find((c) => c.method === 'startLive');
      expect((call!.args[0] as { labels?: string[] }).labels).toBeUndefined();
    });

    it('resets isCapturing on a failed start and returns the result', async () => {
      const { store } = makeStore({ startLive: async () => ({ success: false, error: 'boom' }) });
      const result = await store.getState().startCapture({ windowSecs: 3, intervalSecs: 0.1, llmIntervalSecs: 0 });
      expect(store.getState().isCapturing).toBe(false);
      expect(result).toEqual({ success: false, error: 'boom' });
    });

    it('is a no-op while already capturing', async () => {
      const { store, mock } = makeStore({ startLive: async () => ({ success: true }) });
      store.setState({ isCapturing: true });
      const result = await store.getState().startCapture({ windowSecs: 3, intervalSecs: 0.1, llmIntervalSecs: 0 });
      expect(result).toBeUndefined();
      expect(mock.calls.filter((c) => c.method === 'startLive')).toHaveLength(0);
    });

    it('arms the countdown on a successful start with a positive llmIntervalSecs', async () => {
      vi.useFakeTimers();
      const { store } = makeStore({ startLive: async () => ({ success: true }) });
      await store.getState().startCapture({ windowSecs: 3, intervalSecs: 0.1, llmIntervalSecs: 5 });
      expect(store.getState().countdownSecs).toBe(5);
      expect(store.getState().countdownAnalyzing).toBe(false);

      vi.advanceTimersByTime(1000);
      expect(store.getState().countdownSecs).toBe(4);

      vi.advanceTimersByTime(4000);
      expect(store.getState().countdownSecs).toBe(5);
      expect(store.getState().countdownAnalyzing).toBe(true);
    });

    it('does not arm a countdown when llmIntervalSecs is 0', async () => {
      const { store } = makeStore({ startLive: async () => ({ success: true }) });
      await store.getState().startCapture({ windowSecs: 3, intervalSecs: 0.1, llmIntervalSecs: 0 });
      expect(store.getState().countdownSecs).toBeNull();
    });
  });

  describe('stopCapture', () => {
    it('clears capture/countdown state and calls sb.stopLive', async () => {
      vi.useFakeTimers();
      const { store, mock } = makeStore({
        startLive: async () => ({ success: true }),
        stopLive: async () => {
          mock.calls.push({ method: 'stopLive', args: [] });
          return { success: true, sessionDir: '/tmp/session' };
        },
      });
      await store.getState().startCapture({ windowSecs: 3, intervalSecs: 0.1, llmIntervalSecs: 5 });
      const result = await store.getState().stopCapture();
      expect(store.getState().isCapturing).toBe(false);
      expect(store.getState().countdownSecs).toBeNull();
      expect(result).toEqual({ success: true, sessionDir: '/tmp/session' });
      expect(mock.calls.some((c) => c.method === 'stopLive')).toBe(true);

      // The countdown timer must actually be cleared (no further store writes).
      const before = store.getState().countdownSecs;
      vi.advanceTimersByTime(5000);
      expect(store.getState().countdownSecs).toBe(before);
    });
  });

  describe('clearLiveWindows', () => {
    it('empties the rolling buffer', () => {
      const { store } = makeStore();
      store.setState({ liveWindows: [{ type: 'window', window: 1, ts: 0, channels: [], masking: [] }] });
      store.getState().clearLiveWindows();
      expect(store.getState().liveWindows).toEqual([]);
    });
  });

  describe('bindIpcEvents', () => {
    it('records an error event without touching lastTick', () => {
      const { store, mock } = makeStore();
      store.getState().bindIpcEvents();
      mock.emit('onLiveEvent', { error: 'mic denied' });
      expect(store.getState().lastError).toBe('mic denied');
      expect(store.getState().lastTick).toBeNull();
    });

    it('meter ticks update lastTick/lastLiveChannels without touching liveWindows', () => {
      const { store, mock } = makeStore();
      store.getState().bindIpcEvents();
      const meter = { type: 'meter', ts: 0, channels: [{ index: 0, name: 'A', bands: {}, rms: -10, peak: -5, clipping: false, centroid: 100, rolloff: 200 }] };
      mock.emit('onLiveEvent', meter);
      expect(store.getState().lastTick).toEqual(meter);
      expect(store.getState().lastLiveChannels).toEqual(meter.channels);
      expect(store.getState().liveWindows).toEqual([]);
    });

    it('bumps boardShapeVersion when the channel count changes', () => {
      const { store, mock } = makeStore();
      store.getState().bindIpcEvents();
      const one = { type: 'meter', ts: 0, channels: [{ index: 0, name: 'A', bands: {}, rms: -10, peak: -5, clipping: false, centroid: 100, rolloff: 200 }] };
      const two = { type: 'meter', ts: 0, channels: [...one.channels, { ...one.channels[0], index: 1, name: 'B' }] };
      mock.emit('onLiveEvent', one);
      expect(store.getState().boardShapeVersion).toBe(1);
      mock.emit('onLiveEvent', one);
      expect(store.getState().boardShapeVersion).toBe(1); // unchanged shape
      mock.emit('onLiveEvent', two);
      expect(store.getState().boardShapeVersion).toBe(2);
    });

    it('window ticks accumulate in liveWindows, capped at LIVE_WINDOWS_CAP', () => {
      const { store, mock } = makeStore();
      store.getState().bindIpcEvents();
      for (let i = 0; i < LIVE_WINDOWS_CAP + 3; i++) {
        mock.emit('onLiveEvent', { type: 'window', window: i, ts: i, channels: [], masking: [] });
      }
      const windows = store.getState().liveWindows as Array<{ window: number }>;
      expect(windows).toHaveLength(LIVE_WINDOWS_CAP);
      expect(windows[0].window).toBe(3); // oldest 3 shifted out
      expect(windows[LIVE_WINDOWS_CAP - 1].window).toBe(LIVE_WINDOWS_CAP + 2);
    });

    it('recognizes a window tick via typeof window === number even without type:"window"', () => {
      const { store, mock } = makeStore();
      store.getState().bindIpcEvents();
      mock.emit('onLiveEvent', { window: 1, ts: 0, channels: [], masking: [] });
      expect(store.getState().liveWindows).toHaveLength(1);
    });
  });

  describe('ringout', () => {
    it('setRingout patches stepIndex/cut independently', () => {
      const { store } = makeStore();
      store.getState().setRingout({ stepIndex: 2 });
      expect(store.getState().ringout).toEqual({ stepIndex: 2, cut: null });
      store.getState().setRingout({ cut: { freq: 1000, gainDb: -6, q: 4 } });
      expect(store.getState().ringout).toEqual({ stepIndex: 2, cut: { freq: 1000, gainDb: -6, q: 4 } });
    });
  });

  it('binds the default hook to the window preload bridge', async () => {
    (globalThis as { window?: unknown }).window = {
      soundBuddy: createMockSoundBuddy({
        listDevices: async () => ({ success: true, devices: [] }),
      }).api,
      armState, groupState, collapseState, rigKind,
    };
    await expect(useLiveCaptureStore.getState().loadDevices()).resolves.toBeUndefined();
  });
});
