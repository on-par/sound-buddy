// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createSceneDiffStore, useSceneDiffStore } from './sceneDiffStore';
import { createMockSoundBuddy } from '../mock-sound-buddy';

const DIFF = {
  changes: [{ path: 'channels[0].mix.on', label: 'Kick — mute', from: true, to: false }],
  summary: '1 change found',
  bySection: { channels: [], dcas: [], main: [] },
};

afterEach(() => {
  useSceneDiffStore.setState({
    status: 'idle',
    scenePaths: [],
    diff: null,
    nameA: null,
    nameB: null,
    sceneError: null,
  });
});

describe('createSceneDiffStore', () => {
  it('starts idle with no scenes loaded', () => {
    const mock = createMockSoundBuddy();
    const store = createSceneDiffStore(() => mock.api);

    expect(store.getState().status).toBe('idle');
    expect(store.getState().scenePaths).toEqual([]);
    expect(store.getState().diff).toBeNull();
    expect(store.getState().nameA).toBeNull();
    expect(store.getState().nameB).toBeNull();
    expect(store.getState().sceneError).toBeNull();
  });

  it('a first dropped path moves to one-loaded and never calls the IPC bridge', async () => {
    const mock = createMockSoundBuddy();
    const store = createSceneDiffStore(() => mock.api);

    await store.getState().addScenePath('/scenes/before.scn');

    expect(store.getState().status).toBe('one-loaded');
    expect(store.getState().scenePaths).toEqual(['/scenes/before.scn']);
    expect(store.getState().sceneError).toBeNull();
    expect(mock.calls.find((c) => c.method === 'diffScenes')).toBeUndefined();
  });

  it('a second dropped path diffs and lands on done with the diff/names', async () => {
    const mock = createMockSoundBuddy({
      diffScenes: async (opts) => {
        mock.calls.push({ method: 'diffScenes', args: [opts] });
        return { ok: true, diff: DIFF, nameA: 'Before', nameB: 'After' };
      },
    });
    const store = createSceneDiffStore(() => mock.api);

    await store.getState().addScenePath('/scenes/before.scn');
    await store.getState().addScenePath('/scenes/after.scn');

    expect(store.getState().status).toBe('done');
    expect(store.getState().diff).toEqual(DIFF);
    expect(store.getState().nameA).toBe('Before');
    expect(store.getState().nameB).toBe('After');
    expect(store.getState().sceneError).toBeNull();
    expect(mock.calls).toContainEqual({
      method: 'diffScenes',
      args: [{ pathA: '/scenes/before.scn', pathB: '/scenes/after.scn' }],
    });
  });

  it('sets diffing while the IPC round trip is in flight', async () => {
    let resolveDiff!: (v: { ok: true; diff: typeof DIFF; nameA: string; nameB: string }) => void;
    const mock = createMockSoundBuddy({
      diffScenes: () => new Promise((resolve) => { resolveDiff = resolve; }),
    });
    const store = createSceneDiffStore(() => mock.api);

    await store.getState().addScenePath('/scenes/before.scn');
    const pending = store.getState().addScenePath('/scenes/after.scn');
    expect(store.getState().status).toBe('diffing');

    resolveDiff({ ok: true, diff: DIFF, nameA: 'Before', nameB: 'After' });
    await pending;
    expect(store.getState().status).toBe('done');
  });

  it('an ok:false handler result lands on error with the handler message and clears the diff', async () => {
    const mock = createMockSoundBuddy({
      diffScenes: async () => ({ ok: false, error: "after.scn isn't a valid M32R scene file." }),
    });
    const store = createSceneDiffStore(() => mock.api);

    await store.getState().addScenePath('/scenes/before.scn');
    await store.getState().addScenePath('/scenes/after.scn');

    expect(store.getState().status).toBe('error');
    expect(store.getState().sceneError).toBe("after.scn isn't a valid M32R scene file.");
    expect(store.getState().diff).toBeNull();
  });

  it('an IPC rejection lands on error with an actionable fallback message', async () => {
    const mock = createMockSoundBuddy({
      diffScenes: async () => {
        throw new Error('bridge disconnected');
      },
    });
    const store = createSceneDiffStore(() => mock.api);

    await store.getState().addScenePath('/scenes/before.scn');
    await store.getState().addScenePath('/scenes/after.scn');

    expect(store.getState().status).toBe('error');
    expect(store.getState().sceneError).toBe("Couldn't compare the scene files. Restart Sound Buddy and try again.");
    expect(store.getState().diff).toBeNull();
  });

  it('a third dropped path shifts the two-file window (drops the oldest, keeps the second as the new first)', async () => {
    const calls: Array<{ pathA: string; pathB: string }> = [];
    const mock = createMockSoundBuddy({
      diffScenes: async (opts) => {
        calls.push(opts);
        return { ok: true, diff: DIFF, nameA: 'A', nameB: 'B' };
      },
    });
    const store = createSceneDiffStore(() => mock.api);

    await store.getState().addScenePath('/scenes/one.scn');
    await store.getState().addScenePath('/scenes/two.scn');
    await store.getState().addScenePath('/scenes/three.scn');

    expect(store.getState().scenePaths).toEqual(['/scenes/two.scn', '/scenes/three.scn']);
    expect(calls).toEqual([
      { pathA: '/scenes/one.scn', pathB: '/scenes/two.scn' },
      { pathA: '/scenes/two.scn', pathB: '/scenes/three.scn' },
    ]);
  });

  it('clearScenes resets to the initial idle state', async () => {
    const mock = createMockSoundBuddy({
      diffScenes: async () => ({ ok: true, diff: DIFF, nameA: 'A', nameB: 'B' }),
    });
    const store = createSceneDiffStore(() => mock.api);
    await store.getState().addScenePath('/scenes/before.scn');
    await store.getState().addScenePath('/scenes/after.scn');

    store.getState().clearScenes();

    expect(store.getState()).toMatchObject({
      status: 'idle',
      scenePaths: [],
      diff: null,
      nameA: null,
      nameB: null,
      sceneError: null,
    });
  });
});
