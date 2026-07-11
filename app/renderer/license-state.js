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

  // Length of the first-launch trial — must mirror TRIAL_DAYS in license.ts (#61).
  var TRIAL_DAYS = 14;
  var DAY_MS = 24 * 60 * 60 * 1000;

  // Grace window after a subscription's expiresAt — must mirror GRACE_DAYS in
  // license.ts, and the automatic license-refresh window it doubles as (#117).
  var GRACE_DAYS = 7;

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
   * Header badge model: label + whether to style it as in-grace/trial. During a
   * trial the countdown copy comes from trialBadgeText() — this label is the
   * fallback if that returns null (e.g. clock skew), never a recomposed string.
   * @param {{tier?:string,status?:string}|null} state
   * @returns {{label:string, pro:boolean, grace:boolean, trial:boolean}}
   */
  function badge(state) {
    var pro = !!state && state.tier === 'pro';
    var grace = pro && state.status === 'grace';
    var trial = pro && state.status === 'trial';
    return {
      // The label IS the displayed copy — the renderer must not recompose it,
      // or the tested value and the shown value drift apart.
      label: grace ? 'PRO · GRACE' : trial ? 'PRO · TRIAL' : pro ? 'PRO' : 'FREE',
      pro: pro,
      grace: grace,
      trial: trial,
    };
  }

  /**
   * Whole days of trial left (ceiling, min 1 while active), or null when the
   * state isn't an active trial.
   * @param {{status?:string, trialEndsAt?:string}|null} state
   * @param {Date} [now]
   * @returns {number|null}
   */
  function trialDaysLeft(state, now) {
    if (!state || state.status !== 'trial' || !state.trialEndsAt) return null;
    var endMs = Date.parse(state.trialEndsAt);
    if (isNaN(endMs)) return null;
    var ms = endMs - (now instanceof Date ? now : new Date()).getTime();
    if (ms <= 0) return null;
    return Math.max(1, Math.ceil(ms / DAY_MS));
  }

  /**
   * Subtle header countdown copy during the trial, or null when not trialing.
   * @param {{status?:string, trialEndsAt?:string}|null} state
   * @param {Date} [now]
   * @returns {string|null}
   */
  function trialBadgeText(state, now) {
    var days = trialDaysLeft(state, now);
    if (days === null) return null;
    return 'Pro trial — ' + days + (days === 1 ? ' day left' : ' days left');
  }

  /**
   * The gentle day-3 / day-11 subscription nudge (#61), or null when no nudge is
   * due. `milestone` scopes the per-user dismissal so each nudge shows once.
   * @param {{status?:string, trialEndsAt?:string}|null} state
   * @param {Date} [now]
   * @returns {{milestone:string, text:string}|null}
   */
  function trialNudge(state, now) {
    var days = trialDaysLeft(state, now);
    if (days === null) return null;
    var elapsed = TRIAL_DAYS - days; // days is a ceiling, so elapsed is a floor
    var milestone = elapsed >= 11 ? 'day11' : elapsed >= 3 ? 'day3' : null;
    if (!milestone) return null;
    return { milestone: milestone, text: 'Enjoying Pro? Start your subscription to keep it.' };
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

  /**
   * True when a subscription is due for an automatic license refresh (#117):
   * already in grace, or valid but within GRACE_DAYS of expiresAt. Mirrors
   * shouldAutoRefresh() in app/electron/license-refresh.ts — kept here (not
   * duplicated inline in index.html) so the renderer's paywall-evaluation
   * trigger shares one tested definition of the window.
   * @param {{kind?:string, status?:string, expiresAt?:string}|null} state
   * @param {Date} [now]
   * @returns {boolean}
   */
  function isInRefreshWindow(state, now) {
    if (!state || state.kind !== 'subscription') return false;
    if (state.status === 'grace') return true;
    if (state.status !== 'valid') return false;
    var expiresMs = Date.parse(state.expiresAt || '');
    if (isNaN(expiresMs)) return false;
    return expiresMs - (now instanceof Date ? now : new Date()).getTime() <= GRACE_DAYS * DAY_MS;
  }

  var api = {
    PRO_FEATURES: PRO_FEATURES,
    TRIAL_DAYS: TRIAL_DAYS,
    GRACE_DAYS: GRACE_DAYS,
    isEntitled: isEntitled,
    badge: badge,
    graceDaysLeft: graceDaysLeft,
    graceBannerText: graceBannerText,
    trialDaysLeft: trialDaysLeft,
    trialBadgeText: trialBadgeText,
    trialNudge: trialNudge,
    isInRefreshWindow: isInRefreshWindow,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.licenseState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
