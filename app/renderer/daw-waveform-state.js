// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, framework-free mix-waveform state for the experimental DAW-style Live
// workspace shell (#520, epic #515). DOM-free so it's unit-testable, mirroring
// daw-playhead-state.js. Read off window.dawWaveformState. Decodes the
// {"type":"peaks", ...} NDJSON frames stream.py emits per ADR 0004
// (docs/adr/0004-waveform-peak-transport.md) and accumulates them into a
// drawable peak envelope.
(function (root) {
  'use strict';

  // Must match stream.py's WAVEFORM_BUCKETS_PER_SEC (ADR 0004) — the
  // renderer-side default bucket rate before a capture reports its own
  // meter interval via bucketsPerSecond().
  var WAVEFORM_BUCKETS_PER_SEC = 50;
  // Must match stream.py's QUANT_LEVELS (ADR 0004) — u8 quantization of a
  // peak value in [-1.0, 1.0].
  var QUANT_LEVELS = 256;
  // Bounds memory on marathon captures (30 minutes at the nominal bucket
  // rate); the playhead parks at the timeline's right edge far earlier, so
  // buckets past this cap are never drawable anyway.
  var MAX_WAVEFORM_BUCKETS = WAVEFORM_BUCKETS_PER_SEC * 60 * 30;

  /** A fresh, empty waveform state. Assigning a fresh state on capture start
   *  is the reset. */
  function create() {
    return { pairs: [] };
  }

  /** Decode the "mix" lane of a parsed peaks event into an array of
   *  {min, max} pairs in [-1, 1]. Null-safe: returns null for a
   *  missing/malformed frame, missing lanes, no mix lane, or empty/undecodable
   *  data — a truncated NDJSON line must not throw in the event handler. */
  function decodeMixLane(frame) {
    if (!frame || !Array.isArray(frame.lanes)) return null;
    var mixLane = null;
    for (var i = 0; i < frame.lanes.length; i++) {
      if (frame.lanes[i] && frame.lanes[i].id === 'mix') { mixLane = frame.lanes[i]; break; }
    }
    if (!mixLane || typeof mixLane.data !== 'string' || mixLane.data.length === 0) return null;

    var binary;
    try {
      binary = atob(mixLane.data);
    } catch (_e) {
      return null;
    }
    if (binary.length === 0 || binary.length % 2 !== 0) return null;

    var pairs = [];
    for (var j = 0; j < binary.length; j += 2) {
      var minLevel = binary.charCodeAt(j);
      var maxLevel = binary.charCodeAt(j + 1);
      pairs.push({
        min: (minLevel / (QUANT_LEVELS - 1)) * 2 - 1,
        max: (maxLevel / (QUANT_LEVELS - 1)) * 2 - 1,
      });
    }
    return pairs;
  }

  /** A new state with `pairs` appended, truncated so pairs.length never
   *  exceeds MAX_WAVEFORM_BUCKETS. Stops appending past the cap — never
   *  drops from the front, which would desync the playhead alignment. */
  function append(state, pairs) {
    var base = state && Array.isArray(state.pairs) ? state.pairs : [];
    if (base.length >= MAX_WAVEFORM_BUCKETS) return { pairs: base };
    var room = MAX_WAVEFORM_BUCKETS - base.length;
    var toAdd = pairs.length > room ? pairs.slice(0, room) : pairs;
    return { pairs: base.concat(toAdd) };
  }

  /** Python's round() breaks exact .5 ties to the nearest even integer
   *  (banker's rounding), unlike Math.round's round-half-up. stream.py's
   *  n_buckets uses Python round(), so this mirror must match it exactly at
   *  those ties or waveform x-positions drift out of alignment with the
   *  playhead at meter intervals like 0.25s/0.05s (ADR 0004). */
  function roundHalfEven(value) {
    var floor = Math.floor(value);
    var diff = value - floor;
    if (diff < 0.5) return floor;
    if (diff > 0.5) return floor + 1;
    return floor % 2 === 0 ? floor : floor + 1;
  }

  /** Renderer-side mirror of stream.py's n_buckets formula, so waveform
   *  x-positions stay aligned to the playhead at any meter interval (e.g.
   *  250ms -> 48 buckets/sec, not an assumed 50). Guards non-finite/<=0
   *  input by returning WAVEFORM_BUCKETS_PER_SEC. */
  function bucketsPerSecond(intervalSecs) {
    if (!isFinite(intervalSecs) || intervalSecs <= 0) return WAVEFORM_BUCKETS_PER_SEC;
    return Math.max(1, roundHalfEven(WAVEFORM_BUCKETS_PER_SEC * intervalSecs)) / intervalSecs;
  }

  /** Per-pixel-column {min, max} aggregates for drawing: column x covers
   *  buckets [x * bucketsPerSec / pxPerSecond, (x+1) * ...), aggregating
   *  min-of-mins/max-of-maxes. Returns at most Math.floor(maxPx) columns and
   *  stops at the last bucket. Pure geometry. */
  function columnPeaks(pairs, bucketsPerSec, pxPerSecond, maxPx) {
    if (!pairs || pairs.length === 0) return [];
    var bucketsPerPx = bucketsPerSec / pxPerSecond;
    var totalCols = Math.floor(maxPx);
    var out = [];
    for (var x = 0; x < totalCols; x++) {
      var startBucket = x * bucketsPerPx;
      if (startBucket >= pairs.length) break;
      var endBucket = Math.min(pairs.length, (x + 1) * bucketsPerPx);
      var startIdx = Math.floor(startBucket);
      var endIdx = Math.max(startIdx + 1, Math.ceil(endBucket));
      var min = Infinity;
      var max = -Infinity;
      for (var i = startIdx; i < endIdx && i < pairs.length; i++) {
        if (pairs[i].min < min) min = pairs[i].min;
        if (pairs[i].max > max) max = pairs[i].max;
      }
      if (min === Infinity) { min = 0; max = 0; }
      out.push({ min: min, max: max });
    }
    return out;
  }

  /** Drives the mix lane's visual monitoring/recording marker (companion to
   *  dawWorkspaceState.transportLabel). */
  function captureModeToken(liveRunning, liveMode) {
    if (!liveRunning) return 'stopped';
    return liveMode === 'record' ? 'recording' : 'monitoring';
  }

  var api = {
    WAVEFORM_BUCKETS_PER_SEC: WAVEFORM_BUCKETS_PER_SEC,
    QUANT_LEVELS: QUANT_LEVELS,
    MAX_WAVEFORM_BUCKETS: MAX_WAVEFORM_BUCKETS,
    create: create,
    decodeMixLane: decodeMixLane,
    append: append,
    bucketsPerSecond: bucketsPerSecond,
    columnPeaks: columnPeaks,
    captureModeToken: captureModeToken,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.dawWaveformState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
