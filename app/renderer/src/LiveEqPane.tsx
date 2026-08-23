// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The docked live EQ pane island (TD-001 slice 6g, #710) — portaled by
// App.tsx onto #live-eq-pane-body. Renders the pane body from liveCaptureStore's
// discrete slots (selectedChannel/measurementSource/channelConfig + the
// secondary room override), rebuilding the innerHTML only when
// eqPaneSignature changes: per-tick arc/bars patches from the meter
// controller (eqPanePatchPlan) survive because the memoized string is
// unchanged between ticks. Owns #live-eq-pane's visibility/width and the
// resize-handle wiring, which mode-switch.ts used to drive — those moved here
// so the pane owns its own chrome. #live-eq-pane-body and #live-eq-resize are
// static root-markup nodes, so they exist at mount (App.tsx gates the portal
// on `booted` like every other rootMarkup-injected target).

import { useEffect, useMemo, type FormEvent, type JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore, type LiveCaptureState } from './stores/liveCaptureStore';
import { useSettingsStore, type SettingsState } from './stores/settingsStore';
import { useSoundcheckStore, type SoundcheckState } from './stores/soundcheckStore';
import {
  clampEqPaneWidth,
  eqPaneView,
  eqPaneSignature,
  eqPaneHTML,
  eqPaneClassificationHTML,
  eqPaneInspectorHTML,
  deviceChannelCount,
  deviceNameFor,
  EQ_PANE_RESIZE_STEP,
  type EqPaneView,
} from './live-capture-panel';
import { roomPaneOverride } from './measurement-device-state';
import {
  currentEqPaneChannels,
  selectedEqPaneLevelTilesView,
  getArmState,
  getGroupState,
  getInstrumentProfiles,
  boardRunning,
  liveWorkspaceViewState,
  type ArmStateApi,
  type InstrumentProfilesApi,
} from './live-workspace-view';

export interface ClassificationChangeDeps {
  liveCapture: Pick<LiveCaptureState, 'selectedChannel' | 'channelConfig' | 'selectedDevice' | 'devices' | 'assignGroup'>;
  settings: Pick<SettingsState, 'settings' | 'updateSettings'>;
  instrumentProfiles: Pick<InstrumentProfilesApi, 'recordOverride'>;
  armState: Pick<ArmStateApi, 'stripToken'>;
}

export interface EqPaneInspectorChangeDeps {
  liveCapture: Pick<LiveCaptureState,
    'selectedChannel' | 'channelConfig' | 'setStripLabel' | 'setStripKind' | 'setStripSource' | 'toggleArm'>;
  soundcheck: Pick<SoundcheckState, 'manifest' | 'setRoute'>;
}

// Routes strip-scoped inspector edits through the stores that own strip setup
// and soundcheck routing. A valid selected live strip is required, so a stale
// pane can never mutate unrelated state.
export function applyEqPaneInspectorChange(
  kind: 'label' | 'kind' | 'source' | 'arm' | 'output',
  value: string,
  deps: EqPaneInspectorChangeDeps,
): void {
  const selectedIndex = deps.liveCapture.selectedChannel;
  const strip = selectedIndex != null && selectedIndex >= 0
    ? deps.liveCapture.channelConfig[selectedIndex]
    : null;
  if (!strip || selectedIndex == null) return;
  if (kind === 'label') {
    deps.liveCapture.setStripLabel(selectedIndex, value);
    return;
  }
  if (kind === 'kind') {
    deps.liveCapture.setStripKind(selectedIndex, value);
    return;
  }
  if (kind === 'arm') {
    deps.liveCapture.toggleArm(selectedIndex);
    return;
  }
  if (kind === 'source') {
    const [source, field = 'a'] = value.split(':');
    const channel = Number(source);
    if (!Number.isInteger(channel) || channel < 0 || (field !== 'a' && field !== 'b')) return;
    deps.liveCapture.setStripSource(selectedIndex, field, channel);
    return;
  }
  const base = Number(value);
  if (!Number.isInteger(base) || base < 0 || !deps.soundcheck.manifest?.tracks[selectedIndex]) return;
  deps.soundcheck.setRoute(selectedIndex, base);
}

// Applies a React-owned classification selector change using injected store
// actions, keeping stale selection guards and persistence behavior testable.
export function applyEqPaneClassificationChange(
  kind: 'group' | 'profile',
  value: string,
  deps: ClassificationChangeDeps,
): void {
  const selectedIndex = deps.liveCapture.selectedChannel;
  const strip = selectedIndex != null && selectedIndex >= 0
    ? deps.liveCapture.channelConfig[selectedIndex]
    : null;
  if (!strip || selectedIndex == null) return;
  if (kind === 'group') {
    deps.liveCapture.assignGroup(selectedIndex, parseInt(value, 10));
    return;
  }
  const all = (deps.settings.settings || {}).inputInstrumentProfiles || {};
  const next = deps.instrumentProfiles.recordOverride(
    all,
    deviceNameFor(deps.liveCapture.selectedDevice, deps.liveCapture.devices),
    deps.armState.stripToken(strip),
    value,
  );
  void deps.settings.updateSettings({ inputInstrumentProfiles: next });
}

export default function LiveEqPane(): JSX.Element {
  const s = useStoreShallow(useLiveCaptureStore, (st) => ({
    channelConfig: st.channelConfig,
    channelGroups: st.channelGroups,
    devices: st.devices,
    selectedDevice: st.selectedDevice,
    isCapturing: st.isCapturing,
    demoting: st.demoting,
    measurementSource: st.measurementSource,
    selectedChannel: st.selectedChannel,
    appMode: st.appMode,
    boardShapeVersion: st.boardShapeVersion,
    secondaryMeasurement: st.secondaryMeasurement,
    secondaryWindows: st.secondaryWindows,
    lastMeasurementChannels: st.lastMeasurementChannels,
  }));
  const settings = useStoreShallow(useSettingsStore, (st) => st.settings);
  const soundcheck = useStoreShallow(useSoundcheckStore, (st) => ({
    manifest: st.manifest,
    routes: st.routes,
    deviceChannels: st.deviceChannels,
  }));

  // The pane reads the animation-rate channels imperatively (currentEqPaneChannels
  // falls back to idle placeholders before the first tick); boardShapeVersion
  // is what re-renders it when a tick's channel count changes.
  const lc = useLiveCaptureStore.getState();
  const state = liveWorkspaceViewState(lc, settings);

  // #460 (ADR 0003): when the experimental secondary source is active it owns
  // the Room — the pane's primary slot swaps to the room mic's channel 0 +
  // device name. roomPaneOverride() returns null whenever the flag is off or
  // the source isn't active (the #602 parity guard), so the board path is
  // byte-identical.
  const secondaryActive = s.secondaryMeasurement.status === 'active' && s.secondaryWindows.length > 0;
  const roomOverride = roomPaneOverride(
    secondaryActive, s.secondaryWindows, s.lastMeasurementChannels, s.secondaryMeasurement.deviceName);
  const selectedStrip = s.selectedChannel != null && s.selectedChannel >= 0
    ? s.channelConfig[s.selectedChannel] ?? null
    : null;
  // Keep inspector bindings in the pane view's discrete signature while level
  // tiles remain on the meter controller's imperative patch path.
  const liveRunning = boardRunning({ isCapturing: s.isCapturing, demoting: s.demoting });
  const inspector = selectedStrip && s.selectedChannel != null
    ? {
      selectedIndex: s.selectedChannel,
      strip: selectedStrip,
      deviceChannels: deviceChannelCount(s.selectedDevice, s.devices),
      disabled: liveRunning,
      playbackTrack: soundcheck.manifest?.tracks[s.selectedChannel] ?? null,
      playbackRoute: soundcheck.routes[s.selectedChannel] ?? [0],
      playbackDeviceChannels: soundcheck.deviceChannels,
      levelTiles: selectedEqPaneLevelTilesView(currentEqPaneChannels(state), s.selectedChannel),
    }
    : null;
  const view: EqPaneView = eqPaneView(
    currentEqPaneChannels(state), s.channelConfig, s.measurementSource, s.selectedChannel, roomOverride, inspector);
  const signature = eqPaneSignature(view);
  // Rebuild the innerHTML only when the discrete signature (which channel,
  // which label, the room override, the render mode) changes — the per-tick
  // arc/bars patches from the meter controller survive because this memoized
  // string stays the same across ticks.
  const html = useMemo(() => eqPaneHTML(view), [signature]);
  // Keep configuration locked for the entire record→monitor handoff (#847),
  // including the stop IPC interval where isCapturing is temporarily false.
  const classificationHtml = useMemo(() => {
    if (!selectedStrip || s.selectedChannel == null) return eqPaneClassificationHTML(null);
    const profiles = getInstrumentProfiles().PROFILES;
    const token = getArmState().stripToken(selectedStrip);
    const savedProfiles = ((settings || {}).inputInstrumentProfiles || {})[deviceNameFor(s.selectedDevice, s.devices)] || {};
    const savedProfile = savedProfiles[token];
    return eqPaneClassificationHTML({
      selectedIndex: s.selectedChannel,
      groupIndex: getGroupState().groupOf(s.channelGroups, s.selectedChannel),
      groups: s.channelGroups,
      profiles,
      effectiveProfileId: getInstrumentProfiles().effectiveProfileId(savedProfiles, token, selectedStrip.label),
      instrumentAuto: !(savedProfile && getInstrumentProfiles().isKnownProfileId(savedProfile)),
      disabled: liveRunning,
    });
  }, [selectedStrip, s.selectedChannel, s.channelGroups, s.selectedDevice, s.devices, settings?.inputInstrumentProfiles, liveRunning]);
  const inspectorHtml = useMemo(() => eqPaneInspectorHTML(view.inspector), [signature]);

  function onClassificationChange(e: FormEvent<HTMLDivElement>): void {
    const target = e.target;
    if (!(target instanceof HTMLSelectElement)) return;
    const current = useLiveCaptureStore.getState();
    const deps: ClassificationChangeDeps = {
      liveCapture: current,
      settings: useSettingsStore.getState(),
      instrumentProfiles: getInstrumentProfiles(),
      armState: getArmState(),
    };
    if (target.closest('.eq-pane-classification-group')) {
      applyEqPaneClassificationChange('group', target.value, deps);
      return;
    }
    if (target.closest('.eq-pane-classification-profile')) {
      applyEqPaneClassificationChange('profile', target.value, deps);
    }
  }

  function inspectorDeps(): EqPaneInspectorChangeDeps {
    return { liveCapture: useLiveCaptureStore.getState(), soundcheck: useSoundcheckStore.getState() };
  }

  function onInspectorInput(e: FormEvent<HTMLDivElement>): void {
    const target = e.target;
    if (!(target instanceof HTMLInputElement) || !target.classList.contains('eq-pane-inspector-label')) return;
    applyEqPaneInspectorChange('label', target.value, inspectorDeps());
  }

  function onInspectorChange(e: FormEvent<HTMLDivElement>): void {
    const target = e.target;
    if (!(target instanceof HTMLSelectElement)) return;
    if (target.classList.contains('eq-pane-inspector-kind')) applyEqPaneInspectorChange('kind', target.value, inspectorDeps());
    else if (target.classList.contains('eq-pane-inspector-source')) applyEqPaneInspectorChange('source', `${target.value}:${target.dataset.field ?? 'a'}`, inspectorDeps());
    else if (target.classList.contains('eq-pane-inspector-output')) applyEqPaneInspectorChange('output', target.value, inspectorDeps());
  }

  function onInspectorClick(e: FormEvent<HTMLDivElement>): void {
    const target = e.target;
    if (!(target instanceof HTMLButtonElement) || !target.classList.contains('eq-pane-inspector-arm')) return;
    applyEqPaneInspectorChange('arm', '', inspectorDeps());
  }

  /* c8 ignore start -- visibility/width + resize wiring, no jsdom in this
     harness (renderToString doesn't run effects) — exercised by
     tests/e2e/live-capture-workspace.spec.ts (drag + keyboard resize, min
     clamp) and live-capture.spec.ts (pane visible on the Live tab). */
  useEffect(() => {
    const pane = document.getElementById('live-eq-pane');
    if (!pane) return;
    pane.style.display = s.appMode === 'live' ? 'flex' : 'none';
    pane.style.width = clampEqPaneWidth(settings?.liveEqPaneWidth) + 'px';
  }, [s.appMode, settings?.liveEqPaneWidth]);

  // Port of inline-app.js's initEqPaneResize IIFE (#668): drag the handle, or
  // focus it and press ArrowLeft/ArrowRight. The pane is docked to the right
  // edge of #workspace with the handle riding its left edge, so dragging toward
  // the window's center (decreasing clientX) widens it. The final width
  // persists to settings.json so it survives across sessions.
  useEffect(() => {
    const pane = document.getElementById('live-eq-pane');
    const handle = document.getElementById('live-eq-resize');
    if (!pane || !handle) return;
    let startX = 0;
    let startW = 0;
    const widthFromDrag = (clientX: number): number => clampEqPaneWidth(startW + (startX - clientX));
    const onPointerMove = (ev: PointerEvent): void => {
      pane.style.width = widthFromDrag(ev.clientX) + 'px';
    };
    const onPointerUp = (ev: PointerEvent): void => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      void useSettingsStore.getState().updateSettings({ liveEqPaneWidth: widthFromDrag(ev.clientX) });
    };
    const onPointerDown = (ev: PointerEvent): void => {
      startX = ev.clientX;
      startW = clampEqPaneWidth(parseFloat(pane.style.width));
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
    };
    const onKeyDown = (ev: KeyboardEvent): void => {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      ev.preventDefault();
      const current = clampEqPaneWidth(parseFloat(pane.style.width));
      // Matches the drag handle's direction (decreasing clientX widens):
      // ArrowLeft widens, ArrowRight shrinks.
      const next = clampEqPaneWidth(current + (ev.key === 'ArrowLeft' ? EQ_PANE_RESIZE_STEP : -EQ_PANE_RESIZE_STEP));
      pane.style.width = next + 'px';
      void useSettingsStore.getState().updateSettings({ liveEqPaneWidth: next });
    };
    handle.addEventListener('pointerdown', onPointerDown);
    handle.addEventListener('keydown', onKeyDown);
    return () => {
      handle.removeEventListener('pointerdown', onPointerDown);
      handle.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
    };
  }, []);
  /* c8 ignore stop */

  return <div>
    <div dangerouslySetInnerHTML={{ __html: html }} />
    <div onInput={onInspectorInput} onChange={onInspectorChange} onClick={onInspectorClick} dangerouslySetInnerHTML={{ __html: inspectorHtml }} />
    <div onInput={onClassificationChange} dangerouslySetInnerHTML={{ __html: classificationHtml }} />
    <footer className="eq-pane-footer">Sound Buddy does not write to your console.</footer>
  </div>;
}
