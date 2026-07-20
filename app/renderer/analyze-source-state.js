// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, framework-free predicate + routing table for the unified "Analyze"
// source picker (#543, epic e17). DOM-free so it's unit-testable, mirroring
// single-column-state.js. Read off window.analyzeSourceState.
(function (root) {
  'use strict';

  // The three answers to "where's the audio coming from?" (#543, epic e17).
  // Directory is deliberately absent: it's a real batch workflow now (#270),
  // but adding it to this unified picker is a separate story — the picker's
  // acceptance criteria call for exactly these three choices.
  var ANALYZE_SOURCES = [
    { id: 'file', label: 'Analyze a file', hint: 'Drop in a recording you already have.', icon: 'file-audio' },
    { id: 'live', label: 'Start live capture', hint: 'Capture multi-channel audio from the console right now.', icon: 'radio' },
    { id: 'soundcheck', label: 'Load a soundcheck session', hint: 'Play back a captured session and mix without the band.', icon: 'sliders' }
  ];

  /** Whether the unified source picker replaces the bare file dialog.
   *  Strict: only a literal `true` opens the picker, so a still-loading
   *  settings store never flashes an experimental entry point. */
  function isPickerEnabled(enabled) { return enabled === true; }

  /** The tab-bar mode a chosen source routes to, or null for the file source
   *  (which opens the OS file dialog rather than switching tabs). Unknown ids
   *  return undefined so a typo fails loudly instead of silently no-op'ing. */
  function targetModeFor(id) {
    switch (id) {
      case 'file': return null;
      case 'live': return 'live';
      case 'soundcheck': return 'soundcheck';
      default: return undefined;
    }
  }

  var api = { ANALYZE_SOURCES: ANALYZE_SOURCES, isPickerEnabled: isPickerEnabled, targetModeFor: targetModeFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.analyzeSourceState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
