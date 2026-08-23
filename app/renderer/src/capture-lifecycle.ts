// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The live-capture lifecycle state machine (TD-001 slice 6i, #712) — port of
// inline-app.js's beforeStartCapture/onCaptureStarting/onCaptureStarted/
// promoteToRecording/onCaptureStopping/onCaptureStopped/stopLive/
// showLiveNotEnoughData/syncCaptureControls, re-pointed at liveCaptureStore
// and the React post-session chrome (LiveSessionOffers.tsx/LiveStatusLine.tsx/
// WindowBadge.tsx). Follows the ADR-0005 factory pattern every store here
// uses: createCaptureLifecycle(deps) with every side effect injected (store
// accessors, the soundBuddy api, the liveTransition/preflight/rigReconcile/
// armState classic scripts, the pure live-capture-panel helpers, reportCardChrome,
// a dawShell seam to inline-app.js's still-6j painters, and a document), so the
// whole state machine is unit-testable without Electron or a DOM. App.tsx
// installs the returned runtime onto window.liveCaptureRuntime (the identical
// LiveCaptureRuntime bridge LiveControls.tsx already calls) and onWindowTick
// onto window.captureLifecycle (inline-app.js's onLiveEvent window-tick branch).
//
// The 6j DAW playhead/waveform painters and their module state stay inline;
// this module drives them through the window.dawShellRuntime seam
// (startPlayhead/stopPlayhead/resetWaveform) and never touches those module
// vars directly.

import type { LiveCaptureRuntime, LiveTransitionState, CapturePhase } from './LiveControls';
import type { LiveCaptureState, StartCaptureResult, StopCaptureResult } from './stores/liveCaptureStore';
import type { AnalysisState } from './stores/analysisStore';
import type { SpectrumState } from './stores/spectrumStore';
import type { RigState } from './stores/rigStore';
import type { LiveEvent, StripConfig, LiveDevice } from './live-capture-panel';
import { deviceChannelCount, deviceNameFor } from './live-capture-panel';
import type { ReportCardSource } from './report-card';
import type { SoundBuddyApi, StartLiveOpts, PreflightBaseline } from '../../electron/ipc/api';
import type { PreflightChecklistItem, PreflightSnapshot } from './rig-panel';
import { SPECTRUM_TITLE } from './spectrum-chrome';
import type { LiveSetupStepsApi } from './live-workspace-view';

// The still-inline 6j painters' seam (inline-app.js's window.dawShellRuntime) —
// the lifecycle calls these wrappers instead of the module vars themselves.
export interface DawShellSeam {
  startPlayhead(nowMs: number): void;
  stopPlayhead(): void;
  resetWaveform(intervalSecs: number): void;
}

// The preflight.js classic-script surface preflightBlockReason reads.
export interface PreflightApi {
  buildChecklist(opts: {
    baseline: PreflightBaseline | null;
    current: PreflightSnapshot;
    device: { found: boolean; name: string; channels: number };
  }): PreflightChecklistItem[];
  checklistSummary(items: PreflightChecklistItem[]): { counts: { ok: number; warn: number; fail: number }; ready: boolean };
  snapshotRig(channelConfig: StripConfig[], deviceName: string): PreflightSnapshot;
}

// The rig-reconcile.js classic-script surface preflightBlockReason reads.
export interface RigReconcileApi {
  reconcileRigDevice(deviceName: string, devices: LiveDevice[]): { found: boolean; index: string; deviceName: string };
}

// The arm-state.js classic-script surface the guards read.
export interface ArmStateApi {
  armedCount(cfg: StripConfig[]): number;
  allTokens(cfg: StripConfig[]): string[];
  armedTokens(cfg: StripConfig[]): string[];
}

export interface CaptureLifecycleDeps {
  getLc(): LiveCaptureState;
  getAna(): AnalysisState;
  getSpec(): SpectrumState;
  getRig(): RigState;
  sb: Pick<SoundBuddyApi, 'startLive' | 'revealPath' | 'openDirDialog'>;
  liveTransition(): LiveTransitionState;
  preflight(): PreflightApi;
  rigReconcile(): RigReconcileApi;
  armState(): ArmStateApi;
  liveSetupState(): LiveSetupStepsApi;
  storage: Storage;
  liveCapturePanelApi: {
    shouldOfferReportCard(windows: number): boolean;
    liveSessionReportCardSource(win: LiveEvent[], src: number | null, cfg: StripConfig[]): ReportCardSource | null;
    normalizeMeasurementSource(v: number | null | undefined, n: number): number | null;
  };
  reportCardChrome: { persistSummary(src: ReportCardSource, kind: 'live'): void };
  dawShell(): DawShellSeam | null;
  doc: Pick<Document, 'getElementById'>;
}

declare global {
  interface Window {
    captureLifecycle?: { onWindowTick(data: LiveEvent): void };
  }
}

// Pure port of inline-app.js's capturePhase + captureIndicator + the pill's
// visibility — the header #live-indicator stays a static node driven by
// syncLiveIndicator (a React island can't own it: the measurement badge and
// sibling App-portal containers can't be resolved during App's own render
// pass — see the plan's rejected alternatives).
export function liveIndicatorView(
  liveTransition: LiveTransitionState,
  state: { isCapturing: boolean; liveMode: 'monitor' | 'record'; promoting: boolean; stopping: boolean },
): { visible: boolean; text: string; recording: boolean } {
  const phase = liveTransition.capturePhase({ liveRunning: state.isCapturing, liveMode: state.liveMode, promoting: state.promoting, stopping: state.stopping });
  const indicator = liveTransition.captureIndicator(phase);
  return { visible: state.isCapturing, text: indicator.text, recording: indicator.recording };
}

export function createCaptureLifecycle(deps: CaptureLifecycleDeps): {
  runtime: LiveCaptureRuntime;
  onWindowTick(data: LiveEvent): void;
} {
  // Whole-session window accumulator (#261): the store's liveWindows is capped
  // at 10 for the rolling preview — sessionWindows mirrors every window tick
  // with no cap and is what the session report card is built from at stop.
  let sessionWindows: LiveEvent[] = [];
  // #776: set by onResumeMonitoringStart() immediately before the automatic
  // monitor-resume that follows a record stop; onCaptureStarting consumes it —
  // a resume must preserve the just-shown post-record session offers instead
  // of clearing them the way a fresh user-initiated session does.
  let resumeMonitoringStart = false;
  // #776: the just-frozen session report-card source, stashed only across an
  // auto-resume (the resume's startCapture resets liveWindows → bridge.ts
  // clobbers analysisStore.liveSource; onCaptureStarting's resume branch
  // restores it). Consumed once, like resumeMonitoringStart.
  let frozenLiveSourceForResume: ReportCardSource | null = null;

  // The store's combined capture phase — the liveTransitionState pure model
  // computed from store fields instead of inline-app.js's module vars.
  function capturePhaseFromStore(): CapturePhase {
    const { isCapturing, liveMode, promoting, stopping } = deps.getLc();
    return deps.liveTransition().capturePhase({ liveRunning: isCapturing, liveMode, promoting, stopping });
  }

  // Store-driven applier for the static header #live-indicator pill — replaces
  // inline-app.js's syncCaptureControls (called at the same four points).
  function syncLiveIndicator(): void {
    const lc = deps.getLc();
    const view = liveIndicatorView(deps.liveTransition(), {
      isCapturing: lc.isCapturing,
      liveMode: lc.liveMode,
      promoting: lc.promoting,
      stopping: lc.stopping,
    });
    const indicator = deps.doc.getElementById('live-indicator');
    if (!indicator) return;
    indicator.style.display = view.visible ? 'flex' : 'none';
    const txt = indicator.querySelector('.live-txt');
    if (txt) txt.textContent = view.text;
    indicator.classList.toggle('capture-record', view.recording);
  }

  function beforeStartCapture(): { ok: true } | { ok: false; reason: string } {
    const lc = deps.getLc();
    // No configured tracks (#188): stream.py silently falls back to its first
    // device channels when given an empty channel list — block Start rather
    // than start a capture the UI just showed as empty. Record mode with
    // nothing armed would spawn an empty session — block that too (#43).
    if (lc.channelConfig.length === 0) {
      const reason = 'Add at least one track before starting listening.';
      lc.showArmHint(reason);
      return { ok: false, reason };
    }
    if (lc.liveMode === 'record' && deps.armState().armedCount(lc.channelConfig) === 0) {
      const reason = 'Arm at least one strip to record.';
      lc.showArmHint(reason);
      return { ok: false, reason };
    }
    lc.hideArmHint();
    return { ok: true };
  }

  // Runs synchronously right after lcStore.getState().startCapture() flips
  // isCapturing true (before its own await resolves) — the same point
  // inline-app.js's old inline handler ran these side effects at, right after
  // `liveRunning = true`.
  function onCaptureStarting(): void {
    const lc = deps.getLc();
    const intervalSecs = lc.meterIntervalMs / 1000;
    const shell = deps.dawShell();
    if (lc.liveMode === 'record') shell?.startPlayhead(Date.now());
    shell?.resetWaveform(intervalSecs);
    sessionWindows = [];
    // A new capture must not inherit the previous session's cooldowns or
    // active card (#612).
    lc.resetLapCoaching();
    // A live capture always wins over a loaded history entry (#147).
    deps.getAna().setHistorySummary(null);
    deps.getRig().setLocked(true);

    // #776: a resume (the monitor-restart that follows a record stop) must keep
    // the just-shown post-record session offers on screen — only a fresh
    // user-initiated session clears them. The flag is one-way: consumed here,
    // then back to false.
    if (resumeMonitoringStart) {
      resumeMonitoringStart = false;
      // startLiveCapture already called store.startCapture() (liveWindows: [])
      // before invoking this hook — that synchronously fired bridge.ts's
      // cross-store subscription and re-derived (clobbered)
      // analysisStore.liveSource from the now-empty rolling buffer. Undo it.
      if (frozenLiveSourceForResume) {
        deps.getAna().setLiveSource(frozenLiveSourceForResume);
        frozenLiveSourceForResume = null;
      }
    } else {
      lc.setSessionOffers({ sessionDir: null, reportCard: false, notEnoughData: false });
      lc.setLiveCueVisible(false);
    }
    syncLiveIndicator();
    lc.setLiveStatusText('Connecting…');
    const title = deps.doc.getElementById('spectrum-title');
    if (title) title.textContent = SPECTRUM_TITLE.live;
  }

  function onCaptureStarted(result: StartCaptureResult | undefined, meterRate: number): void {
    if (!result || !result.success) {
      void stopLive();
      deps.getSpec().setPanelState('error', (result && result.error) || 'Failed to start live listening');
      return;
    }
    deps.getLc().setLiveStatusText(deps.liveTransition().statusLabel(capturePhaseFromStore(), meterRate));
    syncLiveIndicator();
    // Guided first-use setup (#294): starting a capture completes setup
    // permanently. deps.liveSetupState() is App.tsx's accessor for the
    // boot-injected classic script (window.liveSetupState), wired the same
    // way as liveTransition/preflight/rigReconcile/armState. Remove any
    // rendered banner immediately rather than waiting for the board's next
    // re-render.
    deps.liveSetupState().markSetupComplete(deps.storage);
    const body = deps.doc.getElementById('spectrum-body');
    const banner = body?.querySelector('.live-setup-banner');
    if (banner) banner.remove();
  }

  // #757: a bad Record press is blocked INLINE by the preflight checklist first
  // (device connected / channel routing in range / baseline match — the same
  // pure window.preflight rules the Settings → Audio PreflightSettings panel
  // renders), surfacing the failing items' detail strings through #arm-hint.
  function preflightBlockReason(): string | null {
    const rigState = deps.getRig();
    const activeRig = rigState.rigs.find((r) => r.id === rigState.activeRigId) || null;
    const lc = deps.getLc();
    const deviceName = deviceNameFor(lc.selectedDevice, lc.devices);
    const rec = deps.rigReconcile().reconcileRigDevice(deviceName, lc.devices);
    const items = deps.preflight().buildChecklist({
      baseline: activeRig ? (activeRig.baseline ?? null) : null,
      current: deps.preflight().snapshotRig(lc.channelConfig, rec.deviceName),
      device: {
        found: rec.found,
        name: rec.deviceName,
        channels: deviceChannelCount(lc.selectedDevice, lc.devices),
      },
    });
    const summary = deps.preflight().checklistSummary(items);
    if (summary.ready) return null;
    return items.filter((i) => i.status === 'fail').map((i) => i.detail).join(' ');
  }

  // Promote a running monitor session to a recording in place (#458): same
  // device, channels, groups, labels, and measurement source carry over
  // unchanged. On failure the session drops to a stopped-but-configured state
  // via stopLive() rather than attempting to resume monitoring.
  async function promoteToRecording(): Promise<void> {
    const lc = deps.getLc();
    const preflightReason = preflightBlockReason();
    if (preflightReason) {
      lc.showArmHint(preflightReason);
      return;
    }
    const guard = deps.liveTransition().canPromoteToRecording({
      liveRunning: lc.isCapturing,
      liveMode: lc.liveMode,
      promoting: lc.promoting,
      armedCount: deps.armState().armedCount(lc.channelConfig),
    });
    if (!guard.ok) {
      lc.showArmHint(guard.reason ?? '');
      return;
    }
    lc.hideArmHint();

    // #776: promoting an already-running monitor session never routes through
    // onCaptureStarting() — but a monitor session can be running with a
    // PREVIOUS record's stale session offers still on screen (deliberately
    // preserved across the auto-resume). A user-initiated promote is a
    // genuinely new session, so clear them here too.
    lc.setSessionOffers({ sessionDir: null, reportCard: false, notEnoughData: false });
    lc.setLiveCueVisible(false);

    lc.setPromoting(true);
    lc.setLiveMode('record');
    deps.dawShell()?.startPlayhead(Date.now());
    syncLiveIndicator();
    // #757: arming stays live while monitoring, so flipping to 'record' is
    // what freezes the arm controls — the board re-renders from
    // liveCaptureStore (liveMode).

    const device = lc.selectedDevice || undefined;
    const windowSecs = lc.windowSecs;
    const intervalSecs = lc.meterIntervalMs / 1000;
    const channels = deps.armState().allTokens(lc.channelConfig);

    const payload: StartLiveOpts = {
      device, channels, windowSecs, intervalSecs,
      mode: 'record',
      recordDir: lc.recordDir || undefined,
      // Record mode: capture only the armed strips as session stems (#43).
      arm: deps.armState().armedTokens(lc.channelConfig),
      // Record mode: carry display labels into stem filenames + session.json (#482).
      labels: lc.channelConfig.map((s) => (s.label || '').trim()),
    };
    const result = (await deps.sb.startLive(payload)) as StartCaptureResult;
    deps.getLc().setPromoting(false);

    if (result.success) {
      deps.getLc().setLiveStatusText(deps.liveTransition().statusLabel(capturePhaseFromStore(), Math.round(1 / intervalSecs)));
      syncLiveIndicator();
    } else {
      deps.getLc().setLiveMode('monitor');
      deps.getSpec().setPanelState('error', result.error || 'Could not start recording. Monitoring stopped — press the Record button to start again.');
      await stopLive();
      syncLiveIndicator();
    }
  }

  // Runs synchronously right after lcStore.getState().stopCapture() flips
  // isCapturing false (before its own await resolves) — the same point
  // inline-app.js's old inline handler ran these side effects at, right after
  // `liveRunning = false`.
  function onCaptureStopping(): void {
    deps.dawShell()?.stopPlayhead();
    deps.getRig().setLocked(false);
  }

  function onCaptureStopped(result: StopCaptureResult | undefined): void {
    const lc = deps.getLc();
    // syncLiveIndicator hides the pill — isCapturing is already false here.
    syncLiveIndicator();
    lc.setLiveStatusText(null);
    lc.setLiveCueVisible(true);
    // "Stopped" distinguishes the frozen EQ from a running one; guard the mode
    // so a tab switch during the stop-live await isn't clobbered.
    if (lc.appMode === 'live') {
      const title = deps.doc.getElementById('spectrum-title');
      if (title) title.textContent = SPECTRUM_TITLE.liveStopped;
    }

    // A Record capture writes a session folder of per-strip stems +
    // session.json (#42); offer to reveal it (#43).
    if (result?.sessionDir) lc.setSessionOffers({ sessionDir: result.sessionDir });

    // #488/#261: a session that accumulated at least one window builds a
    // session-level Report Card from the whole sessionWindows buffer and
    // persists it to history tagged as a live-capture source. A session too
    // short/silent to produce usable windows degrades to the "not enough data"
    // state instead of a nonsensical grade.
    if (deps.liveCapturePanelApi.shouldOfferReportCard(lc.liveWindows.length)) {
      const sessionSrc = deps.liveCapturePanelApi.liveSessionReportCardSource(sessionWindows, lc.measurementSource, lc.channelConfig);
      if (sessionSrc) {
        deps.getAna().setLiveSource(sessionSrc); // freeze the session card onto the Report Card tab
        frozenLiveSourceForResume = sessionSrc; // #776: survive the auto-resume's liveWindows reset (see onCaptureStarting)
        deps.reportCardChrome.persistSummary(sessionSrc, 'live');
        lc.setSessionOffers({ reportCard: true });
      } else {
        lc.setSessionOffers({ notEnoughData: true });
      }
    }
  }

  // Internal-only orchestration for the two call sites that stop a capture
  // without going through RecordButton's own Stop press (a failed Start, and
  // a failed promote-to-recording) — wraps store.stopCapture() with the same
  // before/after split the button itself uses via the bridge.
  async function stopLive(): Promise<StopCaptureResult | undefined> {
    const stopPromise = deps.getLc().stopCapture();
    onCaptureStopping();
    const result = await stopPromise;
    onCaptureStopped(result);
    return result;
  }

  // The window-tick branch of inline-app.js's onLiveEvent — sessionWindows
  // accumulation + the coaching advance move out of the inline script; the
  // peaks branch (6j) and error branch stay inline.
  function onWindowTick(data: LiveEvent): void {
    sessionWindows.push(data); // uncapped — see the declaration above (#261)
    deps.getLc().advanceLapCoaching();
  }

  const runtime: LiveCaptureRuntime = {
    // Measurement source picker (#456): normalize against the current strip
    // count so a stale selection ('' -> null, an index -> the resolved strip)
    // never lands in the store.
    changeMeasurementSource(value) {
      const parsed = value === '' ? null : parseInt(value, 10);
      deps.getLc().setMeasurementSource(deps.liveCapturePanelApi.normalizeMeasurementSource(parsed, deps.getLc().channelConfig.length));
    },
    async chooseRecordFolder() {
      const dir = await deps.sb.openDirDialog();
      if (dir) deps.getLc().setRecordDir(dir);
    },
    beforeStartCapture,
    onCaptureStarting,
    onCaptureStarted,
    onCaptureStopping,
    onCaptureStopped,
    onResumeMonitoringStart() {
      resumeMonitoringStart = true;
    },
    promoteToRecording,
    // #460: the Room badge is MeasurementBadge.tsx (reactive) now — documented
    // no-op until slice 6k removes this from the runtime; kept so
    // SecondaryMeasurementPanel.tsx's optional call stays green.
    afterSecondaryMeasurementChange() { /* no-op until 6k */ },
  };

  return { runtime, onWindowTick };
}
