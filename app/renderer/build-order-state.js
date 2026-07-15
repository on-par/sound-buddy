// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure logic for the Channel Build-Order Guide (#367): Lee's mix-build
// sequence as an ordered, checkable checklist with concrete starting-point
// presets (EQ/comp/gate) per step. Progress is a plain, JSON-serializable
// object persisted via an injected Storage, mirroring onboarding-state.js.
// Nothing here touches the DOM or IPC. Loaded via <script src> and read off
// window.buildOrderState.
(function (root) {
  'use strict';

  var STORAGE_KEY = 'sb-build-order-v1';

  // Lee's mix-build order: drums low-to-high, then tracks/bass/keys/guitars,
  // lead vocal LAST (everything else supports it), then a final unmute-all
  // pass. Starting points are sensible church-sound defaults — engineers
  // adjust from here, not gospel.
  var STEPS = [
    {
      id: 'kick', label: 'Kick',
      presets: {
        eq: [
          'HPF ~30 Hz',
          '+3–4 dB @ 60–80 Hz (thump)',
          '-4 dB @ 300–400 Hz (boxiness)',
          '+3 dB @ 3–4 kHz (beater click)',
        ],
        comp: '4:1, ~6 dB gain reduction, fast attack, medium release',
        gate: 'Threshold just under kick level; fast attack, ~200 ms hold',
      },
    },
    {
      id: 'snare-top', label: 'Snare (top)',
      presets: {
        eq: [
          'HPF ~80 Hz',
          '+3 dB @ 150–200 Hz (body)',
          '-3 dB @ 600 Hz (boxy)',
          '+4 dB @ 4–5 kHz (crack)',
        ],
        comp: '4:1, ~4–6 dB GR, medium attack',
        gate: 'Gate to reject hi-hat bleed; fast attack',
      },
    },
    {
      id: 'snare-bottom', label: 'Snare (bottom)',
      presets: {
        eq: ['HPF ~150 Hz', '+4 dB @ 5–7 kHz (snare wires/sizzle)'],
        comp: null,
        gate: 'Optional gate, often keyed off snare-top',
        note: 'Flip polarity if it thins out the snare when combined with top.',
      },
    },
    {
      id: 'hats', label: 'Hi-hats',
      presets: {
        eq: ['HPF ~200 Hz', '-3 dB @ 800 Hz (clank)', '+2 dB @ 8–10 kHz (air)'],
        comp: null,
        gate: null,
      },
    },
    {
      id: 'toms', label: 'Toms',
      presets: {
        eq: [
          'HPF ~60–80 Hz',
          '+3 dB @ 100 Hz (rack) / 80 Hz (floor)',
          '-4 dB @ 300–400 Hz',
          '+3 dB @ 4–5 kHz (attack)',
        ],
        comp: '3:1, medium attack',
        gate: 'Gate each tom to control ring/bleed',
      },
    },
    {
      id: 'overheads', label: 'Overheads',
      presets: {
        eq: ['HPF ~300 Hz (kill kick/tom wash)', '+2 dB @ 10 kHz (cymbal shimmer)'],
        comp: 'Light 2:1 for glue, ~3 dB GR',
        gate: null,
        note: 'Set overall cymbal balance here — this is your kit picture.',
      },
    },
    {
      id: 'tracks', label: 'Tracks / loops',
      presets: {
        eq: ['Usually flat — trust the studio mix', 'Gentle HPF only if it fights the bass'],
        comp: null,
        gate: null,
        note: 'Bring in stereo; balance against the live kit.',
      },
    },
    {
      id: 'bass', label: 'Bass',
      presets: {
        eq: [
          'HPF ~40 Hz',
          '+3 dB @ 80–100 Hz (weight)',
          '-3 dB @ 250 Hz (mud)',
          '+3 dB @ 700 Hz–1 kHz (definition/growl)',
        ],
        comp: '4:1, ~6 dB GR, medium attack — glue with the kick',
        gate: null,
      },
    },
    {
      id: 'keys', label: 'Keys',
      presets: {
        eq: ['HPF ~80 Hz', '-3 dB @ 300 Hz if boomy', 'Gentle presence around 3 kHz'],
        comp: '2:1 light leveling',
        gate: null,
      },
    },
    {
      id: 'guitars', label: 'Electric guitars',
      presets: {
        eq: ['HPF ~100 Hz', '-3 dB @ 400–500 Hz (mud)', '+2–3 dB @ 3 kHz (bite/presence)'],
        comp: '3:1, ~4 dB GR',
        gate: null,
      },
    },
    {
      id: 'acoustic', label: 'Acoustic guitar',
      presets: {
        eq: ['HPF ~100 Hz', '-4 dB @ 200–300 Hz (boom/boxiness)', '+3 dB @ 5–8 kHz (sparkle)'],
        comp: '3:1 to tame strum dynamics',
        gate: null,
      },
    },
    {
      id: 'lead-vocal', label: 'Lead vocal (do this LAST)',
      presets: {
        eq: [
          'HPF ~100 Hz',
          '-3 dB @ 250–400 Hz (mud)',
          '+2 dB @ 3–5 kHz (intelligibility)',
          '+2 dB @ 10 kHz (air)',
        ],
        comp: '3:1–4:1, ~4–6 dB GR, medium attack, auto/medium release',
        gate: null,
        note: 'Build the whole mix around the vocal — do it LAST so everything else supports it.',
      },
    },
    {
      id: 'unmute-all', label: 'Final unmute-all pass',
      presets: null,
      note: 'Unmute every channel, walk the whole mix, and check balance with the band playing together. This is your final pass before the service.',
    },
  ];

  var VALID_IDS = STEPS.map(function (s) { return s.id; });

  // "What to watch for during the service" — the closing-moment tips (#374).
  // Static guidance shown once the whole build order is checked off; deliberately
  // short and reassuring, not a scored/progression system (that's deferred #20).
  var WATCH_FOR = [
    'Keep the lead vocal on top — it should stay the clearest thing in the mix all service.',
    'Ride faders gently between songs; the band’s energy shifts, your balance should follow.',
    'Watch low-end buildup as the room fills with people — pull the bass/kick if it gets muddy.',
    'Listen for feedback when mics move — catch the ring and pull gain before it takes off.',
    'Trust the build you just did. Make small moves during the service; don’t rebuild mid-song.',
  ];

  function emptyProgress() {
    return { completed: [] };
  }

  function stepIds() {
    return VALID_IDS.slice();
  }

  function totalSteps() {
    return STEPS.length;
  }

  function isValidId(id) {
    return VALID_IDS.indexOf(id) !== -1;
  }

  function isComplete(progress, id) {
    return !!(progress && Array.isArray(progress.completed) && progress.completed.indexOf(id) !== -1);
  }

  // Returns a new progress object; never mutates the input. Unknown ids are
  // never stored — a stray/corrupt id can't get stuck in persisted state.
  function toggle(progress, id) {
    var completed = (progress && Array.isArray(progress.completed)) ? progress.completed.slice() : [];
    if (!isValidId(id)) return { completed: completed };
    var idx = completed.indexOf(id);
    if (idx === -1) completed.push(id);
    else completed.splice(idx, 1);
    return { completed: completed };
  }

  function completedCount(progress) {
    var completed = (progress && Array.isArray(progress.completed)) ? progress.completed : [];
    return completed.filter(isValidId).length;
  }

  function isAllComplete(progress) {
    return completedCount(progress) === STEPS.length;
  }

  // Never throws: missing/malformed/throwing storage all fall back to
  // emptyProgress(), mirroring onboarding-state's resilience.
  function loadProgress(storage) {
    try {
      if (!storage || typeof storage.getItem !== 'function') return emptyProgress();
      var raw = storage.getItem(STORAGE_KEY);
      if (!raw) return emptyProgress();
      var parsed = JSON.parse(raw);
      var completed = (parsed && Array.isArray(parsed.completed)) ? parsed.completed.filter(isValidId) : [];
      return { completed: completed };
    } catch {
      return emptyProgress();
    }
  }

  // Best-effort persist; swallows errors (private-mode / disabled storage).
  function saveProgress(storage, progress) {
    try {
      if (storage && typeof storage.setItem === 'function') {
        storage.setItem(STORAGE_KEY, JSON.stringify(progress || emptyProgress()));
      }
    } catch {
      /* private-mode / disabled storage — nothing we can persist, so no-op */
    }
  }

  // Human-readable lines for a step's starting-point presets. Instrument
  // steps read their EQ/Comp/Gate/Note off `presets`; unmute-all has no
  // presets object (it's a checklist action, not a channel), so its note
  // lives directly on the step.
  function presetLines(step) {
    var lines = [];
    var s = step || {};
    var presets = s.presets;
    if (presets) {
      if (Array.isArray(presets.eq)) {
        presets.eq.forEach(function (line) { lines.push('EQ: ' + line); });
      }
      if (presets.comp) lines.push('Comp: ' + presets.comp);
      if (presets.gate) lines.push('Gate: ' + presets.gate);
      if (presets.note) lines.push('Note: ' + presets.note);
    } else if (s.note) {
      lines.push('Note: ' + s.note);
    }
    return lines;
  }

  // Markup for one checklist row. escapeHtml is injected — the renderer
  // passes its existing shared escapeHtml so there is one escape
  // implementation, not a duplicate (mirrors recent-services.rowHtml).
  function stepRowHtml(step, index, progress, escapeHtml) {
    var s = step || {};
    var done = isComplete(progress, s.id);
    var lines = presetLines(s);
    var detailsHtml = lines.map(function (l) { return '<li>' + escapeHtml(l) + '</li>'; }).join('');
    return '\n    <div class="bg-row' + (done ? ' bg-done' : '') + '" data-step-id="' + escapeHtml(s.id) + '">\n' +
      '      <button type="button" class="bg-check" aria-pressed="' + (done ? 'true' : 'false') + '">' +
      (done ? '✓' : String((index || 0) + 1)) + '</button>\n' +
      '      <div class="bg-row-body">\n' +
      '        <span class="bg-label">' + escapeHtml(s.label) + '</span>\n' +
      '        <ul class="bg-details">' + detailsHtml + '</ul>\n' +
      '      </div>\n' +
      '    </div>';
  }

  // One-line summary of what was accomplished, derived purely from progress.
  // Uses completedCount/totalSteps so it stays honest if the step list changes.
  function summaryLine(progress) {
    var done = completedCount(progress);
    var total = totalSteps();
    return 'You built ' + done + ' of ' + total + ' channels, in order — kick through lead vocal, then a full unmute-all pass.';
  }

  // Markup for the Build Complete closing moment (#374). Returns '' unless the
  // whole build order is complete, so the renderer can call it unconditionally
  // and just toggle visibility. escapeHtml is injected — same shared escape used
  // by stepRowHtml, so there is one escape implementation, not a duplicate.
  function completeMomentHtml(progress, escapeHtml) {
    if (!isAllComplete(progress)) return '';
    var tips = WATCH_FOR
      .map(function (t) { return '<li>' + escapeHtml(t) + '</li>'; })
      .join('');
    return '\n    <div class="bg-complete-head">\n' +
      '      <span class="bg-complete-title">You’re done.</span>\n' +
      '      <span class="bg-complete-sub">Every channel is built. Here’s what to watch for during the service.</span>\n' +
      '    </div>\n' +
      '    <p class="bg-complete-summary">' + escapeHtml(summaryLine(progress)) + '</p>\n' +
      '    <span class="section-label">What to watch for</span>\n' +
      '    <ul class="bg-watch-list">' + tips + '</ul>\n' +
      '    <button type="button" id="build-complete-share" class="btn btn-secondary sm full" data-icon="clipboard-check">Share your grade</button>';
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    STEPS: STEPS,
    emptyProgress: emptyProgress,
    stepIds: stepIds,
    totalSteps: totalSteps,
    isComplete: isComplete,
    toggle: toggle,
    completedCount: completedCount,
    isAllComplete: isAllComplete,
    loadProgress: loadProgress,
    saveProgress: saveProgress,
    presetLines: presetLines,
    stepRowHtml: stepRowHtml,
    WATCH_FOR: WATCH_FOR,
    summaryLine: summaryLine,
    completeMomentHtml: completeMomentHtml,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.buildOrderState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
