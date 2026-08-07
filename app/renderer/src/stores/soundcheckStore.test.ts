// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createSoundcheckStore, type SoundcheckApi } from './soundcheckStore';
import { useLiveCaptureStore } from './liveCaptureStore';
import { useSpectrumStore } from './spectrumStore';
import { createMockSoundBuddy } from '../mock-sound-buddy';
import type { SessionManifest } from '../soundcheck-panel';

// playback-routing.js is a real, pure classic-script module — same
// convention as liveCaptureStore.test.ts's armState/groupState requires.
const playbackRouting = require('../../playback-routing.js');

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { playbackRouting };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useLiveCaptureStore.setState({ appMode: 'reportcard' });
});

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
      expect(spy).toHaveBeenCalledWith('empty', 'Buffering…');
      spy.mockRestore();
    });

    it('surfaces a status message and stays stopped when playback fails to start', async () => {
      const { store } = makeStore({ startPlayback: async () => ({ success: false, error: 'device busy' }) });
      store.setState({ manifest: MANIFEST, sessionDir: '/tmp/s', routes: [[0]] });
      await store.getState().play();
      expect(store.getState().playing).toBe(false);
      expect(store.getState().statusMessage).toBe('device busy');
    });

    it('falls back to a generic error message when the failure has none', async () => {
      const { store } = makeStore({ startPlayback: async () => ({ success: false }) });
      store.setState({ manifest: MANIFEST, sessionDir: '/tmp/s', routes: [[0]] });
      await store.getState().play();
      expect(store.getState().statusMessage).toBe('Could not start playback.');
    });
  });

  describe('stop / resetTransport', () => {
    it('stop() stops playback and resets the transport', async () => {
      const { store, mock } = makeStore({
        stopPlayback: async () => {
          mock.calls.push({ method: 'stopPlayback', args: [] });
          return { success: true };
        },
      });
      store.setState({ playing: true, elapsedText: '0:05 / 1:00' });
      await store.getState().stop();
      expect(mock.calls).toContainEqual({ method: 'stopPlayback', args: [] });
      expect(store.getState().playing).toBe(false);
      expect(store.getState().elapsedText).toBeNull();
    });

    it('hands the panel back to the empty hint only while the soundcheck tab is active', () => {
      const { store } = makeStore();
      useLiveCaptureStore.setState({ appMode: 'live' });
      const spy = vi.spyOn(useSpectrumStore.getState(), 'setPanelState');
      store.getState().resetTransport();
      expect(spy).not.toHaveBeenCalled();

      useLiveCaptureStore.setState({ appMode: 'soundcheck' });
      store.getState().resetTransport();
      expect(spy).toHaveBeenCalledWith('empty', 'Load a session and press Play to see per-track meters');
      spy.mockRestore();
    });
  });

  describe('bindIpcEvents', () => {
    function bind(overrides: Partial<Parameters<typeof createMockSoundBuddy>[0]> = {}) {
      const { store, mock } = makeStore(overrides);
      store.getState().bindIpcEvents();
      return { store, mock };
    }

    it('surfaces an error and resets the transport', () => {
      const { store, mock } = bind();
      store.setState({ playing: true });
      mock.emit('onPlaybackEvent', { error: 'stream died' });
      expect(store.getState().statusMessage).toBe('stream died');
      expect(store.getState().playing).toBe(false);
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

    it('ingests a progress tick only while the soundcheck tab is active and playing', () => {
      const { store, mock } = bind();
      useLiveCaptureStore.setState({ appMode: 'live' });
      store.setState({ playing: true });
      mock.emit('onPlaybackEvent', { type: 'progress', elapsed: 5, duration: 60 });
      expect(store.getState().lastElapsedTick).toBeNull();

      useLiveCaptureStore.setState({ appMode: 'soundcheck' });
      mock.emit('onPlaybackEvent', { type: 'progress', elapsed: 5, duration: 60 });
      expect(store.getState().lastElapsedTick).toEqual({ elapsed: 5, duration: 60 });

      store.setState({ playing: false });
      mock.emit('onPlaybackEvent', { type: 'progress', elapsed: 6, duration: 60 });
      expect(store.getState().lastElapsedTick).toEqual({ elapsed: 5, duration: 60 });
    });

    it('ingests a level tick only while the soundcheck tab is active and playing', () => {
      const { store, mock } = bind();
      useLiveCaptureStore.setState({ appMode: 'soundcheck' });
      store.setState({ playing: true });
      const tracks = [{ label: 'Vocal', rms: -20, peak: -10, clipping: false }];
      mock.emit('onPlaybackEvent', { type: 'level', tracks });
      expect(store.getState().lastMeterTick).toEqual(tracks);
    });

    it('resets the transport when playback ends, regardless of gating', () => {
      const { store, mock } = bind();
      useLiveCaptureStore.setState({ appMode: 'live' });
      store.setState({ playing: true, elapsedText: '0:10 / 1:00' });
      mock.emit('onPlaybackEvent', { type: 'ended' });
      expect(store.getState().playing).toBe(false);
      expect(store.getState().elapsedText).toBeNull();
    });
  });
});
