// Pure, framework-free helpers for named channel groups (#41). A group is
// { name, members: [stripIndex, …] }; a strip belongs to at most one group.
// Membership is keyed by strip index and is pruned/remapped when a strip is
// removed from channelConfig, so no dangling reference survives. DOM-free and
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

  /**
   * Move strip idx into group g (g = -1 → ungrouped). Removes it from every other
   * group first so membership stays exclusive. Returns a NEW groups array.
   */
  function assign(groups, idx, g) {
    return (groups || []).map(function (grp, i) {
      var members = (grp.members || []).filter(function (m) { return m !== idx; });
      if (i === g) members = members.concat([idx]).sort(function (a, b) { return a - b; });
      return { name: grp.name, members: members };
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
      return { name: grp.name, members: members };
    });
  }

  /** Append a new empty group. Returns a NEW array. */
  function addGroup(groups, name) {
    return (groups || []).concat([{ name: name, members: [] }]);
  }

  /** Strip indices to render in the ungrouped section, in order, for a strip count. */
  function ungrouped(groups, count) {
    var out = [];
    for (var i = 0; i < count; i++) if (groupOf(groups, i) === -1) out.push(i);
    return out;
  }

  var api = { groupOf: groupOf, assign: assign, pruneStrip: pruneStrip, addGroup: addGroup, ungrouped: ungrouped };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.groupState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
