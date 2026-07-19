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

  // Analysis windows required before candidates show (≈9s at the default 3s window).
  var MIN_WINDOWS = 3;
  // A band this far (dB) above the mean of the others is a buildup candidate;
  // mirrors grading.js CONFIG.bandBalance.hotDiff.
  var HOT_DIFF_DB = 12;
  // A band this far (dB) below the mean of the others is a buried-range candidate;
  // mirrors grading.js CONFIG.bandBalance.quietDiff.
  var QUIET_DIFF_DB = -15;
  var MAX_CANDIDATES = 3;

  /** The selected mix channel's bands object for one window event, or null when
   *  the window/channel/bands data isn't present. Mirrors the fallback in
   *  live-capture-panel.ts's liveReportCardSource(): measurementSource ?? 0,
   *  falling back to index 0 when that channel is missing. */
  function channelBands(w, measurementSource) {
    if (!w || !Array.isArray(w.channels)) return null;
    var idx = measurementSource == null ? 0 : measurementSource;
    if (!w.channels[idx]) idx = 0;
    var ch = w.channels[idx];
    if (!ch || !ch.bands) return null;
    return ch.bands;
  }

  /** The usable bands objects (one per window) for the selected mix channel.
   *  Null-safe per element; non-array input yields []. */
  function usableBands(windows, measurementSource) {
    if (!Array.isArray(windows)) return [];
    var result = [];
    for (var i = 0; i < windows.length; i++) {
      var bands = channelBands(windows[i], measurementSource);
      if (bands) result.push(bands);
    }
    return result;
  }

  /** Whether enough live analysis windows have accumulated to derive mix
   *  adjustment candidates. */
  function hasEnoughData(windows, measurementSource) {
    return usableBands(windows, measurementSource).length >= MIN_WINDOWS;
  }

  var BAND_KEYS = ['sub_bass', 'bass', 'low_mid', 'mid', 'high_mid', 'presence', 'brilliance'];
  // Parallel to BAND_KEYS, same order — maps to the camelCase keys used by
  // instrumentProfiles' PROFILES[n].bands (#524, see instrument-profiles.js).
  var PROFILE_BAND_KEYS = ['subBass', 'bass', 'lowMid', 'mid', 'highMid', 'presence', 'brilliance'];

  /** Minimal HTML escaper for the focused-input names, which are user-editable
   *  labels — can't require inline-app's escapeHtml from this classic script. */
  function escapeText(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Reimplemented locally (rather than requiring grading.js's bandDiffFromOthers)
  // because this classic script can't require a module in the browser — same
  // math, snake_case keys.
  function diffFromOthers(averages, key) {
    var sum = 0;
    var count = 0;
    for (var i = 0; i < BAND_KEYS.length; i++) {
      var k = BAND_KEYS[i];
      if (k === key) continue;
      sum += averages[k];
      count++;
    }
    return averages[key] - (sum / count);
  }

  /** Non-commanding overall-mix adjustment candidates derived from the live
   *  windows' band averages. [] unless MIN_WINDOWS usable windows have
   *  accumulated. Averaging is a plain arithmetic mean across windows — a
   *  trend smoother, not acoustics. */
  function mixCandidates(windows, measurementSource) {
    var bandsList = usableBands(windows, measurementSource);
    if (bandsList.length < MIN_WINDOWS) return [];

    var averages = {};
    for (var i = 0; i < BAND_KEYS.length; i++) {
      var key = BAND_KEYS[i];
      var sum = 0;
      for (var j = 0; j < bandsList.length; j++) sum += bandsList[j][key];
      averages[key] = sum / bandsList.length;
    }

    var candidates = [];
    if (Math.max(diffFromOthers(averages, 'sub_bass'), diffFromOthers(averages, 'bass')) > HOT_DIFF_DB) {
      candidates.push({
        id: 'low-end',
        title: 'Low-end buildup',
        detail: 'The mix is carrying extra energy below 250 Hz. A small cut in the 60–250 Hz range, or a high-pass on channels that don’t need lows, is what Sound Buddy would try first.',
      });
    }
    if (Math.max(diffFromOthers(averages, 'high_mid'), diffFromOthers(averages, 'presence')) > HOT_DIFF_DB) {
      candidates.push({
        id: 'harshness',
        title: 'Possible harshness',
        detail: 'Energy is concentrated in the 2–6 kHz range. A gentle cut there is what Sound Buddy would try first.',
      });
    }
    if (diffFromOthers(averages, 'mid') < QUIET_DIFF_DB) {
      candidates.push({
        id: 'vocal-clarity',
        title: 'Vocal range sitting low',
        detail: 'The 500 Hz–2 kHz range is well below the rest of the mix. A small boost there, or a nudge up on vocal faders, is what Sound Buddy would try first.',
      });
    }
    return candidates.slice(0, MAX_CANDIDATES);
  }

  /** The selected input channel's bands object for one window event, or null
   *  when the window/channel/bands data isn't present. Unlike channelBands,
   *  there is no fallback to channel 0 — a missing channel means no data for
   *  this specific input, not a stand-in for the mix. */
  function inputBands(w, channelIndex) {
    if (!w || !Array.isArray(w.channels)) return null;
    var ch = w.channels[channelIndex];
    if (!ch || !ch.bands) return null;
    return ch.bands;
  }

  /** The usable bands objects (one per window) for the selected input channel.
   *  Null-safe per element; non-array input yields []. */
  function usableInputBands(windows, channelIndex) {
    if (!Array.isArray(windows)) return [];
    var result = [];
    for (var i = 0; i < windows.length; i++) {
      var bands = inputBands(windows[i], channelIndex);
      if (bands) result.push(bands);
    }
    return result;
  }

  /** Whether enough live analysis windows carrying this input's channel have
   *  accumulated to derive per-input adjustment candidates. */
  function inputHasEnoughData(windows, channelIndex) {
    return usableInputBands(windows, channelIndex).length >= MIN_WINDOWS;
  }

  function meanOf(source, keys) {
    var sum = 0;
    for (var i = 0; i < keys.length; i++) sum += source[keys[i]];
    return sum / keys.length;
  }

  /** Non-commanding per-input adjustment candidates: the input's averaged band
   *  shape, centered and compared against its instrument profile's shape
   *  (also centered), rather than judged in isolation. `profile` is a full
   *  { id, label, bands } entry from instrumentProfiles.profileById, passed in
   *  by the caller so this module stays dependency-free. [] unless a profile
   *  with bands is given and MIN_WINDOWS usable windows have accumulated. */
  function inputCandidates(windows, channelIndex, profile) {
    if (!profile || !profile.bands) return [];
    var bandsList = usableInputBands(windows, channelIndex);
    if (bandsList.length < MIN_WINDOWS) return [];

    var avg = {};
    for (var i = 0; i < BAND_KEYS.length; i++) {
      var key = BAND_KEYS[i];
      var sum = 0;
      for (var j = 0; j < bandsList.length; j++) sum += bandsList[j][key];
      avg[key] = sum / bandsList.length;
    }

    var measuredMean = meanOf(avg, BAND_KEYS);
    var targetMean = meanOf(profile.bands, PROFILE_BAND_KEYS);

    var dev = {};
    for (i = 0; i < BAND_KEYS.length; i++) {
      var measuredRel = avg[BAND_KEYS[i]] - measuredMean;
      var targetRel = profile.bands[PROFILE_BAND_KEYS[i]] - targetMean;
      dev[BAND_KEYS[i]] = measuredRel - targetRel;
    }

    var candidates = [];
    var lowDiff = Math.max(dev.sub_bass, dev.bass);
    if (lowDiff > HOT_DIFF_DB) {
      candidates.push({
        id: 'input-low-cleanup',
        title: 'Low-end cleanup',
        detail: 'This input is carrying more low end than a ' + profile.label + ' input usually needs. A small cut below 250 Hz, or a high-pass, is what Sound Buddy would try first.',
      });
    } else if (lowDiff < QUIET_DIFF_DB) {
      candidates.push({
        id: 'input-low-support',
        title: 'Low-end support',
        detail: 'This input has less low end than a ' + profile.label + ' input usually carries. A small boost in the 60–250 Hz range, or easing its high-pass, is what Sound Buddy would try first.',
      });
    }
    var upperDiff = Math.max(dev.high_mid, dev.presence);
    if (upperDiff > HOT_DIFF_DB) {
      candidates.push({
        id: 'input-high-buildup',
        title: 'Upper-mid buildup',
        detail: 'This input has more 2–6 kHz energy than a ' + profile.label + ' input usually needs. A gentle cut there is what Sound Buddy would try first.',
      });
    } else if (upperDiff < QUIET_DIFF_DB) {
      candidates.push({
        id: 'input-high-support',
        title: 'Presence support',
        detail: 'This input sits below the 2–6 kHz presence a ' + profile.label + ' input usually carries. A small boost there is what Sound Buddy would try first.',
      });
    }
    return candidates.slice(0, MAX_CANDIDATES);
  }

  /** The panel's markup, or '' when it shouldn't render. Renders a waiting
   *  state until enough live analysis windows have accumulated, then the
   *  derived overall-mix adjustment candidates (or a steady-state message
   *  when none trigger). `windows`/`measurementSource` are optional — omitting
   *  them (legacy callers) behaves as not-enough-data. The optional
   *  `focusView` (#525) is `{ inputs: [{ index, name, profile }], focusedIndex
   *  }` — when absent, or when `inputs` is empty, output is byte-identical to
   *  the pre-#525 shape. */
  function panelHTML(settings, mode, windows, measurementSource, focusView) {
    if (!showPanel(settings, mode)) return '';
    var body;
    if (!hasEnoughData(windows, measurementSource)) {
      body = '<p class="lap-empty">Listening… collecting live analysis data. Candidates appear after a few analysis windows.</p>';
    } else {
      var candidates = mixCandidates(windows, measurementSource);
      if (candidates.length === 0) {
        body = '<p class="lap-empty">Mix balance looks steady — nothing to try right now.</p>';
      } else {
        var items = candidates.map(function (c) {
          return '<li class="lap-candidate"><span class="lap-cand-title">' + c.title + '</span> '
            + '<span class="lap-cand-detail">' + c.detail + '</span></li>';
        }).join('');
        body = '<p class="lap-note">Overall mix candidates — suggestions to consider, not instructions:</p>'
          + '<ul class="lap-candidates">' + items + '</ul>';
      }
    }
    return '<div class="live-adjustments-panel" role="note">'
      + '<span class="lap-title">Live adjustments <span class="lap-flag">Experimental</span></span>'
      + body
      + focusHTML(windows, focusView)
      + '</div>';
  }

  /** The focused-input inspector section markup (#525), or '' when `focusView`
   *  is absent or has no inputs — that absence is also what keeps panelHTML's
   *  output byte-identical to the pre-#525 shape for existing callers. */
  function focusHTML(windows, focusView) {
    if (!focusView || !focusView.inputs || focusView.inputs.length === 0) return '';
    var inputs = focusView.inputs;
    var focusedIndex = focusView.focusedIndex == null ? null : focusView.focusedIndex;
    var options = '<option value="">None</option>' + inputs.map(function (input) {
      var selected = input.index === focusedIndex ? ' selected' : '';
      return '<option value="' + input.index + '"' + selected + '>' + escapeText(input.name) + '</option>';
    }).join('');
    var selectHTML = '<select class="lap-focus-select" aria-label="Focused input">' + options + '</select>';

    var focused = null;
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].index === focusedIndex) { focused = inputs[i]; break; }
    }

    var focusBody;
    if (!focused) {
      focusBody = '<p class="lap-empty">Choose an input to see instrument-aware candidates.</p>';
    } else if (!inputHasEnoughData(windows, focused.index)) {
      focusBody = '<p class="lap-empty">Listening to ' + escapeText(focused.name) + '… candidates appear after a few analysis windows.</p>';
    } else {
      var candidates = inputCandidates(windows, focused.index, focused.profile);
      if (candidates.length === 0) {
        focusBody = '<p class="lap-empty">' + escapeText(focused.name) + ' sits close to its ' + escapeText(focused.profile.label) + ' shape — nothing to try right now.</p>';
      } else {
        var items = candidates.map(function (c) {
          return '<li class="lap-candidate"><span class="lap-cand-title">' + c.title + '</span> '
            + '<span class="lap-cand-detail">' + c.detail + '</span></li>';
        }).join('');
        focusBody = '<p class="lap-note">Candidates for ' + escapeText(focused.name) + ', judged against the '
          + escapeText(focused.profile.label) + ' profile — for this input only, not the whole mix:</p>'
          + '<ul class="lap-input-candidates">' + items + '</ul>';
      }
    }

    return '<div class="lap-focus"><span class="lap-section-title">Focused input</span>'
      + selectHTML
      + focusBody
      + '</div>';
  }

  var api = {
    isEnabled: isEnabled,
    showPanel: showPanel,
    panelHTML: panelHTML,
    hasEnoughData: hasEnoughData,
    mixCandidates: mixCandidates,
    inputHasEnoughData: inputHasEnoughData,
    inputCandidates: inputCandidates,
    MIN_WINDOWS: MIN_WINDOWS,
    HOT_DIFF_DB: HOT_DIFF_DB,
    QUIET_DIFF_DB: QUIET_DIFF_DB,
    MAX_CANDIDATES: MAX_CANDIDATES,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.liveAdjustmentsState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
