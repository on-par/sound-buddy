// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, framework-free predicate for the AI Engineer inline dock placement
// (#541, epic e17). DOM-free so it's unit-testable, mirroring
// report-first-ux-state.js. Read off window.aiDockState.
(function (root) {
  'use strict';

  /** Where the AI Engineer panel lives: 'docked' (inline, report-first-ux) or 'rail'.
   *  Strict: only literal `true` docks, so a loading store never reflows the layout.
   *  'live' keeps the rail — the live narrative context is out of scope (#541). */
  function placement(enabled, mode) {
    return enabled === true && mode !== 'live' ? 'docked' : 'rail';
  }

  var api = { placement: placement };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.aiDockState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
