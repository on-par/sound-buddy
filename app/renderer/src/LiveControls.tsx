// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The #tab-live Mode toggle + the Start/Stop transport (TD-001 slice 6c,
// #701; narrowed by #727, which split the device picker/measurement
// source/record-folder row out into LiveSourceSettings.tsx and relocated
// them into Settings → Audio; narrowed again by #729, which moved the
// Record button out of LiveTransportControls entirely into RecordButton.tsx/
// #record-button-island in the top bar — see that file's header for the new
// surface) — portaled by App.tsx onto #live-controls-island (this file's
// default export, LiveControls, Mode only) and #live-transport-island
// (LiveTransportControls, Start/Stop only), replacing inline-app.js's
// setLiveMode/setCaptureControlsLocked/syncCaptureControls DOM-writers for
// this region. Two separate components (not one component with two internal
// createPortal calls) because react-dom's server renderer doesn't support
// portals at all — see LiveControls.test.ts's header note — and because
// root-markup.html's #tab-live interleaves these controls with still-
// bridged, out-of-scope markup (the preflight panel), so they can't share
// one contiguous portal target either.
//
// #live-status, #arm-hint, #rec-offer/#rc-offer/#rc-not-enough, and
// #live-rc-cue stay OUT of both islands (still static markup, still written
// by several other still-inline functions — rig-apply error text,
// group-mutation arm hints, the post-stop session offers) — pulling those
// into React here would double-own DOM nodes that other bridged code also
// writes directly. The Start/Stop click handlers delegate to
// `window.liveCaptureRuntime` (inline-app.js) for the side-effect-heavy
// orchestration (playhead/waveform/rig-lock/lapCoaching/session offers) that
// stays out of 6c's scope — see the ADR in the #701 plan on why those coupled
// sub-surfaces (DAW shell, live-adjustments, preflight, rigs) stay bridged.
// `window.liveTransitionState`'s capturePhase/recordButtonView classic
// scripts are left untouched (still load-bearing for inline-app.js's header
// REC/LIVE indicator and the promoteToRecording() guard) but are no longer
// read from this file — LiveTransportControls' idle/non-idle split is just
// `!isCapturing` now, and RecordButton.tsx derives its own phase from
// record-transport.ts instead.

import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore, type StartCaptureResult, type StopCaptureResult } from './stores/liveCaptureStore';
import { iconSvg } from './report-card';
import { captureOptsFromCadence } from './measurement-device-state';

export interface LiveCaptureRuntime {
  /** Refreshes the device list and re-seeds channel config/groups for the (possibly new) default device. */
  loadDevices(): Promise<void>;
  /** Device <select> changed — re-seeds channel config/groups for the newly selected device. */
  selectDevice(value: string): void;
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
  /** Promotes a running monitor session to a recording in place (#458) — its own guard/orchestration stays bridged. */
  promoteToRecording(): Promise<void>;
  /** Repaints the still-imperative Room badge/EQ-pane slot after a secondary-
   *  measurement device selection/start/stop/reconnect (#460, #724) —
   *  renderMeasurementBadge()/renderEqPane() stay imperative and out of
   *  scope for this component. */
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

export async function stopLiveCapture(rt: LiveCaptureRuntime | undefined): Promise<void> {
  useLiveCaptureStore.getState().setStopping(true);
  const stopPromise = useLiveCaptureStore.getState().stopCapture();
  rt?.onCaptureStopping();
  const result = await stopPromise;
  rt?.onCaptureStopped(result);
  useLiveCaptureStore.getState().setStopping(false);
}

export function recordCapture(rt: LiveCaptureRuntime | undefined): Promise<void> {
  return rt?.promoteToRecording() ?? Promise.resolve();
}

export default function LiveControls() {
  const { liveMode, isCapturing } = useStoreShallow(useLiveCaptureStore, (s) => ({
    liveMode: s.liveMode,
    isCapturing: s.isCapturing,
  }));

  return (
    <div>
      <div className="seg-label">Mode</div>
      <div className="segmented" id="live-mode">
        <button
          type="button"
          data-mode="monitor"
          className={liveMode === 'monitor' ? 'active' : ''}
          disabled={isCapturing}
          onClick={() => useLiveCaptureStore.getState().setLiveMode('monitor')}
          dangerouslySetInnerHTML={{ __html: iconSvg('activity', 16) + 'Monitor' }}
        />
        <button
          type="button"
          data-mode="record"
          className={liveMode === 'record' ? 'active' : ''}
          disabled={isCapturing}
          onClick={() => useLiveCaptureStore.getState().setLiveMode('record')}
          dangerouslySetInnerHTML={{ __html: iconSvg('circle', 16) + 'Record' }}
        />
      </div>
    </div>
  );
}

export function LiveTransportControls() {
  const { isCapturing } = useStoreShallow(useLiveCaptureStore, (s) => ({ isCapturing: s.isCapturing }));

  function onStart() {
    const { windowSecs, meterIntervalMs } = useLiveCaptureStore.getState();
    const opts = captureOptsFromCadence(windowSecs, meterIntervalMs);
    void startLiveCapture(runtime(), opts.windowSecs, opts.intervalSecs);
  }

  function onStop() {
    void stopLiveCapture(runtime());
  }

  return (
    <>
      <button
        className="btn btn-primary full"
        id="live-start-btn"
        style={{ display: !isCapturing ? 'inline-flex' : 'none' }}
        onClick={onStart}
        dangerouslySetInnerHTML={{ __html: iconSvg('play', 16) + 'Start Capture' }}
      />
      <button
        className="btn btn-danger full"
        id="live-stop-btn"
        style={{ display: !isCapturing ? 'none' : 'inline-flex' }}
        onClick={onStop}
        dangerouslySetInnerHTML={{ __html: iconSvg('square', 16) + 'Stop Capture' }}
      />
    </>
  );
}
