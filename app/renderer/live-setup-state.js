// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, framework-free gate for the Live tab's guided first-use setup (#294).
// The Live workspace's zero-state teaches the sequence choose a device -> add
// a track -> start monitoring or recording, then gets permanently out of the
// way once the user has started their first capture (or dismisses it). State
// is a single localStorage flag, mirroring onboarding-state.js's "seen once"
// pattern — a missing or throwing storage is treated as "not done" so the
// guide still shows rather than being silently suppressed. Loaded via
// <script src> and read off window.liveSetupState.
(function (root) {
  'use strict';

  // localStorage key. Versioned like sb-onboarding-seen-v1 so a future
  // revision can re-show the guide to existing users by bumping the suffix.
  var KEY = 'sb-live-setup-done-v1';

  /** Has the user already completed (or dismissed) the guided setup? */
  function hasCompletedSetup(storage) {
    try {
      return !!(storage && typeof storage.getItem === 'function' && storage.getItem(KEY) === '1');
    } catch {
      return false;
    }
  }

  /** Mark setup as complete so the guide never reappears (idempotent, best-effort). */
  function markSetupComplete(storage) {
    try {
      if (storage && typeof storage.setItem === 'function') storage.setItem(KEY, '1');
    } catch {
      /* private-mode / disabled storage — nothing we can persist, so no-op */
    }
  }

  /** Should the guided setup (hero or banner) show? */
  function shouldShowGuide(storage) {
    return !hasCompletedSetup(storage);
  }

  // Step copy is fixed (no magic numbers/strings inline at call sites) and
  // covers the sequence choose a device -> add a track -> start monitoring or
  // recording. "start" is never rendered done — starting a capture is what
  // completes and dismisses the guide, not a checkable step state.
  function setupSteps(view) {
    var deviceReady = !!(view && view.deviceReady);
    var trackCount = (view && view.trackCount) || 0;
    var liveMode = (view && view.liveMode) || 'monitor';

    var steps = [
      {
        key: 'device',
        label: 'Choose your input device',
        hint: 'Pick your interface or console under Input Device in the Source panel.',
        done: deviceReady,
      },
      {
        key: 'track',
        label: 'Add a track',
        hint: 'Each track meters one input channel, or a stereo pair.',
        done: trackCount > 0,
      },
      {
        key: 'start',
        label: liveMode === 'record' ? 'Start recording' : 'Start monitoring',
        hint: 'Press Start Capture in the Source panel when you’re ready.',
        done: false,
      },
    ];

    var activeIdx = steps.findIndex(function (s) { return !s.done; });
    steps.forEach(function (s, i) { s.active = i === activeIdx; });
    return steps;
  }

  /** Whether the power-user controls (new group, collapse/expand, arm-all) should show. */
  function showAdvancedControls(trackCount) {
    return trackCount > 0;
  }

  var api = {
    KEY: KEY,
    hasCompletedSetup: hasCompletedSetup,
    markSetupComplete: markSetupComplete,
    shouldShowGuide: shouldShowGuide,
    setupSteps: setupSteps,
    showAdvancedControls: showAdvancedControls,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.liveSetupState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
