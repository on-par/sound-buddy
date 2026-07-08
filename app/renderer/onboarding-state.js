// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, framework-free gate for the first-run onboarding flow (#69). The welcome
// overlay should appear exactly once — on a genuine first launch — and never
// again after the user runs their first analysis or skips. State is a single
// localStorage flag; these helpers keep the "seen once" rule unit-testable
// without a DOM by taking a Storage-like object (getItem/setItem). A missing or
// throwing storage is treated as "not seen" so onboarding still shows rather than
// being silently suppressed. Loaded via <script src> and read off
// window.onboardingState, mirroring collapse-state.js / license-state.js.
(function (root) {
  'use strict';

  // localStorage key. Versioned so a future onboarding revision can re-show the
  // flow to existing users by bumping the suffix, without colliding with the
  // sb-trial-dismiss-* keys the trial banner owns.
  var KEY = 'sb-onboarding-seen-v1';

  /** Has the user already completed or skipped onboarding? */
  function hasSeenOnboarding(storage) {
    try {
      return !!(storage && typeof storage.getItem === 'function' && storage.getItem(KEY) === '1');
    } catch (e) {
      return false;
    }
  }

  /** Should the first-run welcome overlay show? Only on a genuine first launch. */
  function shouldShowOnboarding(storage) {
    return !hasSeenOnboarding(storage);
  }

  /** Mark onboarding as seen so it never reappears (idempotent, best-effort). */
  function markOnboardingSeen(storage) {
    try {
      if (storage && typeof storage.setItem === 'function') storage.setItem(KEY, '1');
    } catch (e) {
      /* private-mode / disabled storage — nothing we can persist, so no-op */
    }
  }

  var api = {
    KEY: KEY,
    hasSeenOnboarding: hasSeenOnboarding,
    shouldShowOnboarding: shouldShowOnboarding,
    markOnboardingSeen: markOnboardingSeen,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.onboardingState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
