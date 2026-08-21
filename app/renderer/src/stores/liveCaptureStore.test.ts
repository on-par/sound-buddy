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
const rigKind = require('../../rig-kind.js');
const channelLabels = require('../../channel-labels.js');

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { armState, groupState, rigKind, channelLabels };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.useRealTimers();
  useSettingsStore.setState({ settings: null, settingsError: null });
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
    expect(s.appMode).toBe('reportcard');
    expect(s.ringout).toEqual({ stepIndex: 0, cut: null });
    expect(s.measurementSource).toBeNull();
    expect(s.selectedChannel).toBeNull();
    expect(s.mutedChannels).toEqual({});
    expect(s.soloedChannels).toEqual({});
    expect(s.meterIntervalMs).toBe(100);
    expect(s.windowSecs).toBe(3);
  });

  describe('capture cadence (#725)', () => {
    it('setMeterIntervalMs sets meterIntervalMs and leaves windowSecs untouched', () => {
      const { store } = makeStore();
      store.getState().setMeterIntervalMs(250);
      expect(store.getState().meterIntervalMs).toBe(250);
      expect(store.getState().windowSecs).toBe(3);
    });

    it('setWindowSecs sets windowSecs and leaves meterIntervalMs untouched', () => {
      const { store } = makeStore();
      store.getState().setWindowSecs(7.5);
      expect(store.getState().windowSecs).toBe(7.5);
      expect(store.getState().meterIntervalMs).toBe(100);
    });

    it('both values survive an unrelated action', () => {
      const { store } = makeStore();
      store.getState().setMeterIntervalMs(250);
      store.getState().setWindowSecs(7.5);
      store.getState().setLiveMode('record');
      expect(store.getState().meterIntervalMs).toBe(250);
      expect(store.getState().windowSecs).toBe(7.5);
    });
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

    it('loadDevices hydrates channelGroups (#483) for the resolved device', async () => {
      useSettingsStore.setState({
        settings: { channelGroups: { 'Scarlett 18i20': [{ name: 'Drums', members: [0, 1], collapsed: true }] } } as never,
      });
      const { store } = makeStore({
        listDevices: async () => ({ success: true, micAccess: 'granted', devices: DEVICES }),
      });
      store.setState({ selectedDevice: '0' });
      await store.getState().loadDevices();
      expect(store.getState().channelGroups).toEqual([{ name: 'Drums', members: [0, 1], collapsed: true }]);
    });

    it('selectDevice hydrates channelGroups (#483) for the newly selected device', () => {
      useSettingsStore.setState({
        settings: { channelGroups: { 'Scarlett 18i20': [{ name: 'Drums', members: [0] }] } } as never,
      });
      const { store } = makeStore();
      store.setState({ devices: DEVICES, channelGroups: [{ name: 'Stale', members: [0] }] });
      store.getState().selectDevice('0');
      expect(store.getState().channelGroups).toEqual([{ name: 'Drums', members: [0] }]);
    });

    it('selectDevice resets channelGroups to [] when the device has no saved groups', () => {
      const { store } = makeStore();
      store.setState({ devices: DEVICES, channelGroups: [{ name: 'Stale', members: [0] }] });
      store.getState().selectDevice('0');
      expect(store.getState().channelGroups).toEqual([]);
    });

    it('selectDevice resets measurementSource to null (config is rebuilt, old indices are meaningless)', () => {
      const { store } = makeStore();
      store.setState({ devices: DEVICES, measurementSource: 1 });
      store.getState().selectDevice('0');
      expect(store.getState().measurementSource).toBeNull();
    });

    it('loadDevices resets measurementSource to null when it reseeds the config', async () => {
      const { store } = makeStore({
        listDevices: async () => ({ success: true, micAccess: 'granted', devices: DEVICES }),
      });
      store.setState({ measurementSource: 1 });
      await store.getState().loadDevices();
      expect(store.getState().measurementSource).toBeNull();
    });

    // TD-001 slice 6h (#711): the inline resetChannelConfig() and
    // window.liveCaptureRuntime.selectDevice wrappers both cleared the focused
    // input + last tick snapshot on a device switch; those resets are absorbed
    // into the store actions so the deleted wrappers are fully replaced.
    it('selectDevice resets focusedInputIndex and lastLiveChannels (absorbed resetChannelConfig)', () => {
      const { store } = makeStore();
      store.setState({ devices: DEVICES, focusedInputIndex: 1, lastLiveChannels: [{ index: 0 }] as never });
      store.getState().selectDevice('0');
      expect(store.getState().focusedInputIndex).toBeNull();
      expect(store.getState().lastLiveChannels).toBeNull();
    });

    it('loadDevices resets focusedInputIndex and lastLiveChannels when it reseeds the config', async () => {
      const { store } = makeStore({
        listDevices: async () => ({ success: true, micAccess: 'granted', devices: DEVICES }),
      });
      store.setState({ focusedInputIndex: 1, lastLiveChannels: [{ index: 0 }] as never });
      await store.getState().loadDevices();
      expect(store.getState().focusedInputIndex).toBeNull();
      expect(store.getState().lastLiveChannels).toBeNull();
    });

    it('loadDevices leaves the focused input + last tick alone when no devices are found', async () => {
      const { store } = makeStore({
        listDevices: async () => ({ success: true, devices: [] }),
      });
      store.setState({ focusedInputIndex: 1, lastLiveChannels: [{ index: 0 }] as never });
      await store.getState().loadDevices();
      expect(store.getState().focusedInputIndex).toBe(1);
      expect(store.getState().lastLiveChannels).toEqual([{ index: 0 }]);
    });
  });

  describe('measurementSource', () => {
    it('setMeasurementSource sets the value as given', () => {
      const { store } = makeStore();
      store.getState().setMeasurementSource(1);
      expect(store.getState().measurementSource).toBe(1);
    });

    it('the value survives unrelated store actions', () => {
      const { store } = makeStore();
      store.getState().setMeasurementSource(1);
      store.getState().setLiveMode('record');
      expect(store.getState().measurementSource).toBe(1);
    });

    it('setMeasurementSource(null) resets to the default', () => {
      const { store } = makeStore();
      store.getState().setMeasurementSource(1);
      store.getState().setMeasurementSource(null);
      expect(store.getState().measurementSource).toBeNull();
    });
  });

  describe('selectedChannel (#668)', () => {
    it('setSelectedChannel sets the value as given', () => {
      const { store } = makeStore();
      store.getState().setSelectedChannel(1);
      expect(store.getState().selectedChannel).toBe(1);
    });

    it('the value survives unrelated store actions', () => {
      const { store } = makeStore();
      store.getState().setSelectedChannel(1);
      store.getState().setLiveMode('record');
      expect(store.getState().selectedChannel).toBe(1);
    });

    it('setSelectedChannel(null) resets to the default', () => {
      const { store } = makeStore();
      store.getState().setSelectedChannel(1);
      store.getState().setSelectedChannel(null);
      expect(store.getState().selectedChannel).toBeNull();
    });

    it('selectDevice resets selectedChannel to null (config is rebuilt, old indices are meaningless)', () => {
      const { store } = makeStore();
      store.setState({ devices: DEVICES, selectedChannel: 1 });
      store.getState().selectDevice('0');
      expect(store.getState().selectedChannel).toBeNull();
    });

    it('loadDevices resets selectedChannel to null when it reseeds the config', async () => {
      const { store } = makeStore({
        listDevices: async () => ({ success: true, micAccess: 'granted', devices: DEVICES }),
      });
      store.setState({ selectedChannel: 1 });
      await store.getState().loadDevices();
      expect(store.getState().selectedChannel).toBeNull();
    });

    it('removeStrip resets selectedChannel to null when the selected strip is removed', () => {
      const { store } = makeStore();
      store.setState({
        channelConfig: [{ kind: 'mono', a: 0, b: 1 }, { kind: 'mono', a: 1, b: 2 }],
        selectedChannel: 0,
      });
      store.getState().removeStrip(0);
      expect(store.getState().selectedChannel).toBeNull();
    });

    it('removeStrip shifts selectedChannel down when a lower strip is removed', () => {
      const { store } = makeStore();
      store.setState({
        channelConfig: [{ kind: 'mono', a: 0, b: 1 }, { kind: 'mono', a: 1, b: 2 }],
        selectedChannel: 1,
      });
      store.getState().removeStrip(0);
      expect(store.getState().selectedChannel).toBe(0);
    });

    it('removeStrip leaves selectedChannel untouched when a higher strip is removed', () => {
      const { store } = makeStore();
      store.setState({
        channelConfig: [{ kind: 'mono', a: 0, b: 1 }, { kind: 'mono', a: 1, b: 2 }],
        selectedChannel: 0,
      });
      store.getState().removeStrip(1);
      expect(store.getState().selectedChannel).toBe(0);
    });
  });

  describe('monitor mute / solo (#1054)', () => {
    it('toggleChannelMute(idx) mutes then unmutes with the key removed', () => {
      const { store } = makeStore();
      store.getState().toggleChannelMute(1);
      expect(store.getState().mutedChannels[1]).toBe(true);
      store.getState().toggleChannelMute(1);
      expect(store.getState().mutedChannels).toEqual({});
    });

    it('muting two different channels keeps both keys; unmuting one leaves the other', () => {
      const { store } = makeStore();
      store.getState().toggleChannelMute(0);
      store.getState().toggleChannelMute(1);
      expect(store.getState().mutedChannels).toEqual({ 0: true, 1: true });
      store.getState().toggleChannelMute(0);
      expect(store.getState().mutedChannels).toEqual({ 1: true });
    });

    it('toggleChannelSolo(idx) solos, and clearChannelSolo empties the map', () => {
      const { store } = makeStore();
      store.getState().toggleChannelSolo(2);
      expect(store.getState().soloedChannels[2]).toBe(true);
      expect(Object.keys(store.getState().soloedChannels)).toHaveLength(1);
      store.getState().clearChannelSolo();
      expect(Object.keys(store.getState().soloedChannels)).toHaveLength(0);
    });

    it('toggleChannelSolo twice on the same channel unsolos it', () => {
      const { store } = makeStore();
      store.getState().toggleChannelSolo(2);
      store.getState().toggleChannelSolo(2);
      expect(store.getState().soloedChannels).toEqual({});
    });

    it('clearChannelSolo leaves mutedChannels untouched', () => {
      const { store } = makeStore();
      store.getState().toggleChannelMute(0);
      store.getState().clearChannelSolo();
      expect(store.getState().mutedChannels[0]).toBe(true);
    });

    it('mute and solo are independent', () => {
      const { store } = makeStore();
      store.getState().toggleChannelMute(0);
      expect(store.getState().soloedChannels).toEqual({});
      store.getState().toggleChannelSolo(0);
      expect(store.getState().mutedChannels).toEqual({ 0: true });
    });

    it('every toggle writes a new mutedChannels object (no mutation)', () => {
      const { store } = makeStore();
      const before = store.getState().mutedChannels;
      store.getState().toggleChannelMute(0);
      expect(store.getState().mutedChannels).not.toBe(before);
      expect(before).toEqual({});
    });

    it('removeStrip reindexes both flag maps, dropping the removed strip and shifting higher ones down', () => {
      const { store } = makeStore();
      store.setState({
        channelConfig: [
          { kind: 'mono', a: 0, b: 1 },
          { kind: 'mono', a: 1, b: 2 },
          { kind: 'mono', a: 2, b: 3 },
        ],
      });
      store.getState().toggleChannelMute(2);
      store.getState().toggleChannelSolo(2);
      store.getState().removeStrip(0);
      expect(store.getState().mutedChannels).toEqual({ 1: true });
      expect(store.getState().soloedChannels).toEqual({ 1: true });
    });

    it('selectDevice resets both maps to {}', () => {
      const { store } = makeStore();
      store.setState({ devices: DEVICES });
      store.getState().toggleChannelMute(0);
      store.getState().selectDevice('0');
      expect(store.getState().mutedChannels).toEqual({});
      expect(store.getState().soloedChannels).toEqual({});
    });

    it('loadDevices resets both maps to {} when it reseeds the config', async () => {
      const { store } = makeStore({
        listDevices: async () => ({ success: true, micAccess: 'granted', devices: DEVICES }),
      });
      store.getState().toggleChannelMute(0);
      await store.getState().loadDevices();
      expect(store.getState().mutedChannels).toEqual({});
      expect(store.getState().soloedChannels).toEqual({});
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

    it('removeStrip resets measurementSource to null when the selected strip is removed', () => {
      const { store } = makeStore();
      store.setState({
        channelConfig: [{ kind: 'mono', a: 0, b: 1 }, { kind: 'mono', a: 1, b: 2 }],
        measurementSource: 0,
      });
      store.getState().removeStrip(0);
      expect(store.getState().measurementSource).toBeNull();
    });

    it('removeStrip shifts measurementSource down when a lower strip is removed', () => {
      const { store } = makeStore();
      store.setState({
        channelConfig: [{ kind: 'mono', a: 0, b: 1 }, { kind: 'mono', a: 1, b: 2 }],
        measurementSource: 1,
      });
      store.getState().removeStrip(0);
      expect(store.getState().measurementSource).toBe(0);
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

    it('moveGroup reorders channelGroups (#483)', () => {
      const { store } = makeStore();
      store.setState({ channelGroups: [{ name: 'A', members: [] }, { name: 'B', members: [] }] });
      store.getState().moveGroup(0, 1);
      expect(store.getState().channelGroups.map((g) => g.name)).toEqual(['B', 'A']);
    });

    it('moveChannelInGroup reorders members within a group by position (#483)', () => {
      const { store } = makeStore();
      store.setState({ channelGroups: [{ name: 'Drums', members: [0, 1, 2] }] });
      store.getState().moveChannelInGroup(0, 2, 0);
      expect(store.getState().channelGroups[0].members).toEqual([2, 0, 1]);
    });

    it('removeStrip persists the pruned channelGroups map via useSettingsStore (#483)', () => {
      const updateSettingsSpy = vi.fn().mockResolvedValue(undefined);
      useSettingsStore.setState({ settings: { channelGroups: {} } as never, updateSettings: updateSettingsSpy });
      const { store } = makeStore();
      store.setState({
        devices: DEVICES, selectedDevice: '0',
        channelConfig: [{ kind: 'mono', a: 0, b: 1 }, { kind: 'mono', a: 1, b: 2 }],
        channelGroups: [{ name: 'Drums', members: [0, 1] }],
      });
      store.getState().removeStrip(0);
      expect(updateSettingsSpy).toHaveBeenCalledWith({
        channelGroups: { 'Scarlett 18i20': [{ name: 'Drums', members: [0], collapsed: false }] },
      });
    });

    it('addGroup persists the computed channelGroups map via useSettingsStore (#483)', () => {
      const updateSettingsSpy = vi.fn().mockResolvedValue(undefined);
      useSettingsStore.setState({ settings: { channelGroups: {} } as never, updateSettings: updateSettingsSpy });
      const { store } = makeStore();
      store.setState({ devices: DEVICES, selectedDevice: '0' });
      store.getState().addGroup('Drums');
      expect(updateSettingsSpy).toHaveBeenCalledWith({
        channelGroups: { 'Scarlett 18i20': [{ name: 'Drums', members: [], collapsed: false }] },
      });
    });

    it('persistGroups keys by device name and preserves other devices (#483)', () => {
      const updateSettingsSpy = vi.fn().mockResolvedValue(undefined);
      useSettingsStore.setState({
        settings: { channelGroups: { Other: [{ name: 'Existing', members: [] }] } } as never,
        updateSettings: updateSettingsSpy,
      });
      const { store } = makeStore();
      store.setState({ devices: DEVICES, selectedDevice: '0' });
      store.getState().addGroup('Drums');
      expect(updateSettingsSpy).toHaveBeenCalledWith({
        channelGroups: {
          Other: [{ name: 'Existing', members: [] }],
          'Scarlett 18i20': [{ name: 'Drums', members: [], collapsed: false }],
        },
      });
    });
  });

  describe('setRunning / setPromoting (TD-001 slice 6c, #701)', () => {
    it('setRunning sets isCapturing directly, independent of the async startCapture/stopCapture flow', () => {
      const { store } = makeStore();
      store.getState().setRunning(true);
      expect(store.getState().isCapturing).toBe(true);
      store.getState().setRunning(false);
      expect(store.getState().isCapturing).toBe(false);
    });

    it('setPromoting sets the promoting flag, defaulting to false', () => {
      const { store } = makeStore();
      expect(store.getState().promoting).toBe(false);
      store.getState().setPromoting(true);
      expect(store.getState().promoting).toBe(true);
      store.getState().setPromoting(false);
      expect(store.getState().promoting).toBe(false);
    });

    it('setStopping sets the stopping flag, defaulting to false (#729)', () => {
      const { store } = makeStore();
      expect(store.getState().stopping).toBe(false);
      store.getState().setStopping(true);
      expect(store.getState().stopping).toBe(true);
      store.getState().setStopping(false);
      expect(store.getState().stopping).toBe(false);
    });

    it('setDemoting sets the demoting flag, defaulting to false (#847)', () => {
      const { store } = makeStore();
      expect(store.getState().demoting).toBe(false);
      store.getState().setDemoting(true);
      expect(store.getState().demoting).toBe(true);
      store.getState().setDemoting(false);
      expect(store.getState().demoting).toBe(false);
    });
  });

  describe('collapse', () => {
    it('setGroupCollapsed sets the group-level collapsed flag (#483)', () => {
      const { store } = makeStore();
      store.setState({ channelGroups: [{ name: 'Drums', members: [0, 1] }] });
      store.getState().setGroupCollapsed(0, true);
      expect(store.getState().channelGroups[0].collapsed).toBe(true);
      store.getState().setGroupCollapsed(0, false);
      expect(store.getState().channelGroups[0].collapsed).toBe(false);
    });

    it('toggleGroupCollapse flips the group-level collapsed flag (#483)', () => {
      const { store } = makeStore();
      store.setState({ channelGroups: [{ name: 'Drums', members: [0, 1] }] });
      store.getState().toggleGroupCollapse(0);
      expect(store.getState().channelGroups[0].collapsed).toBe(true);
      store.getState().toggleGroupCollapse(0);
      expect(store.getState().channelGroups[0].collapsed).toBe(false);
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
      await store.getState().startCapture({ windowSecs: 3, intervalSecs: 0.1 });
      expect(mock.calls).toContainEqual({
        method: 'startLive',
        args: [{
          device: '0',
          channels: ['0', '2-3'],
          windowSecs: 3,
          intervalSecs: 0.1,
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
      await store.getState().startCapture({ windowSecs: 3, intervalSecs: 0.1 });
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
      await store.getState().startCapture({ windowSecs: 3, intervalSecs: 0.1 });
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
      await store.getState().startCapture({ windowSecs: 3, intervalSecs: 0.1 });
      const call = mock.calls.find((c) => c.method === 'startLive');
      expect((call!.args[0] as { labels?: string[] }).labels).toBeUndefined();
    });

    it('resets isCapturing on a failed start and returns the result', async () => {
      const { store } = makeStore({ startLive: async () => ({ success: false, error: 'boom' }) });
      const result = await store.getState().startCapture({ windowSecs: 3, intervalSecs: 0.1 });
      expect(store.getState().isCapturing).toBe(false);
      expect(result).toEqual({ success: false, error: 'boom' });
    });

    it('is a no-op while already capturing', async () => {
      const { store, mock } = makeStore({ startLive: async () => ({ success: true }) });
      store.setState({ isCapturing: true });
      const result = await store.getState().startCapture({ windowSecs: 3, intervalSecs: 0.1 });
      expect(result).toBeUndefined();
      expect(mock.calls.filter((c) => c.method === 'startLive')).toHaveLength(0);
    });

  });

  describe('stopCapture', () => {
    it('clears capture state and calls sb.stopLive', async () => {
      const { store, mock } = makeStore({
        startLive: async () => ({ success: true }),
        stopLive: async () => {
          mock.calls.push({ method: 'stopLive', args: [] });
          return { success: true, sessionDir: '/tmp/session' };
        },
      });
      await store.getState().startCapture({ windowSecs: 3, intervalSecs: 0.1 });
      const result = await store.getState().stopCapture();
      expect(store.getState().isCapturing).toBe(false);
      expect(result).toEqual({ success: true, sessionDir: '/tmp/session' });
      expect(mock.calls.some((c) => c.method === 'stopLive')).toBe(true);
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

  describe('clearLastLiveChannels', () => {
    it('clears the most-recent-tick channel snapshot (TD-001 slice 6c, #701 — a device switch must not leak a stale reading into the EQ pane)', () => {
      const { store } = makeStore();
      store.setState({ lastLiveChannels: [{ index: 0, name: 'Ch 1', rms: -20, peak: -6, clipping: false, centroid: 0, rolloff: 0, bands: {} }] });
      store.getState().clearLastLiveChannels();
      expect(store.getState().lastLiveChannels).toBeNull();
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

    it('a peaks frame does not touch lastTick/lastLiveChannels/boardShapeVersion (#720)', () => {
      const { store, mock } = makeStore();
      store.getState().bindIpcEvents();
      const meter = { type: 'meter', ts: 0, channels: [{ index: 0, name: 'A', bands: {}, rms: -10, peak: -5, clipping: false, centroid: 100, rolloff: 200 }] };
      mock.emit('onLiveEvent', meter);
      expect(store.getState().boardShapeVersion).toBe(1);
      mock.emit('onLiveEvent', { type: 'peaks', ts: 1, lanes: {} });
      expect(store.getState().lastTick).toEqual(meter);
      expect(store.getState().lastLiveChannels).toEqual(meter.channels);
      expect(store.getState().boardShapeVersion).toBe(1);
      expect(store.getState().liveWindows).toEqual([]);
    });

    it('a tick leaves channelGroups (incl. collapsed) untouched (#483)', () => {
      const { store, mock } = makeStore();
      store.setState({ channelGroups: [{ name: 'Drums', members: [0, 1], collapsed: true }] });
      store.getState().bindIpcEvents();
      const tick = { type: 'window', window: 1, ts: 0, channels: [{ index: 0, name: 'A', bands: {}, rms: -10, peak: -5, clipping: false, centroid: 100, rolloff: 200 }], masking: [] };
      mock.emit('onLiveEvent', tick);
      expect(store.getState().channelGroups).toEqual([{ name: 'Drums', members: [0, 1], collapsed: true }]);
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

  describe('secondary measurement source (#460)', () => {
    const SECONDARY_DEVICES: LiveDevice[] = [
      { index: 0, name: 'Built-in Microphone', channels: 2, default_sr: 48000 },
      { index: 2, name: 'USB Measurement Mic', channels: 1, default_sr: 48000 },
    ];

    it('starts off with no secondary source and an empty window buffer', () => {
      const { store } = makeStore();
      expect(store.getState().secondaryMeasurement).toEqual({ status: 'off', deviceName: '' });
      expect(store.getState().secondaryWindows).toEqual([]);
      expect(store.getState().lastMeasurementChannels).toBeNull();
    });

    it('setSecondaryDeviceName sets the name and persists it via useSettingsStore', () => {
      const updateSettingsSpy = vi.fn().mockResolvedValue(undefined);
      useSettingsStore.setState({ settings: {} as never, updateSettings: updateSettingsSpy });
      const { store } = makeStore();

      store.getState().setSecondaryDeviceName('USB Measurement Mic');

      expect(store.getState().secondaryMeasurement.deviceName).toBe('USB Measurement Mic');
      expect(updateSettingsSpy).toHaveBeenCalledWith({ measurementDeviceName: 'USB Measurement Mic' });
    });

    it('startSecondaryMeasurement resolves the name to an index and applies an active result', async () => {
      const startMeasurement = vi.fn().mockResolvedValue({ success: true });
      const { store } = makeStore({ startMeasurement });
      store.setState({
        devices: SECONDARY_DEVICES,
        secondaryMeasurement: { status: 'off', deviceName: 'USB Measurement Mic' },
      });

      await store.getState().startSecondaryMeasurement({ windowSecs: 5, intervalSecs: 0.1 });

      expect(startMeasurement).toHaveBeenCalledWith({ device: '2', windowSecs: 5, intervalSecs: 0.1 });
      expect(store.getState().secondaryMeasurement.status).toBe('active');
    });

    it('startSecondaryMeasurement goes disconnected without an API call when the device is absent', async () => {
      const startMeasurement = vi.fn();
      const { store } = makeStore({ startMeasurement });
      store.setState({
        devices: SECONDARY_DEVICES,
        secondaryMeasurement: { status: 'off', deviceName: 'Ghost Interface' },
      });

      await store.getState().startSecondaryMeasurement({ windowSecs: 5, intervalSecs: 0.1 });

      expect(startMeasurement).not.toHaveBeenCalled();
      expect(store.getState().secondaryMeasurement.status).toBe('disconnected');
    });

    it('startSecondaryMeasurement surfaces a blocked mic result', async () => {
      const startMeasurement = vi.fn().mockResolvedValue({ success: false, micAccess: 'denied' });
      const { store } = makeStore({ startMeasurement });
      store.setState({
        devices: SECONDARY_DEVICES,
        secondaryMeasurement: { status: 'off', deviceName: 'USB Measurement Mic' },
      });

      await store.getState().startSecondaryMeasurement({ windowSecs: 5, intervalSecs: 0.1 });

      expect(store.getState().secondaryMeasurement).toEqual({
        status: 'blocked',
        deviceName: 'USB Measurement Mic',
        micAccess: 'denied',
      });
    });

    it('stopSecondaryMeasurement clears the stream and windows but keeps the preference', async () => {
      const stopMeasurement = vi.fn().mockResolvedValue({ success: true });
      const { store } = makeStore({ stopMeasurement });
      store.setState({
        secondaryMeasurement: { status: 'active', deviceName: 'USB Measurement Mic' },
        secondaryWindows: [{ window: 1 } as never],
      });

      await store.getState().stopSecondaryMeasurement();

      expect(stopMeasurement).toHaveBeenCalled();
      expect(store.getState().secondaryMeasurement).toEqual({ status: 'off', deviceName: 'USB Measurement Mic' });
      expect(store.getState().secondaryWindows).toEqual([]);
    });

    it('bindMeasurementEvents flags disconnect on measurementEnded', () => {
      const { store, mock } = makeStore();
      store.setState({ secondaryMeasurement: { status: 'active', deviceName: 'USB Mic' } });
      store.getState().bindMeasurementEvents();

      mock.emit('onMeasurementEvent', { measurementEnded: true, code: 1 });

      expect(store.getState().secondaryMeasurement.status).toBe('disconnected');
    });

    it('bindMeasurementEvents stores an error payload in lastError', () => {
      const { store, mock } = makeStore();
      store.getState().bindMeasurementEvents();

      mock.emit('onMeasurementEvent', { error: 'boom' });

      expect(store.getState().lastError).toBe('boom');
    });

    it('bindMeasurementEvents buffers window ticks with the cap', () => {
      const { store, mock } = makeStore();
      store.getState().bindMeasurementEvents();

      for (let i = 0; i < LIVE_WINDOWS_CAP + 3; i++) {
        mock.emit('onMeasurementEvent', { window: i });
      }

      expect(store.getState().secondaryWindows).toHaveLength(LIVE_WINDOWS_CAP);
      expect((store.getState().secondaryWindows[0] as { window: number }).window).toBe(3);
    });

    it('bindMeasurementEvents tracks the latest tick channels for the Room pane (#460 visual swap)', () => {
      const { store, mock } = makeStore();
      store.getState().bindMeasurementEvents();

      const meterCh = [{ index: 0, name: 'Room', rms: -20 }];
      mock.emit('onMeasurementEvent', { type: 'meter', ts: 1, channels: meterCh });

      // Meter ticks refresh the pane reading but never buffer as windows.
      expect(store.getState().lastMeasurementChannels).toBe(meterCh);
      expect(store.getState().secondaryWindows).toEqual([]);

      // A window tick refreshes the reading too (it also carries channels).
      const windowCh = [{ index: 0, name: 'Room', rms: -24 }];
      mock.emit('onMeasurementEvent', { window: 1, ts: 2, channels: windowCh });
      expect(store.getState().lastMeasurementChannels).toBe(windowCh);
      expect(store.getState().secondaryWindows).toHaveLength(1);
    });

    it('startSecondaryMeasurement clears the previous device’s last reading', async () => {
      const startMeasurement = vi.fn().mockResolvedValue({ success: true });
      const { store } = makeStore({ startMeasurement });
      store.setState({
        devices: SECONDARY_DEVICES,
        secondaryMeasurement: { status: 'off', deviceName: 'USB Measurement Mic' },
        lastMeasurementChannels: [{ index: 0, name: 'Stale' } as never],
      });

      await store.getState().startSecondaryMeasurement({ windowSecs: 5, intervalSecs: 0.1 });

      expect(store.getState().lastMeasurementChannels).toBeNull();
    });

    it('stopSecondaryMeasurement clears the last reading alongside the window buffer', async () => {
      const { store } = makeStore();
      store.setState({
        secondaryMeasurement: { status: 'active', deviceName: 'USB Measurement Mic' },
        secondaryWindows: [{ window: 1 } as never],
        lastMeasurementChannels: [{ index: 0, name: 'Room' } as never],
      });

      await store.getState().stopSecondaryMeasurement();

      expect(store.getState().lastMeasurementChannels).toBeNull();
    });

    it('pollSecondaryReconnect restarts the stream and returns true when the remembered device reappears', async () => {
      const startMeasurement = vi.fn().mockResolvedValue({ success: true });
      const listDevices = vi.fn().mockResolvedValue({ success: true, devices: SECONDARY_DEVICES });
      const { store } = makeStore({ startMeasurement, listDevices });
      store.setState({
        devices: [],
        secondaryMeasurement: { status: 'disconnected', deviceName: 'USB Measurement Mic' },
      });

      const restarted = await store.getState().pollSecondaryReconnect({ windowSecs: 5, intervalSecs: 0.1 });

      expect(restarted).toBe(true);
      expect(startMeasurement).toHaveBeenCalledWith({ device: '2', windowSecs: 5, intervalSecs: 0.1 });
      expect(store.getState().secondaryMeasurement.status).toBe('active');
      expect(store.getState().devices).toEqual(SECONDARY_DEVICES);
    });

    it('pollSecondaryReconnect returns false and makes no startMeasurement call when the remembered device is still absent', async () => {
      const startMeasurement = vi.fn();
      const listDevices = vi.fn().mockResolvedValue({ success: true, devices: [] });
      const { store } = makeStore({ startMeasurement, listDevices });
      store.setState({
        devices: [],
        secondaryMeasurement: { status: 'disconnected', deviceName: 'USB Measurement Mic' },
      });

      const restarted = await store.getState().pollSecondaryReconnect({ windowSecs: 5, intervalSecs: 0.1 });

      expect(restarted).toBe(false);
      expect(startMeasurement).not.toHaveBeenCalled();
      expect(store.getState().secondaryMeasurement.status).toBe('disconnected');
    });
  });

  it('binds the default hook to the window preload bridge', async () => {
    (globalThis as { window?: unknown }).window = {
      soundBuddy: createMockSoundBuddy({
        listDevices: async () => ({ success: true, devices: [] }),
      }).api,
      armState, groupState, rigKind,
    };
    await expect(useLiveCaptureStore.getState().loadDevices()).resolves.toBeUndefined();
  });

  describe('focused input + live-adjustments coaching state (TD-001 slice 6g, #710)', () => {
    // The pure helper classic-scripts lapDispose/advanceLapCoaching resolve
    // through (lapObservationContext -> lapFocusView reads rigReconcile/
    // instrumentProfiles; the coaching reducers + allCoachingCandidates read
    // liveAdjustmentsState/grading).
    const rigReconcile = require('../../rig-reconcile.js');
    const instrumentProfiles = require('../../instrument-profiles.js');
    const liveAdjustmentsState = require('../../live-adjustments-state.js');
    const grading = require('../../grading.js');

    beforeEach(() => {
      (globalThis as { window?: unknown }).window = {
        armState, groupState, rigKind, channelLabels,
        rigReconcile, instrumentProfiles, liveAdjustmentsState, grading,
      };
      useSettingsStore.setState({
        settings: {
          inputInstrumentProfiles: {},
          channelLabels: {},
          channelGroups: {},
        } as never,
      });
    });

    it('starts with no focused input and no coaching state', () => {
      const { store } = makeStore();
      expect(store.getState().focusedInputIndex).toBeNull();
      expect(store.getState().lapCoaching).toBeNull();
    });

    it('setFocusedInputIndex stores the value as given', () => {
      const { store } = makeStore();
      store.getState().setFocusedInputIndex(2);
      expect(store.getState().focusedInputIndex).toBe(2);
      store.getState().setFocusedInputIndex(null);
      expect(store.getState().focusedInputIndex).toBeNull();
    });

    it('removeStrip shifts/clears the focused input index like the other runtime selections', () => {
      const { store } = makeStore();
      store.setState({
        channelConfig: [{ kind: 'mono', a: 0, b: 1 }, { kind: 'mono', a: 1, b: 2 }],
        focusedInputIndex: 1,
      });
      store.getState().removeStrip(0);
      expect(store.getState().focusedInputIndex).toBe(0);
      store.setState({ channelConfig: [{ kind: 'mono', a: 0, b: 1 }], focusedInputIndex: 0 });
      store.getState().removeStrip(0);
      expect(store.getState().focusedInputIndex).toBeNull();
    });

    it('resetLapCoaching seeds a fresh coaching state from liveAdjustmentsState', () => {
      const { store } = makeStore();
      const base = liveAdjustmentsState.createCoachingState();
      expect(base).toEqual({ active: null, activeSince: null, pendingId: null, pendingCount: 0, pendingCandidate: null, clearCount: 0, cooldowns: {}, acknowledgedId: null, snoozeUntil: null, dismissed: {}, observing: null, outcome: null });
      store.setState({ lapCoaching: { active: { id: 'x' } } });
      store.getState().resetLapCoaching();
      expect(store.getState().lapCoaching).toEqual(base);
    });

    it('lapDispose applies the acknowledge reducer and writes lapCoaching', () => {
      const { store } = makeStore();
      const active = liveAdjustmentsState.createCoachingState();
      const withActive = { ...active, active: { id: 'low-end', title: 't', category: 'tonal', severityDb: 4, confidence: 0.8 } };
      store.setState({ lapCoaching: withActive });
      store.getState().lapDispose('acknowledge');
      expect((store.getState().lapCoaching as { acknowledgedId: string }).acknowledgedId).toBe('low-end');
    });

    it('lapDispose passes the observation context to markTriedCoaching (#614)', () => {
      const { store } = makeStore();
      const active = liveAdjustmentsState.createCoachingState();
      store.setState({
        channelConfig: [{ kind: 'mono', a: 0, b: 1 }, { kind: 'mono', a: 1, b: 2 }],
        focusedInputIndex: 1,
        measurementSource: 0,
        lapCoaching: { ...active, active: { id: 'low-end', title: 't', category: 'tonal', severityDb: 4, confidence: 0.8 } },
      });
      store.getState().lapDispose('tried', 1000);
      const observing = (store.getState().lapCoaching as { observing: { source: { measurementSource: number; focusIndex: number; label: string }; until: number } }).observing;
      expect(observing.source).toEqual({ measurementSource: 0, focusIndex: 1, label: 'Track 1' });
      expect(observing.until).toBe(1000 + liveAdjustmentsState.OBSERVATION_WINDOW_MS);
    });

    it('lapDispose routes every disposition through its reducer with an injected now', () => {
      const { store } = makeStore();
      const base = liveAdjustmentsState.createCoachingState();
      store.setState({ lapCoaching: base });

      store.getState().lapDispose('snooze', 500);
      expect((store.getState().lapCoaching as { snoozeUntil: number | null }).snoozeUntil).toBe(500 + liveAdjustmentsState.SNOOZE_MS);

      store.getState().lapDispose('resume');
      expect((store.getState().lapCoaching as { snoozeUntil: number | null }).snoozeUntil).toBeNull();

      store.setState({
        lapCoaching: { ...base, active: { id: 'clip-risk', title: 't', category: 'clipping', severityDb: 2, confidence: 1 } },
      });
      store.getState().lapDispose('dismiss', 700);
      const dismissed = store.getState().lapCoaching as { active: unknown; dismissed: Record<string, { severityDb: number; at: number }> };
      expect(dismissed.active).toBeNull();
      expect(dismissed.dismissed['clip-risk']).toEqual({ severityDb: 2, at: 700 });

      store.setState({ lapCoaching: { ...base, outcome: { id: 'low-end', title: 't', category: 'tonal', scope: 'mix' } } });
      store.getState().lapDispose('outcome-ack', 900);
      expect((store.getState().lapCoaching as { outcome: unknown }).outcome).toBeNull();
    });

    it('lapDispose defaults now to Date.now()', () => {
      const { store } = makeStore();
      const base = liveAdjustmentsState.createCoachingState();
      store.setState({ lapCoaching: base });
      const spy = vi.spyOn(Date, 'now').mockReturnValue(12345);
      try {
        store.getState().lapDispose('snooze');
      } finally {
        spy.mockRestore();
      }
      expect((store.getState().lapCoaching as { snoozeUntil: number }).snoozeUntil).toBe(12345 + liveAdjustmentsState.SNOOZE_MS);
    });

    it('advanceLapCoaching advances from allCoachingCandidates with the observation context and Date.now()', () => {
      const { store } = makeStore();
      const base = liveAdjustmentsState.createCoachingState();
      store.setState({ lapCoaching: base });
      const spy = vi.spyOn(Date, 'now').mockReturnValue(50000);
      try {
        store.getState().advanceLapCoaching();
      } finally {
        spy.mockRestore();
      }
      // No windows accumulated -> no candidates -> still the monitoring state.
      expect(store.getState().lapCoaching).toEqual(base);
      // The write path is the same one lapDispose uses.
      store.getState().advanceLapCoaching();
      expect(store.getState().lapCoaching).toEqual(base);
    });
  });

  describe('arm hint (TD-001 slice 6h, #711)', () => {
    it('starts hidden with empty text', () => {
      const { store } = makeStore();
      expect(store.getState().armHint).toEqual({ visible: false, text: '' });
    });

    it('showArmHint sets the visible flag and the message text', () => {
      const { store } = makeStore();
      store.getState().showArmHint('Arm at least one strip to record.');
      expect(store.getState().armHint).toEqual({ visible: true, text: 'Arm at least one strip to record.' });
    });

    it('showArmHint replaces an earlier message', () => {
      const { store } = makeStore();
      store.getState().showArmHint('first');
      store.getState().showArmHint('second');
      expect(store.getState().armHint.text).toBe('second');
    });

    it('hideArmHint clears the visible flag', () => {
      const { store } = makeStore();
      store.getState().showArmHint('Arm at least one strip to record.');
      store.getState().hideArmHint();
      expect(store.getState().armHint.visible).toBe(false);
    });
  });

  describe('post-stop session chrome (TD-001 slice 6i, #712)', () => {
    it('starts with no offers, the live cue visible, and no status text', () => {
      const { store } = makeStore();
      expect(store.getState().sessionOffers).toEqual({ sessionDir: null, reportCard: false, notEnoughData: false });
      expect(store.getState().liveCueVisible).toBe(true);
      expect(store.getState().liveStatusText).toBeNull();
    });

    it('setSessionOffers merges a partial patch onto the existing offers', () => {
      const { store } = makeStore();
      store.getState().setSessionOffers({ sessionDir: '/tmp/session' });
      expect(store.getState().sessionOffers).toEqual({ sessionDir: '/tmp/session', reportCard: false, notEnoughData: false });
      store.getState().setSessionOffers({ reportCard: true });
      expect(store.getState().sessionOffers).toEqual({ sessionDir: '/tmp/session', reportCard: true, notEnoughData: false });
      store.getState().setSessionOffers({ sessionDir: null, notEnoughData: true });
      expect(store.getState().sessionOffers).toEqual({ sessionDir: null, reportCard: true, notEnoughData: true });
    });

    it('setLiveCueVisible hides/shows the #live-rc-cue cue', () => {
      const { store } = makeStore();
      store.getState().setLiveCueVisible(false);
      expect(store.getState().liveCueVisible).toBe(false);
      store.getState().setLiveCueVisible(true);
      expect(store.getState().liveCueVisible).toBe(true);
    });

    it('setLiveStatusText stores the text as given; null hides the status line', () => {
      const { store } = makeStore();
      store.getState().setLiveStatusText('Monitoring · meters 10/s');
      expect(store.getState().liveStatusText).toBe('Monitoring · meters 10/s');
      store.getState().setLiveStatusText(null);
      expect(store.getState().liveStatusText).toBeNull();
      store.getState().setLiveStatusText('Connecting…');
      expect(store.getState().liveStatusText).toBe('Connecting…');
    });

    it('the session chrome fields survive an unrelated store action', () => {
      const { store } = makeStore();
      store.getState().setSessionOffers({ sessionDir: '/tmp/s' });
      store.getState().setLiveCueVisible(false);
      store.getState().setLiveStatusText('x');
      store.getState().setLiveMode('record');
      expect(store.getState().sessionOffers.sessionDir).toBe('/tmp/s');
      expect(store.getState().liveCueVisible).toBe(false);
      expect(store.getState().liveStatusText).toBe('x');
    });
  });
});
