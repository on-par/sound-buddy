// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure license/entitlement helpers for the renderer (#54): which features a
// LicenseState unlocks, what the header badge should read, and the grace-period
// banner copy. Kept in a standalone classic script so the logic is
// unit-testable (Vitest) yet shared verbatim with the renderer, which loads it
// via <script src> and reads it off window.licenseState.
//
// Nothing here touches the DOM or IPC — the state object comes from the main
// process (sb.getLicense() / sb.activateLicense()), which owns the offline
// cryptographic validation. Gating keys off feature FLAGS only — never
// recording count, length, or storage size (#91).

(function (root) {
  'use strict';

  // Pro-gated features — must mirror PRO_FEATURES in app/electron/license.ts.
  // Everything else (the full report card) is free: the funnel, not the product.
  var PRO_FEATURES = ['saved-rigs', 'live-monitoring', 'virtual-soundcheck', 'ai-narrative'];

  /**
   * Feature gate, renderer side. Free features are always entitled; Pro
   * features need state.tier === 'pro' (covers both valid and in-grace).
   * @param {{tier?:string}|null} state
   * @param {string} feature
   * @returns {boolean}
   */
  function isEntitled(state, feature) {
    if (PRO_FEATURES.indexOf(feature) === -1) return true;
    return !!state && state.tier === 'pro';
  }

  /**
   * Header badge model: label + whether to style it as in-grace.
   * @param {{tier?:string,status?:string}|null} state
   * @returns {{label:string, pro:boolean, grace:boolean}}
   */
  function badge(state) {
    var pro = !!state && state.tier === 'pro';
    var grace = pro && state.status === 'grace';
    return {
      // The label IS the displayed copy — the renderer must not recompose it,
      // or the tested value and the shown value drift apart.
      label: grace ? 'PRO · GRACE' : pro ? 'PRO' : 'FREE',
      pro: pro,
      grace: grace,
    };
  }

  /**
   * Whole days of grace left (ceiling, min 1 while in grace), or null when the
   * state isn't in a grace period.
   * @param {{status?:string, graceEndsAt?:string}|null} state
   * @param {Date} [now]
   * @returns {number|null}
   */
  function graceDaysLeft(state, now) {
    if (!state || state.status !== 'grace' || !state.graceEndsAt) return null;
    var endMs = Date.parse(state.graceEndsAt);
    if (isNaN(endMs)) return null;
    var ms = endMs - (now instanceof Date ? now : new Date()).getTime();
    if (ms <= 0) return null;
    return Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)));
  }

  /**
   * Banner copy while in grace, or null when no banner should show.
   * @param {{status?:string, graceEndsAt?:string}|null} state
   * @param {Date} [now]
   * @returns {string|null}
   */
  function graceBannerText(state, now) {
    var days = graceDaysLeft(state, now);
    if (days === null) return null;
    var unit = days === 1 ? 'day' : 'days';
    return 'Your license has expired — Pro features stay unlocked for ' + days + ' more ' + unit + '. Renew to keep them.';
  }

  var api = {
    PRO_FEATURES: PRO_FEATURES,
    isEntitled: isEntitled,
    badge: badge,
    graceDaysLeft: graceDaysLeft,
    graceBannerText: graceBannerText,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.licenseState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
