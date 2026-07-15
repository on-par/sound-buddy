// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure logic for the "Grade your own service" guide dialog (#295 rework of
// #142): the three capture paths a user with no recording yet can pick from,
// and the dispatch table for their follow-through CTA. No DOM/IPC — the
// dialog wiring (inline-app.js) reads this off window.gradeOwnState and does
// only the innerHTML assignment and click handling.
(function (root) {
  'use strict';

  var CAPTURE_PATHS = [
    {
      id: 'usb',
      title: 'Record to a USB stick on your console/mixer.',
      body: 'Most digital mixers can record the main mix (or every channel) straight to a USB drive — start it before the service, stop it after, then drop the file in.',
      cta: { label: 'Read the USB recording steps', action: 'open-guide' },
    },
    {
      id: 'daw',
      title: 'Capture on a laptop with a DAW or audio interface.',
      body: "Connect the board's output (or an interface) to a laptop and record into any DAW (or free tool); export a WAV/AIFF and analyze it.",
      cta: { label: 'Read the laptop capture steps', action: 'open-guide' },
    },
    {
      id: 'livestream',
      title: 'Use your livestream or video recording.',
      body: 'If you already stream or record the service to video, just pick that file — Sound Buddy extracts and grades its audio track automatically.',
      cta: { label: 'Choose your livestream video…', action: 'choose-file' },
    },
  ];

  var CTA_ACTIONS = {
    'open-guide': 'open-guide',
    'choose-file': 'choose-file',
  };

  function pathsHtml(escapeHtml, paths) {
    var list = paths || CAPTURE_PATHS;
    return list.map(function (p, i) {
      return '<div class="guide-item">' +
        '<span class="guide-item-num">' + (i + 1) + '</span>' +
        '<span class="guide-item-text"><strong>' + escapeHtml(p.title) + '</strong> ' + escapeHtml(p.body) + '</span>' +
        '</div>' +
        '<button type="button" class="btn btn-secondary sm guide-item-cta" data-guide-path="' + escapeHtml(p.id) + '">' + escapeHtml(p.cta.label) + '</button>';
    }).join('');
  }

  function ctaAction(pathId) {
    var path = CAPTURE_PATHS.filter(function (p) { return p.id === pathId; })[0];
    if (!path) return null;
    return CTA_ACTIONS[path.cta.action] || null;
  }

  var api = {
    CAPTURE_PATHS: CAPTURE_PATHS,
    pathsHtml: pathsHtml,
    ctaAction: ctaAction,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.gradeOwnState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
