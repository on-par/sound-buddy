// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';

// skill-tree-state is a plain classic script (window.skillTreeState in the
// browser, module.exports under Node) so the progression logic is exercised
// without a DOM. A tiny in-memory Storage stand-in stands in for localStorage.
const {
  KEY,
  SKILL_TREE,
  BRANCH_COUNT,
  LEVELS_PER_BRANCH,
  LEVEL_COUNT,
  loadProgress,
  saveProgress,
  isLevelComplete,
  completeLevel,
  branchComplete,
  badgesFor,
  nextLevelId,
} = require('./skill-tree-state.js');

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, v),
    _map: map,
  };
}

function completedProgress(ids) {
  return { completed: ids };
}

describe('SKILL_TREE', () => {
  it('mirrors the MxU teaching order: exactly nine branches, in the literal order', () => {
    expect(BRANCH_COUNT).toBe(9);
    expect(SKILL_TREE.map((b) => b.id)).toEqual([
      'fundamentals',
      'phase-summation',
      'eq',
      'compression',
      'gates-sidechain',
      'de-essing-dynamic-eq',
      'relational-skills',
      'monitor-mixing',
      'effects',
    ]);
  });

  it('every branch has a title, a one-sentence summary, and three levels with ids <branchId>.1/.2/.3', () => {
    expect(LEVELS_PER_BRANCH).toBe(3);
    expect(LEVEL_COUNT).toBe(27);
    for (const branch of SKILL_TREE) {
      expect(branch.title.length).toBeGreaterThan(0);
      expect(branch.summary.length).toBeGreaterThan(0);
      expect(branch.levels).toHaveLength(3);
      branch.levels.forEach((level, i) => {
        expect(level.id).toBe(`${branch.id}.${i + 1}`);
        expect(level.title.length).toBeGreaterThan(0);
        expect(level.body.length).toBeGreaterThan(0);
        expect(level.tip.length).toBeGreaterThan(0);
      });
    }
  });

  it('every branch id in the tree is unique', () => {
    const ids = SKILL_TREE.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('loadProgress', () => {
  it('returns empty progress for empty storage', () => {
    expect(loadProgress(fakeStorage())).toEqual({ completed: [] });
  });

  it('round-trips a valid persisted payload', () => {
    const s = fakeStorage({ [KEY]: JSON.stringify({ completed: ['eq.1', 'compression.2'] }) });

    expect(loadProgress(s)).toEqual({ completed: ['eq.1', 'compression.2'] });
  });

  it('filters out non-string and empty entries and de-duplicates', () => {
    const s = fakeStorage({
      [KEY]: JSON.stringify({ completed: ['eq.1', '', 42, 'eq.1', null, 'compression.2'] }),
    });

    expect(loadProgress(s)).toEqual({ completed: ['eq.1', 'compression.2'] });
  });

  it('degrades to empty progress on garbage JSON', () => {
    const s = fakeStorage({ [KEY]: 'not json {{{' });

    expect(loadProgress(s)).toEqual({ completed: [] });
  });

  it('degrades to empty progress when the payload is not an object with a completed array', () => {
    expect(loadProgress(fakeStorage({ [KEY]: '"just a string"' }))).toEqual({ completed: [] });
    expect(loadProgress(fakeStorage({ [KEY]: JSON.stringify({ completed: 'nope' }) }))).toEqual({
      completed: [],
    });
    expect(loadProgress(fakeStorage({ [KEY]: JSON.stringify([1, 2, 3]) }))).toEqual({ completed: [] });
  });

  it('degrades to empty progress for a null storage', () => {
    expect(loadProgress(null)).toEqual({ completed: [] });
  });

  it('degrades to empty progress when storage.getItem throws (private mode)', () => {
    const throwing = { getItem: () => { throw new Error('denied'); } };

    expect(loadProgress(throwing)).toEqual({ completed: [] });
  });
});

describe('saveProgress', () => {
  it('persists the progress JSON under the KEY', () => {
    const s = fakeStorage();

    saveProgress(s, completedProgress(['eq.1']));

    expect(s._map.get(KEY)).toBe(JSON.stringify({ completed: ['eq.1'] }));
    expect(loadProgress(s)).toEqual({ completed: ['eq.1'] });
  });

  it('is a no-op (no throw) when storage.setItem throws (private mode)', () => {
    const throwing = { setItem: () => { throw new Error('denied'); } };

    expect(() => saveProgress(throwing, completedProgress(['eq.1']))).not.toThrow();
  });

  it('is a no-op (no throw) for a null storage and a storage without setItem', () => {
    expect(() => saveProgress(null, completedProgress(['eq.1']))).not.toThrow();
    expect(() => saveProgress({}, completedProgress(['eq.1']))).not.toThrow();
  });
});

describe('isLevelComplete', () => {
  it('is true only when the level id is in progress.completed', () => {
    const progress = completedProgress(['eq.1', 'effects.3']);

    expect(isLevelComplete(progress, 'eq.1')).toBe(true);
    expect(isLevelComplete(progress, 'effects.3')).toBe(true);
    expect(isLevelComplete(progress, 'eq.2')).toBe(false);
  });

  it('is false for an empty or missing progress', () => {
    expect(isLevelComplete(completedProgress([]), 'eq.1')).toBe(false);
    expect(isLevelComplete(null, 'eq.1')).toBe(false);
  });
});

describe('completeLevel', () => {
  it('adds a level id that is not yet complete', () => {
    const next = completeLevel(completedProgress([]), 'eq.1');

    expect(next).toEqual({ completed: ['eq.1'] });
  });

  it('treats a missing progress as empty when toggling', () => {
    expect(completeLevel(null, 'eq.1')).toEqual({ completed: ['eq.1'] });
  });

  it('removes the level id on a second call (toggle)', () => {
    const once = completeLevel(completedProgress([]), 'eq.1');

    expect(completeLevel(once, 'eq.1')).toEqual({ completed: [] });
  });

  it('never mutates the input progress', () => {
    const progress = completedProgress(['eq.1']);

    completeLevel(progress, 'eq.2');

    expect(progress).toEqual({ completed: ['eq.1'] });
  });

  it('returns an unchanged copy (not the same reference) for an unknown level id', () => {
    const progress = completedProgress(['eq.1']);

    const next = completeLevel(progress, 'not-a-real-level');

    expect(next).toEqual({ completed: ['eq.1'] });
    expect(next).not.toBe(progress);
    expect(next.completed).not.toBe(progress.completed);
  });
});

describe('branchComplete', () => {
  it('is true only when all three levels of the branch are complete', () => {
    expect(branchComplete(completedProgress([]), 'eq')).toBe(false);
    expect(branchComplete(completedProgress(['eq.1', 'eq.2']), 'eq')).toBe(false);
    expect(branchComplete(completedProgress(['eq.1', 'eq.2', 'eq.3']), 'eq')).toBe(true);
  });

  it('is false for an unknown branch id', () => {
    expect(branchComplete(completedProgress([]), 'not-a-branch')).toBe(false);
  });
});

describe('badgesFor', () => {
  it('returns no badges when nothing is complete', () => {
    expect(badgesFor(completedProgress([]))).toEqual([]);
  });

  it('returns exactly one badge per fully completed branch, with the right shape', () => {
    const progress = completedProgress(['fundamentals.1', 'fundamentals.2', 'fundamentals.3']);

    expect(badgesFor(progress)).toEqual([{ branchId: 'fundamentals', title: 'Fundamentals' }]);
  });

  it('returns one badge per fully completed branch (partial branches earn none)', () => {
    const progress = completedProgress([
      'fundamentals.1', 'fundamentals.2', 'fundamentals.3',
      'eq.1',
    ]);

    expect(badgesFor(progress).map((b) => b.branchId)).toEqual(['fundamentals']);
  });
});

describe('nextLevelId', () => {
  it('returns the first uncompleted level in tree order', () => {
    expect(nextLevelId(completedProgress([]))).toBe('fundamentals.1');
    expect(nextLevelId(completedProgress(['fundamentals.1']))).toBe('fundamentals.2');
    expect(nextLevelId(completedProgress(['fundamentals.1', 'fundamentals.2', 'fundamentals.3', 'phase-summation.1']))).toBe('phase-summation.2');
  });

  it('returns null when every level is complete', () => {
    const all = SKILL_TREE.flatMap((b) => b.levels.map((l) => l.id));

    expect(nextLevelId(completedProgress(all))).toBeNull();
  });
});