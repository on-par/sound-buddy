// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure logic for the post-report-card "Keep improving" momentum card (#58): the
// score-aware heading/subhead so a great mix is celebrated (not told it needs
// help), the locked next-step actions, the pricing CTAs, and the "Maybe later"
// 7-day dismissal window. Kept DOM-free and IPC-free in a standalone classic
// script so it's unit-testable (Vitest) yet shared verbatim with the renderer,
// which loads it via <script src> and reads it off window.upgradeMomentum.
//
// The card only ever renders for a free (non-Pro) user who has just seen their
// report card — the renderer keys visibility off body.not-pro (the same single
// gate as every other Pro surface, #54). This module owns only what to say.

(function (root) {
  'use strict';

  // "Maybe later" hides the card for the length of the conversion window (#58):
  // the 7-day window is the revenue thesis, so the card re-appears after it,
  // once, rather than nagging every launch or vanishing forever.
  var DISMISS_DAYS = 7;
  var DAY_MS = 24 * 60 * 60 * 1000;

  // The two subscription tiers (#56). One price each — no A/B (a non-goal). The
  // renderer maps `plan` straight to sb.openCheckout(plan); keep in sync with
  // the checkoutUrl() mapping in app/electron/checkout.ts.
  var PLANS = [
    { plan: 'monthly', label: 'Start for $9/mo', primary: true },
    { plan: 'annual', label: 'Best value $79/yr', primary: false },
  ];

  // The locked next-step actions shown beside the free result. Each maps a Pro
  // feature (mirrors PRO_FEATURES in license-state.js) to the one-line hint from
  // Iris's wireframe direction. Order is the funnel order: see change → save →
  // coach.
  var ACTIONS = [
    { feature: 'saved-rigs', title: 'See what changed week to week', hint: 'Saved rigs track every mix over time.' },
    { feature: 'saved-rigs', title: 'Save this rig as your baseline', hint: 'Capture profiles you can compare against.' },
    { feature: 'live-monitoring', title: 'Get ongoing coaching during live monitoring', hint: 'Real-time feedback on the Live tab.' },
  ];

  // Trust copy under the CTAs (#58) — the AI is always the user's own, local or
  // their key, never proxied. Companion to the locked "Works with the AI you
  // already have" phrase, but scoped to the pricing moment.
  var TRUST_COPY = 'Use your own AI provider or stay fully local with Ollama';

  /**
   * Score-aware framing so the card respects the user's result (#58): a strong
   * grade (A/B) is celebrated and offered Pro tools to keep it repeatable; a
   * weaker grade is framed as turning this one result into a workflow. Never
   * implies a great mix needs fixing.
   * @param {string} grade  Letter grade from computeGrade (A–F).
   * @returns {{heading:string, sub:string}}
   */
  function toneForGrade(grade) {
    var strong = grade === 'A' || grade === 'B';
    if (strong) {
      return {
        heading: 'Nice mix — make it repeatable',
        sub: 'Lock in this result and keep it dialed in every week with Pro.',
      };
    }
    return {
      heading: 'Keep improving',
      sub: 'Turn this result into a repeatable workflow with Pro.',
    };
  }

  /**
   * Whether the momentum card should show for the current license state. Only
   * free (non-Pro) users see it — a trialing or paid user already has these
   * tools. Mirrors isEntitled()'s Pro check without importing it: Pro is any
   * state whose tier is 'pro' (covers valid, trial, and grace).
   * @param {{tier?:string}|null} state
   * @returns {boolean}
   */
  function shouldShowForLicense(state) {
    return !(state && state.tier === 'pro');
  }

  /**
   * Whether a "Maybe later" dismissal is still active. Given the stored
   * timestamp (ms epoch, or null/invalid when never dismissed), the card stays
   * hidden until DISMISS_DAYS have passed, then returns once more.
   * @param {number|string|null|undefined} dismissedAt  ms epoch or null.
   * @param {Date} [now]
   * @returns {boolean}
   */
  function isDismissed(dismissedAt, now) {
    if (dismissedAt == null) return false;
    var at = typeof dismissedAt === 'string' ? parseInt(dismissedAt, 10) : dismissedAt;
    if (typeof at !== 'number' || isNaN(at)) return false;
    var nowMs = (now instanceof Date ? now : new Date()).getTime();
    return nowMs - at < DISMISS_DAYS * DAY_MS;
  }

  var api = {
    DISMISS_DAYS: DISMISS_DAYS,
    PLANS: PLANS,
    ACTIONS: ACTIONS,
    TRUST_COPY: TRUST_COPY,
    toneForGrade: toneForGrade,
    shouldShowForLicense: shouldShowForLicense,
    isDismissed: isDismissed,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.upgradeMomentum = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
