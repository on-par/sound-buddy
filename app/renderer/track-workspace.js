// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, framework-free helpers for the persistent Live-tab track workspace
// (#188). The workspace renders channelConfig as track lanes the moment the
// Live tab is active, idle or capturing — these helpers are the DOM-free bits
// so they're unit-testable, mirroring group-state.js / rig-reconcile.js.
// Read off window.trackWorkspace.
(function (root) {
  'use strict';

  /**
   * A synthetic idle channel for a configured-but-not-yet-live strip: every
   * band floored to -120 (so it renders as a flat, dimmed meter — veqLoudestIdx
   * never lights a "loudest" band for an all-idle channel) and non-finite
   * rms/peak (so the meta line reads as idle rather than a bogus 0 dBFS).
   */
  function idleChannel(bandKeys) {
    var bands = {};
    (bandKeys || []).forEach(function (k) { bands[k] = -120; });
    return { name: undefined, rms: -Infinity, peak: -Infinity, clipping: false, centroid: null, bands: bands, idle: true };
  }

  /** Whether the workspace "Add track" control should be enabled. */
  function addEnabled(usedChannels, totalChannels, capturing) {
    return !capturing && usedChannels < totalChannels;
  }

  /** Whether the workspace should show the "Add your first track" empty state. */
  function isEmpty(configuredCount) {
    return !configuredCount;
  }

  var api = { idleChannel: idleChannel, addEnabled: addEnabled, isEmpty: isEmpty };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.trackWorkspace = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
