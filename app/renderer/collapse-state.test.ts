import { describe, it, expect } from 'vitest';

// collapse-state is a plain classic script (window.collapseState in the browser,
// module.exports under Node) so the pure fold logic is exercised without a DOM.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { isCollapsed, toggle, collapseAll, expandAll } = require('./collapse-state.js') as {
  isCollapsed: (set: Set<number> | null, id: number) => boolean;
  toggle: (set: Set<number> | null, id: number) => Set<number>;
  collapseAll: (ids: number[] | null) => Set<number>;
  expandAll: () => Set<number>;
};

describe('isCollapsed', () => {
  it('is false for an id absent from the set (default = expanded)', () => {
    expect(isCollapsed(new Set([1, 2]), 3)).toBe(false);
  });
  it('is true for an id present in the set', () => {
    expect(isCollapsed(new Set([1, 2]), 2)).toBe(true);
  });
  it('treats a null/undefined set as all-expanded', () => {
    expect(isCollapsed(null, 0)).toBe(false);
  });
});

describe('toggle', () => {
  it('adds an id that was expanded', () => {
    expect([...toggle(new Set([1]), 2)].sort()).toEqual([1, 2]);
  });
  it('removes an id that was collapsed', () => {
    expect([...toggle(new Set([1, 2]), 2)]).toEqual([1]);
  });
  it('does not mutate the input set (returns a new Set)', () => {
    const before = new Set([1]);
    const after = toggle(before, 2);
    expect([...before]).toEqual([1]);
    expect(after).not.toBe(before);
  });
  it('toggles from a null set', () => {
    expect([...toggle(null, 5)]).toEqual([5]);
  });
});

describe('collapseAll', () => {
  it('collapses exactly the given ids', () => {
    expect([...collapseAll([0, 1, 2])].sort()).toEqual([0, 1, 2]);
  });
  it('handles a null id list as empty', () => {
    expect([...collapseAll(null)]).toEqual([]);
  });
});

describe('expandAll', () => {
  it('returns an empty set', () => {
    expect([...expandAll()]).toEqual([]);
  });
});
