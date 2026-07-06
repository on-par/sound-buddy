// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, framework-free helpers for per-strip collapse state on the live meter
// board (#40). Collapsed strips are held as a Set of stable strip ids; every
// mutation returns a NEW Set so the renderer can swap state atomically and the
// rules stay unit-testable without a DOM. A strip whose id is absent from the
// set is expanded — that's the default, so a freshly arriving strip is never
// silently collapsed. Loaded via <script src> and read off window.collapseState,
// mirroring rig-reconcile.js.
(function (root) {
  'use strict';

  /** Is this strip id currently collapsed? Absent id (or no set) → expanded. */
  function isCollapsed(set, id) {
    return !!(set && typeof set.has === 'function' && set.has(id));
  }

  /** Toggle one strip's collapsed state, returning a new Set (input untouched). */
  function toggle(set, id) {
    const next = new Set(set || []);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }

  /** Collapse every id in the list → a new Set of exactly those ids. */
  function collapseAll(ids) {
    return new Set(ids || []);
  }

  /** Expand everything → a new empty Set. */
  function expandAll() {
    return new Set();
  }

  const api = { isCollapsed: isCollapsed, toggle: toggle, collapseAll: collapseAll, expandAll: expandAll };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.collapseState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
