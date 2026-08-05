// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The #tab-live capture controls — device picker, measurement source, mode
// segmented, record-folder row, and the Start/Stop/Record transport (TD-001
// slice 6c, #701) — portaled by App.tsx onto #live-controls-island (this
// file's default export, LiveControls) and #live-transport-island
// (LiveTransportControls), replacing inline-app.js's loadDevices/
// renderChannelConfig/setLiveMode/setCaptureControlsLocked/
// syncCaptureControls DOM-writers for this region. Two separate components
// (not one component with two internal createPortal calls) because
// react-dom's server renderer doesn't support portals at all — see
// LiveControls.test.ts's header note — and because root-markup.html's
// #tab-live interleaves these controls with still-bridged, out-of-scope
// markup (meter-rate/window sliders, the preflight panel), so they can't
// share one contiguous portal target either. Button visibility/labels are
// derived from the same pure window.liveTransitionState module inline-app.js
// used, fed by liveCaptureStore state instead of the old liveRunning/
// liveMode/capturePromoting module vars.
//
// #live-status, #arm-hint, #rec-offer/#rc-offer/#rc-not-enough, and
// #live-rc-cue stay OUT of both islands (still static markup, still written
// by several other still-inline functions — rig-apply error text,
// group-mutation arm hints, the post-stop session offers) — pulling those
// into React here would double-own DOM nodes that other bridged code also
// writes directly. The Start/Stop/Record click handlers delegate to
// `window.liveCaptureRuntime` (inline-app.js) for the side-effect-heavy
// orchestration (playhead/waveform/rig-lock/lapCoaching/session offers) that
// stays out of 6c's scope — see the ADR in the #701 plan on why those coupled
// sub-surfaces (DAW shell, live-adjustments, preflight, rigs) stay bridged.

import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore, type StartCaptureResult, type StopCaptureResult } from './stores/liveCaptureStore';
import { useSettingsStore } from './stores/settingsStore';
import { iconSvg } from './report-card';
import { deviceOptionLabel, measurementSourceOptionsHTML } from './live-capture-panel';

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

function runtime(): LiveCaptureRuntime | undefined {
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
  const stopPromise = useLiveCaptureStore.getState().stopCapture();
  rt?.onCaptureStopping();
  const result = await stopPromise;
  rt?.onCaptureStopped(result);
}

export function recordCapture(rt: LiveCaptureRuntime | undefined): Promise<void> {
  return rt?.promoteToRecording() ?? Promise.resolve();
}

// Device <select> changed: writes the selection into the store (so the
// controlled <select>'s value stays in sync) and delegates the re-seed of
// channel config/groups/preflight for the newly selected device to the
// bridged runtime.
export function changeDevice(rt: LiveCaptureRuntime | undefined, value: string): void {
  useLiveCaptureStore.getState().selectDevice(value);
  rt?.selectDevice(value);
}

export default function LiveControls() {
  const { devices, deviceHint, selectedDevice, channelConfig, measurementSource, liveMode, recordDir, isCapturing } =
    useStoreShallow(useLiveCaptureStore, (s) => ({
      devices: s.devices,
      deviceHint: s.deviceHint,
      selectedDevice: s.selectedDevice,
      channelConfig: s.channelConfig,
      measurementSource: s.measurementSource,
      liveMode: s.liveMode,
      recordDir: s.recordDir,
      isCapturing: s.isCapturing,
    }));
  const storageDir = useStoreShallow(useSettingsStore, (s) => s.settings?.storageDir ?? null);

  const devicePlaceholder = devices.length > 0
    ? 'Default Device'
    : (deviceHint?.text || 'Loading devices…');
  // Mirrors inline-app.js's defaultRecordFolderText() (#91) — the configured
  // storageDir setting, falling back to the platform default.
  const defaultRecordFolderText = (storageDir && storageDir.trim()) || '~/Music/Sound Buddy';

  return (
    <>
      <label className="select-label">
        <span>Input Device</span>
        <div className="select-row">
          <div className="select-wrap">
            <select
              id="device-select"
              value={selectedDevice}
              disabled={isCapturing}
              onChange={(e) => changeDevice(runtime(), e.target.value)}
            >
              {devices.length === 0
                ? <option value="">{devicePlaceholder}</option>
                : (
                  <>
                    <option value="">Default Device</option>
                    {devices.map((d) => <option key={d.index} value={String(d.index)}>{deviceOptionLabel(d)}</option>)}
                  </>
                )}
            </select>
            <span className="select-caret" dangerouslySetInnerHTML={{ __html: iconSvg('chevron-down', 16) }} />
          </div>
          <button
            type="button"
            id="device-refresh-btn"
            className="ghost-btn"
            title="Re-scan input devices"
            disabled={isCapturing}
            onClick={() => { void runtime()?.loadDevices(); }}
          >
            Refresh
          </button>
        </div>
      </label>
      {deviceHint?.text && (
        <p id="device-hint" className={`device-hint${deviceHint.isError ? ' is-error' : ''}`}>{deviceHint.text}</p>
      )}

      <label className="select-label">
        <span>Measurement Source</span>
        <div className="select-row">
          <div className="select-wrap">
            <select
              id="measurement-source"
              value={measurementSource == null ? '' : String(measurementSource)}
              dangerouslySetInnerHTML={{ __html: measurementSourceOptionsHTML(channelConfig, measurementSource) }}
              onChange={(e) => runtime()?.changeMeasurementSource(e.target.value)}
            />
            <span className="select-caret" dangerouslySetInnerHTML={{ __html: iconSvg('chevron-down', 16) }} />
          </div>
        </div>
      </label>

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

      <div className="record-row" id="record-folder-row" style={{ display: liveMode === 'record' ? 'flex' : 'none' }}>
        <button
          type="button"
          id="record-folder-btn"
          className="ghost-btn"
          title="Choose recording folder"
          disabled={isCapturing}
          onClick={() => { void runtime()?.chooseRecordFolder(); }}
        >
          Folder…
        </button>
        <span className="record-path" id="record-folder-path">{recordDir || defaultRecordFolderText}</span>
      </div>
    </>
  );
}

export function LiveTransportControls() {
  const { liveMode, isCapturing, promoting } = useStoreShallow(useLiveCaptureStore, (s) => ({
    liveMode: s.liveMode,
    isCapturing: s.isCapturing,
    promoting: s.promoting,
  }));

  const phase = window.liveTransitionState.capturePhase({ liveRunning: isCapturing, liveMode, promoting });
  const recordView = window.liveTransitionState.recordButtonView(phase);

  function onStart() {
    const windowSecsEl = document.getElementById('window-secs') as HTMLInputElement | null;
    const meterIntervalEl = document.getElementById('meter-interval') as HTMLInputElement | null;
    const windowSecs = parseFloat(windowSecsEl?.value ?? '3');
    const intervalSecs = parseInt(meterIntervalEl?.value ?? '100', 10) / 1000;
    void startLiveCapture(runtime(), windowSecs, intervalSecs);
  }

  function onStop() {
    void stopLiveCapture(runtime());
  }

  function onRecord() {
    void recordCapture(runtime());
  }

  return (
    <>
      <button
        className="btn btn-primary full"
        id="live-start-btn"
        style={{ display: phase === 'idle' ? 'inline-flex' : 'none' }}
        onClick={onStart}
        dangerouslySetInnerHTML={{ __html: iconSvg('play', 16) + 'Start Capture' }}
      />
      <button
        className="btn btn-danger full"
        id="live-stop-btn"
        style={{ display: phase === 'idle' ? 'none' : 'inline-flex' }}
        onClick={onStop}
        dangerouslySetInnerHTML={{ __html: iconSvg('square', 16) + 'Stop Capture' }}
      />
      {recordView.visible && (
        <button
          className="btn btn-danger full"
          id="live-record-btn"
          disabled={recordView.disabled}
          onClick={onRecord}
          dangerouslySetInnerHTML={{ __html: iconSvg('circle', 16) + recordView.label }}
        />
      )}
    </>
  );
}
