// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, framework-free routing helpers for the Virtual Soundcheck screen (#46).
// A "route" is a per-track output assignment: a mono track maps to one output
// channel [c], a stereo track to a pair [l, r]. These build the playback.py
// route spec, size the device requirement, and decide the stereo-master fold —
// all DOM-free so they're unit-testable. Read off window.playbackRouting.
(function (root) {
  'use strict';

  /**
   * Default sequential routing: pack tracks onto consecutive output channels
   * starting at 0 (mono takes one, stereo takes a pair).
   * @param {Array<{kind?:string}>} tracks
   * @returns {number[][]} one channel-list per track
   */
  function defaultRoutes(tracks) {
    var next = 0;
    return (tracks || []).map(function (t) {
      if (t && t.kind === 'stereo') { var pair = [next, next + 1]; next += 2; return pair; }
      var mono = [next]; next += 1; return mono;
    });
  }

  /** Build playback.py's route spec, e.g. "0:0,1:1,2:2-3", from per-track routes. */
  function routeSpec(routes) {
    return (routes || []).map(function (r, i) {
      if (r && r.length === 2) return i + ':' + r[0] + '-' + r[1];
      return i + ':' + (r && r[0] != null ? r[0] : 0);
    }).join(',');
  }

  /** Highest output channel used + 1 — how many device channels the routing needs. */
  function requiredChannels(routes) {
    var max = -1;
    (routes || []).forEach(function (r) {
      (r || []).forEach(function (c) { if (c > max) max = c; });
    });
    return max + 1;
  }

  /** Fold to a stereo master when forced (master) or the device is too small. */
  function needsMixdown(routes, deviceChannels, master) {
    return !!master || requiredChannels(routes) > (deviceChannels || 0);
  }

  var api = {
    defaultRoutes: defaultRoutes, routeSpec: routeSpec,
    requiredChannels: requiredChannels, needsMixdown: needsMixdown,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.playbackRouting = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
