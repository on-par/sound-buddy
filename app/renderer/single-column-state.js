// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, framework-free predicate for the single-column workspace layout.
// DOM-free so it's unit-testable. Read off window.singleColumnState.
(function (root) {
  'use strict';

  // Simple mode's History tab is backed by the Recent workspace. It has no
  // real-time spectrum to meter, so the spectrum panel is dead space beside it.
  var SINGLE_COLUMN_MODES = ['recent'];

  /** Whether the workspace should collapse to a single full-width column.
   *  Strict on `simpleMode`: only a literal `true` (loaded Simple settings)
   *  reflows the layout, so a still-loading store never flashes a different
   *  shell. */
  function isSingleColumn(simpleMode, mode) {
    return simpleMode === true && SINGLE_COLUMN_MODES.indexOf(mode) !== -1;
  }

  var api = { isSingleColumn: isSingleColumn, SINGLE_COLUMN_MODES: SINGLE_COLUMN_MODES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.singleColumnState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
