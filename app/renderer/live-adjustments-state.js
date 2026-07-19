// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, framework-free predicate for the experimental live adjustments gate
// (#522, epic #515). DOM-free so it's unit-testable, mirroring
// daw-workspace-state.js. Read off window.liveAdjustmentsState.
(function (root) {
  'use strict';

  /** Whether the experimental live adjustments area is enabled in app
   *  settings. Strict: only a literal `true` on a real settings object
   *  counts, so a null/still-loading store or a hand-edited settings.json
   *  string never enables an experiment. */
  function isEnabled(settings) {
    return !!settings && settings.liveAdjustmentsEnabled === true;
  }

  /** Whether the placeholder recommendations panel should render — only on
   *  the Live tab, and only while the experiment is on. Single predicate
   *  every render gate calls so the two rules can't drift apart between
   *  call sites. */
  function showPanel(settings, mode) {
    return isEnabled(settings) && mode === 'live';
  }

  /** The panel's markup, or '' when it shouldn't render. No recommendation
   *  logic — a static placeholder telling the engineer suggestions will
   *  appear here later (#522). */
  function panelHTML(settings, mode) {
    if (!showPanel(settings, mode)) return '';
    return '<div class="live-adjustments-panel" role="note">'
      + '<span class="lap-title">Live adjustments <span class="lap-flag">Experimental</span></span>'
      + '<p class="lap-empty">Recommendations will appear here while you monitor or record. Nothing to suggest yet.</p>'
      + '</div>';
  }

  var api = { isEnabled: isEnabled, showPanel: showPanel, panelHTML: panelHTML };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.liveAdjustmentsState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
