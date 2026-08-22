// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createRigStore, type RigApiSubset } from './rigStore';
import { useLiveCaptureStore } from './liveCaptureStore';
import { useSettingsStore } from './settingsStore';
import { createMockSoundBuddy } from '../mock-sound-buddy';
import type { CaptureRig, AppSettings } from '../../../electron/ipc/api';
import type { LiveDevice } from '../live-capture-panel';

// rig-reconcile.js/preflight.js/arm-state.js/channel-labels.js are real,
// pure classic-script modules — same convention as liveCaptureStore.test.ts's
// armState/groupState requires.
const rigReconcile = require('../../rig-reconcile.js');
const preflight = require('../../preflight.js');
const armState = require('../../arm-state.js');
const channelLabels = require('../../channel-labels.js');

let rigDialog: ReturnType<typeof vi.fn>;

beforeEach(() => {
  rigDialog = vi.fn();
  (globalThis as { window?: unknown }).window = { rigReconcile, preflight, armState, channelLabels, rigDialog };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useLiveCaptureStore.setState({
    devices: [], selectedDevice: '', channelConfig: [], channelGroups: [],
    liveMode: 'monitor', recordDir: '', measurementSource: null,
    meterIntervalMs: 100, windowSecs: 3, rigApplyNotice: null,
    sessionOffers: { sessionDir: null, reportCard: false, notEnoughData: false },
    liveCueVisible: true, liveStatusText: null,
  });
  useSettingsStore.setState({ settings: null, settingsError: null });
});

function makeStore(overrides: Partial<Parameters<typeof createMockSoundBuddy>[0]> = {}) {
  const mock = createMockSoundBuddy(overrides);
  const store = createRigStore(() => mock.api as unknown as RigApiSubset);
  return { store, mock };
}

const DEVICES: LiveDevice[] = [{ index: 0, name: 'Scarlett 18i20', channels: 8, default_sr: 48000 }];

function makeRig(overrides: Partial<CaptureRig> = {}): CaptureRig {
  return {
    id: 'rig-1',
    name: 'Main Board',
    deviceName: 'Scarlett 18i20',
    channelConfig: [{ kind: 'mono', a: 0, b: 0 }],
    mode: 'monitor',
    recordDir: '',
    intervalMs: 100,
    windowSecs: 3,
    ...overrides,
  };
}

function fakeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    idealProfile: '', customIdealProfiles: [], storageDir: '', rigs: [], activeRigId: null,
    usageSignalEnabled: false, channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {},
    crashReportingEnabled: false, liveAdjustmentsEnabled: false,
    reportFirstUxEnabled: false, shareChurchName: '', weeklyReminderEnabled: false,
    weeklyReminderServiceDay: 0, liveEqPaneWidth: 360,
    measurementDeviceName: '', gradingProfile: 'casual', consoleNetworkConsentGranted: false,
    soundcheckBuses: [],
    ...overrides,
  };
}

describe('createRigStore', () => {
  it('starts with no rigs and unlocked', () => {
    const { store } = makeStore();
    expect(store.getState()).toMatchObject({ rigs: [], activeRigId: null, locked: false });
  });

  describe('loadRigs', () => {
    it('seeds the picker and applies the active rig', async () => {
      const rig = makeRig({ intervalMs: 200, windowSecs: 5 });
      const { store } = makeStore({ getSettings: async () => fakeSettings({ rigs: [rig], activeRigId: 'rig-1' }) });
      useLiveCaptureStore.setState({ devices: DEVICES, selectedDevice: '0' });
      await store.getState().loadRigs();
      expect(store.getState().rigs).toEqual([rig]);
      expect(store.getState().activeRigId).toBe('rig-1');
      expect(useLiveCaptureStore.getState().selectedDevice).toBe('0');
      expect(useLiveCaptureStore.getState().meterIntervalMs).toBe(200);
      expect(useLiveCaptureStore.getState().windowSecs).toBe(5);
    });

    it('leaves activeRigId null when the saved id is not among the rigs', async () => {
      const { store } = makeStore({ getSettings: async () => fakeSettings({ rigs: [], activeRigId: 'ghost' }) });
      await store.getState().loadRigs();
      expect(store.getState().activeRigId).toBeNull();
    });

    it('falls back to an empty rig list when getSettings rejects', async () => {
      const { store } = makeStore({ getSettings: async () => { throw new Error('disk error'); } });
      await store.getState().loadRigs();
      expect(store.getState().rigs).toEqual([]);
      expect(store.getState().activeRigId).toBeNull();
    });

    it('re-overlays saved channel labels onto the current channelConfig', async () => {
      const { store } = makeStore({ getSettings: async () => fakeSettings({ rigs: [], activeRigId: null }) });
      useLiveCaptureStore.setState({
        devices: DEVICES, selectedDevice: '0', channelConfig: [{ kind: 'mono', a: 0, b: 1 }],
      });
      useSettingsStore.setState({ settings: fakeSettings({ channelLabels: { 'Scarlett 18i20': { '0': 'Vocal' } } }) });
      await store.getState().loadRigs();
      expect(useLiveCaptureStore.getState().channelConfig[0].label).toBe('Vocal');
    });
  });

  describe('selectRig', () => {
    it('applies the selected rig', async () => {
      const rig = makeRig({ intervalMs: 250, windowSecs: 7.5 });
      const { store } = makeStore({ setActiveRig: async () => fakeSettings() });
      store.setState({ rigs: [rig] });
      useLiveCaptureStore.setState({ devices: DEVICES, selectedDevice: '' });
      await store.getState().selectRig('rig-1');
      expect(store.getState().activeRigId).toBe('rig-1');
      expect(useLiveCaptureStore.getState().selectedDevice).toBe('0');
      expect(useLiveCaptureStore.getState().meterIntervalMs).toBe(250);
      expect(useLiveCaptureStore.getState().windowSecs).toBe(7.5);
    });

    it('deselecting clears activeRigId without touching the current setup', async () => {
      const { store } = makeStore({ setActiveRig: async () => fakeSettings() });
      store.setState({ rigs: [makeRig()], activeRigId: 'rig-1' });
      await store.getState().selectRig('');
      expect(store.getState().activeRigId).toBeNull();
    });

    it('surfaces an error status when setActiveRig rejects', async () => {
      const { store } = makeStore({ setActiveRig: async () => { throw new Error('nope'); } });
      await store.getState().selectRig('rig-1');
      expect(useLiveCaptureStore.getState().liveStatusText).toBe('Could not select rig — check that Sound Buddy can write its settings.');
    });

    // Regression (PR #740 CI): rigApplyNotice must land on the store, not
    // just setLiveStatusText's DOM text — the #728 auto-start gate
    // (live-auto-start.ts) reads it from liveCaptureStore to decide whether
    // to skip auto-starting monitoring on a rig that needs attention.
    it('sets rigApplyNotice on liveCaptureStore when the rig device is not found', async () => {
      const rig = makeRig({ deviceName: 'Missing Interface' });
      const { store } = makeStore({ setActiveRig: async () => fakeSettings() });
      store.setState({ rigs: [rig] });
      useLiveCaptureStore.setState({ devices: DEVICES, selectedDevice: '' });
      await store.getState().selectRig('rig-1');
      expect(useLiveCaptureStore.getState().rigApplyNotice)
        .toBe('Rig device "Missing Interface" not found — select a device.');
    });

    it('clears rigApplyNotice on liveCaptureStore when the rig applies cleanly', async () => {
      const rig = makeRig();
      const { store } = makeStore({ setActiveRig: async () => fakeSettings() });
      store.setState({ rigs: [rig] });
      useLiveCaptureStore.setState({ devices: DEVICES, selectedDevice: '', rigApplyNotice: 'stale notice' });
      await store.getState().selectRig('rig-1');
      expect(useLiveCaptureStore.getState().rigApplyNotice).toBeNull();
    });
  });

  describe('save', () => {
    it('prompts via rigDialog and falls back to saveAs when there is no active rig', async () => {
      rigDialog.mockResolvedValue('New Rig');
      const { store } = makeStore({
        saveRig: async () => fakeSettings({ rigs: [makeRig({ id: 'new-1', name: 'New Rig' })] }),
        setActiveRig: async () => fakeSettings(),
      });
      await store.getState().save();
      expect(rigDialog).toHaveBeenCalledWith(expect.objectContaining({ title: 'Save rig as…' }));
      expect(store.getState().activeRigId).toBe('new-1');
    });

    it('does nothing when the Save As prompt is cancelled from the no-active-rig fallback', async () => {
      rigDialog.mockResolvedValue(null);
      const { store, mock } = makeStore();
      await store.getState().save();
      expect(mock.calls.some((c) => c.method === 'saveRig')).toBe(false);
    });

    it('updates the selected rig in place', async () => {
      const { store } = makeStore({
        saveRig: async () => fakeSettings({ rigs: [makeRig({ name: 'Main Board' })] }),
        setActiveRig: async () => fakeSettings(),
      });
      store.setState({ rigs: [makeRig()], activeRigId: 'rig-1' });
      await store.getState().save();
      expect(store.getState().rigs[0].name).toBe('Main Board');
      expect(useLiveCaptureStore.getState().liveStatusText).toBe('Saved "Main Board".');
    });

    it('snapshots the current liveCaptureStore cadence, not a stale/DOM value (#725)', async () => {
      let saved: CaptureRig | undefined;
      const { store } = makeStore({
        saveRig: async (rig) => { saved = rig; return fakeSettings({ rigs: [rig] }); },
        setActiveRig: async () => fakeSettings(),
      });
      store.setState({ rigs: [makeRig()], activeRigId: 'rig-1' });
      useLiveCaptureStore.setState({ meterIntervalMs: 200, windowSecs: 5 });

      await store.getState().save();

      expect(saved?.intervalMs).toBe(200);
      expect(saved?.windowSecs).toBe(5);
    });

    it('surfaces an error status when saveRig rejects', async () => {
      const { store } = makeStore({ saveRig: async () => { throw new Error('disk full'); } });
      store.setState({ rigs: [makeRig()], activeRigId: 'rig-1' });
      await store.getState().save();
      expect(useLiveCaptureStore.getState().liveStatusText).toBe('Could not save rig — check that Sound Buddy can write its settings.');
    });
  });

  describe('saveAs', () => {
    it('creates a new rig, selects it, and reports success', async () => {
      const created = makeRig({ id: 'new-1', name: 'Drum Kit' });
      const { store } = makeStore({
        saveRig: async () => fakeSettings({ rigs: [created] }),
        setActiveRig: async () => fakeSettings(),
      });
      await store.getState().saveAs('Drum Kit');
      expect(store.getState().rigs).toEqual([created]);
      expect(store.getState().activeRigId).toBe('new-1');
      expect(useLiveCaptureStore.getState().liveStatusText).toBe('Saved "Drum Kit".');
    });

    it('ignores an all-whitespace name', async () => {
      const { store, mock } = makeStore();
      await store.getState().saveAs('   ');
      expect(mock.calls).toEqual([]);
    });

    it('surfaces an error status when saveRig rejects', async () => {
      const { store } = makeStore({ saveRig: async () => { throw new Error('nope'); } });
      await store.getState().saveAs('New Rig');
      expect(useLiveCaptureStore.getState().liveStatusText).toBe('Could not save rig — check that Sound Buddy can write its settings.');
    });

    it('snapshots the current liveCaptureStore cadence, not a stale/DOM value (#725)', async () => {
      let saved: CaptureRig | undefined;
      const { store } = makeStore({
        saveRig: async (rig) => { saved = rig; return fakeSettings({ rigs: [rig] }); },
        setActiveRig: async () => fakeSettings(),
      });
      useLiveCaptureStore.setState({ meterIntervalMs: 250, windowSecs: 7.5 });

      await store.getState().saveAs('Drum Kit');

      expect(saved?.intervalMs).toBe(250);
      expect(saved?.windowSecs).toBe(7.5);
    });
  });

  describe('rename', () => {
    it('renames the rig in place', async () => {
      const { store } = makeStore({ saveRig: async () => fakeSettings({ rigs: [makeRig({ name: 'New Name' })] }) });
      store.setState({ rigs: [makeRig()] });
      await store.getState().rename('rig-1', 'New Name');
      expect(store.getState().rigs[0].name).toBe('New Name');
    });

    it('is a no-op for an unknown id', async () => {
      const { store, mock } = makeStore();
      await store.getState().rename('ghost', 'New Name');
      expect(mock.calls).toEqual([]);
    });

    it('ignores an all-whitespace name', async () => {
      const { store, mock } = makeStore();
      store.setState({ rigs: [makeRig()] });
      await store.getState().rename('rig-1', '  ');
      expect(mock.calls).toEqual([]);
    });

    it('surfaces an error status when saveRig rejects', async () => {
      const { store } = makeStore({ saveRig: async () => { throw new Error('nope'); } });
      store.setState({ rigs: [makeRig()] });
      await store.getState().rename('rig-1', 'New Name');
      expect(useLiveCaptureStore.getState().liveStatusText).toBe('Could not rename rig — check that Sound Buddy can write its settings.');
    });
  });

  describe('remove', () => {
    it('deletes the rig and adopts the backend\'s activeRigId', async () => {
      const { store } = makeStore({ deleteRig: async () => fakeSettings({ rigs: [], activeRigId: null }) });
      store.setState({ rigs: [makeRig()], activeRigId: 'rig-1' });
      await store.getState().remove('rig-1');
      expect(store.getState().rigs).toEqual([]);
      expect(store.getState().activeRigId).toBeNull();
    });

    it('surfaces an error status when deleteRig rejects', async () => {
      const { store } = makeStore({ deleteRig: async () => { throw new Error('nope'); } });
      await store.getState().remove('rig-1');
      expect(useLiveCaptureStore.getState().liveStatusText).toBe('Could not delete rig — check that Sound Buddy can write its settings.');
    });
  });

  describe('saveBaseline', () => {
    it('seeds a new rig named "Rig" when none is active', async () => {
      const created = makeRig({ id: 'seeded-1', name: 'Rig' });
      const { store } = makeStore({
        saveRig: async () => fakeSettings({ rigs: [created] }),
        setActiveRig: async () => fakeSettings(),
      });
      useLiveCaptureStore.setState({ channelConfig: [{ kind: 'mono', a: 0, b: 0 }], devices: DEVICES, selectedDevice: '0' });
      await store.getState().saveBaseline();
      expect(store.getState().activeRigId).toBe('seeded-1');
      expect(useLiveCaptureStore.getState().liveStatusText).toBe('Baseline saved.');
    });

    it('attaches the baseline to the already-active rig', async () => {
      const { store, mock } = makeStore({
        saveRig: async (rig) => {
          mock.calls.push({ method: 'saveRig', args: [rig] });
          return fakeSettings({ rigs: [makeRig()] });
        },
        setActiveRig: async () => fakeSettings(),
      });
      store.setState({ rigs: [makeRig()], activeRigId: 'rig-1' });
      await store.getState().saveBaseline();
      const call = mock.calls.find((c) => c.method === 'saveRig');
      expect((call?.args[0] as { baseline?: { deviceName: string } }).baseline).toBeDefined();
    });

    it('reports the Pro-license message distinctly from a generic save failure', async () => {
      const { store } = makeStore({ saveRig: async () => { throw new Error('requires a Pro license'); } });
      await store.getState().saveBaseline();
      expect(useLiveCaptureStore.getState().liveStatusText).toBe('Saving a baseline requires a Pro license.');
    });

    it('reports a generic failure message for a non-license error', async () => {
      const { store } = makeStore({ saveRig: async () => { throw new Error('disk full'); } });
      await store.getState().saveBaseline();
      expect(useLiveCaptureStore.getState().liveStatusText).toBe('Could not save baseline — check that Sound Buddy can write its settings.');
    });
  });

  describe('setLocked', () => {
    it('toggles the locked flag', () => {
      const { store } = makeStore();
      store.getState().setLocked(true);
      expect(store.getState().locked).toBe(true);
      store.getState().setLocked(false);
      expect(store.getState().locked).toBe(false);
    });
  });
});
