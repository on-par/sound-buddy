// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, framework-free gate for promoting a running Live-tab monitor session
// into a recording in place (#458). Today the Monitor<->Record segmented
// toggle and every config control freeze the moment capture starts, so
// switching to Record requires a full stop/reconfigure/restart — this module
// models the combined capture phase (idle/monitoring/starting-record/
// recording) from the existing liveRunning/liveMode runtime flags plus one
// new transient "promoting" flag, so the transport UI and the promotion
// guard can never diverge. No DOM, no globals. Loaded via <script src> and
// read off window.liveTransitionState.
(function (root) {
  'use strict';

  var PHASE_IDLE = 'idle';
  var PHASE_MONITORING = 'monitoring';
  var PHASE_STARTING_RECORD = 'starting-record';
  var PHASE_RECORDING = 'recording';

  var INDICATOR_REC = { text: 'REC', recording: true };
  var INDICATOR_LIVE = { text: 'LIVE', recording: false };
  var INDICATOR_NONE = { text: '', recording: false };

  var RECORD_BTN_LABEL = 'Start Recording';
  var RECORD_BTN_LABEL_STARTING = 'Starting…';

  var REASON_NOT_MONITORING = 'Recording can only start from an active monitor session.';
  var REASON_NOTHING_ARMED = 'Arm at least one strip to record.';

  /** Combined capture phase from the runtime's raw flags. */
  function capturePhase(view) {
    var liveRunning = !!(view && view.liveRunning);
    if (!liveRunning) return PHASE_IDLE;
    if (view && view.promoting) return PHASE_STARTING_RECORD;
    if (view && view.liveMode === 'record') return PHASE_RECORDING;
    return PHASE_MONITORING;
  }

  /** Header #live-indicator text + recording-styling flag for a phase. */
  function captureIndicator(phase) {
    if (phase === PHASE_RECORDING || phase === PHASE_STARTING_RECORD) return INDICATOR_REC;
    if (phase === PHASE_MONITORING) return INDICATOR_LIVE;
    return INDICATOR_NONE;
  }

  /** Visibility/label for the new #live-record-btn transport control. */
  function recordButtonView(phase) {
    if (phase === PHASE_MONITORING) return { visible: true, disabled: false, label: RECORD_BTN_LABEL };
    if (phase === PHASE_STARTING_RECORD) return { visible: true, disabled: true, label: RECORD_BTN_LABEL_STARTING };
    return { visible: false, disabled: true, label: RECORD_BTN_LABEL };
  }

  /** #live-status text for a phase, interpolating the meter rate where relevant. */
  function statusLabel(phase, meterRate) {
    if (phase === PHASE_RECORDING) return 'Recording · meters ' + meterRate + '/s';
    if (phase === PHASE_STARTING_RECORD) return 'Starting recording…';
    if (phase === PHASE_MONITORING) return 'Monitoring · meters ' + meterRate + '/s';
    return '';
  }

  /**
   * Guard for promoting a running monitor session to recording. Only ok while
   * actively monitoring (not idle, not already recording, not mid-promotion)
   * and at least one strip is armed. Reasons are actionable, user-facing text.
   */
  function canPromoteToRecording(view) {
    var liveRunning = !!(view && view.liveRunning);
    var liveMode = view && view.liveMode;
    var promoting = !!(view && view.promoting);
    var armedCount = (view && view.armedCount) || 0;

    if (!liveRunning || liveMode !== 'monitor' || promoting) {
      return { ok: false, reason: REASON_NOT_MONITORING };
    }
    if (armedCount === 0) {
      return { ok: false, reason: REASON_NOTHING_ARMED };
    }
    return { ok: true, reason: null };
  }

  var api = {
    capturePhase: capturePhase,
    captureIndicator: captureIndicator,
    recordButtonView: recordButtonView,
    statusLabel: statusLabel,
    canPromoteToRecording: canPromoteToRecording,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.liveTransitionState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
