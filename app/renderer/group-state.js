// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, framework-free helpers for named channel groups (#41, #483). A group is
// { name, members: [stripIndex, …], collapsed? }; a strip belongs to at most one
// group. Membership is keyed by strip index and is pruned/remapped when a strip
// is removed from channelConfig, so no dangling reference survives. Group order
// (array order) and member order (per-group members array order) are both
// meaningful — manual drag-reorder (#483) relies on them. DOM-free and
// unit-testable, mirroring rig-reconcile.js. Read off window.groupState.
(function (root) {
  'use strict';

  /** Index of the group containing strip idx, or -1 if ungrouped. */
  function groupOf(groups, idx) {
    for (var g = 0; g < (groups || []).length; g++) {
      if (groups[g] && groups[g].members && groups[g].members.indexOf(idx) !== -1) return g;
    }
    return -1;
  }

  /** Copies { name, members } forward, carrying a truthy `collapsed` flag along. */
  function copyGroup(grp, members) {
    var out = { name: grp.name, members: members };
    if (grp && grp.collapsed) out.collapsed = true;
    return out;
  }

  /**
   * Move strip idx into group g (g = -1 → ungrouped). Removes it from every other
   * group first so membership stays exclusive, then appends it at the end of the
   * target group's members (manual order, not sorted). Returns a NEW groups array.
   */
  function assign(groups, idx, g) {
    return (groups || []).map(function (grp, i) {
      var members = (grp.members || []).filter(function (m) { return m !== idx; });
      if (i === g) members = members.concat([idx]);
      return copyGroup(grp, members);
    });
  }

  /**
   * Drop strip idx from every group and shift higher indices down by one, to keep
   * membership valid after a channelConfig.splice(idx, 1). Returns a NEW array.
   */
  function pruneStrip(groups, idx) {
    return (groups || []).map(function (grp) {
      var members = (grp.members || [])
        .filter(function (m) { return m !== idx; })
        .map(function (m) { return m > idx ? m - 1 : m; });
      return copyGroup(grp, members);
    });
  }

  /** Append a new empty group. Returns a NEW array. */
  function addGroup(groups, name) {
    return (groups || []).concat([{ name: name, members: [] }]);
  }

  /**
   * Drop group g entirely. Its members simply become ungrouped — membership is
   * keyed by absence, so no strip index or channelConfig entry is touched.
   * Returns a NEW array.
   */
  function removeGroup(groups, g) {
    return (groups || []).filter(function (_grp, i) { return i !== g; });
  }

  /** Rename group g, leaving its members untouched. Returns a NEW array. */
  function renameGroup(groups, g, name) {
    return (groups || []).map(function (grp, i) {
      return i === g ? copyGroup({ name: name, collapsed: grp.collapsed }, (grp.members || []).slice()) : grp;
    });
  }

  /** Strip indices to render in the ungrouped section, in order, for a strip count. */
  function ungrouped(groups, count) {
    var out = [];
    for (var i = 0; i < count; i++) if (groupOf(groups, i) === -1) out.push(i);
    return out;
  }

  /** Clamps `to` into [0, length - 1]; used by both reorder helpers. */
  function clampIndex(to, length) {
    return Math.max(0, Math.min(to, length - 1));
  }

  /** Reorders an array by moving the element at `from` to position `to` (splice-based). */
  function reorder(arr, from, to) {
    var n = arr.length;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= n || n === 0) return arr;
    var clampedTo = clampIndex(to, n);
    if (from === clampedTo) return arr;
    var item = arr.splice(from, 1)[0];
    arr.splice(clampedTo, 0, item);
    return arr;
  }

  /**
   * Reorder the groups array itself (drag-reorder whole groups, #483). `from`/`to`
   * are group indices; `to` is clamped to bounds. Invalid/no-op inputs return an
   * unchanged (but new) copy. Returns a NEW array.
   */
  function moveGroup(groups, from, to) {
    return reorder((groups || []).slice(), from, to);
  }

  /**
   * Reorder members within group g by POSITION in its members array (not strip
   * index) — drag-reorder within a group (#483). `from`/`to` are positions;
   * `to` is clamped to bounds. Invalid/no-op inputs leave that group's members
   * unchanged; other groups are untouched (same reference). Returns a NEW array.
   */
  function moveMember(groups, g, from, to) {
    return (groups || []).map(function (grp, i) {
      if (i !== g) return grp;
      var members = reorder((grp.members || []).slice(), from, to);
      return copyGroup(grp, members);
    });
  }

  /** Sets group g's collapsed flag, preserving name/members. Returns a NEW array. */
  function setGroupCollapsed(groups, g, collapsed) {
    return (groups || []).map(function (grp, i) {
      if (i !== g) return grp;
      var out = { name: grp.name, members: (grp.members || []).slice(), collapsed: !!collapsed };
      return out;
    });
  }

  /** Whether group g is collapsed; false for null groups / out-of-range g. */
  function isGroupCollapsed(groups, g) {
    return !!(groups && groups[g] && groups[g].collapsed);
  }

  var api = {
    groupOf: groupOf, assign: assign, pruneStrip: pruneStrip, addGroup: addGroup,
    removeGroup: removeGroup, renameGroup: renameGroup, ungrouped: ungrouped,
    moveGroup: moveGroup, moveMember: moveMember,
    setGroupCollapsed: setGroupCollapsed, isGroupCollapsed: isGroupCollapsed,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.groupState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
