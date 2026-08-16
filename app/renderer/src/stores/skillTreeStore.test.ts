// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSkillTreeStore, useSkillTreeStore } from './skillTreeStore';
import { createMockSoundBuddy } from '../mock-sound-buddy';

// skill-tree-state is a plain classic script (window.skillTreeState /
// module.exports) — the store's getSkillTreeState() reads it off window, same
// as the running app, so the real api is installed on the fake window.
const state = require('../../skill-tree-state.js') as {
  SKILL_TREE: Array<{ id: string; title: string; levels: unknown[] }>;
  loadProgress: (storage: unknown) => { completed: string[] };
  saveProgress: (storage: unknown, progress: { completed: string[] }) => void;
  completeLevel: (progress: { completed: string[] }, levelId: string) => { completed: string[] };
};

function makeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    _map: map,
  };
}

let mock: ReturnType<typeof createMockSoundBuddy>;
let storage: ReturnType<typeof makeStorage>;

beforeEach(() => {
  mock = createMockSoundBuddy();
  storage = makeStorage();
  (globalThis as { window?: unknown }).window = {
    soundBuddy: mock.api,
    localStorage: storage,
    skillTreeState: state,
  };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useSkillTreeStore.setState({ dialogOpen: false, progress: { completed: [] }, selectedBranchId: '' });
});

describe('createSkillTreeStore', () => {
  it('starts closed with empty progress', () => {
    const store = createSkillTreeStore(() => mock.api);
    expect(store.getState().dialogOpen).toBe(false);
    expect(store.getState().progress).toEqual({ completed: [] });
    expect(store.getState().selectedBranchId).toBe('');
  });

  it('open loads persisted progress and selects the first branch in MxU order', () => {
    storage._map.set('sb-skill-tree-progress-v1', JSON.stringify({ completed: ['eq.1'] }));
    const store = createSkillTreeStore(() => mock.api);

    store.getState().open();

    expect(store.getState().dialogOpen).toBe(true);
    expect(store.getState().progress).toEqual({ completed: ['eq.1'] });
    expect(store.getState().selectedBranchId).toBe(state.SKILL_TREE[0].id);
  });

  it('close hides the dialog', () => {
    const store = createSkillTreeStore(() => mock.api);
    store.getState().open();

    store.getState().close();

    expect(store.getState().dialogOpen).toBe(false);
  });

  it('selectBranch updates the selected branch', () => {
    const store = createSkillTreeStore(() => mock.api);

    store.getState().selectBranch('compression');

    expect(store.getState().selectedBranchId).toBe('compression');
  });

  describe('toggleLevelComplete', () => {
    it('marks a level complete and persists through the injected storage', () => {
      const store = createSkillTreeStore(() => mock.api);

      store.getState().toggleLevelComplete('fundamentals.1');

      expect(store.getState().progress).toEqual({ completed: ['fundamentals.1'] });
      expect(storage._map.get('sb-skill-tree-progress-v1')).toBe(
        JSON.stringify({ completed: ['fundamentals.1'] })
      );
    });

    it('un-marks an already-complete level (toggle) and persists', () => {
      storage._map.set('sb-skill-tree-progress-v1', JSON.stringify({ completed: ['fundamentals.1'] }));
      const store = createSkillTreeStore(() => mock.api);
      store.getState().init();

      store.getState().toggleLevelComplete('fundamentals.1');

      expect(store.getState().progress).toEqual({ completed: [] });
      expect(storage._map.get('sb-skill-tree-progress-v1')).toBe(JSON.stringify({ completed: [] }));
    });

    it('delegates through the classic script api (completeLevel + saveProgress)', () => {
      const completeLevel = vi.spyOn(state, 'completeLevel');
      const saveProgress = vi.spyOn(state, 'saveProgress');
      const store = createSkillTreeStore(() => mock.api);

      store.getState().toggleLevelComplete('eq.2');

      expect(completeLevel).toHaveBeenCalledWith({ completed: [] }, 'eq.2');
      expect(saveProgress).toHaveBeenCalledWith(storage, { completed: ['eq.2'] });
    });
  });

  it('bindIpcEvents registers a callback that opens the dialog when the menu push fires', () => {
    const store = createSkillTreeStore(() => mock.api);

    store.getState().bindIpcEvents();
    mock.emit('onOpenSkillTreeDialog');

    expect(store.getState().dialogOpen).toBe(true);
  });

  it('init hydrates progress without opening the dialog', () => {
    storage._map.set('sb-skill-tree-progress-v1', JSON.stringify({ completed: ['effects.1', 'effects.2'] }));
    const store = createSkillTreeStore(() => mock.api);

    store.getState().init();

    expect(store.getState().progress).toEqual({ completed: ['effects.1', 'effects.2'] });
    expect(store.getState().dialogOpen).toBe(false);
  });

  it('binds the default hook to the window preload bridge', () => {
    useSkillTreeStore.getState().init();
    useSkillTreeStore.getState().open();
    expect(useSkillTreeStore.getState().dialogOpen).toBe(true);
    useSkillTreeStore.getState().close();
  });
});