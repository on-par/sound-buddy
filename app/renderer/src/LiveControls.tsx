// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The Live-capture runtime bridge + capture orchestration helpers (TD-001
// slice 6c, #701, narrowed by #727, #729). The #tab-live Mode toggle
// (LiveControls) and the Start/Stop transport (LiveTransportControls) are
// GONE (#757): the Live tab is permanently monitor-mode and the top-bar
// Record button (#729, RecordButton.tsx / #record-button-island) is the sole
// capture transport, so the old in-tab control components no longer exist.
// What remains is the window.liveCaptureRuntime bridge type + accessor
// (runtime()), the extracted startLiveCapture/stopLiveCapture ordering
// helpers, and recordCapture — the promote-in-place orchestration (#458) the
// top-bar Record button's idle press flows into (starting monitoring first
// when nothing is live, #757). #arm-hint is liveCaptureStore.armHint written
// by the runtime's beforeStartCapture/promoteToRecording and rendered by
// LiveArmHint.tsx (TD-001 slice 6h, #711).
//
// #live-status, #rec-offer/#rc-offer/#rc-not-enough, and #live-rc-cue are
// React-owned now (TD-001 slice 6i, #712): LiveStatusLine.tsx +
// LiveSessionOffers.tsx render them from liveCaptureStore
// (liveStatusText/sessionOffers/liveCueVisible), written by the capture-lifecycle
// module and rigStore. The capture click handlers delegate to
// `window.liveCaptureRuntime` (installed by App.tsx from capture-lifecycle.ts,
// the port of inline-app.js's lifecycle) for the side-effect-heavy
// orchestration (playhead/waveform/rig-lock/lapCoaching/session offers) that
// stays out of 6c's scope — see the ADR in the #701 plan on why those coupled
// sub-surfaces (DAW shell, live-adjustments, preflight, rigs) stay bridged.
// `window.liveTransitionState`'s capturePhase classic script is left
// untouched (still load-bearing for the capture-lifecycle module's header
// REC/LIVE indicator applier) but is no longer read from this file.

import { useLiveCaptureStore, type StartCaptureResult, type StopCaptureResult } from './stores/liveCaptureStore';
import { captureOptsFromCadence } from './measurement-device-state';

export interface LiveCaptureRuntime {
  /** Measurement-source <select> changed — normalizes + persists the selection and refreshes the badge/EQ pane. */
  changeMeasurementSource(value: string): void;
  /** Opens the folder-choose dialog and stores the result as the record folder. */
  chooseRecordFolder(): Promise<void>;
  /** Pre-flight validation for Start — returns a user-facing reason when blocked (shown via the still-inline #arm-hint). */
  beforeStartCapture(): { ok: true } | { ok: false; reason: string };
  /** Runs the start-of-capture side effects (playhead/waveform/rig-lock/etc.) synchronously, right after isCapturing flips true. */
  onCaptureStarting(): void;
  /** Runs the post-start side effects once the IPC result resolves. */
  onCaptureStarted(result: StartCaptureResult | undefined, meterRate: number): void;
  /** Runs the pre-stop side effects synchronously, right after isCapturing flips false. */
  onCaptureStopping(): void;
  /** Runs the post-stop side effects once the IPC result resolves (sessionDir drives the "reveal session folder" offer). */
  onCaptureStopped(result: StopCaptureResult | undefined): void;
  /** #776: called by stopLiveCapture right before the automatic monitor-resume
   *  that follows a record stop; tells the runtime the next capture start is a
   *  resume of the always-monitoring Live tab (not a fresh user session), so
   *  onCaptureStarting preserves the just-shown post-record session offers
   *  instead of clearing them. Consumed by the runtime on the next start. */
  onResumeMonitoringStart?(): void;
  /** Promotes a running monitor session to a recording in place (#458) — its own guard/orchestration stays bridged. */
  promoteToRecording(): Promise<void>;
  /** Repaints the Room badge after a secondary-measurement device selection/
   *  start/stop/reconnect (#460, #724) — the badge is MeasurementBadge.tsx
   *  (reactive) now, so this is a documented no-op until slice 6k removes it
   *  from the runtime; the EQ pane's Room slot is React-owned (LiveEqPane,
   *  TD-001 slice 6g #710). */
  afterSecondaryMeasurementChange?(): void;
}

export type CapturePhase = 'idle' | 'monitoring' | 'starting-record' | 'recording';

// Typed accessor for the pure live-transition-state.js classic-script (boot-
// injected onto `window` by App.tsx, read the same way liveCaptureStore.ts
// reads armState/groupState/rigKind — see that file's header comment).
export interface LiveTransitionState {
  capturePhase(view: { liveRunning: boolean; liveMode: string; promoting: boolean }): CapturePhase;
  captureIndicator(phase: CapturePhase): { text: string; recording: boolean };
  recordButtonView(phase: CapturePhase): { visible: boolean; disabled: boolean; label: string };
  statusLabel(phase: CapturePhase, meterRate: number): string;
  canPromoteToRecording(view: { liveRunning: boolean; liveMode: string; promoting: boolean; armedCount: number }): { ok: boolean; reason: string | null };
}

declare global {
  interface Window {
    liveCaptureRuntime?: LiveCaptureRuntime;
    liveTransitionState: LiveTransitionState;
  }
}

// Exported so other React-owned islands reading window.liveCaptureRuntime
// (e.g. SecondaryMeasurementPanel.tsx, #724) share this one lookup instead of
// duplicating it.
export function runtime(): LiveCaptureRuntime | undefined {
  return window.liveCaptureRuntime;
}

// Extracted from the components so the ordering (validate -> flip isCapturing
// synchronously via startCapture -> run bridged side effects -> await the IPC
// result) is independently unit-testable with a mock LiveCaptureRuntime,
// without needing a DOM to click a button (no jsdom in this harness).
export async function startLiveCapture(
  rt: LiveCaptureRuntime | undefined,
  windowSecs: number,
  intervalSecs: number,
): Promise<void> {
  const guard = rt?.beforeStartCapture();
  if (guard && !guard.ok) return;
  // startCapture's synchronous prelude (isCapturing:true, liveWindows:[])
  // runs the moment it's called, before this awaits the returned promise —
  // so onCaptureStarting() (playhead/waveform/rig-lock side effects) sees
  // the flipped isCapturing state at the same point inline-app.js's old
  // `liveRunning = true` ordering did.
  const capturePromise = useLiveCaptureStore.getState().startCapture({ windowSecs, intervalSecs });
  rt?.onCaptureStarting();
  const result = await capturePromise;
  rt?.onCaptureStarted(result, Math.round(1 / intervalSecs));
}

// The stop half of stopLiveCapture's ordering (flip stopping -> stopCapture()
// -> bridged before/after hooks -> clear stopping), split out so
// stopCaptureIfRunning below can run exactly this and stop short of
// stopLiveCapture's post-record resume-to-monitoring tail.
async function runStopCeremony(rt: LiveCaptureRuntime | undefined): Promise<StopCaptureResult | undefined> {
  useLiveCaptureStore.getState().setStopping(true);
  const stopPromise = useLiveCaptureStore.getState().stopCapture();
  rt?.onCaptureStopping();
  const result = await stopPromise;
  rt?.onCaptureStopped(result);
  useLiveCaptureStore.getState().setStopping(false);
  return result;
}

export async function stopLiveCapture(rt: LiveCaptureRuntime | undefined): Promise<void> {
  const live = useLiveCaptureStore.getState();
  const stopIsRecordStop = live.liveMode === 'record' && live.isCapturing;
  // #847: hold the board's running shape across the stop IPC — stopCapture()
  // flips isCapturing false before awaiting it, and React paints that whole
  // window, so without this the workspace flashes its idle card, un-disables
  // every capture-locked control, and drops the header stats row / level
  // readout before the monitor session restarts.
  if (stopIsRecordStop) useLiveCaptureStore.getState().setDemoting(true);
  try {
    await runStopCeremony(rt);
    // #776: the Live tab is always-monitoring (ADR-0014) — stopping a record
    // returns to a live monitor session (Record button idle, meters running)
    // instead of ending capture entirely. Mirrors recordCapture's normalize-
    // then-start shape; onResumeMonitoringStart keeps the just-shown session
    // offers on screen across the restart.
    if (!stopIsRecordStop) return;
    const next = useLiveCaptureStore.getState();
    if (next.liveMode !== 'monitor') useLiveCaptureStore.getState().setLiveMode('monitor');
    rt?.onResumeMonitoringStart?.();
    const opts = captureOptsFromCadence(next.windowSecs, next.meterIntervalMs);
    await startLiveCapture(rt, opts.windowSecs, opts.intervalSecs);
  } finally {
    if (stopIsRecordStop) useLiveCaptureStore.getState().setDemoting(false);
  }
}

// The one production entry point for "drive the board fully idle, if it
// isn't already" (#776) — no button reaches this state (a Record-button stop
// only demotes a record session back to monitoring, per stopLiveCapture
// above), so e2e/automation callers that need a genuinely idle board (config
// unlocked, readout hidden) call this instead of re-deriving the stop
// ceremony themselves. Runs the same runStopCeremony as stopLiveCapture but
// never takes its post-record resume-to-monitoring branch. Bridged onto
// window by App.tsx so Playwright's page.evaluate() can reach it.
export async function stopCaptureIfRunning(rt: LiveCaptureRuntime | undefined): Promise<void> {
  if (!useLiveCaptureStore.getState().isCapturing) return;
  await runStopCeremony(rt);
}

// The top-bar Record button's promote action (#729, #757): promotes a running
// monitor session to a recording in place (#458). With the Live tab's mode
// toggle gone, an idle press (nothing live) starts monitoring FIRST — the tab
// is always-monitoring, so the button never needs to be disabled — then
// promotes. liveMode is normalized back to 'monitor' before that start so a
// stopped record session can be recorded again, and honoring
// beforeStartCapture's #arm-hint guard means a blocked start (e.g. an empty
// channel config) returns without ever touching promoteToRecording.
export async function recordCapture(rt: LiveCaptureRuntime | undefined): Promise<void> {
  const live = useLiveCaptureStore.getState();
  if (!live.isCapturing) {
    if (live.liveMode !== 'monitor') useLiveCaptureStore.getState().setLiveMode('monitor');
    const opts = captureOptsFromCadence(live.windowSecs, live.meterIntervalMs);
    await startLiveCapture(rt, opts.windowSecs, opts.intervalSecs);
    if (!useLiveCaptureStore.getState().isCapturing) return; // blocked start — beforeStartCapture already surfaced #arm-hint
  }
  return rt?.promoteToRecording() ?? Promise.resolve();
}
