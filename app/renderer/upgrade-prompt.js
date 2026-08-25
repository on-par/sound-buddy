// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure logic for the conversion CTAs (#1191): the checkout plan/label the
// locked-feature gates and the Settings "Upgrade to Pro" button open, and the
// current-plan/trial-days-left label shown in Settings → About. Kept DOM-free
// and IPC-free in a standalone classic script so it's unit-testable (Vitest)
// yet shared verbatim with the renderer, which loads it via <script src> and
// reads it off window.upgradePrompt.
//
// Trial/day math is a verbatim port of license-state.js's trialDaysLeft, kept
// here (not imported) so this module stays a single self-contained classic
// script, matching upgrade-momentum.js's convention.

(function (root) {
  'use strict';

  // The low-friction plan the gate/Settings "Upgrade to Pro" buttons open —
  // must be a plan accepted by openCheckout ('monthly' | 'annual'); mirrors
  // the monthly fallback in app/electron/checkout.ts.
  var UPGRADE_CTA_PLAN = 'monthly';
  var UPGRADE_CTA_LABEL = 'Upgrade to Pro';
  var DAY_MS = 24 * 60 * 60 * 1000;

  /**
   * Whole days of trial left (ceiling, min 1 while active), or null when the
   * state isn't an active trial. Verbatim port of license-state.js's
   * trialDaysLeft, kept here so this module has no cross-script dependency.
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
   * The Settings → About plan/trial line, derived purely from a LicenseState
   * (#1191). An active paid license ('valid') hides the upgrade CTA; every
   * other state (none/trial/trial-expired/grace/expired/invalid, and a null
   * state) shows it.
   * @param {{tier?:string,status?:string,kind?:string,expiresAt?:string,trialEndsAt?:string}|null} state
   * @param {Date} [now]
   * @returns {{label:string, isPro:boolean, showUpgrade:boolean, trialDaysLeft:number|null}}
   */
  function planStatusView(state, now) {
    var isPro = !!state && state.tier === 'pro';
    var showUpgrade = !(state && state.status === 'valid');
    var days = trialDaysLeft(state, now);
    var status = state ? state.status : 'none';
    var label;
    switch (status) {
      case 'trial':
        label = days != null
          ? 'Pro trial — ' + days + (days === 1 ? ' day left' : ' days left')
          : 'Pro trial';
        break;
      case 'trial-expired':
        label = 'Trial ended — Free plan';
        break;
      case 'valid':
        label = state.kind === 'lifetime' ? 'Pro — lifetime license' : 'Pro — active';
        break;
      case 'grace':
        label = 'Pro — grace period';
        break;
      case 'expired':
        label = 'Free plan (license expired)';
        break;
      case 'invalid':
        label = 'Free plan';
        break;
      case 'none':
      default:
        label = 'Free plan';
        break;
    }
    return { label: label, isPro: isPro, showUpgrade: showUpgrade, trialDaysLeft: days };
  }

  var api = {
    UPGRADE_CTA_PLAN: UPGRADE_CTA_PLAN,
    UPGRADE_CTA_LABEL: UPGRADE_CTA_LABEL,
    DAY_MS: DAY_MS,
    trialDaysLeft: trialDaysLeft,
    planStatusView: planStatusView,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.upgradePrompt = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
