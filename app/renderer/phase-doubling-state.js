// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure logic for the Doubling/Phase Bug Detector guided checklist (#370): a
// static, fully-offline wizard walking a church audio engineer through the
// common routing mistakes that cause a "weird, robotic, doubled" system
// sound (comb filtering from a source summed twice). No console API, no
// routing-matrix access, no audio DSP — the phase-signal heuristic below is
// a lightweight pattern check over the existing ideal-profile deviation
// array. Nothing here touches the DOM or IPC. Loaded via <script src> and
// read off window.phaseDoublingState.
(function (root) {
  'use strict';

  var STEPS = [
    {
      id: 'symptom',
      title: 'Confirm the symptom',
      explanation: 'A hollow, robotic, "underwater" or doubled sound is almost always comb filtering — the same signal reaching the mix twice, slightly offset in time, so some frequencies cancel and others reinforce.',
      resolution: 'If the system sounds thin/phasey rather than just harsh, work through the next steps. If it only sounds harsh or muddy, this checklist is not your problem — use the EQ recommendations instead.',
    },
    {
      id: 'parallel-bus',
      title: 'Parallel or processed bus still in the main mix',
      explanation: 'If a channel is sent to a parallel compression / FX / processed bus AND its dry channel is still up in the main LR, the mix sums two near-identical copies of that source and combs.',
      resolution: 'Pick one path: either pull the dry channel out of LR (send it only to the parallel bus), or remove the parallel bus from LR. Then confirm the bus return is not also assigned to LR a second time.',
    },
    {
      id: 'duplicate-sum',
      title: 'Duplicate bus sums',
      explanation: 'Two buses carrying the same source can both land in LR — for example a subgroup AND its member channels are each assigned directly to the main mix, so every hit plays twice.',
      resolution: 'Assign each source to the group OR to LR — never both. Walk your subgroups and confirm member channels are not also routed straight to the main mix.',
    },
    {
      id: 'matrix',
      title: 'Walk the routing matrix',
      explanation: 'Matrix and aux sends can quietly loop a mix back into itself — an aux fed from LR that then returns to LR, or a matrix output patched back to a main, re-injects a delayed copy of the whole mix.',
      resolution: 'Step through each input\'s direct-out and bus assignments, then each matrix/aux source, and remove any send whose signal path eventually returns to the main LR.',
    },
    {
      id: 'physical',
      title: 'Doubled source before the console',
      explanation: 'Doubling can start before the desk: two mics on one source, a duplicated stem during virtual soundcheck playback, or a monitor / stream feed bleeding back in slightly delayed.',
      resolution: 'Mute one of any pair of mics on the same source (or time-align them), and confirm no playback/monitor path is feeding a second copy of the same audio into the mix.',
    },
    {
      id: 'resolved',
      title: 'Re-check the sound',
      explanation: 'After each change, listen again — comb filtering collapses the moment the duplicate path is gone, so the fix is unmistakable.',
      resolution: 'If it still sounds doubled, the duplicate is elsewhere in the signal chain (stagebox split, DAW, streaming encoder) — trace the source signal end-to-end until you find the second copy.',
    },
  ];

  // detectPhaseSignal thresholds — named per the constitution's no-magic-
  // numbers rule.
  var MIN_BANDS = 6;
  var MIN_DEV_DB = 1.5;
  var EPSILON = 1e-9;
  var MIN_SIGNIFICANT = 4;
  var ALTERNATION_RATIO = 0.6;

  function stepCount() {
    return STEPS.length;
  }

  function clampIndex(i) {
    var n = Math.trunc(Number(i));
    if (!Number.isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > STEPS.length - 1) return STEPS.length - 1;
    return n;
  }

  function isLastStep(i) {
    return clampIndex(i) === STEPS.length - 1;
  }

  function getStep(i) {
    return STEPS[clampIndex(i)];
  }

  // Comb filtering shows up as a regularly alternating over/under pattern
  // across adjacent bands in the ideal-profile deviation curve. Never
  // throws — missing/short/flat/monotonic deviation data all fall through
  // to false.
  function detectPhaseSignal(input) {
    var deviation = input && input.deviation;
    if (!Array.isArray(deviation) || deviation.length < MIN_BANDS) return false;

    var significant = deviation.filter(function (d) {
      return Math.abs(d) >= EPSILON && Math.abs(d) >= MIN_DEV_DB;
    });
    if (significant.length < MIN_SIGNIFICANT) return false;

    var signChanges = 0;
    for (var i = 1; i < significant.length; i++) {
      if ((significant[i] > 0) !== (significant[i - 1] > 0)) signChanges++;
    }
    var pairs = significant.length - 1;
    if (pairs <= 0) return false;

    return (signChanges / pairs) >= ALTERNATION_RATIO;
  }

  // Every interpolated user-facing field routes through the injected
  // escapeHtml, mirroring pass-mode-state.js's reminderHtml — the step
  // content is static today but the discipline guards against future
  // dynamic content.
  function stepHtml(step, index, total, escapeHtml) {
    var s = step || getStep(0);
    return '<div class="pd-counter">Step ' + (index + 1) + ' of ' + total + '</div>' +
      '<div class="pd-title">' + escapeHtml(s.title) + '</div>' +
      '<div class="pd-explanation">' + escapeHtml(s.explanation) + '</div>' +
      '<div class="pd-resolution">' + escapeHtml(s.resolution) + '</div>';
  }

  // Report-card handoff context line (#372): names the analyzed file and
  // whether the deviation curve showed a comb-filter pattern. ctx is
  // { filename, detected } or null — no filename means no card was analyzed
  // (no console/live data, nothing to name).
  function contextLineHtml(ctx, escapeHtml) {
    if (!ctx || typeof ctx.filename !== 'string' || !ctx.filename) return '';
    if (ctx.detected) {
      return '<div class="pd-context detected">From your report card — ' + escapeHtml(ctx.filename) + ': the spectrum shows a comb-filter pattern.</div>';
    }
    return '<div class="pd-context">From your report card — ' + escapeHtml(ctx.filename) + '</div>';
  }

  // No user strings here — nothing to escape.
  function progressDotsHtml(index, total) {
    var active = clampIndex(index);
    var dots = '';
    for (var i = 0; i < total; i++) {
      dots += '<span class="pd-dot' + (i === active ? ' active' : '') + '"></span>';
    }
    return dots;
  }

  var api = {
    STEPS: STEPS,
    stepCount: stepCount,
    clampIndex: clampIndex,
    isLastStep: isLastStep,
    getStep: getStep,
    stepHtml: stepHtml,
    progressDotsHtml: progressDotsHtml,
    detectPhaseSignal: detectPhaseSignal,
    contextLineHtml: contextLineHtml,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.phaseDoublingState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
