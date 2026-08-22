// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createSoundcheckStore, type SoundcheckApi } from './soundcheckStore';
import { useLiveCaptureStore } from './liveCaptureStore';
import { useSpectrumStore } from './spectrumStore';
import { useSettingsStore } from './settingsStore';
import { createMockSoundBuddy } from '../mock-sound-buddy';
import { recordButtonView } from '../record-transport';
import type { SessionManifest } from '../soundcheck-panel';
import type { AppSettings, SessionPeaksDto } from '../../../electron/ipc/api';

// playback-routing.js is a real, pure classic-script module — same
// convention as liveCaptureStore.test.ts's armState/groupState requires.
const playbackRouting = require('../../playback-routing.js');
const liveTransitionState = require('../../live-transition-state.js');

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { playbackRouting };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useLiveCaptureStore.setState({ appMode: 'reportcard', isCapturing: false, promoting: false, stopping: false, liveMode: 'monitor' });
  useSettingsStore.setState({ settings: null, settingsError: null });
});

/** A complete settings seed (with empty buses) so a bus test can spread + add. */
const SEED_SETTINGS: AppSettings = {
  idealProfile: '', customIdealProfiles: [], storageDir: '', rigs: [], activeRigId: null,
  usageSignalEnabled: false, channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {},
  crashReportingEnabled: false, dawWorkspaceEnabled: false, liveAdjustmentsEnabled: false,
  reportFirstUxEnabled: false, shareChurchName: '', weeklyReminderEnabled: false,
  weeklyReminderServiceDay: 0, liveEqPaneWidth: 360, measurementDeviceName: '',
  gradingProfile: 'casual', consoleNetworkConsentGranted: false, soundcheckBuses: [],
};

function makeStore(overrides: Partial<Parameters<typeof createMockSoundBuddy>[0]> = {}) {
  const mock = createMockSoundBuddy(overrides);
  const store = createSoundcheckStore(() => mock.api as unknown as SoundcheckApi);
  return { store, mock };
}

const MANIFEST: SessionManifest = {
  tracks: [{ kind: 'mono', label: 'Vocal' }, { kind: 'stereo' }],
};

describe('createSoundcheckStore', () => {
  it('starts idle with no session loaded', () => {
    const { store } = makeStore();
    const s = store.getState();
    expect(s.manifest).toBeNull();
    expect(s.devices).toEqual([]);
    expect(s.playing).toBe(false);
    expect(s.looping).toBe(false);
    expect(s.elapsedText).toBeNull();
    expect(s.mixdownNotice).toBeNull();
    expect(s.statusMessage).toBeNull();
  });

  describe('loadDevices', () => {
    it('populates devices and resolves the current selection\'s channel count', async () => {
      const { store } = makeStore({
        listOutputDevices: async () => ({ devices: [{ index: 0, name: 'Focusrite', channels: 4 }] }),
      });
      store.setState({ selectedDevice: '0' });
      await store.getState().loadDevices();
      expect(store.getState().devices).toEqual([{ index: 0, name: 'Focusrite', channels: 4 }]);
      expect(store.getState().devicesLoaded).toBe(true);
      expect(store.getState().deviceChannels).toBe(4);
    });

    it('leaves deviceChannels at 0 when the selected device is not in the list', async () => {
      const { store } = makeStore({ listOutputDevices: async () => ({ devices: [] }) });
      await store.getState().loadDevices();
      expect(store.getState().deviceChannels).toBe(0);
    });
  });

  describe('recorded session selection', () => {
    it('hydrates the discovered session list once, including an empty usable root', async () => {
      const listRecordedSessions = vi.fn(async () => ({ success: true, sessions: [{ sessionDir: '/recordings/sunday', name: 'Sunday AM', createdAt: '2026-08-17T10:00:00.000Z' }] }));
      const { store } = makeStore({
        listRecordedSessions,
      });

      await Promise.all([store.getState().loadRecordedSessions(), store.getState().loadRecordedSessions()]);

      expect(store.getState().recordedSessions).toEqual([{ sessionDir: '/recordings/sunday', name: 'Sunday AM', createdAt: '2026-08-17T10:00:00.000Z' }]);
      expect(store.getState().recordedSessionsLoaded).toBe(true);
      expect(listRecordedSessions).toHaveBeenCalledOnce();
    });

    it('keeps discovery usable with an empty list when the IPC envelope is unsuccessful', async () => {
      const { store } = makeStore({ listRecordedSessions: async () => ({ success: false }) });

      await store.getState().loadRecordedSessions();

      expect(store.getState().recordedSessions).toEqual([]);
      expect(store.getState().recordedSessionsLoaded).toBe(true);
    });

    it('keeps discovery usable when the list IPC rejects', async () => {
      const { store } = makeStore({ listRecordedSessions: async () => Promise.reject(new Error('recording root unavailable')) });

      await store.getState().loadRecordedSessions();

      expect(store.getState().recordedSessions).toEqual([]);
      expect(store.getState().recordedSessionsLoaded).toBe(true);
    });

    it('loads a known session through the shared validated path', async () => {
      const { store } = makeStore({ readSession: async () => ({ success: true, manifest: MANIFEST }) });
      store.setState({ recordedSessions: [{ sessionDir: '/recordings/sunday', name: 'Sunday AM' }], looping: true });

      await expect(store.getState().loadSession('/recordings/sunday')).resolves.toBe(true);
      expect(store.getState().sessionDir).toBe('/recordings/sunday');
      expect(store.getState().manifest).toEqual(MANIFEST);
      expect(store.getState().lastElapsedTick).toEqual({ elapsed: 0, duration: 0 });
      expect(store.getState().looping).toBe(false);
    });

    it('loads an external session through the same validated path', async () => {
      const external: SessionManifest = { name: 'Offsite', createdAt: '2026-08-18T10:00:00.000Z', sampleRate: 48000, tracks: [{ kind: 'mono', frames: 48000 }] };
      const { store } = makeStore({ readSession: async () => ({ success: true, manifest: external }) });

      await expect(store.getState().loadSession('/external/session')).resolves.toBe(true);
      expect(store.getState().sessionDir).toBe('/external/session');
      expect(store.getState().manifest).toEqual(external);
    });

    it('keeps an existing selection unchanged when the folder dialog is cancelled', async () => {
      const { store } = makeStore({ openDirDialog: async () => null });
      store.setState({ sessionDir: '/working', manifest: MANIFEST, routes: [[3], [4, 5]] });

      await store.getState().chooseSession();

      expect(store.getState().sessionDir).toBe('/working');
      expect(store.getState().manifest).toEqual(MANIFEST);
      expect(store.getState().routes).toEqual([[3], [4, 5]]);
    });

    it('retains a loaded session and routes when an invalid folder cannot be read', async () => {
      const { store } = makeStore({ readSession: async () => ({ success: false, error: 'Could not read session.json: malformed' }) });
      store.setState({ sessionDir: '/working', manifest: MANIFEST, routes: [[3], [4, 5]] });

      await expect(store.getState().loadSession('/invalid')).resolves.toBe(false);
      expect(store.getState().sessionDir).toBe('/working');
      expect(store.getState().manifest).toEqual(MANIFEST);
      expect(store.getState().routes).toEqual([[3], [4, 5]]);
      expect(store.getState().statusMessage).toBe('Could not read session.json: malformed');
    });

    it('refuses to replace a session while playback is active', async () => {
      const readSession = vi.fn(async () => ({ success: true, manifest: { tracks: [{ kind: 'mono', label: 'Replacement' }] } }));
      const { store } = makeStore({ readSession });
      store.setState({
        sessionDir: '/working',
        manifest: MANIFEST,
        routes: [[3], [4, 5]],
        playing: true,
        lastElapsedTick: { elapsed: 12, duration: 60 },
      });

      await expect(store.getState().loadSession('/replacement')).resolves.toBe(false);

      expect(readSession).not.toHaveBeenCalled();
      expect(store.getState()).toMatchObject({
        sessionDir: '/working',
        manifest: MANIFEST,
        routes: [[3], [4, 5]],
        playing: true,
        lastElapsedTick: { elapsed: 12, duration: 60 },
        statusMessage: 'Stop playback before loading a different session.',
      });
    });
  });

  describe('selectDevice', () => {
    it('updates selectedDevice and recomputes deviceChannels', () => {
      const { store } = makeStore();
      store.setState({ devices: [{ index: 2, name: 'Out', channels: 6 }] });
      store.getState().selectDevice('2');
      expect(store.getState().selectedDevice).toBe('2');
      expect(store.getState().deviceChannels).toBe(6);
    });

    it('recomputes the mixdown notice against the new device', () => {
      const { store } = makeStore();
      store.setState({ manifest: MANIFEST, routes: [[0], [1, 2]], devices: [{ index: 0, name: 'Small', channels: 1 }] });
      store.getState().selectDevice('0');
      expect(store.getState().mixdownNotice).toContain('routing needs');
    });
  });

  describe('chooseSession', () => {
    it('does nothing when the dialog is cancelled', async () => {
      const { store } = makeStore({ openDirDialog: async () => null });
      await store.getState().chooseSession();
      expect(store.getState().manifest).toBeNull();
    });

    it('surfaces an error status when the session cannot be read', async () => {
      const { store } = makeStore({
        openDirDialog: async () => '/tmp/session',
        readSession: async () => ({ success: false, error: 'bad session' }),
      });
      await store.getState().chooseSession();
      expect(store.getState().statusMessage).toBe('bad session');
      expect(store.getState().manifest).toBeNull();
    });

    it('falls back to a generic error message when none is provided', async () => {
      const { store } = makeStore({
        openDirDialog: async () => '/tmp/session',
        readSession: async () => ({ success: false }),
      });
      await store.getState().chooseSession();
      expect(store.getState().statusMessage).toBe('Could not read that session.');
    });

    it('loads the manifest and seeds default routes on success', async () => {
      const { store } = makeStore({
        openDirDialog: async () => '/tmp/session',
        readSession: async () => ({ success: true, manifest: MANIFEST }),
      });
      await store.getState().chooseSession();
      const s = store.getState();
      expect(s.statusMessage).toBeNull();
      expect(s.sessionDir).toBe('/tmp/session');
      expect(s.manifest).toEqual(MANIFEST);
      expect(s.routes).toEqual([[0], [1, 2]]);
    });

    it('preserves previously-set routes when re-importing the same session', async () => {
      const { store } = makeStore({
        openDirDialog: async () => '/tmp/session',
        readSession: async () => ({ success: true, manifest: MANIFEST }),
      });
      store.setState({ sessionDir: '/tmp/session', manifest: MANIFEST, routes: [[3], [4, 5]] });
      await store.getState().chooseSession();
      expect(store.getState().routes).toEqual([[3], [4, 5]]);
    });

    it('reseeds default routes when importing a different session directory', async () => {
      const { store } = makeStore({
        openDirDialog: async () => '/tmp/B',
        readSession: async () => ({ success: true, manifest: MANIFEST }),
      });
      store.setState({ sessionDir: '/tmp/A', manifest: MANIFEST, routes: [[3], [4, 5]] });
      await store.getState().chooseSession();
      expect(store.getState().routes).toEqual([[0], [1, 2]]);
    });

    it('reseeds default routes when the same directory\'s track shape changed', async () => {
      const changedManifest: SessionManifest = { tracks: [{ kind: 'mono' }] };
      const { store } = makeStore({
        openDirDialog: async () => '/tmp/session',
        readSession: async () => ({ success: true, manifest: changedManifest }),
      });
      store.setState({ sessionDir: '/tmp/session', manifest: MANIFEST, routes: [[3], [4, 5]] });
      await store.getState().chooseSession();
      expect(store.getState().routes).toEqual([[0]]);
    });

    it('auto-routes a track matching a saved bus pattern to the bus output on a NEW session (#756)', async () => {
      useSettingsStore.setState({
        settings: {
          ...SEED_SETTINGS,
          soundcheckBuses: [{ id: 'b1', name: 'Acoustic Guitar', pattern: 'ag', outputChannel: 3 }],
        },
      });
      const manifest: SessionManifest = { tracks: [{ kind: 'mono', label: 'AG' }, { kind: 'stereo' }] };
      const { store } = makeStore({
        openDirDialog: async () => '/tmp/brand-new',
        readSession: async () => ({ success: true, manifest }),
      });
      await store.getState().chooseSession();
      expect(store.getState().routes).toEqual([[3], [1, 2]]);
    });

    it('auto-routes on a reimport whose track shape changed, matching the stem basename (#756)', async () => {
      useSettingsStore.setState({
        settings: {
          ...SEED_SETTINGS,
          soundcheckBuses: [{ id: 'b1', name: 'Kick', pattern: 'kick', outputChannel: 0 }],
        },
      });
      const changed: SessionManifest = { tracks: [{ kind: 'mono', file: '/tmp/session/kick.wav' }] };
      const { store } = makeStore({
        openDirDialog: async () => '/tmp/session',
        readSession: async () => ({ success: true, manifest: changed }),
      });
      store.setState({ sessionDir: '/tmp/session', manifest: MANIFEST, routes: [[5]] });
      await store.getState().chooseSession();
      expect(store.getState().routes).toEqual([[0]]);
    });

    it('preserves prior routes on a same-session reimport even when a bus would match (ADR-0012, #756)', async () => {
      useSettingsStore.setState({
        settings: {
          ...SEED_SETTINGS,
          soundcheckBuses: [{ id: 'b1', name: 'Acoustic Guitar', pattern: 'ag', outputChannel: 3 }],
        },
      });
      const manifest: SessionManifest = { tracks: [{ kind: 'mono', label: 'AG' }, { kind: 'stereo' }] };
      const { store } = makeStore({
        openDirDialog: async () => '/tmp/session',
        readSession: async () => ({ success: true, manifest }),
      });
      store.setState({ sessionDir: '/tmp/session', manifest, routes: [[7], [8, 9]] });
      await store.getState().chooseSession();
      expect(store.getState().routes).toEqual([[7], [8, 9]]);
    });

    it('applies changed saved buses only when a different session is loaded (#1091)', async () => {
      const manifest: SessionManifest = { tracks: [{ kind: 'mono', label: 'Lead Vocal' }] };
      const { store } = makeStore({ readSession: async () => ({ success: true, manifest }) });
      useSettingsStore.setState({
        settings: { ...SEED_SETTINGS, soundcheckBuses: [{ id: 'bus-a', name: 'Lead', pattern: 'lead', outputChannel: 2 }] },
      });

      await store.getState().loadSession('/tmp/first');
      expect(store.getState().routes).toEqual([[2]]);

      useSettingsStore.setState({
        settings: { ...SEED_SETTINGS, soundcheckBuses: [{ id: 'bus-b', name: 'Lead', pattern: 'lead', outputChannel: 5 }] },
      });
      await store.getState().loadSession('/tmp/first');
      expect(store.getState().routes).toEqual([[2]]);

      await store.getState().loadSession('/tmp/second');
      expect(store.getState().routes).toEqual([[5]]);
    });

    it('triggers generation on a successful read-session and lands peaks in ready state', async () => {
      const peaks: SessionPeaksDto = {
        bucketsPerSecond: 50,
        tracks: [{ index: 0, label: 'Vocal', kind: 'mono', bucketCount: 5, data: 'AA==' }],
      };
      const { store, mock } = makeStore({
        openDirDialog: async () => '/tmp/session',
        readSession: async () => ({ success: true, manifest: MANIFEST }),
        generateSessionPeaks: async () => {
          mock.calls.push({ method: 'generateSessionPeaks', args: ['/tmp/session'] });
          return { success: true as const, cached: false, peaks };
        },
      });
      await store.getState().chooseSession();
      expect(mock.calls).toContainEqual({ method: 'generateSessionPeaks', args: ['/tmp/session'] });
      expect(store.getState().peaks).toEqual(peaks);
      expect(store.getState().peaksStatus).toBe('ready');
      expect(store.getState().statusMessage).toBeNull();
    });

    it('marks peaks error on failed generation while keeping the loaded session intact', async () => {
      const { store } = makeStore({
        openDirDialog: async () => '/tmp/session',
        readSession: async () => ({ success: true, manifest: MANIFEST }),
        generateSessionPeaks: async () => ({ success: false as const, error: 'boom' }),
      });
      await store.getState().chooseSession();
      const s = store.getState();
      expect(s.peaksStatus).toBe('error');
      expect(s.peaks).toBeNull();
      expect(s.manifest).toEqual(MANIFEST);
      expect(s.sessionDir).toBe('/tmp/session');
      // Generation failure is silent — never clobbers the workflow status.
      expect(s.statusMessage).toBeNull();
    });

    it('clears prior peaks before generating for a re-import', async () => {
      const priorPeaks: SessionPeaksDto = {
        bucketsPerSecond: 50,
        tracks: [{ index: 0, label: 'Old', kind: 'mono', bucketCount: 2, data: 'AQ==' }],
      };
      const { store } = makeStore({
        openDirDialog: async () => '/tmp/session',
        readSession: async () => ({ success: true, manifest: MANIFEST }),
        generateSessionPeaks: async () => ({ success: false as const, error: 'boom' }),
      });
      store.setState({ peaks: priorPeaks, peaksStatus: 'ready' });
      await store.getState().chooseSession();
      expect(store.getState().peaks).toBeNull();
      expect(store.getState().peaksStatus).toBe('error');
    });
  });

  describe('setRoute', () => {
    it('sets a mono track to a single-channel route', () => {
      const { store } = makeStore();
      store.setState({ manifest: MANIFEST, routes: [[0], [1, 2]] });
      store.getState().setRoute(0, 3);
      expect(store.getState().routes[0]).toEqual([3]);
    });

    it('sets a stereo track to an adjacent-pair route', () => {
      const { store } = makeStore();
      store.setState({ manifest: MANIFEST, routes: [[0], [1, 2]] });
      store.getState().setRoute(1, 4);
      expect(store.getState().routes[1]).toEqual([4, 5]);
    });

    it('is a no-op for an out-of-range track index', () => {
      const { store } = makeStore();
      store.setState({ manifest: MANIFEST, routes: [[0], [1, 2]] });
      store.getState().setRoute(5, 0);
      expect(store.getState().routes).toEqual([[0], [1, 2]]);
    });

    it('hot-swaps the FULL route spec to the running engine while playing (#759)', () => {
      const { store, mock } = makeStore();
      store.setState({ manifest: MANIFEST, routes: [[0], [1, 2]], playing: true });
      store.getState().setRoute(0, 3);
      expect(mock.calls).toContainEqual({
        method: 'setPlaybackRoutes',
        args: [{ route: '0:3,1:1-2' }],
      });
    });

    it('sends nothing while stopped (the next play() resends the full spec)', () => {
      const { store, mock } = makeStore();
      store.setState({ manifest: MANIFEST, routes: [[0], [1, 2]], playing: false });
      store.getState().setRoute(0, 3);
      expect(mock.calls).toEqual([]);
    });
  });

  describe('setMaster', () => {
    it('sets master and recomputes the mixdown notice', () => {
      const { store } = makeStore();
      store.setState({ manifest: MANIFEST, routes: [[0], [1, 2]] });
      store.getState().setMaster(true);
      expect(store.getState().master).toBe(true);
      expect(store.getState().mixdownNotice).toBe('Playing a stereo master mixdown.');
    });
  });

  describe('play', () => {
    it('is a no-op without a loaded manifest', async () => {
      const { store, mock } = makeStore();
      await store.getState().play();
      expect(mock.calls).toEqual([]);
    });

    it('starts playback and hands the panel to the buffering state', async () => {
      const { store } = makeStore({ startPlayback: async () => ({ success: true }) });
      store.setState({ manifest: MANIFEST, sessionDir: '/tmp/s', routes: [[0], [1, 2]] });
      const spy = vi.spyOn(useSpectrumStore.getState(), 'setPanelState');
      await store.getState().play();
      expect(store.getState().playing).toBe(true);
      expect(store.getState().elapsedText).toBe('0:00 / 0:00');
      expect(store.getState().lastElapsedTick).toEqual({ elapsed: 0, duration: 0 });
      expect(spy).toHaveBeenCalledWith('empty', 'Buffering…');
      spy.mockRestore();
    });

    it('resumes playback from the retained positive take position', async () => {
      const { store, mock } = makeStore({
        startPlayback: async (opts) => {
          mock.calls.push({ method: 'startPlayback', args: [opts] });
          return { success: true };
        },
      });
      store.setState({ manifest: MANIFEST, sessionDir: '/tmp/s', routes: [[0], [1, 2]], lastElapsedTick: { elapsed: 5, duration: 60 } });

      await store.getState().play();

      expect(mock.calls).toContainEqual({ method: 'startPlayback', args: [{ sessionDir: '/tmp/s', route: '0:0,1:1-2', startOffsetSecs: 5 }] });
      expect(store.getState().lastElapsedTick).toEqual({ elapsed: 5, duration: 60 });
    });

    it('preserves the zero-position playback IPC contract', async () => {
      const { store, mock } = makeStore({
        startPlayback: async (opts) => {
          mock.calls.push({ method: 'startPlayback', args: [opts] });
          return { success: true };
        },
      });
      store.setState({ manifest: MANIFEST, sessionDir: '/tmp/s', routes: [[0]], lastElapsedTick: { elapsed: 0, duration: 60 } });

      await store.getState().play();

      expect(mock.calls).toContainEqual({ method: 'startPlayback', args: [{ sessionDir: '/tmp/s', route: '0:0' }] });
    });

    it('passes the enabled master mixdown to playback', async () => {
      const { store, mock } = makeStore({
        startPlayback: async (opts) => {
          mock.calls.push({ method: 'startPlayback', args: [opts] });
          return { success: true };
        },
      });
      store.setState({ manifest: MANIFEST, sessionDir: '/tmp/s', routes: [[0]] });
      store.getState().setMaster(true);

      await store.getState().play();

      expect(mock.calls).toContainEqual({ method: 'startPlayback', args: [{ sessionDir: '/tmp/s', route: '0:0', master: true }] });
    });

    it('surfaces a status message and stays stopped when playback fails to start', async () => {
      const { store } = makeStore({ startPlayback: async () => ({ success: false, error: 'device busy' }) });
      store.setState({ manifest: MANIFEST, sessionDir: '/tmp/s', routes: [[0]], lastElapsedTick: { elapsed: 5, duration: 60 } });
      await store.getState().play();
      expect(store.getState().playing).toBe(false);
      expect(store.getState().statusMessage).toBe('device busy');
      expect(store.getState().lastElapsedTick).toEqual({ elapsed: 5, duration: 60 });
    });

    it('falls back to a generic error message when the failure has none', async () => {
      const { store } = makeStore({ startPlayback: async () => ({ success: false }) });
      store.setState({ manifest: MANIFEST, sessionDir: '/tmp/s', routes: [[0]] });
      await store.getState().play();
      expect(store.getState().statusMessage).toBe('Could not start playback.');
    });
  });

  describe('loop and return transport controls', () => {
    it('leaves loop and position unchanged without a loaded take', async () => {
      const { store, mock } = makeStore();

      store.getState().toggleLoop();
      await store.getState().returnToStart();

      expect(store.getState().looping).toBe(false);
      expect(store.getState().lastElapsedTick).toBeNull();
      expect(mock.calls).toEqual([]);
    });

    it('toggles the loaded take loop state in memory', () => {
      const { store } = makeStore();
      store.setState({ manifest: MANIFEST });
      store.getState().toggleLoop();
      expect(store.getState().looping).toBe(true);
      store.getState().toggleLoop();
      expect(store.getState().looping).toBe(false);
    });

    it('returns a stopped take to zero while preserving duration', async () => {
      const { store, mock } = makeStore();
      store.setState({ manifest: MANIFEST, playing: false, lastElapsedTick: { elapsed: 5, duration: 60 } });

      await store.getState().returnToStart();

      expect(store.getState().playing).toBe(false);
      expect(store.getState().lastElapsedTick).toEqual({ elapsed: 0, duration: 60 });
      expect(mock.calls).toEqual([]);
    });

    it('restarts an active take at zero through the established seek path', async () => {
      const { store, mock } = makeStore({
        startPlayback: async (opts) => {
          mock.calls.push({ method: 'startPlayback', args: [opts] });
          return { success: true };
        },
      });
      store.setState({ manifest: MANIFEST, sessionDir: '/tmp/s', routes: [[0]], playing: true, lastElapsedTick: { elapsed: 5, duration: 60 } });

      await store.getState().returnToStart();

      expect(mock.calls).toContainEqual({ method: 'startPlayback', args: [{ sessionDir: '/tmp/s', route: '0:0', startOffsetSecs: 0 }] });
      expect(store.getState().lastElapsedTick).toEqual({ elapsed: 0, duration: 0 });
    });
  });

  describe('seekTo', () => {
    it('is a no-op without a loaded manifest', async () => {
      const { store, mock } = makeStore();
      await store.getState().seekTo(30);
      expect(mock.calls).toEqual([]);
    });

    it('re-invokes startPlayback with startOffsetSecs and hands the panel to buffering', async () => {
      const { store, mock } = makeStore({
        startPlayback: async (opts) => {
          mock.calls.push({ method: 'startPlayback', args: [opts] });
          return { success: true };
        },
      });
      store.setState({ manifest: MANIFEST, sessionDir: '/tmp/s', routes: [[0], [1, 2]] });
      const spy = vi.spyOn(useSpectrumStore.getState(), 'setPanelState');
      await store.getState().seekTo(30);
      expect(mock.calls).toContainEqual({
        method: 'startPlayback',
        args: [{ sessionDir: '/tmp/s', route: '0:0,1:1-2', startOffsetSecs: 30 }],
      });
      expect(store.getState().playing).toBe(true);
      expect(store.getState().elapsedText).toBe('0:00 / 0:00');
      expect(store.getState().lastElapsedTick).toEqual({ elapsed: 30, duration: 0 });
      expect(spy).toHaveBeenCalledWith('empty', 'Buffering…');
      spy.mockRestore();
    });

    it('clamps a negative seek to 0', async () => {
      const { store, mock } = makeStore({
        startPlayback: async (opts) => {
          mock.calls.push({ method: 'startPlayback', args: [opts] });
          return { success: true };
        },
      });
      store.setState({ manifest: MANIFEST, sessionDir: '/tmp/s', routes: [[0]] });
      // spy+restore so the shared spectrumStore.setPanelState mock's call
      // history stays clean for the sibling resetTransport test (vitest
      // spyOn reuses the mock zustand copies into new state objects).
      const spy = vi.spyOn(useSpectrumStore.getState(), 'setPanelState');
      await store.getState().seekTo(-5);
      expect(mock.calls).toContainEqual({
        method: 'startPlayback',
        args: [{ sessionDir: '/tmp/s', route: '0:0', startOffsetSecs: 0 }],
      });
      expect(store.getState().lastElapsedTick).toEqual({ elapsed: 0, duration: 0 });
      expect(spy).toHaveBeenCalledWith('empty', 'Buffering…');
      spy.mockRestore();
    });

    it('surfaces a status message and stays stopped when the restart fails', async () => {
      const { store } = makeStore({ startPlayback: async () => ({ success: false, error: 'device busy' }) });
      store.setState({ manifest: MANIFEST, sessionDir: '/tmp/s', routes: [[0]], lastElapsedTick: { elapsed: 5, duration: 60 } });
      await store.getState().seekTo(30);
      expect(store.getState().playing).toBe(false);
      expect(store.getState().statusMessage).toBe('device busy');
      expect(store.getState().lastElapsedTick).toEqual({ elapsed: 5, duration: 60 });
    });
  });

  describe('stop / resetTransport', () => {
    it('stop() stops playback and retains the take position', async () => {
      const { store, mock } = makeStore({
        stopPlayback: async () => {
          mock.calls.push({ method: 'stopPlayback', args: [] });
          return { success: true };
        },
      });
      store.setState({ playing: true, elapsedText: '0:05 / 1:00', lastElapsedTick: { elapsed: 5, duration: 60 } });
      await store.getState().stop();
      expect(mock.calls).toContainEqual({ method: 'stopPlayback', args: [] });
      expect(store.getState().playing).toBe(false);
      expect(store.getState().elapsedText).toBeNull();
      expect(store.getState().lastElapsedTick).toEqual({ elapsed: 5, duration: 60 });
    });

    it('resets transport without changing the spectrum panel, even for the retired app mode', () => {
      const { store } = makeStore();
      useLiveCaptureStore.setState({ appMode: 'live' });
      const spy = vi.spyOn(useSpectrumStore.getState(), 'setPanelState');
      store.getState().resetTransport();
      expect(spy).not.toHaveBeenCalled();

      useLiveCaptureStore.setState({ appMode: "soundcheck" });
      store.getState().resetTransport();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('bindIpcEvents', () => {
    function bind(overrides: Partial<Parameters<typeof createMockSoundBuddy>[0]> = {}) {
      const { store, mock } = makeStore(overrides);
      store.getState().bindIpcEvents();
      return { store, mock };
    }

    it('surfaces an error, stops playback, and retains the take position', () => {
      const { store, mock } = bind();
      store.setState({ playing: true, lastElapsedTick: { elapsed: 5, duration: 60 } });
      mock.emit('onPlaybackEvent', { error: 'stream died' });
      expect(store.getState().statusMessage).toBe('stream died');
      expect(store.getState().playing).toBe(false);
      expect(store.getState().lastElapsedTick).toEqual({ elapsed: 5, duration: 60 });
    });

    it('ignores a null event', () => {
      const { store, mock } = bind();
      expect(() => mock.emit('onPlaybackEvent', null)).not.toThrow();
      expect(store.getState().statusMessage).toBeNull();
    });

    it('sets the mixdown notice only when active', () => {
      const { store, mock } = bind();
      mock.emit('onPlaybackEvent', { type: 'mixdown', active: false });
      expect(store.getState().mixdownNotice).toBeNull();
      mock.emit('onPlaybackEvent', { type: 'mixdown', active: true, requiredChannels: 4, outputChannels: 2 });
      expect(store.getState().mixdownNotice).toBe('Stereo master mixdown — routing needed 4 channels, device has 2.');
    });

    it('ingests a progress tick while playback is active, including the Session workspace', () => {
      const { store, mock } = bind();
      useLiveCaptureStore.setState({ appMode: 'live' });
      store.setState({ playing: true });
      mock.emit('onPlaybackEvent', { type: 'progress', elapsed: 5, duration: 60 });
      expect(store.getState().lastElapsedTick).toEqual({ elapsed: 5, duration: 60 });

      store.setState({ playing: false });
      mock.emit('onPlaybackEvent', { type: 'progress', elapsed: 6, duration: 60 });
      expect(store.getState().lastElapsedTick).toEqual({ elapsed: 5, duration: 60 });
    });

    it('stops playback and retains the take position when playback ends, regardless of gating', () => {
      const { store, mock } = bind();
      useLiveCaptureStore.setState({ appMode: 'live' });
      store.setState({ playing: true, elapsedText: '0:10 / 1:00', lastElapsedTick: { elapsed: 10, duration: 60 } });
      mock.emit('onPlaybackEvent', { type: 'ended' });
      expect(store.getState().playing).toBe(false);
      expect(store.getState().elapsedText).toBeNull();
      expect(store.getState().lastElapsedTick).toEqual({ elapsed: 10, duration: 60 });
    });
  });

  describe('does not touch Live capture (#758)', () => {
    it('play() from an idle Live state leaves capture state and the Record button idle', async () => {
      useLiveCaptureStore.setState({ appMode: 'console', isCapturing: false, promoting: false, stopping: false, liveMode: 'monitor' });
      const { store } = makeStore({ startPlayback: async () => ({ success: true }) });
      store.setState({ manifest: MANIFEST, sessionDir: '/tmp/s', routes: [[0], [2, 3]], devicesLoaded: true });
      await store.getState().play();

      expect(store.getState().playing).toBe(true);
      expect(useLiveCaptureStore.getState().isCapturing).toBe(false);
      expect(useLiveCaptureStore.getState().promoting).toBe(false);
      expect(useLiveCaptureStore.getState().stopping).toBe(false);

      const { isCapturing, liveMode, promoting, stopping } = useLiveCaptureStore.getState();
      const phase = liveTransitionState.capturePhase({ liveRunning: isCapturing, liveMode, promoting, stopping });
      expect(recordButtonView(phase).phase).toBe('idle');
    });

    it('play() does not stop or mutate an already-running Live capture (criterion #3)', async () => {
      useLiveCaptureStore.setState({ appMode: 'console', isCapturing: true, promoting: false, stopping: false, liveMode: 'record' });
      const { store } = makeStore({ startPlayback: async () => ({ success: true }) });
      store.setState({ manifest: MANIFEST, sessionDir: '/tmp/s', routes: [[0], [2, 3]], devicesLoaded: true });
      await store.getState().play();

      expect(useLiveCaptureStore.getState().isCapturing).toBe(true);
      expect(useLiveCaptureStore.getState().liveMode).toBe('record');
      expect(useLiveCaptureStore.getState().promoting).toBe(false);
      expect(useLiveCaptureStore.getState().stopping).toBe(false);
    });

    it('a playback event through bindIpcEvents never mutates Live capture state', () => {
      useLiveCaptureStore.setState({ appMode: 'console', isCapturing: false, promoting: false, stopping: false });
      const { store, mock } = makeStore();
      store.getState().bindIpcEvents();
      store.setState({ playing: true });

      mock.emit('onPlaybackEvent', { type: 'progress', elapsed: 5, duration: 60 });
      mock.emit('onPlaybackEvent', { type: 'level', tracks: [{ label: 'Vocal', rms: -20, peak: -10, clipping: false }] });
      mock.emit('onPlaybackEvent', { type: 'ended' });

      expect(useLiveCaptureStore.getState().isCapturing).toBe(false);
      expect(useLiveCaptureStore.getState().promoting).toBe(false);
      expect(useLiveCaptureStore.getState().stopping).toBe(false);
    });
  });
});
