// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, framework-free helpers for persisted per-device channel labels (#482).
// Restores user-entered strip labels (#39) across monitor/live sessions via a
// settings-level channelLabels map, keyed by device name ('' = Default Device)
// then by strip token (arm-state.js's stripToken: "0" mono, "2-3" stereo).
// Dependency-free — token strings are computed by callers, who already have
// armState. Kept as a classic script so the overlay/persist rules are
// unit-testable without a DOM, mirroring arm-state.js.
// Read off window.channelLabels in the renderer, module.exports under Node.
(function (root) {
  'use strict';

  var MAX_LABEL_LEN = 40;

  /**
   * Overlay saved labels onto a channel config, one strip per `tokens[i]`.
   * Never overwrites a strip that already carries a non-empty label (rig-
   * loaded labels win). Null/undefined `cfg` degrades to an empty array copy.
   */
  function applyLabels(cfg, tokens, savedForDevice) {
    var config = cfg || [];
    var toks = tokens || [];
    var saved = savedForDevice || {};
    return config.map(function (strip, i) {
      if (strip && strip.label) return strip;
      var label = saved[toks[i]];
      if (typeof label !== 'string' || label === '') return Object.assign({}, strip);
      return Object.assign({}, strip, { label: label });
    });
  }

  /**
   * A new top-level channelLabels map with `label` recorded for
   * `deviceName`/`token` (never mutates `all`). An empty/whitespace-only
   * label deletes the token entry instead, pruning the device's map once it
   * has no labels left.
   */
  function recordLabel(all, deviceName, token, label) {
    var next = {};
    for (var device in (all || {})) {
      next[device] = Object.assign({}, all[device]);
    }
    var trimmed = (label || '').trim().slice(0, MAX_LABEL_LEN);
    var deviceLabels = Object.assign({}, next[deviceName]);
    if (trimmed === '') {
      delete deviceLabels[token];
    } else {
      deviceLabels[token] = trimmed;
    }
    if (Object.keys(deviceLabels).length > 0) {
      next[deviceName] = deviceLabels;
    } else {
      delete next[deviceName];
    }
    return next;
  }

  var api = { applyLabels: applyLabels, recordLabel: recordLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.channelLabels = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
