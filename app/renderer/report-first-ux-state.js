// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, framework-free predicate for the report-first-ux epic gate (#538,
// epic e17). DOM-free so it's unit-testable, mirroring daw-workspace-state.js.
// Read off window.reportFirstUxState.
(function (root) {
  'use strict';

  /** Whether the report-first-ux epic gate is enabled in app settings.
   *  Strict: only a literal `true` on a real settings object counts, so a
   *  null/still-loading store or a hand-edited settings.json string never
   *  enables an experiment. */
  function isEnabled(settings) {
    return !!settings && settings.reportFirstUxEnabled === true;
  }

  var api = { isEnabled: isEnabled };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.reportFirstUxState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
