// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure logic for the Feedback Ring-Out Assistant (#366): a step-by-step
// wizard that walks a volunteer through eliminating monitor feedback —
// raise gain to just-ringing, capture the ringing frequency (via the shared
// findSpectralPeaks DSP core, injected), suggest a narrow-Q cut snapped to
// the nearest ISO third-octave center, and optionally persist a per-mic EQ
// profile. Nothing here touches the DOM, IPC, or window — the peak finder,
// escapeHtml, and Storage are all injected, mirroring build-order-state.js.
(function (root) {
  'use strict';

  var STORAGE_KEY = 'sb-ringout-profiles-v1';

  // Narrow-Q ring-out cut defaults: deep enough to kill the ring, narrow
  // enough (~1/6-octave at Q 6) to be surgical rather than scooping the mix.
  var DEFAULT_CUT_GAIN_DB = -6;
  var DEFAULT_CUT_Q = 6.0;

  var MIN_FREQ_HZ = 20;
  var MAX_FREQ_HZ = 20000;

  // Standard 31-band ISO third-octave GEQ centers — the values engineers
  // actually have knobs for, so a raw FFT peak snaps to something dialable.
  var ISO_THIRD_OCTAVE = [
    20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630,
    800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000,
    12500, 16000, 20000,
  ];

  var STEPS = [
    {
      id: 'setup', label: 'Set up as used',
      instructions: [
        'Position mics and monitors exactly as they will be used.',
        'Get everyone in place — the room absorbs sound differently once occupied.',
      ],
    },
    {
      id: 'raise-gain', label: 'Raise gain to just-feedback',
      instructions: [
        'Slowly bring up the monitor/mic gain.',
        'Stop the instant it just starts to ring — you only need a hint of feedback.',
      ],
    },
    {
      id: 'capture', label: 'Capture the ringing frequency',
      instructions: [
        'Hold at the ring for a couple of seconds.',
        'Capture it from the local mic, or enter the frequency manually if no mic is available.',
      ],
    },
    {
      id: 'cut', label: 'Apply a narrow-Q cut',
      instructions: [
        'Dial the suggested frequency, gain, and Q into the monitor’s EQ/GEQ.',
      ],
    },
    {
      id: 'retest', label: 'Re-test / repeat',
      instructions: [
        'Push the gain again.',
        'If it rings elsewhere, repeat from Capture.',
      ],
    },
    {
      id: 'save', label: 'Save this mic’s EQ profile (optional)',
      instructions: [
        'Store the cuts you made so next service starts from here.',
      ],
    },
  ];

  function stepCount() {
    return STEPS.length;
  }

  // Non-finite (NaN/±Infinity) coerces to 0; otherwise clamped to a valid index.
  function clampStep(i) {
    var n = Number(i);
    if (!isFinite(n)) return 0;
    n = Math.trunc(n);
    if (n < 0) return 0;
    if (n > STEPS.length - 1) return STEPS.length - 1;
    return n;
  }

  function stepAt(i) {
    return STEPS[clampStep(i)];
  }

  function stepId(i) {
    return stepAt(i).id;
  }

  function isFirstStep(i) {
    return clampStep(i) === 0;
  }

  function isLastStep(i) {
    return clampStep(i) === STEPS.length - 1;
  }

  // findPeaks is injected (the shared findSpectralPeaks core from #376) so
  // this module stays DOM/window-free and testable against a fake finder.
  function identifyRing(curve, findPeaks, opts) {
    if (typeof findPeaks !== 'function') return null;
    if (!curve || !Array.isArray(curve.freqs) || !Array.isArray(curve.db)) return null;
    var peaks = findPeaks(curve, opts);
    if (!Array.isArray(peaks) || !peaks.length) return null;
    // findSpectralPeaks already sorts by prominence descending — the most
    // prominent peak is the one most likely to be the actual ring.
    var p = peaks[0];
    return { freq: p.freq, db: p.db, prominence: p.prominence };
  }

  // Nearest ISO third-octave center by log-frequency distance (perceptually
  // even, so 3100 Hz snaps to 3150 not 4000). Non-finite/≤0 → null.
  function snapToIso(freq) {
    if (!isFinite(freq) || freq <= 0) return null;
    var lf = Math.log(freq);
    var best = null;
    var bestDist = Infinity;
    for (var i = 0; i < ISO_THIRD_OCTAVE.length; i++) {
      var center = ISO_THIRD_OCTAVE[i];
      var dist = Math.abs(lf - Math.log(center));
      if (dist < bestDist) {
        bestDist = dist;
        best = center;
      }
    }
    return best;
  }

  function suggestCut(freq, opts) {
    if (!isFinite(freq)) return null;
    var snapped = snapToIso(freq);
    var f = (snapped === null) ? freq : snapped;
    var gainDb = (opts && opts.gainDb !== undefined && opts.gainDb !== null) ? opts.gainDb : DEFAULT_CUT_GAIN_DB;
    var q = (opts && opts.q !== undefined && opts.q !== null) ? opts.q : DEFAULT_CUT_Q;
    return { freq: f, gainDb: gainDb, q: q };
  }

  // '3150' -> 3150, out-of-range or unparseable -> null. Powers the manual
  // fallback entry, which must work with zero mic access.
  function parseManualFrequency(input) {
    var n = parseFloat(String(input));
    if (!isfiniteNumber(n)) return null;
    if (n < MIN_FREQ_HZ || n > MAX_FREQ_HZ) return null;
    return n;
  }

  function isfiniteNumber(n) {
    return typeof n === 'number' && isFinite(n);
  }

  function emptyProfiles() {
    return { profiles: [] };
  }

  function isValidProfile(p) {
    if (!p || typeof p.mic !== 'string' || !p.mic.length) return false;
    if (!Array.isArray(p.cuts)) return false;
    for (var i = 0; i < p.cuts.length; i++) {
      var c = p.cuts[i];
      if (!c || !isfiniteNumber(c.freq) || !isfiniteNumber(c.gainDb) || !isfiniteNumber(c.q)) return false;
    }
    return true;
  }

  // Never throws: missing/malformed/throwing storage all fall back to
  // emptyProfiles(), mirroring build-order-state's resilience.
  function loadProfiles(storage) {
    try {
      if (!storage || typeof storage.getItem !== 'function') return emptyProfiles();
      var raw = storage.getItem(STORAGE_KEY);
      if (!raw) return emptyProfiles();
      var parsed = JSON.parse(raw);
      var profiles = (parsed && Array.isArray(parsed.profiles)) ? parsed.profiles.filter(isValidProfile) : [];
      return { profiles: profiles };
    } catch {
      return emptyProfiles();
    }
  }

  // Best-effort persist; swallows errors (private-mode / disabled storage).
  function saveProfiles(storage, profiles) {
    try {
      if (storage && typeof storage.setItem === 'function') {
        storage.setItem(STORAGE_KEY, JSON.stringify(profiles || emptyProfiles()));
      }
    } catch {
      /* private-mode / disabled storage — nothing we can persist, so no-op */
    }
  }

  function getProfile(profiles, mic) {
    var list = (profiles && Array.isArray(profiles.profiles)) ? profiles.profiles : [];
    var target = String(mic || '').toLowerCase();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].mic).toLowerCase() === target) return list[i];
    }
    return null;
  }

  // Returns a new { profiles } with `profile` upserted by mic name
  // (case-insensitive); invalid profiles are ignored and the input is
  // returned unchanged. Never mutates the input.
  function saveProfile(storage, profiles, profile) {
    if (!isValidProfile(profile)) return profiles;
    var list = (profiles && Array.isArray(profiles.profiles)) ? profiles.profiles.slice() : [];
    var name = String(profile.mic).toLowerCase();
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].mic).toLowerCase() === name) { idx = i; break; }
    }
    if (idx === -1) list.push(profile);
    else list[idx] = profile;
    var next = { profiles: list };
    saveProfiles(storage, next);
    return next;
  }

  function deleteProfile(storage, profiles, mic) {
    var list = (profiles && Array.isArray(profiles.profiles)) ? profiles.profiles : [];
    var target = String(mic || '').toLowerCase();
    var next = { profiles: list.filter(function (p) { return String(p.mic).toLowerCase() !== target; }) };
    saveProfiles(storage, next);
    return next;
  }

  function formatFreq(freq) {
    if (freq >= 1000) return (freq / 1000).toFixed(2) + ' kHz';
    return Math.round(freq) + ' Hz';
  }

  function formatCut(cut) {
    return 'Cut ' + formatFreq(cut.freq) + ' · ' + cut.gainDb + ' dB · Q ' + cut.q.toFixed(1);
  }

  // Markup for one wizard step card. escapeHtml is injected (mirrors
  // stepRowHtml) so there is one escape implementation, not a duplicate.
  function stepHtml(index, escapeHtml) {
    var i = clampStep(index);
    var step = STEPS[i];
    var itemsHtml = step.instructions.map(function (line) {
      return '<li>' + escapeHtml(line) + '</li>';
    }).join('');
    return '\n    <div class="ro-step" data-step-id="' + escapeHtml(step.id) + '">\n' +
      '      <span class="section-label">' + escapeHtml(step.label) + '</span>\n' +
      '      <ul class="ro-instructions">' + itemsHtml + '</ul>\n' +
      '      <span class="ro-step-indicator">Step ' + (i + 1) + ' of ' + STEPS.length + '</span>\n' +
      '    </div>';
  }

  function suggestionHtml(cut, escapeHtml) {
    if (!cut) {
      return '<span class="ro-suggestion-empty">' + escapeHtml('No suggestion yet — capture or enter a frequency.') + '</span>';
    }
    return '<span class="ro-suggestion">' + escapeHtml(formatCut(cut)) + '</span>';
  }

  function profileRowHtml(profile, escapeHtml) {
    var p = profile || {};
    var cuts = Array.isArray(p.cuts) ? p.cuts : [];
    var summary = cuts.map(function (c) {
      return formatFreq(c.freq) + ' (' + c.gainDb + ' dB, Q ' + c.q.toFixed(1) + ')';
    }).join(', ');
    return '\n    <div class="ro-profile-row" data-mic="' + escapeHtml(p.mic) + '">\n' +
      '      <span class="ro-profile-name">' + escapeHtml(p.mic) + '</span>\n' +
      '      <span class="ro-profile-summary">' + escapeHtml(summary) + '</span>\n' +
      '      <button type="button" class="ro-profile-recall ghost-btn sm" data-mic="' + escapeHtml(p.mic) + '">Recall</button>\n' +
      '      <button type="button" class="ro-profile-delete ghost-btn sm" data-mic="' + escapeHtml(p.mic) + '">Delete</button>\n' +
      '    </div>';
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    DEFAULT_CUT_GAIN_DB: DEFAULT_CUT_GAIN_DB,
    DEFAULT_CUT_Q: DEFAULT_CUT_Q,
    MIN_FREQ_HZ: MIN_FREQ_HZ,
    MAX_FREQ_HZ: MAX_FREQ_HZ,
    ISO_THIRD_OCTAVE: ISO_THIRD_OCTAVE,
    STEPS: STEPS,
    stepCount: stepCount,
    clampStep: clampStep,
    stepAt: stepAt,
    stepId: stepId,
    isFirstStep: isFirstStep,
    isLastStep: isLastStep,
    identifyRing: identifyRing,
    snapToIso: snapToIso,
    suggestCut: suggestCut,
    parseManualFrequency: parseManualFrequency,
    emptyProfiles: emptyProfiles,
    isValidProfile: isValidProfile,
    loadProfiles: loadProfiles,
    getProfile: getProfile,
    saveProfile: saveProfile,
    deleteProfile: deleteProfile,
    formatCut: formatCut,
    stepHtml: stepHtml,
    suggestionHtml: suggestionHtml,
    profileRowHtml: profileRowHtml,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.feedbackRingout = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
