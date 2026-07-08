// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure grading engine for the report card (#130): recording-type classification,
// the letter grade, the ring-arc score kept within that grade's band, and the
// prioritised recommendations. Extracted verbatim from the renderer so the
// product's core loop — the grade — is unit-testable (Vitest) yet shared byte
// for byte with the renderer, which loads it via <script src> and reads it off
// window.grading.
//
// Nothing here touches the DOM or IPC — every function is a pure function of the
// report-card source object built by getReportCardSource(). Behaviour is frozen:
// thresholds, rules, and outputs match the pre-extraction inline code exactly.
// Changing any threshold belongs to the config work (#131), not here.

(function (root) {
  'use strict';

  // Band label + frequency metadata used to phrase the "too much energy in X"
  // recommendation. Grading-only — the renderer's own band table lives inline.
  const RC_BAND_INFO = {
    subBass:    { label: 'Sub-bass',   freq: '20-60 Hz' },
    bass:       { label: 'Bass',       freq: '60-250 Hz' },
    lowMid:     { label: 'Low-mid',    freq: '250-500 Hz' },
    mid:        { label: 'Mid',        freq: '500Hz-2kHz' },
    highMid:    { label: 'High-mid',   freq: '2-4kHz' },
    presence:   { label: 'Presence',   freq: '4-6kHz' },
    brilliance: { label: 'Brilliance', freq: '6-20kHz' },
  };

  function bandDiffFromOthers(bands, key) {
    const keys = Object.keys(bands);
    const others = keys.filter(k => k !== key).map(k => bands[k]);
    const avgOthers = others.reduce((a, b) => a + b, 0) / others.length;
    return bands[key] - avgOthers;
  }

  function analyzeRecordingType(src) {
    if (src.clipping || src.peak >= -0.5) return { type: 'clipping', label: 'Clipping', note: 'Signal is clipping. Reduce input gain immediately.', tone: 'issue' };
    if (src.peak > -3 && src.rms > -12) return { type: 'hot', label: 'Hot', note: 'Recording level is very hot. Consider reducing gain.', tone: 'check' };
    if ((src.contentType === 'mixed' || src.contentType === 'music') && src.peak > -12 && src.dynamicRange != null && src.dynamicRange > 15 && src.rms < -25)
      return { type: 'dynamic_service', label: 'Dynamic Service', note: 'Peaks are healthy; quiet sections are lowering whole-file RMS.', tone: 'info' };
    if (src.peak > -15 && src.rms < -30 && src.dynamicRange != null && src.dynamicRange > 15)
      return { type: 'low_gain', label: 'Low Recording Gain', note: 'Mix is fine but USB record level is low. Raise console USB output toward -18 dBFS RMS.', tone: 'check' };
    if (src.peak < -15 && src.rms < -35)
      return { type: 'low_gain', label: 'Low Recording Gain', note: 'Peak and RMS are very low. Increase the USB recording output level.', tone: 'check' };
    if (src.rms < -25) return { type: 'quiet', label: 'Quiet', note: 'Recording is quieter than typical. Consider more gain.', tone: 'check' };
    if (src.rms >= -20 && src.rms <= -10 && src.peak > -6) return { type: 'good', label: 'Good Level', note: 'Recording level is healthy.', tone: 'good' };
    return { type: 'normal', label: 'Normal', note: 'Recording level is within typical range.', tone: 'info' };
  }

  function computeGrade(src) {
    const letters = ['A', 'B', 'C', 'D', 'F'];
    if (src.clipping) return 'F';
    let idx = 0;
    const drop = () => { idx = Math.min(idx + 1, letters.length - 1); };
    const recType = analyzeRecordingType(src);
    if (recType.type === 'low_gain') {
      if (src.dynamicRange != null && src.dynamicRange < 3) drop();
      if (Object.keys(src.bands).some(k => bandDiffFromOthers(src.bands, k) > 15)) drop();
      return letters[idx];
    }
    const rmsExempt = recType.type === 'dynamic_service';
    if (!rmsExempt && (src.rms < -20 || src.rms > -14)) drop();
    if (src.dynamicRange != null && src.dynamicRange < 6) drop();
    if (Object.keys(src.bands).some(k => bandDiffFromOthers(src.bands, k) > 15)) drop();
    return letters[idx];
  }

  // Ring arc score, kept within the letter grade's band so the two agree.
  function computeScore(src) {
    const grade = computeGrade(src);
    const bands = { A: [90, 99], B: [80, 89], C: [70, 79], D: [60, 69], F: [38, 55] };
    let score = 100;
    const rt = analyzeRecordingType(src);
    if (src.clipping) score -= 45;
    if (rt.type !== 'low_gain' && rt.type !== 'dynamic_service') {
      if (src.rms < -20 || src.rms > -14) score -= 9;
      if (src.rms < -25 || src.rms > -10) score -= 7;
    }
    if (src.dynamicRange != null) { if (src.dynamicRange < 3) score -= 15; else if (src.dynamicRange < 6) score -= 8; }
    let maxDiff = 0;
    for (const k of Object.keys(src.bands)) maxDiff = Math.max(maxDiff, bandDiffFromOthers(src.bands, k));
    if (maxDiff > 15) score -= 14; else if (maxDiff > 12) score -= 7;
    const [lo, hi] = bands[grade];
    return Math.round(Math.max(lo, Math.min(hi, score)));
  }

  function computeRecommendations(src) {
    const recs = [];
    const recType = analyzeRecordingType(src);
    if (src.clipping) recs.push('CRITICAL: Clipping detected. Reduce input gain immediately.');
    if (recType.type === 'low_gain' || recType.type === 'dynamic_service') recs.push(recType.note);
    else if (src.rms > -10) recs.push('Your recording is too hot. Reduce gain to avoid clipping.');
    else if (src.rms < -25 && recType.type !== 'low_gain') recs.push('Your recording is too quiet. Increase input gain or fader levels.');
    if (src.dynamicRange != null && src.dynamicRange < 3) recs.push('Dynamic range is very compressed. Mix may sound lifeless.');
    if (src.bands.subBass > -10) recs.push('Too much sub-bass energy. Apply a high-pass filter below 80Hz.');
    for (const k of Object.keys(src.bands)) {
      const diff = bandDiffFromOthers(src.bands, k);
      if (diff > 12) {
        const info = RC_BAND_INFO[k];
        recs.push(`Too much energy in ${info.label} (${info.freq}). Cut ${Math.min(diff, 10).toFixed(1)} dB around this range.`);
      }
    }
    if (src.bands.brilliance < -40) recs.push('Mix lacks air and brightness. Boost 2-3 dB above 8kHz.');
    if (recs.length === 0) recs.push('Great job! No major issues detected — levels and balance are solid.');
    return recs.slice(0, 5);
  }

  var api = {
    RC_BAND_INFO: RC_BAND_INFO,
    bandDiffFromOthers: bandDiffFromOthers,
    analyzeRecordingType: analyzeRecordingType,
    computeGrade: computeGrade,
    computeScore: computeScore,
    computeRecommendations: computeRecommendations,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.grading = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
