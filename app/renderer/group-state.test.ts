import { describe, it, expect } from 'vitest';

// group-state is a plain classic script (window.groupState / module.exports).
const {
  groupOf, assign, pruneStrip, addGroup, removeGroup, renameGroup, ungrouped,
  moveGroup, moveMember, setGroupCollapsed, isGroupCollapsed,
} = require('./group-state.js') as {
  groupOf: (groups: Group[] | null, idx: number) => number;
  assign: (groups: Group[] | null, idx: number, g: number) => Group[];
  pruneStrip: (groups: Group[] | null, idx: number) => Group[];
  addGroup: (groups: Group[] | null, name: string) => Group[];
  removeGroup: (groups: Group[] | null, g: number) => Group[];
  renameGroup: (groups: Group[] | null, g: number, name: string) => Group[];
  ungrouped: (groups: Group[] | null, count: number) => number[];
  moveGroup: (groups: Group[] | null, from: number, to: number) => Group[];
  moveMember: (groups: Group[] | null, g: number, from: number, to: number) => Group[];
  setGroupCollapsed: (groups: Group[] | null, g: number, collapsed: boolean) => Group[];
  isGroupCollapsed: (groups: Group[] | null, g: number) => boolean;
};
type Group = { name: string; members: number[]; collapsed?: boolean };

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
  it('reassigns from one group to another (removes from old, appended at end)', () => {
    const r = assign(G(), 1, 1);
    expect(r[0].members).toEqual([0]);
    expect(r[1].members).toEqual([3, 1]);
  });
  it('ungroups with g = -1', () => {
    const r = assign(G(), 0, -1);
    expect(groupOf(r, 0)).toBe(-1);
    expect(r[0].members).toEqual([1]);
  });
  it('does not mutate the input', () => { const g = G(); assign(g, 2, 0); expect(g[0].members).toEqual([0, 1]); });
  it('appends rather than sorting (order ≠ ascending)', () => {
    const groups: Group[] = [{ name: 'Kit', members: [2, 3] }];
    const r = assign(groups, 0, 0);
    expect(r[0].members).toEqual([2, 3, 0]);
  });
  it('preserves the collapsed flag of untouched and touched groups', () => {
    const groups: Group[] = [
      { name: 'Drums', members: [0, 1], collapsed: true },
      { name: 'Vocals', members: [3] },
    ];
    const r = assign(groups, 2, 0);
    expect(r[0].collapsed).toBe(true);
    expect(r[1].collapsed).toBeUndefined();
  });
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
  it('preserves member order', () => {
    const groups: Group[] = [{ name: 'Kit', members: [3, 1, 2] }];
    const r = pruneStrip(groups, 0);
    expect(r[0].members).toEqual([2, 0, 1]);
  });
  it('preserves the collapsed flag', () => {
    const groups: Group[] = [{ name: 'Kit', members: [0, 1], collapsed: true }];
    const r = pruneStrip(groups, 0);
    expect(r[0].collapsed).toBe(true);
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
  it('preserves the collapsed flag on surviving groups', () => {
    const groups: Group[] = [{ name: 'Drums', members: [0, 1] }, { name: 'Vocals', members: [3], collapsed: true }];
    const r = removeGroup(groups, 0);
    expect(r[0].collapsed).toBe(true);
  });
});

describe('renameGroup', () => {
  it('renames only the target group, keeping its members', () => {
    const r = renameGroup(G(), 0, 'Kit');
    expect(r[0]).toEqual({ name: 'Kit', members: [0, 1] });
    expect(r[1]).toEqual({ name: 'Vocals', members: [3] });
  });
  it('does not mutate the input', () => { const g = G(); renameGroup(g, 0, 'Kit'); expect(g[0].name).toBe('Drums'); });
  it('preserves the collapsed flag', () => {
    const groups: Group[] = [{ name: 'Drums', members: [0, 1], collapsed: true }];
    const r = renameGroup(groups, 0, 'Kit');
    expect(r[0]).toEqual({ name: 'Kit', members: [0, 1], collapsed: true });
  });
});

describe('moveGroup', () => {
  it('reorders groups by splicing', () => {
    const groups: Group[] = [{ name: 'A', members: [] }, { name: 'B', members: [] }, { name: 'C', members: [] }];
    const r = moveGroup(groups, 2, 0);
    expect(r.map((g) => g.name)).toEqual(['C', 'A', 'B']);
  });
  it('is a no-op when from === to', () => {
    const groups = G();
    const r = moveGroup(groups, 0, 0);
    expect(r).toEqual(groups);
    expect(r).not.toBe(groups);
  });
  it('clamps an out-of-range destination to the bounds', () => {
    const groups: Group[] = [{ name: 'A', members: [] }, { name: 'B', members: [] }];
    const r = moveGroup(groups, 0, 99);
    expect(r.map((g) => g.name)).toEqual(['B', 'A']);
  });
  it('is a no-op for an invalid source index', () => {
    const groups = G();
    expect(moveGroup(groups, -1, 0)).toEqual(groups);
    expect(moveGroup(groups, 9, 0)).toEqual(groups);
  });
  it('does not mutate the input', () => {
    const groups = G();
    moveGroup(groups, 1, 0);
    expect(groups.map((g) => g.name)).toEqual(['Drums', 'Vocals']);
  });
  it('loses no groups in the reorder', () => {
    const groups: Group[] = [{ name: 'A', members: [] }, { name: 'B', members: [] }, { name: 'C', members: [] }];
    const r = moveGroup(groups, 0, 2);
    expect(r.map((g) => g.name).slice().sort()).toEqual(['A', 'B', 'C']);
  });
});

describe('moveMember', () => {
  it('reorders members within a group by position', () => {
    const groups: Group[] = [{ name: 'Kit', members: [0, 1, 2] }];
    const r = moveMember(groups, 0, 2, 0);
    expect(r[0].members).toEqual([2, 0, 1]);
  });
  it('leaves other groups untouched', () => {
    const groups = G();
    const r = moveMember(groups, 0, 1, 0);
    expect(r[1]).toBe(groups[1]);
  });
  it('is a no-op when from === to', () => {
    const groups: Group[] = [{ name: 'Kit', members: [0, 1, 2] }];
    const r = moveMember(groups, 0, 1, 1);
    expect(r[0].members).toEqual([0, 1, 2]);
  });
  it('clamps an out-of-range destination to the bounds', () => {
    const groups: Group[] = [{ name: 'Kit', members: [0, 1, 2] }];
    const r = moveMember(groups, 0, 0, 99);
    expect(r[0].members).toEqual([1, 2, 0]);
  });
  it('is a no-op for an invalid source position or group index', () => {
    const groups: Group[] = [{ name: 'Kit', members: [0, 1, 2] }];
    expect(moveMember(groups, 0, -1, 0)[0].members).toEqual([0, 1, 2]);
    expect(moveMember(groups, 0, 9, 0)[0].members).toEqual([0, 1, 2]);
    expect(moveMember(groups, 9, 0, 1)).toEqual(groups);
  });
  it('does not mutate the input', () => {
    const groups: Group[] = [{ name: 'Kit', members: [0, 1, 2] }];
    moveMember(groups, 0, 2, 0);
    expect(groups[0].members).toEqual([0, 1, 2]);
  });
  it('preserves the collapsed flag', () => {
    const groups: Group[] = [{ name: 'Kit', members: [0, 1, 2], collapsed: true }];
    const r = moveMember(groups, 0, 2, 0);
    expect(r[0].collapsed).toBe(true);
  });
  it('loses no members in the reorder', () => {
    const groups: Group[] = [{ name: 'Kit', members: [0, 1, 2, 3] }];
    const r = moveMember(groups, 0, 3, 1);
    expect(r[0].members.slice().sort()).toEqual([0, 1, 2, 3]);
  });
});

describe('setGroupCollapsed / isGroupCollapsed', () => {
  it('sets the collapsed flag on the target group, preserving name/members', () => {
    const groups = G();
    const r = setGroupCollapsed(groups, 0, true);
    expect(r[0]).toEqual({ name: 'Drums', members: [0, 1], collapsed: true });
    expect(r[1]).toBe(groups[1]);
  });
  it('clears the collapsed flag', () => {
    const groups: Group[] = [{ name: 'Drums', members: [0, 1], collapsed: true }];
    const r = setGroupCollapsed(groups, 0, false);
    expect(r[0].collapsed).toBe(false);
  });
  it('does not mutate the input', () => {
    const groups = G();
    setGroupCollapsed(groups, 0, true);
    expect(groups[0].collapsed).toBeUndefined();
  });
  it('isGroupCollapsed reflects the flag, defaulting to false', () => {
    const groups: Group[] = [{ name: 'Drums', members: [0, 1], collapsed: true }, { name: 'Vocals', members: [3] }];
    expect(isGroupCollapsed(groups, 0)).toBe(true);
    expect(isGroupCollapsed(groups, 1)).toBe(false);
  });
  it('isGroupCollapsed is false for null/out-of-range', () => {
    expect(isGroupCollapsed(null, 0)).toBe(false);
    expect(isGroupCollapsed(G(), 9)).toBe(false);
  });
});

describe('ungrouped', () => {
  it('lists strips in no group, in order', () => expect(ungrouped(G(), 5)).toEqual([2, 4]));
  it('is all strips when there are no groups', () => expect(ungrouped([], 3)).toEqual([0, 1, 2]));
});
