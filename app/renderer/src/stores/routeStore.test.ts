// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, expect, it } from 'vitest';
import { createRouteStore, validateRouteState, type RouteState } from './routeStore';

const INITIAL_ROUTE_STATE: RouteState = {
  tracks: [
    { inputChannels: [0], outputChannels: [1] },
    { inputChannels: [2, 3], outputChannels: [4, 5] },
  ],
  savedBuses: [{ id: 'drums', name: 'Drums', pattern: 'drums', outputChannel: 6 }],
  masterMixdown: false,
};

function makeStore() {
  return createRouteStore();
}

describe('createRouteStore', () => {
  it('seeds a session once and exposes it through a later read', () => {
    const store = makeStore();

    const seeded = store.getState().ensureSession('session-a', INITIAL_ROUTE_STATE);

    expect(seeded).toEqual(INITIAL_ROUTE_STATE);
    expect(store.getState().getRouteState('session-a')).toEqual(INITIAL_ROUTE_STATE);
  });

  it('updates a track input without changing its output or another track', () => {
    const store = makeStore();
    store.getState().ensureSession('session-a', INITIAL_ROUTE_STATE);

    const updated = store.getState().updateTrackInput('session-a', 0, [7, 8]);

    expect(updated).toEqual({
      ...INITIAL_ROUTE_STATE,
      tracks: [
        { inputChannels: [7, 8], outputChannels: [1] },
        INITIAL_ROUTE_STATE.tracks[1],
      ],
    });
    expect(store.getState().getRouteState('session-a')).toEqual(updated);
    expect(INITIAL_ROUTE_STATE.tracks[0].inputChannels).toEqual([0]);
  });

  it('updates a track output without changing its input or another track', () => {
    const store = makeStore();
    store.getState().ensureSession('session-a', INITIAL_ROUTE_STATE);

    const updated = store.getState().updateTrackOutput('session-a', 1, [9]);

    expect(updated).toEqual({
      ...INITIAL_ROUTE_STATE,
      tracks: [
        INITIAL_ROUTE_STATE.tracks[0],
        { inputChannels: [2, 3], outputChannels: [9] },
      ],
    });
    expect(store.getState().getRouteState('session-a')).toEqual(updated);
    expect(INITIAL_ROUTE_STATE.tracks[1].outputChannels).toEqual([4, 5]);
  });

  it('updates saved buses and master mixdown for an existing session', () => {
    const store = makeStore();
    const savedBuses = [{ id: 'vox', name: 'Vocals', pattern: 'vox', outputChannel: 2 }];
    store.getState().ensureSession('session-a', INITIAL_ROUTE_STATE);

    const withBuses = store.getState().updateSavedBuses('session-a', savedBuses);
    const updated = store.getState().setMasterMixdown('session-a', true);

    expect(withBuses?.savedBuses).toEqual(savedBuses);
    expect(updated).toEqual({ ...INITIAL_ROUTE_STATE, savedBuses, masterMixdown: true });
    expect(store.getState().getRouteState('session-a')).toEqual(updated);
    expect(INITIAL_ROUTE_STATE.savedBuses).toHaveLength(1);
  });

  it('preserves mutations for an existing identity and isolates another identity', () => {
    const store = makeStore();
    store.getState().ensureSession('session-a', INITIAL_ROUTE_STATE);
    const mutated = store.getState().updateTrackInput('session-a', 0, [7]);
    const other: RouteState = { tracks: [], savedBuses: [], masterMixdown: true };

    const reseeded = store.getState().ensureSession('session-a', other);
    const otherSeeded = store.getState().ensureSession('session-b', other);

    expect(reseeded).toEqual(mutated);
    expect(store.getState().getRouteState('session-a')).toEqual(mutated);
    expect(otherSeeded).toEqual(other);
    expect(store.getState().getRouteState('session-b')).toEqual(other);
  });

  it('treats a prototype-collision string as an opaque session identity', () => {
    const store = makeStore();

    const seeded = store.getState().ensureSession('toString', INITIAL_ROUTE_STATE);

    expect(seeded).toEqual(INITIAL_ROUTE_STATE);
    expect(store.getState().getRouteState('toString')).toEqual(INITIAL_ROUTE_STATE);
  });

  it('returns null without changing state for unknown sessions and invalid track indexes', () => {
    const store = makeStore();
    store.getState().ensureSession('session-a', INITIAL_ROUTE_STATE);

    expect(store.getState().updateTrackInput('missing', 0, [1])).toBeNull();
    expect(store.getState().updateTrackOutput('session-a', -1, [1])).toBeNull();
    expect(store.getState().updateTrackInput('session-a', 0.5, [1])).toBeNull();
    expect(store.getState().updateTrackOutput('session-a', 2, [1])).toBeNull();
    expect(store.getState().updateSavedBuses('missing', [])).toBeNull();
    expect(store.getState().setMasterMixdown('missing', true)).toBeNull();
    expect(store.getState().validateForDevice('missing', 8)).toBeNull();
    expect(store.getState().getRouteState('session-a')).toEqual(INITIAL_ROUTE_STATE);
  });
});

describe('validateRouteState', () => {
  it('retains only valid channel references and buses for a known device', () => {
    const state: RouteState = {
      tracks: [
        { inputChannels: [0, -1, 1.5, 3, 4], outputChannels: [1, -2, 2.5, 3, 4] },
      ],
      savedBuses: [
        { id: 'valid', name: 'Valid', pattern: 'valid', outputChannel: 2 },
        { id: 'negative', name: 'Negative', pattern: 'negative', outputChannel: -1 },
        { id: 'fractional', name: 'Fractional', pattern: 'fractional', outputChannel: 1.5 },
        { id: 'large', name: 'Large', pattern: 'large', outputChannel: 4 },
      ],
      masterMixdown: true,
    };

    expect(validateRouteState(state, 4)).toEqual({
      tracks: [{ inputChannels: [0, 3], outputChannels: [1, 3] }],
      savedBuses: [{ id: 'valid', name: 'Valid', pattern: 'valid', outputChannel: 2 }],
      masterMixdown: true,
    });
  });

  it.each([0, -1, Number.POSITIVE_INFINITY, Number.NaN])(
    'keeps routes unchanged when device channel count %p is unknown',
    (deviceChannelCount) => {
      const state: RouteState = {
        tracks: [{ inputChannels: [-1, 0, 3], outputChannels: [4] }],
        savedBuses: [{ id: 'bus', name: 'Bus', pattern: 'bus', outputChannel: -1 }],
        masterMixdown: false,
      };

      expect(validateRouteState(state, deviceChannelCount)).toBe(state);
    },
  );

  it('writes validated state back to the same session for later reads', () => {
    const store = makeStore();
    const state: RouteState = {
      tracks: [{ inputChannels: [0, 3], outputChannels: [1, 4] }],
      savedBuses: [{ id: 'valid', name: 'Valid', pattern: 'valid', outputChannel: 2 }],
      masterMixdown: true,
    };
    store.getState().ensureSession('session-a', state);

    const validated = store.getState().validateForDevice('session-a', 3);

    expect(validated).toEqual({
      tracks: [{ inputChannels: [0], outputChannels: [1] }],
      savedBuses: [{ id: 'valid', name: 'Valid', pattern: 'valid', outputChannel: 2 }],
      masterMixdown: true,
    });
    expect(store.getState().getRouteState('session-a')).toEqual(validated);
  });
});
