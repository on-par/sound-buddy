// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, framework-free predicate for the single-column workspace layout
// (#542, epic e17). DOM-free so it's unit-testable, mirroring ai-dock-state.js.
// Read off window.singleColumnState.
(function (root) {
  'use strict';

  // Tabs whose content is a list / checklist / step wizard — no real-time
  // spectrum to meter and no per-analysis AI narrative, so the spectrum panel
  // and AI rail are dead space beside them (#542). Live and Soundcheck are
  // deliberately absent: their meters are a genuine use of that space.
  var SINGLE_COLUMN_MODES = ['recent', 'guide', 'ringout'];

  /** Whether the workspace should collapse to a single full-width column.
   *  Strict on `enabled`: only a literal `true` (a loaded settings object with
   *  the epic flag on) reflows the layout, so a still-loading store never
   *  flashes a different shell. */
  function isSingleColumn(enabled, mode) {
    return enabled === true && SINGLE_COLUMN_MODES.indexOf(mode) !== -1;
  }

  var api = { isSingleColumn: isSingleColumn, SINGLE_COLUMN_MODES: SINGLE_COLUMN_MODES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.singleColumnState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
