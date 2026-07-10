import { describe, it, expect } from 'vitest';

// group-state is a plain classic script (window.groupState / module.exports).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { groupOf, assign, pruneStrip, addGroup, removeGroup, renameGroup, ungrouped } = require('./group-state.js') as {
  groupOf: (groups: Group[] | null, idx: number) => number;
  assign: (groups: Group[] | null, idx: number, g: number) => Group[];
  pruneStrip: (groups: Group[] | null, idx: number) => Group[];
  addGroup: (groups: Group[] | null, name: string) => Group[];
  removeGroup: (groups: Group[] | null, g: number) => Group[];
  renameGroup: (groups: Group[] | null, g: number, name: string) => Group[];
  ungrouped: (groups: Group[] | null, count: number) => number[];
};
type Group = { name: string; members: number[] };

const G = (): Group[] => [
  { name: 'Drums', members: [0, 1] },
  { name: 'Vocals', members: [3] },
];

describe('groupOf', () => {
  it('finds the owning group', () => { expect(groupOf(G(), 1)).toBe(0); expect(groupOf(G(), 3)).toBe(1); });
  it('is -1 for an ungrouped strip', () => expect(groupOf(G(), 2)).toBe(-1));
  it('is -1 for empty groups', () => expect(groupOf(null, 0)).toBe(-1));
});

describe('assign', () => {
  it('moves a strip into a group exclusively', () => {
    const r = assign(G(), 2, 0);
    expect(r[0].members).toEqual([0, 1, 2]);
    expect(groupOf(r, 2)).toBe(0);
  });
  it('reassigns from one group to another (removes from old)', () => {
    const r = assign(G(), 1, 1);
    expect(r[0].members).toEqual([0]);
    expect(r[1].members).toEqual([1, 3]);
  });
  it('ungroups with g = -1', () => {
    const r = assign(G(), 0, -1);
    expect(groupOf(r, 0)).toBe(-1);
    expect(r[0].members).toEqual([1]);
  });
  it('does not mutate the input', () => { const g = G(); assign(g, 2, 0); expect(g[0].members).toEqual([0, 1]); });
});

describe('pruneStrip', () => {
  it('removes the strip and shifts higher indices down', () => {
    // remove strip 1 → Drums keeps 0, Vocals 3 → 2
    const r = pruneStrip(G(), 1);
    expect(r[0].members).toEqual([0]);
    expect(r[1].members).toEqual([2]);
  });
  it('leaves no dangling reference to the removed strip', () => {
    const r = pruneStrip(G(), 0);
    expect(groupOf(r, 0)).toBe(1 - 1); // former strip 1 shifted to index 0, still in Drums
    expect(r.every((grp) => grp.members.indexOf(-1) === -1)).toBe(true);
  });
});

describe('addGroup', () => {
  it('appends an empty named group', () => {
    const r = addGroup(G(), 'Guitars');
    expect(r).toHaveLength(3);
    expect(r[2]).toEqual({ name: 'Guitars', members: [] });
  });
});

describe('removeGroup', () => {
  it('drops the group so its members fall back to ungrouped', () => {
    // Deleting "Drums" (index 0) leaves only "Vocals"; former members 0 & 1
    // are now in no group, and strip 3 (Vocals) is unaffected.
    const r = removeGroup(G(), 0);
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe('Vocals');
    expect(groupOf(r, 0)).toBe(-1);
    expect(groupOf(r, 1)).toBe(-1);
    expect(ungrouped(r, 4)).toEqual([0, 1, 2]);
  });
  it('touches no strip index (channelConfig stays intact)', () => {
    // Deleting a group only drops the group entry — every strip index is
    // preserved. Strip 3 stays in the surviving "Vocals" group (now index 0),
    // and the count of strips accounted for (grouped + ungrouped) is unchanged.
    const r = removeGroup(G(), 0);
    expect(groupOf(r, 3)).toBe(0); // Vocals is now the only remaining group
    expect(ungrouped(r, 4).length + r[0].members.length).toBe(4);
  });
  it('does not mutate the input', () => { const g = G(); removeGroup(g, 0); expect(g).toHaveLength(2); });
  it('is a no-op for an out-of-range index', () => expect(removeGroup(G(), 9)).toHaveLength(2));
});

describe('renameGroup', () => {
  it('renames only the target group, keeping its members', () => {
    const r = renameGroup(G(), 0, 'Kit');
    expect(r[0]).toEqual({ name: 'Kit', members: [0, 1] });
    expect(r[1]).toEqual({ name: 'Vocals', members: [3] });
  });
  it('does not mutate the input', () => { const g = G(); renameGroup(g, 0, 'Kit'); expect(g[0].name).toBe('Drums'); });
});

describe('ungrouped', () => {
  it('lists strips in no group, in order', () => expect(ungrouped(G(), 5)).toEqual([2, 4]));
  it('is all strips when there are no groups', () => expect(ungrouped([], 3)).toEqual([0, 1, 2]));
});
