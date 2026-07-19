// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, framework-free helpers for instrument-aware live input EQ profiles
// (#524, epic #515). Each live input strip gets an instrument profile (kick,
// bass, acoustic/electric guitar, vocal, keys, or generic) so a later per-
// input analysis pass can judge each input against an appropriate EQ target
// instead of one generic curve. The profile defaults from the strip's label
// and can be overridden per input; overrides persist per device + strip
// token in settings.json, mirroring channel-labels.js's model (#482). Kept
// as a classic script so the inference/override rules are unit-testable
// without a DOM, mirroring channel-labels.js and ideal-curves.js.
// Read off window.instrumentProfiles in the renderer, module.exports under Node.
(function (root) {
  'use strict';

  var GENERIC_ID = 'generic';
  var MAX_PROFILE_ID_LEN = 64;

  // Array order IS the label-match precedence: kick before bass so "Bass
  // Drum" matches kick; bass before the guitars so "Bass Gtr" matches bass;
  // acoustic before electric so "Ac Gtr" matches acoustic. generic is last
  // and never keyword-matched — it's only the inference/override fallback.
  var PROFILES = [
    { id: 'kick', label: 'Kick drum', keywords: ['kick', 'bass drum', 'bd '],
      bands: { subBass: 6, bass: 4, lowMid: -2, mid: -6, highMid: -4, presence: -2, brilliance: -10 } },
    { id: 'bass', label: 'Bass', keywords: ['bass'],
      bands: { subBass: 4, bass: 6, lowMid: 2, mid: -2, highMid: -6, presence: -10, brilliance: -14 } },
    { id: 'acoustic-guitar', label: 'Acoustic guitar', keywords: ['acoustic', 'ac gtr', 'agtr'],
      bands: { subBass: -14, bass: -4, lowMid: 0, mid: 2, highMid: 2, presence: 3, brilliance: 1 } },
    { id: 'electric-guitar', label: 'Electric guitar', keywords: ['gtr', 'guitar', 'egtr', 'electric'],
      bands: { subBass: -18, bass: -6, lowMid: 2, mid: 3, highMid: 2, presence: -1, brilliance: -6 } },
    { id: 'vocal', label: 'Vocal', keywords: ['vox', 'vocal', 'voc', 'sing', 'choir', 'speech', 'pastor'],
      bands: { subBass: -12, bass: -6, lowMid: 0, mid: 2, highMid: 3, presence: 3, brilliance: 0 } },
    { id: 'keys', label: 'Keys / piano', keywords: ['keys', 'keyboard', 'piano', 'synth', 'organ', 'rhodes', 'pad'],
      bands: { subBass: -8, bass: -2, lowMid: 0, mid: 1, highMid: 1, presence: 1, brilliance: 0 } },
    { id: GENERIC_ID, label: 'Generic', keywords: [],
      bands: { subBass: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, presence: 0, brilliance: 0 } },
  ];

  /**
   * The id of the first profile (in PROFILES order) whose keyword list has a
   * substring match in the normalized (lowercased, trimmed) label. Empty,
   * null, undefined, or no-match labels resolve to GENERIC_ID.
   */
  function inferProfileId(label) {
    var normalized = String(label || '').toLowerCase().trim();
    for (var i = 0; i < PROFILES.length; i++) {
      var keywords = PROFILES[i].keywords;
      for (var k = 0; k < keywords.length; k++) {
        if (normalized.indexOf(keywords[k]) !== -1) return PROFILES[i].id;
      }
    }
    return GENERIC_ID;
  }

  /** True iff some PROFILES entry has this exact id. */
  function isKnownProfileId(id) {
    for (var i = 0; i < PROFILES.length; i++) {
      if (PROFILES[i].id === id) return true;
    }
    return false;
  }

  /** The matching PROFILES entry, or the generic entry for unknown/empty ids. */
  function profileById(id) {
    for (var i = 0; i < PROFILES.length; i++) {
      if (PROFILES[i].id === id) return PROFILES[i];
    }
    return profileById(GENERIC_ID);
  }

  /**
   * The effective profile id for one strip: the persisted override for
   * `token` when it's a known profile id, else the label-inferred id.
   * Null/undefined `overridesForDevice` behaves as `{}`.
   */
  function effectiveProfileId(overridesForDevice, token, label) {
    var overrides = overridesForDevice || {};
    var override = overrides[token];
    if (typeof override === 'string' && isKnownProfileId(override)) return override;
    return inferProfileId(label);
  }

  /**
   * A new top-level inputInstrumentProfiles map with an override recorded for
   * `deviceName`/`token` (never mutates `all`), mirroring channel-labels.js's
   * recordLabel. A `profileId` that is `''`, `'auto'`, or not a known profile
   * id deletes the token entry instead (back to inferred), pruning the
   * device's map once it has no overrides left.
   */
  function recordOverride(all, deviceName, token, profileId) {
    var next = {};
    for (var device in (all || {})) {
      next[device] = Object.assign({}, all[device]);
    }
    var trimmed = String(profileId || '').trim().slice(0, MAX_PROFILE_ID_LEN);
    var deviceOverrides = Object.assign({}, next[deviceName]);
    if (trimmed === '' || trimmed === 'auto' || !isKnownProfileId(trimmed)) {
      delete deviceOverrides[token];
    } else {
      deviceOverrides[token] = trimmed;
    }
    if (Object.keys(deviceOverrides).length > 0) {
      next[deviceName] = deviceOverrides;
    } else {
      delete next[deviceName];
    }
    return next;
  }

  var api = {
    PROFILES: PROFILES,
    GENERIC_ID: GENERIC_ID,
    inferProfileId: inferProfileId,
    isKnownProfileId: isKnownProfileId,
    profileById: profileById,
    effectiveProfileId: effectiveProfileId,
    recordOverride: recordOverride,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.instrumentProfiles = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
