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

  /**
   * Whether the workspace "Add track" control should be enabled.
   * `recording` is true while an active recording locks the capture set (#1403).
   */
  function addEnabled(usedChannels, totalChannels, recording) {
    return !recording && usedChannels < totalChannels;
  }

  /** Whether the workspace should show the "Add your first track" empty state. */
  function isEmpty(configuredCount) {
    return !configuredCount;
  }

  /**
   * Lowest device input not referenced by any configured strip (a, plus b for
   * stereo) — where "+ Add track" lands a new strip (#1403). Falls back to the
   * last valid index when every input is already referenced.
   */
  function nextUnusedChannel(config, totalChannels) {
    var total = Math.max(1, Math.floor(totalChannels) || 1);
    var used = {};
    (config || []).forEach(function (s) {
      if (!s) return;
      used[s.a] = true;
      if (s.kind === 'stereo') used[s.b] = true;
    });
    for (var i = 0; i < total; i++) if (!used[i]) return i;
    return total - 1;
  }

  var api = { idleChannel: idleChannel, addEnabled: addEnabled, isEmpty: isEmpty, nextUnusedChannel: nextUnusedChannel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.trackWorkspace = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
