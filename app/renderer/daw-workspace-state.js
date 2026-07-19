// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, framework-free predicate for the experimental DAW-style Live
// workspace gate (#516, epic #515). DOM-free so it's unit-testable,
// mirroring track-workspace.js. Read off window.dawWorkspaceState.
(function (root) {
  'use strict';

  /** Whether the experimental DAW workspace is enabled in app settings.
   *  Strict: only a literal `true` on a real settings object counts, so a
   *  null/still-loading store or a hand-edited settings.json string never
   *  enables an experiment. */
  function isEnabled(settings) {
    return !!settings && settings.dawWorkspaceEnabled === true;
  }

  var api = { isEnabled: isEnabled };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.dawWorkspaceState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
