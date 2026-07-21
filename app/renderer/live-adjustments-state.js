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

  // Peak (dBFS) above which the live signal reads as clipping-adjacent; mirrors
  // grading.js CONFIG.peak.issueAbove so the live card and the report card agree.
  var CLIP_RISK_PEAK_DBFS = -1;
  // Ranking tiers. A critical condition (clipping risk) always outranks a tonal
  // balance improvement, no matter how confident the tonal candidate is.
  var CATEGORY_PRIORITY = { clipping: 2, tonal: 1 };
  // Confidence model. Confidence is evidence strength, not probability: a base
  // floor, plus how far past its threshold the condition sits, plus how many
  // analysis windows back it up. Saturates at 1.
  var CONFIDENCE_BASE = 0.4;
  var CONFIDENCE_MAGNITUDE_WEIGHT = 0.4;
  var CONFIDENCE_WINDOW_WEIGHT = 0.2;
  // dB past a candidate's own threshold at which the magnitude term saturates.
  var CONFIDENCE_FULL_EXCESS_DB = 6;
  // Analysis windows at which the evidence term saturates (2x MIN_WINDOWS).
  var CONFIDENCE_FULL_WINDOWS = 6;
  // Below this, Sound Buddy stays quiet rather than offering weak advice.
  var MIN_CONFIDENCE = 0.6;
  var HIGH_CONFIDENCE = 0.8;
  // Tolerance for the float threshold comparisons below — confidence is a sum of
  // floats, so a candidate landing exactly on a threshold must not fall out to
  // binary representation error.
  var CONFIDENCE_EPSILON = 1e-9;

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
    var lowSeverity = Math.max(diffFromOthers(averages, 'sub_bass'), diffFromOthers(averages, 'bass')) - HOT_DIFF_DB;
    if (lowSeverity > 0) {
      candidates.push({
        id: 'low-end',
        title: 'Low-end buildup',
        detail: 'The mix is carrying extra energy below 250 Hz. A small cut in the 60–250 Hz range, or a high-pass on channels that don’t need lows, is what Sound Buddy would try first.',
        category: 'tonal',
        scope: 'mix',
        scopeLabel: 'Overall mix',
        severityDb: lowSeverity,
        confidence: candidateConfidence(lowSeverity, bandsList.length),
        why: 'Extra energy below 250 Hz masks vocals and makes the room feel muddy from the back.',
        action: 'Consider a small cut in the 60–250 Hz range, or a high-pass on channels that don’t need lows.',
      });
    }
    var harshSeverity = Math.max(diffFromOthers(averages, 'high_mid'), diffFromOthers(averages, 'presence')) - HOT_DIFF_DB;
    if (harshSeverity > 0) {
      candidates.push({
        id: 'harshness',
        title: 'Possible harshness',
        detail: 'Energy is concentrated in the 2–6 kHz range. A gentle cut there is what Sound Buddy would try first.',
        category: 'tonal',
        scope: 'mix',
        scopeLabel: 'Overall mix',
        severityDb: harshSeverity,
        confidence: candidateConfidence(harshSeverity, bandsList.length),
        why: 'A concentration of 2–6 kHz energy is what listeners hear as harsh or fatiguing.',
        action: 'Consider a gentle cut in the 2–6 kHz range.',
      });
    }
    var vocalSeverity = QUIET_DIFF_DB - diffFromOthers(averages, 'mid');
    if (vocalSeverity > 0) {
      candidates.push({
        id: 'vocal-clarity',
        title: 'Vocal range sitting low',
        detail: 'The 500 Hz–2 kHz range is well below the rest of the mix. A small boost there, or a nudge up on vocal faders, is what Sound Buddy would try first.',
        category: 'tonal',
        scope: 'mix',
        scopeLabel: 'Overall mix',
        severityDb: vocalSeverity,
        confidence: candidateConfidence(vocalSeverity, bandsList.length),
        why: 'With 500 Hz–2 kHz well below the rest of the mix, spoken and sung words get hard to follow.',
        action: 'Consider a small boost in the 500 Hz–2 kHz range, or a nudge up on vocal faders.',
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
      var lowCleanupSeverity = lowDiff - HOT_DIFF_DB;
      candidates.push({
        id: 'input-low-cleanup',
        title: 'Low-end cleanup',
        detail: 'This input is carrying more low end than a ' + profile.label + ' input usually needs. A small cut below 250 Hz, or a high-pass, is what Sound Buddy would try first.',
        category: 'tonal',
        scope: 'input',
        scopeLabel: 'Focused input',
        severityDb: lowCleanupSeverity,
        confidence: candidateConfidence(lowCleanupSeverity, bandsList.length),
        why: 'Low end this input doesn’t need still eats headroom and muddies the mix.',
        action: 'Consider a small cut below 250 Hz on this input, or a high-pass.',
      });
    } else if (lowDiff < QUIET_DIFF_DB) {
      var lowSupportSeverity = QUIET_DIFF_DB - lowDiff;
      candidates.push({
        id: 'input-low-support',
        title: 'Low-end support',
        detail: 'This input has less low end than a ' + profile.label + ' input usually carries. A small boost in the 60–250 Hz range, or easing its high-pass, is what Sound Buddy would try first.',
        category: 'tonal',
        scope: 'input',
        scopeLabel: 'Focused input',
        severityDb: lowSupportSeverity,
        confidence: candidateConfidence(lowSupportSeverity, bandsList.length),
        why: 'Without its usual low end this input sounds thin against the rest of the mix.',
        action: 'Consider a small boost in the 60–250 Hz range on this input, or easing its high-pass.',
      });
    }
    var upperDiff = Math.max(dev.high_mid, dev.presence);
    if (upperDiff > HOT_DIFF_DB) {
      var highBuildupSeverity = upperDiff - HOT_DIFF_DB;
      candidates.push({
        id: 'input-high-buildup',
        title: 'Upper-mid buildup',
        detail: 'This input has more 2–6 kHz energy than a ' + profile.label + ' input usually needs. A gentle cut there is what Sound Buddy would try first.',
        category: 'tonal',
        scope: 'input',
        scopeLabel: 'Focused input',
        severityDb: highBuildupSeverity,
        confidence: candidateConfidence(highBuildupSeverity, bandsList.length),
        why: 'Extra 2–6 kHz on one input is what makes a single source stick out as harsh.',
        action: 'Consider a gentle cut in the 2–6 kHz range on this input.',
      });
    } else if (upperDiff < QUIET_DIFF_DB) {
      var highSupportSeverity = QUIET_DIFF_DB - upperDiff;
      candidates.push({
        id: 'input-high-support',
        title: 'Presence support',
        detail: 'This input sits below the 2–6 kHz presence a ' + profile.label + ' input usually carries. A small boost there is what Sound Buddy would try first.',
        category: 'tonal',
        scope: 'input',
        scopeLabel: 'Focused input',
        severityDb: highSupportSeverity,
        confidence: candidateConfidence(highSupportSeverity, bandsList.length),
        why: 'Without its usual presence this input gets buried even when its fader is up.',
        action: 'Consider a small boost in the 2–6 kHz range on this input.',
      });
    }
    return candidates.slice(0, MAX_CANDIDATES);
  }

  /** Evidence-strength score in [CONFIDENCE_BASE, 1]: a base floor, plus how
   *  far past its own threshold the condition sits (magnitude), plus how many
   *  analysis windows back it up (evidence). Non-finite/missing inputs (e.g.
   *  a candidate with no severity yet) coerce to a 0 ratio rather than NaN. */
  function candidateConfidence(severityDb, windowCount) {
    var magnitudeRatio = Math.min(1, Math.max(0, severityDb) / CONFIDENCE_FULL_EXCESS_DB);
    var windowRatio = Math.min(1, Math.max(0, windowCount) / CONFIDENCE_FULL_WINDOWS);
    if (!isFinite(magnitudeRatio)) magnitudeRatio = 0;
    if (!isFinite(windowRatio)) windowRatio = 0;
    return Math.min(1, CONFIDENCE_BASE + CONFIDENCE_MAGNITUDE_WEIGHT * magnitudeRatio + CONFIDENCE_WINDOW_WEIGHT * windowRatio);
  }

  /** 'High' | 'Medium' | 'Low' reading of a confidence score, for the
   *  coaching card's confidence line. */
  function confidenceLabel(confidence) {
    if (confidence >= HIGH_CONFIDENCE - CONFIDENCE_EPSILON) return 'High';
    if (confidence >= MIN_CONFIDENCE - CONFIDENCE_EPSILON) return 'Medium';
    return 'Low';
  }

  /** The selected channel's level object (peak/clipping) for one window
   *  event, or null when it doesn't carry a numeric peak. Reuses the same
   *  channel-selection fallback as channelBands (measurementSource ?? 0,
   *  falling back to index 0 when missing). */
  function channelLevels(w, measurementSource) {
    if (!w || !Array.isArray(w.channels)) return null;
    var idx = measurementSource == null ? 0 : measurementSource;
    if (!w.channels[idx]) idx = 0;
    var ch = w.channels[idx];
    if (!ch || typeof ch.peak !== 'number') return null;
    return ch;
  }

  /** Mix-scope clipping-risk candidate(s) from the peak/clipping fields the
   *  live window events already carry (stream.py emits them per channel and
   *  the live meters already render them) — no new detector, just a ranking
   *  input. [] unless MIN_WINDOWS usable level readings have accumulated and
   *  the signal is at or past clipping-adjacent. */
  function clipCandidates(windows, measurementSource) {
    if (!Array.isArray(windows)) return [];
    var levels = [];
    for (var i = 0; i < windows.length; i++) {
      var ch = channelLevels(windows[i], measurementSource);
      if (ch) levels.push(ch);
    }
    if (levels.length < MIN_WINDOWS) return [];

    var maxPeak = -Infinity;
    var anyClipping = false;
    for (var j = 0; j < levels.length; j++) {
      if (levels[j].peak > maxPeak) maxPeak = levels[j].peak;
      if (levels[j].clipping === true) anyClipping = true;
    }
    if (!anyClipping && maxPeak <= CLIP_RISK_PEAK_DBFS) return [];

    var severityDb = maxPeak - CLIP_RISK_PEAK_DBFS;
    // A measured `clipping === true` is not an inference — force confidence
    // to 1 rather than let a barely-past-threshold peak read as low-evidence.
    var confidence = anyClipping ? 1 : candidateConfidence(severityDb, levels.length);
    return [{
      id: 'clip-risk',
      title: 'Clipping risk',
      detail: 'The measured signal is peaking at or above −1 dBFS. Easing input gain is what Sound Buddy would try first.',
      category: 'clipping',
      scope: 'mix',
      scopeLabel: 'Overall mix',
      severityDb: severityDb,
      confidence: confidence,
      why: 'A signal at or past 0 dBFS distorts, and no downstream EQ can undo it.',
      action: 'Consider easing input gain or the fader until peaks sit below −1 dBFS.',
    }];
  }

  /** 0 for mix-scope, 1 for input-scope — mix sorts first in rankCandidates. */
  function scopeRank(scope) {
    return scope === 'mix' ? 0 : 1;
  }

  /** All candidate sources normalized into one ranked set, highest priority
   *  first. Ignores null/non-array input and filters out non-object entries.
   *  Returns a new array (never mutates the argument) sorted by a fully
   *  deterministic comparator — category, then confidence, then severity,
   *  then scope, then id — so ordering never depends on sort stability. */
  function rankCandidates(candidates) {
    if (!Array.isArray(candidates)) return [];
    var ranked = candidates.filter(function (c) { return c && typeof c === 'object'; });
    ranked.sort(function (a, b) {
      var catDiff = (CATEGORY_PRIORITY[b.category] || 0) - (CATEGORY_PRIORITY[a.category] || 0);
      if (catDiff !== 0) return catDiff;
      var confDiff = b.confidence - a.confidence;
      if (confDiff !== 0) return confDiff;
      var sevDiff = b.severityDb - a.severityDb;
      if (sevDiff !== 0) return sevDiff;
      var scopeDiff = scopeRank(a.scope) - scopeRank(b.scope);
      if (scopeDiff !== 0) return scopeDiff;
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    });
    return ranked;
  }

  /** The single winning candidate, or null when nothing clears the
   *  confidence gate. The gate is applied after ranking, so a low-confidence
   *  clipping candidate does not suppress a high-confidence tonal one. */
  function selectCoachingCandidate(candidates) {
    var ranked = rankCandidates(candidates);
    for (var i = 0; i < ranked.length; i++) {
      if (ranked[i].confidence >= MIN_CONFIDENCE - CONFIDENCE_EPSILON) return ranked[i];
    }
    return null;
  }

  // A candidate must win the ranked, confidence-gated top slot for this many
  // consecutive analysis windows before it becomes actionable. At the default 3s
  // window that is ~6s of agreement on top of the MIN_WINDOWS the detectors
  // already require — enough to ride out one transient peak or song transition.
  var PERSISTENCE_WINDOWS = 2;
  // While a suggestion is active it is retained down to this confidence, below
  // the MIN_CONFIDENCE promotion gate — so a condition fluctuating around the
  // activation threshold does not blink the card off and on.
  var RETAIN_CONFIDENCE = 0.5;
  // Consecutive windows the active condition must read as resolved (absent from
  // the candidate set, or below RETAIN_CONFIDENCE) before it is cleared.
  var RECOVERY_WINDOWS = 2;
  // A challenger in the same category must beat the active candidate's
  // confidence by this much to be worth switching the engineer's attention.
  var REPLACEMENT_MARGIN = 0.15;
  // An active suggestion is held at least this long (ms) before a same-category
  // challenger may replace it — long enough to read the card and try the change.
  // A higher-priority category (clipping) bypasses this: it is safety-critical.
  var MIN_ACTIVE_HOLD_MS = 15000;
  // After a condition resolves, it and its contradictory counterpart are
  // suppressed for this long (ms) so short-term variation cannot produce the
  // opposite advice moments later.
  var COOLDOWN_MS = 60000;
  // Candidate ids that advise opposite moves on the same range. Resolving one
  // puts the other in cooldown too. Only same-scope pairs are listed — a mix
  // candidate never contradicts a focused-input candidate.
  var OPPOSITE_IDS = {
    'input-low-cleanup': 'input-low-support',
    'input-low-support': 'input-low-cleanup',
    'input-high-buildup': 'input-high-support',
    'input-high-support': 'input-high-buildup',
  };

  // Ordinary coaching is hidden this long (ms) after a snooze — one song, roughly.
  var SNOOZE_MS = 300000;
  // A dismissed condition may only return if it reads this much worse (dB past its own
  // threshold) than it was when dismissed — "materially more severe", not noise.
  var DISMISS_ESCALATION_DB = 3;
  // After "I tried this", Sound Buddy watches this long (ms) before it would have anything
  // to say about the result. #613 only opens the window; scoring it is out of scope.
  var OBSERVATION_WINDOW_MS = 60000;
  // Categories a snooze does not silence — a clipping risk is safety-critical, and the
  // acceptance criteria only protect *ordinary* advice from reactivation.
  var SNOOZE_BYPASS_CATEGORIES = { clipping: true };
  // Minutes-remaining display for the snoozed card copy.
  var MS_PER_MINUTE = 60000;

  /** A fresh coaching stability state (#612/#613): no active suggestion,
   *  nothing pending, no cooldowns/dismissals in effect, no disposition. */
  function createCoachingState() {
    return {
      active: null,
      activeSince: null,
      pendingId: null,
      pendingCount: 0,
      pendingCandidate: null,
      clearCount: 0,
      cooldowns: {},
      acknowledgedId: null,
      snoozeUntil: null,
      dismissed: {},
      observing: null,
    };
  }

  /** The full candidate set (clipping + overall-mix + focused-input) for one
   *  analysis window, in the same shape panelHTML has always assembled —
   *  factored out (#612) so advanceCoaching sees exactly the candidates the
   *  render path would, without duplicating the assembly logic. */
  function allCoachingCandidates(windows, measurementSource, focusView) {
    var candidates = clipCandidates(windows, measurementSource).concat(mixCandidates(windows, measurementSource));
    var focused = focusedInput(focusView);
    if (focused && inputHasEnoughData(windows, focused.index)) {
      candidates = candidates.concat(inputCandidates(windows, focused.index, focused.profile));
    }
    return candidates;
  }

  /** Pure coaching-stability reducer (#612). A candidate must persist for
   *  PERSISTENCE_WINDOWS consecutive windows before it becomes the active
   *  suggestion; the active card is retained through minor confidence dips;
   *  replacing it requires either a higher-priority category or clearing both
   *  MIN_ACTIVE_HOLD_MS and REPLACEMENT_MARGIN; a cleared condition resolves
   *  after RECOVERY_WINDOWS windows without it, putting it (and its
   *  contradictory counterpart, if any) into cooldown so the opposite advice
   *  can't surface moments later. Called once per analysis window, never per
   *  render. Pure: returns a brand-new state object, never mutates `prev`
   *  (including `prev.cooldowns`). `now` is always the caller's injected
   *  clock reading — this module never calls Date.now() itself. */
  function advanceCoaching(prev, candidates, now) {
    var state = prev && typeof prev === 'object' ? prev : createCoachingState();
    var cands = Array.isArray(candidates) ? candidates : [];

    var cooldowns = {};
    for (var key in state.cooldowns) {
      if (Object.prototype.hasOwnProperty.call(state.cooldowns, key) && state.cooldowns[key] > now) {
        cooldowns[key] = state.cooldowns[key];
      }
    }

    var dismissed = {};
    for (var dKey in state.dismissed) {
      if (!Object.prototype.hasOwnProperty.call(state.dismissed, dKey)) continue;
      var record = state.dismissed[dKey];
      var escaped = false;
      for (var d = 0; d < cands.length; d++) {
        var c = cands[d];
        if (c && c.id === dKey && c.severityDb >= record.severityDb + DISMISS_ESCALATION_DB - CONFIDENCE_EPSILON) {
          escaped = true;
          break;
        }
      }
      if (!escaped) dismissed[dKey] = record;
    }

    var snoozeUntil = (state.snoozeUntil != null && state.snoozeUntil > now) ? state.snoozeUntil : null;
    var observing = (state.observing && state.observing.until > now) ? state.observing : null;

    var ranked = rankCandidates(cands);
    var eligible = ranked.filter(function (c) { return cooldowns[c.id] == null && dismissed[c.id] == null; });

    var active = state.active;
    var activeSince = state.activeSince;
    var pendingId = state.pendingId;
    var pendingCount = state.pendingCount;
    // Always reassigned in the pending-accounting step below before use.
    var pendingCandidate;
    var clearCount = state.clearCount;
    var prevActiveId = state.active ? state.active.id : null;

    if (active) {
      var cur = null;
      for (var i = 0; i < ranked.length; i++) {
        if (ranked[i].id === active.id) { cur = ranked[i]; break; }
      }
      if (cur && cur.confidence >= RETAIN_CONFIDENCE - CONFIDENCE_EPSILON) {
        active = cur;
        clearCount = 0;
      } else {
        clearCount = clearCount + 1;
        if (clearCount >= RECOVERY_WINDOWS) {
          var resolvedId = active.id;
          cooldowns[resolvedId] = now + COOLDOWN_MS;
          if (OPPOSITE_IDS[resolvedId]) cooldowns[OPPOSITE_IDS[resolvedId]] = now + COOLDOWN_MS;
          // A resolution window must not also promote another candidate —
          // return immediately rather than falling into pending accounting.
          return {
            active: null,
            activeSince: null,
            pendingId: null,
            pendingCount: 0,
            pendingCandidate: null,
            clearCount: 0,
            cooldowns: cooldowns,
            acknowledgedId: null,
            snoozeUntil: snoozeUntil,
            dismissed: dismissed,
            observing: observing,
          };
        }
        // A dip that hasn't yet cleared RECOVERY_WINDOWS keeps the previous snapshot.
      }
    }

    var top = null;
    for (var j = 0; j < eligible.length; j++) {
      if (eligible[j].confidence >= MIN_CONFIDENCE - CONFIDENCE_EPSILON) { top = eligible[j]; break; }
    }

    if (!top) {
      pendingId = null;
      pendingCount = 0;
      pendingCandidate = null;
    } else if (active && top.id === active.id) {
      // Not a challenger to itself.
      pendingId = null;
      pendingCount = 0;
      pendingCandidate = null;
    } else if (top.id === pendingId) {
      pendingCount = pendingCount + 1;
      pendingCandidate = top;
    } else {
      pendingId = top.id;
      pendingCount = 1;
      pendingCandidate = top;
    }

    if (pendingCount >= PERSISTENCE_WINDOWS) {
      if (!active) {
        active = pendingCandidate;
        activeSince = now;
        clearCount = 0;
        pendingId = null;
        pendingCount = 0;
        pendingCandidate = null;
      } else {
        var challenger = top;
        var categoryBypass = (CATEGORY_PRIORITY[challenger.category] || 0) > (CATEGORY_PRIORITY[active.category] || 0);
        var pastHold = now - activeSince >= MIN_ACTIVE_HOLD_MS;
        var overMargin = challenger.confidence >= active.confidence + REPLACEMENT_MARGIN - CONFIDENCE_EPSILON;
        if (categoryBypass || (pastHold && overMargin)) {
          active = challenger;
          activeSince = now;
          clearCount = 0;
          pendingId = null;
          pendingCount = 0;
          pendingCandidate = null;
        }
        // Otherwise keep the current active — the pending counters above
        // already carried the challenger's persistence credit forward.
      }
    }

    var newActiveId = active ? active.id : null;
    var acknowledgedId = newActiveId === prevActiveId ? state.acknowledgedId : null;

    return {
      active: active,
      activeSince: activeSince,
      pendingId: pendingId,
      pendingCount: pendingCount,
      pendingCandidate: pendingCandidate,
      clearCount: clearCount,
      cooldowns: cooldowns,
      acknowledgedId: acknowledgedId,
      snoozeUntil: snoozeUntil,
      dismissed: dismissed,
      observing: observing,
    };
  }

  /** Engineer control over the active coaching card (#613). Every reducer
   *  returns a brand-new state object and never mutates `prev` (including
   *  `prev.cooldowns`/`prev.dismissed`); no reducer calls Date.now() — `now`
   *  is always the caller's injected clock reading. A click on a card that
   *  just resolved (no `state.active`) is a no-op, not a crash. */

  /** Marks the active candidate as seen — stops the repeated attention cue.
   *  No-op (unchanged copy) when there is no active candidate. */
  function acknowledgeCoaching(state) {
    if (!state || !state.active) return Object.assign({}, state);
    return Object.assign({}, state, { acknowledgedId: state.active.id });
  }

  /** Hides ordinary coaching for SNOOZE_MS. A panel-level action — allowed
   *  even with no active card — so monitoring and the state machine keep
   *  running underneath; only the view hides ordinary cards. */
  function snoozeCoaching(state, now) {
    return Object.assign({}, state, { snoozeUntil: now + SNOOZE_MS });
  }

  /** Ends a snooze early. */
  function resumeCoaching(state) {
    return Object.assign({}, state, { snoozeUntil: null });
  }

  /** Suppresses the active candidate for the rest of the session unless it
   *  gets materially worse (DISMISS_ESCALATION_DB), and clears the active
   *  card plus its pending counters so the machine cannot re-promote it on
   *  the very next window. No-op when there is no active candidate. */
  function dismissCoaching(state, now) {
    if (!state || !state.active) return Object.assign({}, state);
    var severityDb = isFinite(state.active.severityDb) ? state.active.severityDb : 0;
    var dismissed = Object.assign({}, state.dismissed);
    dismissed[state.active.id] = { severityDb: severityDb, at: now };
    return Object.assign({}, state, {
      active: null,
      activeSince: null,
      acknowledgedId: null,
      pendingId: null,
      pendingCount: 0,
      pendingCandidate: null,
      clearCount: 0,
      dismissed: dismissed,
    });
  }

  /** Records the active candidate's before-state and opens an
   *  OBSERVATION_WINDOW_MS window on it. Keeps `active` so the card stays on
   *  screen while being observed; also acknowledges it — trying it implies
   *  seeing it. No-op when there is no active candidate. */
  function markTriedCoaching(state, now) {
    if (!state || !state.active) return Object.assign({}, state);
    var active = state.active;
    return Object.assign({}, state, {
      acknowledgedId: active.id,
      observing: {
        id: active.id,
        title: active.title,
        category: active.category,
        scope: active.scope,
        before: { severityDb: active.severityDb, confidence: active.confidence },
        startedAt: now,
        until: now + OBSERVATION_WINDOW_MS,
      },
    });
  }

  /** The render-time truth derived from a coaching state (#613): the
   *  candidate to show (or null while snoozed, unless its category bypasses
   *  the snooze), whether it's acknowledged, and the active observation
   *  window, if any. Null/garbage `state` yields the same shape with
   *  `candidate: null` and everything else falsy/0. */
  function coachingView(state, now) {
    var s = state && typeof state === 'object' ? state : {};
    var snoozed = s.snoozeUntil != null && s.snoozeUntil > now;
    var candidate = s.active || null;
    if (candidate && snoozed && !SNOOZE_BYPASS_CATEGORIES[candidate.category]) candidate = null;
    var snoozeRemainingMs = snoozed ? s.snoozeUntil - now : 0;
    var acknowledged = !!candidate && s.acknowledgedId === candidate.id;
    var observing = (s.observing && candidate && s.observing.id === candidate.id && s.observing.until > now) ? s.observing : null;
    return {
      candidate: candidate,
      snoozed: snoozed,
      snoozeRemainingMs: snoozeRemainingMs,
      acknowledged: acknowledged,
      observing: observing,
    };
  }

  /** The one coaching card's markup, or the monitoring state when `candidate`
   *  is null. `focusName` is the focused input's display name (may be
   *  null/absent) — escaped since it's a user-editable label. Candidate
   *  title/why/action/detail are module-owned literals, emitted as-is like
   *  the existing candidate markup. The optional third `view` (#613,
   *  coachingView()'s return shape) adds the disposition actions and
   *  attention cue; omitting it (every pre-#613 caller) emits byte-identical
   *  markup to before. */
  function coachingCardHTML(candidate, focusName, view) {
    if (!candidate) {
      if (view && view.snoozed) {
        var minutes = Math.max(1, Math.ceil(view.snoozeRemainingMs / MS_PER_MINUTE));
        return '<div class="lap-card lap-card-snoozed" role="note">'
          + '<span class="lap-card-label">Top suggestion <span class="lap-flag">Experimental · Advisory</span></span>'
          + '<p class="lap-empty">Coaching snoozed — still listening. Suggestions resume in ' + minutes + ' min.</p>'
          + '<div class="lap-card-actions"><button type="button" class="lap-action" data-lap-action="resume">Resume coaching</button></div>'
          + '</div>';
      }
      return '<div class="lap-card lap-card-monitoring" role="note">'
        + '<span class="lap-card-label">Top suggestion <span class="lap-flag">Experimental · Advisory</span></span>'
        + '<p class="lap-empty">Monitoring — not enough evidence to advise yet. Sound Buddy will surface one suggestion when it is confident.</p>'
        + '</div>';
    }
    var scopeText;
    if (candidate.scope === 'mix') {
      scopeText = 'Overall mix';
    } else if (focusName) {
      scopeText = 'Focused input: ' + escapeText(focusName);
    } else {
      scopeText = 'Focused input';
    }

    var acknowledged = !!(view && view.acknowledged);
    var cardClass = 'lap-card';
    var cueHTML = '';
    if (view && !acknowledged) {
      cardClass += ' lap-card-attention';
      cueHTML = ' <span class="lap-card-cue">New</span>';
    }

    var observingHTML = '';
    var actionsHTML = '';
    if (view && view.observing) {
      observingHTML = '<p class="lap-card-observing" role="status">Checking the result — watching the next minute of audio.</p>';
      actionsHTML = '<div class="lap-card-actions">'
        + '<button type="button" class="lap-action" data-lap-action="snooze">Snooze 5 min</button>'
        + '<button type="button" class="lap-action" data-lap-action="dismiss">Dismiss</button>'
        + '</div>';
    } else if (view) {
      var ackClass = acknowledged ? 'lap-action lap-action-on' : 'lap-action';
      var ackAttr = acknowledged ? ' aria-pressed="true"' : '';
      actionsHTML = '<div class="lap-card-actions">'
        + '<button type="button" class="' + ackClass + '"' + ackAttr + ' data-lap-action="acknowledge">Got it</button>'
        + '<button type="button" class="lap-action" data-lap-action="tried">I tried this</button>'
        + '<button type="button" class="lap-action" data-lap-action="snooze">Snooze 5 min</button>'
        + '<button type="button" class="lap-action" data-lap-action="dismiss">Dismiss</button>'
        + '</div>';
    }

    return '<div class="' + cardClass + '" role="note" data-candidate-id="' + candidate.id + '">'
      + '<span class="lap-card-label">Top suggestion <span class="lap-flag">Experimental · Advisory</span>' + cueHTML + '</span>'
      + '<span class="lap-card-title">' + candidate.title + '</span>'
      + '<p class="lap-card-why"><span class="lap-card-key">Why it matters:</span> ' + candidate.why + '</p>'
      + '<p class="lap-card-action"><span class="lap-card-key">One thing to consider:</span> ' + candidate.action + '</p>'
      + '<p class="lap-card-meta"><span class="lap-card-scope">' + scopeText + '</span> · <span class="lap-card-confidence">Confidence: ' + confidenceLabel(candidate.confidence) + '</span></p>'
      + observingHTML
      + actionsHTML
      + '<p class="lap-card-advisory">Advisory only — Sound Buddy never changes your console.</p>'
      + '</div>';
  }

  /** The focused input entry from focusView (#525's { index, name, profile }
   *  shape), or null when there is none — the lookup focusHTML and panelHTML
   *  both need, factored out so they can't drift apart. */
  function focusedInput(focusView) {
    if (!focusView || !focusView.inputs || focusView.inputs.length === 0) return null;
    var inputs = focusView.inputs;
    var focusedIndex = focusView.focusedIndex == null ? null : focusView.focusedIndex;
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].index === focusedIndex) return inputs[i];
    }
    return null;
  }

  /** The panel's markup, or '' when it shouldn't render. Renders a waiting
   *  state until enough live analysis windows have accumulated, then the
   *  derived overall-mix adjustment candidates (or a steady-state message
   *  when none trigger). `windows`/`measurementSource` are optional — omitting
   *  them (legacy callers) behaves as not-enough-data. The optional
   *  `focusView` (#525) is `{ inputs: [{ index, name, profile }], focusedIndex
   *  }` — when absent, or when `inputs` is empty, output is byte-identical to
   *  the pre-#525 shape. The optional `coaching` (#612) is an
   *  advanceCoaching() state object — when given, its `active` candidate (or
   *  none) is the card shown, so the card reflects the stability rules rather
   *  than the per-render winner; omitting it keeps the pre-#612 per-render
   *  selection so every existing caller stays byte-identical. */
  function panelHTML(settings, mode, windows, measurementSource, focusView, coaching, now) {
    if (!showPanel(settings, mode)) return '';
    var mixCands = mixCandidates(windows, measurementSource);
    var body;
    if (!hasEnoughData(windows, measurementSource)) {
      body = '<p class="lap-empty">Listening… collecting live analysis data. Candidates appear after a few analysis windows.</p>';
    } else if (mixCands.length === 0) {
      body = '<p class="lap-empty">Mix balance looks steady — nothing to try right now.</p>';
    } else {
      var items = mixCands.map(function (c) {
        return '<li class="lap-candidate"><span class="lap-cand-title">' + c.title + '</span> '
          + '<span class="lap-cand-detail">' + c.detail + '</span></li>';
      }).join('');
      body = '<p class="lap-note">Overall mix candidates — suggestions to consider, not instructions:</p>'
        + '<ul class="lap-candidates">' + items + '</ul>';
    }

    var focused = focusedInput(focusView);
    var card;
    if (coaching && typeof coaching === 'object' && typeof now === 'number') {
      var view = coachingView(coaching, now);
      card = coachingCardHTML(view.candidate, focused && focused.name, view);
    } else if (coaching && typeof coaching === 'object') {
      card = coachingCardHTML(coaching.active, focused && focused.name);
    } else {
      card = coachingCardHTML(selectCoachingCandidate(allCoachingCandidates(windows, measurementSource, focusView)), focused && focused.name);
    }

    return '<div class="live-adjustments-panel" role="note">'
      + '<span class="lap-title">Live adjustments <span class="lap-flag">Experimental</span></span>'
      + card
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

    var focused = focusedInput(focusView);

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
    clipCandidates: clipCandidates,
    candidateConfidence: candidateConfidence,
    confidenceLabel: confidenceLabel,
    rankCandidates: rankCandidates,
    selectCoachingCandidate: selectCoachingCandidate,
    coachingCardHTML: coachingCardHTML,
    MIN_CONFIDENCE: MIN_CONFIDENCE,
    HIGH_CONFIDENCE: HIGH_CONFIDENCE,
    CATEGORY_PRIORITY: CATEGORY_PRIORITY,
    CLIP_RISK_PEAK_DBFS: CLIP_RISK_PEAK_DBFS,
    CONFIDENCE_FULL_WINDOWS: CONFIDENCE_FULL_WINDOWS,
    createCoachingState: createCoachingState,
    advanceCoaching: advanceCoaching,
    allCoachingCandidates: allCoachingCandidates,
    PERSISTENCE_WINDOWS: PERSISTENCE_WINDOWS,
    RETAIN_CONFIDENCE: RETAIN_CONFIDENCE,
    RECOVERY_WINDOWS: RECOVERY_WINDOWS,
    REPLACEMENT_MARGIN: REPLACEMENT_MARGIN,
    MIN_ACTIVE_HOLD_MS: MIN_ACTIVE_HOLD_MS,
    COOLDOWN_MS: COOLDOWN_MS,
    OPPOSITE_IDS: OPPOSITE_IDS,
    acknowledgeCoaching: acknowledgeCoaching,
    snoozeCoaching: snoozeCoaching,
    resumeCoaching: resumeCoaching,
    dismissCoaching: dismissCoaching,
    markTriedCoaching: markTriedCoaching,
    coachingView: coachingView,
    SNOOZE_MS: SNOOZE_MS,
    DISMISS_ESCALATION_DB: DISMISS_ESCALATION_DB,
    OBSERVATION_WINDOW_MS: OBSERVATION_WINDOW_MS,
    SNOOZE_BYPASS_CATEGORIES: SNOOZE_BYPASS_CATEGORIES,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.liveAdjustmentsState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
