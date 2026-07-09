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
// thresholds, rules, and outputs match the pre-extraction inline code exactly —
// with one deliberate exception owned by #131: the RMS status pill's "good"
// window was widened to the grade's full acceptable band, so a passing grade no
// longer shows a non-"good" RMS pill (see CONFIG.rms and rcRmsStatus).

(function (root) {
  'use strict';

  // #131 — the single source of truth for the grading thresholds shared by the
  // letter grade, the ring score, and the report-card status pills, so each of
  // those numbers lives in exactly one place. Change a value and both the grade
  // and its matching pill move together (proven by grading.test.js). Copy-only
  // recommendation cutoffs (e.g. the sub-bass / brilliance advice wording) stay
  // inline in computeRecommendations — they shape phrasing, not the grade or the
  // pills, and reconciling them is out of scope for #131.
  const CONFIG = {
    // RMS "average level" in dBFS. [acceptableMin, acceptableMax] is the band
    // the grade treats as passing (no deduction); the pill calls it "good".
    // Outside that band but within [quietEdge, hotEdge] is a single-tier miss
    // (grade drops one letter, pill says "check"); beyond the edges is worse
    // (extra score penalty, pill says "issue"). These tiers are what keep the
    // pill and the grade agreeing in direction.
    rms: { acceptableMin: -20, acceptableMax: -14, quietEdge: -25, hotEdge: -10 },
    // Sample peak in dBFS. Above issueAbove reads as clipping-adjacent ("issue");
    // above checkAbove is hot but usable ("check"); otherwise "good".
    peak: { issueAbove: -1, checkAbove: -3 },
    // Dynamic range in dB. >= good is healthy; >= check is compressed-but-okay;
    // below check is very compressed (grade drops, pill says "issue").
    dynamicRange: { good: 6, check: 3 },
    // Per-band level vs. the mean of the other bands, in dB. hotDiff is the
    // recommendation/score threshold; severeHotDiff drops the letter grade;
    // quietDiff flags a band sitting well below the others in the UI.
    bandBalance: { hotDiff: 12, severeHotDiff: 15, quietDiff: -15 },
    // Spectral centroid in Hz — the "good" tonal-balance window for the pill.
    centroid: { min: 500, max: 4000 },
  };

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
    if (src.rms >= CONFIG.rms.acceptableMin && src.rms <= CONFIG.rms.hotEdge && src.peak > -6) return { type: 'good', label: 'Good Level', note: 'Recording level is healthy.', tone: 'good' };
    return { type: 'normal', label: 'Normal', note: 'Recording level is within typical range.', tone: 'info' };
  }

  function computeGrade(src) {
    const letters = ['A', 'B', 'C', 'D', 'F'];
    if (src.clipping) return 'F';
    let idx = 0;
    const drop = () => { idx = Math.min(idx + 1, letters.length - 1); };
    const recType = analyzeRecordingType(src);
    if (recType.type === 'low_gain') {
      if (src.dynamicRange != null && src.dynamicRange < CONFIG.dynamicRange.check) drop();
      if (Object.keys(src.bands).some(k => bandDiffFromOthers(src.bands, k) > CONFIG.bandBalance.severeHotDiff)) drop();
      return letters[idx];
    }
    const rmsExempt = recType.type === 'dynamic_service';
    if (!rmsExempt && (src.rms < CONFIG.rms.acceptableMin || src.rms > CONFIG.rms.acceptableMax)) drop();
    if (src.dynamicRange != null && src.dynamicRange < CONFIG.dynamicRange.good) drop();
    if (Object.keys(src.bands).some(k => bandDiffFromOthers(src.bands, k) > CONFIG.bandBalance.severeHotDiff)) drop();
    return letters[idx];
  }

  // #133 — the per-deduction breakdown behind the letter grade. explainGrade
  // walks the EXACT same rules as computeGrade, in the same order, and records
  // one entry per rule that fired: the rule, the measured value, the config
  // target it missed, and its impact on the letter. This is the data the report
  // card's "Why this grade" section renders, turning an opaque letter into an
  // auditable list. Invariant: the deductions returned here are precisely the
  // rules computeGrade deducted for — same guards, same order — so the breakdown
  // can never claim a deduction the grade didn't take (or omit one it did).
  // Every target string is read from CONFIG (single source, #131), so moving a
  // threshold moves both the grade and the reason shown for it. Returns
  // { grade, clipping, deductions } where deductions is a deterministic list for
  // a fixed input; an empty list is the honest "no deductions" (clean) state.
  function explainGrade(src) {
    // Clipping short-circuits to an automatic F with a single clipping
    // deduction — mirroring computeGrade's src.clipping early return, which
    // never evaluates the other rules. The breakdown reflects that exactly.
    if (src.clipping) {
      return {
        grade: 'F',
        clipping: true,
        deductions: [{
          rule: 'Clipping',
          measured: 'Clipping detected',
          target: 'No clipping',
          letterImpact: 'Automatic F',
        }],
      };
    }

    const deductions = [];
    const recType = analyzeRecordingType(src);
    const maxBandDiff = Object.keys(src.bands).reduce(
      (m, k) => Math.max(m, bandDiffFromOthers(src.bands, k)), 0,
    );
    const bandImbalanceDeduction = () => ({
      rule: 'Band imbalance',
      measured: '+' + maxBandDiff.toFixed(1) + ' dB',
      target: '≤ +' + CONFIG.bandBalance.severeHotDiff + ' dB vs. other bands',
      letterImpact: 'Drops one letter',
    });

    if (recType.type === 'low_gain') {
      // Low-gain takes carry their own rule set (RMS ignored, DR floor relaxed
      // to the "check" threshold), matching computeGrade's low_gain branch.
      if (src.dynamicRange != null && src.dynamicRange < CONFIG.dynamicRange.check) {
        deductions.push({
          rule: 'Dynamic range too low',
          measured: src.dynamicRange.toFixed(1) + ' dB',
          target: '≥ ' + CONFIG.dynamicRange.check + ' dB',
          letterImpact: 'Drops one letter',
        });
      }
      if (maxBandDiff > CONFIG.bandBalance.severeHotDiff) deductions.push(bandImbalanceDeduction());
      return { grade: computeGrade(src), clipping: false, deductions };
    }

    // Dynamic-service recordings are RMS-exempt (a quiet whole-file RMS is
    // expected when peaks are healthy), matching computeGrade's rmsExempt.
    const rmsExempt = recType.type === 'dynamic_service';
    if (!rmsExempt && (src.rms < CONFIG.rms.acceptableMin || src.rms > CONFIG.rms.acceptableMax)) {
      deductions.push({
        rule: 'RMS out of band',
        measured: src.rms.toFixed(1) + ' dBFS',
        target: rcMetricTarget('rms'),
        letterImpact: 'Drops one letter',
      });
    }
    if (src.dynamicRange != null && src.dynamicRange < CONFIG.dynamicRange.good) {
      deductions.push({
        rule: 'Dynamic range too low',
        measured: src.dynamicRange.toFixed(1) + ' dB',
        target: '≥ ' + CONFIG.dynamicRange.good + ' dB',
        letterImpact: 'Drops one letter',
      });
    }
    if (maxBandDiff > CONFIG.bandBalance.severeHotDiff) deductions.push(bandImbalanceDeduction());

    return { grade: computeGrade(src), clipping: false, deductions };
  }

  // Ring arc score, kept within the letter grade's band so the two agree.
  function computeScore(src) {
    const grade = computeGrade(src);
    const bands = { A: [90, 99], B: [80, 89], C: [70, 79], D: [60, 69], F: [38, 55] };
    let score = 100;
    const rt = analyzeRecordingType(src);
    if (src.clipping) score -= 45;
    if (rt.type !== 'low_gain' && rt.type !== 'dynamic_service') {
      if (src.rms < CONFIG.rms.acceptableMin || src.rms > CONFIG.rms.acceptableMax) score -= 9;
      if (src.rms < CONFIG.rms.quietEdge || src.rms > CONFIG.rms.hotEdge) score -= 7;
    }
    if (src.dynamicRange != null) { if (src.dynamicRange < CONFIG.dynamicRange.check) score -= 15; else if (src.dynamicRange < CONFIG.dynamicRange.good) score -= 8; }
    let maxDiff = 0;
    for (const k of Object.keys(src.bands)) maxDiff = Math.max(maxDiff, bandDiffFromOthers(src.bands, k));
    if (maxDiff > CONFIG.bandBalance.severeHotDiff) score -= 14; else if (maxDiff > CONFIG.bandBalance.hotDiff) score -= 7;
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
    if (src.dynamicRange != null && src.dynamicRange < CONFIG.dynamicRange.check) recs.push('Dynamic range is very compressed. Mix may sound lifeless.');
    if (src.bands.subBass > -10) recs.push('Too much sub-bass energy. Apply a high-pass filter below 80Hz.');
    for (const k of Object.keys(src.bands)) {
      const diff = bandDiffFromOthers(src.bands, k);
      if (diff > CONFIG.bandBalance.hotDiff) {
        const info = RC_BAND_INFO[k];
        recs.push(`Too much energy in ${info.label} (${info.freq}). Cut ${Math.min(diff, 10).toFixed(1)} dB around this range.`);
      }
    }
    if (src.bands.brilliance < -40) recs.push('Mix lacks air and brightness. Boost 2-3 dB above 8kHz.');
    if (recs.length === 0) recs.push('Great job! No major issues detected — levels and balance are solid.');
    return recs.slice(0, 5);
  }

  // Report-card metric status pills. rcRmsStatus shares the RMS band with the
  // grade so the two never contradict: the acceptable band the grade treats as
  // passing reads "good"; any level the grade deducts for (out of band) reads
  // "issue" — mirroring the grade's single in-band / out-of-band RMS test.
  // Before #131 the pill's "good" window (-18..-16) was narrower than the
  // grade's acceptable band, so a passing grade could still show a yellow pill;
  // that is the visible contradiction this issue resolves. We keep the pill a
  // faithful two-way mirror of the grade rather than adding an intermediate
  // "check" tier, so no previously-flagged level is silently downgraded.
  function rcRmsStatus(rms) {
    const c = CONFIG.rms;
    if (rms >= c.acceptableMin && rms <= c.acceptableMax) return 'good';
    return 'issue';
  }

  function rcPeakStatus(peak, clipping) {
    const c = CONFIG.peak;
    if (clipping || peak > c.issueAbove) return 'issue';
    if (peak > c.checkAbove) return 'check';
    return 'good';
  }

  function rcDrStatus(dr) {
    const c = CONFIG.dynamicRange;
    if (dr == null) return 'check';
    if (dr >= c.good) return 'good';
    if (dr >= c.check) return 'check';
    return 'issue';
  }

  function rcCentroidStatus(centroid) {
    const c = CONFIG.centroid;
    if (!centroid) return 'check';
    if (centroid >= c.min && centroid <= c.max) return 'good';
    return 'check';
  }

  // #132 — the config-derived "good" target shown beside each measured metric on
  // the report card, turning an opaque pill into an actionable one. Every string
  // is read from CONFIG (never hardcoded in the renderer): change a threshold and
  // the target text moves with the grade and its pill. The bounds mirror exactly
  // what each pill classifier above treats as "good": the RMS acceptable band,
  // the peak's "check" ceiling, the DR "good" floor, and the centroid window.
  // Metrics with no target in CONFIG (e.g. Clipping) return null, so the card
  // shows an explicit "—" rather than a fabricated range.
  function rcMetricTarget(key) {
    const c = CONFIG;
    switch (key) {
      case 'peak':         return '≤ ' + c.peak.checkAbove + ' dBFS';
      case 'rms':          return c.rms.acceptableMin + ' to ' + c.rms.acceptableMax + ' dBFS';
      case 'dynamicRange': return '≥ ' + c.dynamicRange.good + ' dB';
      case 'centroid':     return c.centroid.min.toLocaleString() + ' to ' + c.centroid.max.toLocaleString() + ' Hz';
      default:             return null;
    }
  }

  var api = {
    CONFIG: CONFIG,
    RC_BAND_INFO: RC_BAND_INFO,
    bandDiffFromOthers: bandDiffFromOthers,
    analyzeRecordingType: analyzeRecordingType,
    computeGrade: computeGrade,
    explainGrade: explainGrade,
    computeScore: computeScore,
    computeRecommendations: computeRecommendations,
    rcRmsStatus: rcRmsStatus,
    rcPeakStatus: rcPeakStatus,
    rcDrStatus: rcDrStatus,
    rcCentroidStatus: rcCentroidStatus,
    rcMetricTarget: rcMetricTarget,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.grading = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
