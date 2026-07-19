// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, framework-free playhead state for the experimental DAW-style Live
// workspace shell (#517, epic #515). DOM-free so it's unit-testable,
// mirroring daw-workspace-state.js. Read off window.dawPlayheadState. The
// clock is injected as a `nowMs` parameter rather than read internally
// (Architecture standard: side effects injected), so this stays wall-clock
// time-based, not sample-accurate, per #518's INVEST framing.
(function (root) {
  'use strict';

  /** A fresh playhead started at nowMs. Starting again replaces the old
   *  state, which is what resets the playhead to zero for a new capture. */
  function start(nowMs) {
    return { startedAtMs: nowMs, stoppedAtMs: null };
  }

  /** Freeze the playhead. Null-safe; freezing an already-stopped playhead
   *  keeps the original stop time (stopLive can run on the failed-Start path). */
  function stop(state, nowMs) {
    if (!state) return null;
    if (state.stoppedAtMs !== null) return state;
    return { startedAtMs: state.startedAtMs, stoppedAtMs: nowMs };
  }

  /** Whether the playhead is currently advancing. */
  function isAdvancing(state) {
    return !!state && state.stoppedAtMs === null;
  }

  /** Elapsed capture time in ms. 0 before any capture; frozen at stop time
   *  once stopped; clamped so a clock skew can never go negative. */
  function elapsedMs(state, nowMs) {
    if (!state) return 0;
    const end = state.stoppedAtMs !== null ? state.stoppedAtMs : nowMs;
    return Math.max(0, end - state.startedAtMs);
  }

  /** M:SS readout, mirroring scTime() in inline-app.js. Non-finite or
   *  negative input renders as 0:00 rather than NaN in the transport. */
  function formatElapsed(ms) {
    let s = ms / 1000;
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec < 10 ? '0' : ''}${sec}`;
  }

  /** Horizontal playhead offset in px, clamped to the timeline width so the
   *  line parks at the right edge instead of walking off-screen. */
  function offsetPx(elapsedMsVal, pxPerSecond, maxPx) {
    return Math.min(maxPx, Math.max(0, (elapsedMsVal / 1000) * pxPerSecond));
  }

  var api = {
    start: start,
    stop: stop,
    isAdvancing: isAdvancing,
    elapsedMs: elapsedMs,
    formatElapsed: formatElapsed,
    offsetPx: offsetPx,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.dawPlayheadState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
