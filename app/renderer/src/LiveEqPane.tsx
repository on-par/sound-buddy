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

import { useEffect, useMemo, type JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useSettingsStore } from './stores/settingsStore';
import {
  clampEqPaneWidth,
  eqPaneView,
  eqPaneSignature,
  eqPaneHTML,
  EQ_PANE_RESIZE_STEP,
  type EqPaneView,
} from './live-capture-panel';
import { roomPaneOverride } from './measurement-device-state';
import { currentEqPaneChannels, type LiveWorkspaceViewState } from './live-workspace-view';

export default function LiveEqPane(): JSX.Element {
  const s = useStoreShallow(useLiveCaptureStore, (st) => ({
    channelConfig: st.channelConfig,
    measurementSource: st.measurementSource,
    selectedChannel: st.selectedChannel,
    appMode: st.appMode,
    boardShapeVersion: st.boardShapeVersion,
    secondaryMeasurement: st.secondaryMeasurement,
    secondaryWindows: st.secondaryWindows,
    lastMeasurementChannels: st.lastMeasurementChannels,
  }));
  const settings = useStoreShallow(useSettingsStore, (st) => st.settings);

  // The pane reads the animation-rate channels imperatively (currentEqPaneChannels
  // falls back to idle placeholders before the first tick); boardShapeVersion
  // is what re-renders it when a tick's channel count changes.
  const lc = useLiveCaptureStore.getState();
  const state: LiveWorkspaceViewState = {
    channelConfig: s.channelConfig,
    channelGroups: lc.channelGroups,
    devices: lc.devices,
    selectedDevice: lc.selectedDevice,
    isCapturing: lc.isCapturing,
    liveMode: lc.liveMode,
    appMode: lc.appMode,
    selectedChannel: s.selectedChannel,
    measurementSource: s.measurementSource,
    focusedInputIndex: lc.focusedInputIndex,
    lastTick: lc.lastTick,
    lastLiveChannels: lc.lastLiveChannels,
    liveWindows: lc.liveWindows,
    settings,
    lapCoaching: lc.lapCoaching,
    playheadElapsedMs: 0,
  };

  // #460 (ADR 0003): when the experimental secondary source is active it owns
  // the Room — the pane's primary slot swaps to the room mic's channel 0 +
  // device name. roomPaneOverride() returns null whenever the flag is off or
  // the source isn't active (the #602 parity guard), so the board path is
  // byte-identical.
  const secondaryActive = s.secondaryMeasurement.status === 'active' && s.secondaryWindows.length > 0;
  const roomOverride = roomPaneOverride(
    secondaryActive, s.secondaryWindows, s.lastMeasurementChannels, s.secondaryMeasurement.deviceName);
  const view: EqPaneView = eqPaneView(
    currentEqPaneChannels(state), s.channelConfig, s.measurementSource, s.selectedChannel, roomOverride);
  const signature = eqPaneSignature(view);
  // Rebuild the innerHTML only when the discrete signature (which channel,
  // which label, the room override, the render mode) changes — the per-tick
  // arc/bars patches from the meter controller survive because this memoized
  // string stays the same across ticks.
  const html = useMemo(() => eqPaneHTML(view), [signature]);

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

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
