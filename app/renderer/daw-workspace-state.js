// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Framework-free transport-label helper for the Session arrangement. Read
// off window.dawWorkspaceState.
(function (root) {
  'use strict';

  /** Transport chip text for the DAW shell header, driven by the same
   *  liveRunning/liveMode state the existing capture controls use. */
  function transportLabel(liveRunning, liveMode) {
    if (!liveRunning) return 'Stopped';
    return liveMode === 'record' ? 'Recording' : 'Monitoring';
  }

  var api = { transportLabel: transportLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.dawWorkspaceState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
