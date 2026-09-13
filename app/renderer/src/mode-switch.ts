// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure mode-switch decision + the DOM/store apply side (TD-001 slice 6e,
// #703) — ports inline-app.js's .mode-tab click listener (the module-level
// currentMode var, syncSpectrumForMode, syncSingleColumn) into a real ES
// module. ModeTabs.tsx renders the tab buttons and owns each button's
// `active` class reactively (data-mode === appMode); this module owns
// everything else the original click listener's body did.
// liveCaptureStore.appMode (TD-001 slice 6c, #701) stays the single source
// of truth for "current mode" — no new store field (see the plan's rejected
// alternatives for why).

import { getSoundBuddy } from './useElectron';
import { spectrumTransport } from './spectrum-transport';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useRigStore } from './stores/rigStore';
import { useSettingsStore } from './stores/settingsStore';
import { useSpectrumStore } from './stores/spectrumStore';
import { useAnalysisStore } from './stores/analysisStore';
import { SPECTRUM_TITLE } from './spectrum-chrome';
import { decideLiveAutoStart } from './live-auto-start';
import { startLiveCapture, runtime } from './LiveControls';
import { captureOptsFromCadence } from './measurement-device-state';
import { clampBootMode } from './simple-mode';
import type { AppSettings } from '../../electron/ipc/api';

export type WorkspaceMode = 'dir' | 'live' | 'console' | 'recent' | 'guide' | 'ringout' | 'reportcard';
export type ModeSwitchRequest = WorkspaceMode | 'analyze' | 'history';

const WORKSPACE_MODES: readonly WorkspaceMode[] = ['dir', 'live', 'console', 'recent', 'guide', 'ringout', 'reportcard'];
const WORKSPACE_MODE_SET = new Set<string>(WORKSPACE_MODES);

export function isWorkspaceMode(mode: string): mode is WorkspaceMode {
  return WORKSPACE_MODE_SET.has(mode);
}

export type ModeSwitchDecision =
  | { type: 'noop' }
  | { type: 'chooseFile' }
  | { type: 'openPicker' }
  | { type: 'redirect'; mode: WorkspaceMode }
  | { type: 'switch'; mode: WorkspaceMode };

// Verbatim port of the special-casing at the top of the old .mode-tab click
// listener (inline-app.js) — pure, no DOM.
export function resolveModeSwitch(
  requestedMode: string,
  currentMode: string,
  opts?: { simpleMode?: boolean },
): ModeSwitchDecision {
  if (requestedMode === 'analyze') return opts?.simpleMode ? { type: 'chooseFile' } : { type: 'openPicker' };
  if (requestedMode === 'history') return { type: 'redirect', mode: 'recent' };
  if (requestedMode === currentMode) return { type: 'noop' };
  if (!isWorkspaceMode(requestedMode)) return { type: 'noop' };
  return { type: 'switch', mode: requestedMode };
}

// single-column-state.js/report-first-ux-state.js stay classic scripts —
// read via a typed window cast, matching ReportCardIsland.tsx's
// getGrading()-style pattern.
interface SingleColumnStateApi {
  isSingleColumn(reportFirstUxEnabled: boolean, mode: string): boolean;
}
interface ReportFirstUxStateApi {
  isEnabled(settings: unknown): boolean;
}
function getSingleColumnState(): SingleColumnStateApi {
  return (window as unknown as { singleColumnState: SingleColumnStateApi }).singleColumnState;
}
function getReportFirstUxState(): ReportFirstUxStateApi {
  return (window as unknown as { reportFirstUxState: ReportFirstUxStateApi }).reportFirstUxState;
}

// The Live tab's meter board + docked EQ pane are React-owned now (TD-001
// slice 6g, #710): LiveCapturePanel renders #live-island from liveCaptureStore's
// discrete state and LiveEqPane owns #live-eq-pane's visibility/width/resize,
// so applySpectrumForMode's live branch no longer calls renderLiveMeters/
// renderLiveWorkspace/renderEqPane/currentEqPaneChannels — the board and pane
// render reactively from appMode, and this branch keeps only the spectrum
// title write.

// Verbatim port of syncSpectrumForMode (inline-app.js) — keeps the spectrum
// panel's title + empty/populated/meters state in sync with the active mode.
export function applySpectrumForMode(mode: string): void {
  const title = document.getElementById('spectrum-title');
  const curAnalysis = () => useAnalysisStore.getState().currentAnalysis;

  if (mode === 'live') {
    if (title) title.textContent = SPECTRUM_TITLE.live;
    // The docked EQ pane's visibility/width live in LiveEqPane's own effect
    // (TD-001 slice 6g, #710) — the pane is always mounted and toggles from
    // appMode, so there is nothing to write here.
  } else if (mode === 'console') {
    if (title) title.textContent = SPECTRUM_TITLE.curve;
    if (!curAnalysis()) useSpectrumStore.getState().setPanelState('empty', 'Select a console to monitor channel state');
    else useSpectrumStore.getState().setPanelState('populated');
  } else if (mode === 'recent') {
    if (title) title.textContent = SPECTRUM_TITLE.curve;
    if (!curAnalysis()) useSpectrumStore.getState().setPanelState('empty', 'Select a recent analysis to load its report card');
    else useSpectrumStore.getState().setPanelState('populated');
  } else if (mode === 'guide') {
    if (title) title.textContent = SPECTRUM_TITLE.curve;
    if (!curAnalysis()) useSpectrumStore.getState().setPanelState('empty', 'Follow the build order, then load a recording to grade it');
    else useSpectrumStore.getState().setPanelState('populated');
  } else if (mode === 'dir') {
    if (title) title.textContent = SPECTRUM_TITLE.curve;
    if (!curAnalysis()) useSpectrumStore.getState().setPanelState('empty', 'Choose a folder to analyze every recording in it');
    else useSpectrumStore.getState().setPanelState('populated');
  } else {
    if (title) title.textContent = SPECTRUM_TITLE.curve;
    if (!curAnalysis()) useSpectrumStore.getState().setPanelState('empty', 'Load a file to see the spectrum');
    else useSpectrumStore.getState().setPanelState('populated');
  }
}

// Verbatim port of syncSingleColumn (inline-app.js) — #542 (epic e17): fold
// the workspace to one column for Recent/Build Guide/Ring-Out/Directory when
// the report-first-ux flag is on.
export function applySingleColumnSync(): void {
  document.body.classList.toggle('single-column', getSingleColumnState().isSingleColumn(
    getReportFirstUxState().isEnabled(useSettingsStore.getState().settings),
    useLiveCaptureStore.getState().appMode));
}

// #728: on landing on the Live tab, auto-start monitoring using the
// last-used rig's device/channel-config/measurement-source — already
// hydrated onto liveCaptureStore by rigStore's loadRigs()/applyRigById at
// boot. decideLiveAutoStart is the pure gate; this just wires its 'start'
// verdict to the exact startLiveCapture() path the Start Capture button
// uses, so failures (Pro license, mic denied) surface through the same
// existing onCaptureStarted -> spectrum panel error state.
// Exported (#1405) so restoreBootMode can invoke exactly this same decision
// after hydration settles, instead of duplicating the gate-plus-start glue.
// Always logs one 'live-auto-start' console line with the decision (and skip
// reason, if any) — the acceptance criterion for #1405 is that a silent
// no-op at boot is diagnosable from the console, not just from re-reading
// this file's ADR.
export function maybeAutoStartLive(): void {
  const live = useLiveCaptureStore.getState();
  const decision = decideLiveAutoStart({
    isCapturing: live.isCapturing,
    activeRigId: useRigStore.getState().activeRigId,
    deviceHint: live.deviceHint,
    rigApplyNotice: live.rigApplyNotice,
  });
  console.log('live-auto-start', decision);
  if (decision.type !== 'start') return;
  // #776: auto-start is monitoring ONLY (#728/ADR-0008) — a record-mode rig
  // hydrates liveMode='record' (rig-panel.ts applyRigPatch), so normalize back
  // to monitor before starting, exactly as recordCapture does (#757).
  if (live.liveMode !== 'monitor') useLiveCaptureStore.getState().setLiveMode('monitor');
  const opts = captureOptsFromCadence(live.windowSecs, live.meterIntervalMs);
  void startLiveCapture(runtime(), opts.windowSecs, opts.intervalSecs);
}

// Verbatim port of the .mode-tab click listener's body (inline-app.js) minus
// the tab-active class toggle, which ModeTabs.tsx now owns reactively.
//
// `opts.boot` (#1405) marks App.tsx's synchronous first-paint call, which
// fires before settings have loaded and before inline-app.js's device/rig
// hydration has settled. It is load-bearing in two ways: (1) it skips
// persisting `mode` to settings, so the hardcoded initial 'reportcard'
// default never clobbers a saved 'live' on disk before restoreBootMode gets
// a chance to read it back; (2) it skips the auto-start call, since
// decideLiveAutoStart would read rigStore's still-empty activeRigId and
// skip with a false 'no-last-used-device'. restoreBootMode is what performs
// the real (non-boot) switch/auto-start once hydration has settled.
export function switchMode(mode: WorkspaceMode, opts?: { boot?: boolean }): void {
  const sb = getSoundBuddy();
  // Opt-in crash reporting (#473): the current screen is a safe breadcrumb
  // (a name, never content) a crash payload includes as `route`.
  sb.recordAppEvent(`screen.${mode === 'reportcard' ? 'reportcard' : mode}`);
  // Live replaces the spectrum area with unrelated content — don't leave the
  // analyzed file playing silently in the background with no visible control.
  if (mode === 'live') spectrumTransport.pauseIfPlaying();

  useLiveCaptureStore.getState().setAppMode(mode);
  if (!opts?.boot) void useSettingsStore.getState().updateSettings({ lastAppMode: mode });

  // #727: the Live tab's #tab-live node relocated out of #source-panel into
  // #spectrum-panel, leaving #source-panel with nothing to show while Live
  // is active — collapse it via this class the same way rc-active already
  // does for the Report Card tab.
  document.body.classList.toggle('live-active', mode === 'live');

  if (mode === 'live' && !opts?.boot) maybeAutoStartLive();

  if (mode === 'reportcard') {
    document.body.classList.add('rc-active');
    document.getElementById('reportcard-view')?.classList.add('active');
    applySpectrumForMode('reportcard');
  } else {
    document.body.classList.remove('rc-active');
    document.getElementById('reportcard-view')?.classList.remove('active');
    document.querySelectorAll('.tab-content').forEach((tc) => tc.classList.remove('active'));
    document.getElementById(`tab-${mode}`)?.classList.add('active');
    applySpectrumForMode(mode);
  }
  applySingleColumnSync();
}

export interface RestoreBootModeDeps {
  // window.rendererHydration (inline-app.js) — settles once settings AND
  // devices-then-rigs have both loaded (or failed). Awaiting it, rather than
  // e.g. polling activeRigId, is what makes this run exactly once per boot.
  hydration: Promise<unknown>;
  getLastAppMode: () => string | null | undefined;
  getCurrentMode: () => string;
  getSettings: () => AppSettings | null;
}

// #1405: the second half of the boot sequence, paired with App.tsx's
// synchronous `switchMode(initialMode, { boot: true })`. That first call
// paints the hardcoded default (Report Card) immediately so first paint
// never blocks on IPC; this restores the user's actual last-active mode (or,
// if it was already Live, runs the auto-start decision) once hydration has
// settled — never both, and never before hydration, so decideLiveAutoStart
// always sees the real post-hydration rigStore/deviceHint state.
export async function restoreBootMode(deps: RestoreBootModeDeps): Promise<void> {
  await deps.hydration;
  const lastMode = deps.getLastAppMode();
  const currentMode = deps.getCurrentMode();
  const restoredMode = lastMode ? clampBootMode(lastMode, deps.getSettings()) : lastMode;
  if (restoredMode && isWorkspaceMode(restoredMode) && restoredMode !== currentMode) {
    switchMode(restoredMode);
    return;
  }
  if (currentMode === 'live') maybeAutoStartLive();
}
