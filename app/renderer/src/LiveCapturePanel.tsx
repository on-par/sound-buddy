// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The mounted live-workspace board (slice 6g, #710), rendered by
// LiveWorkspace into #live-island — the rewritten replacement for the legacy
// presentational shell this file used to export. Subscribes ONLY to discrete
// store fields (appMode/channelConfig/channelGroups/isCapturing/liveMode/
// devices/selectedDevice/boardShapeVersion/lastTick!==null/settings/
// lapCoaching/focusedInputIndex); per-tick data (lastTick/lastLiveChannels/
// liveWindows/lastMeasurementChannels) is read as one-time getState()
// snapshots at render time, never subscribed (ADR-0005). The board's HTML
// comes from the pure live-board.ts builders through dangerouslySetInnerHTML,
// so React's string-diff only rebuilds the DOM on discrete changes and the
// DOM stays byte-identical to the imperative renderers it replaces. Every
// per-tick DOM write happens in live-board.ts's patch appliers, driven by
// LiveWorkspace's live-meter-controller.

import { useLayoutEffect, useState, type JSX, type MouseEvent as ReactMouseEvent, type KeyboardEvent as ReactKeyboardEvent, type ChangeEvent as ReactChangeEvent } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore, deviceNameFor } from './stores/liveCaptureStore';
import { useSettingsStore } from './stores/settingsStore';
import { useSpectrumStore } from './stores/spectrumStore';
import {
  boardHTML,
  dawShellHTML,
  dawShellShowing,
  heroHTML,
  liveAdjustmentsPanelHTML,
  liveBoardShowing,
  liveBoardState,
  workspaceIsEmpty,
  markSetupGuideComplete,
  resolveStripName,
  lapFocusView,
  lapObservationContext,
} from './live-board';

declare global {
  interface Window {
    // 6g bridge: the React DAW-shell branch repaints playhead + waveforms
    // after each render (6j functions stay in inline-app.js).
    liveDawShellRepaint?: () => void;
    // renderChannelConfig (6h/6i, rigs.spec.ts) — the inline-app.js function
    // the inline name-edit commit re-asserts through.
    renderChannelConfig?: () => void;
  }
}

// Make a live meter header name click-to-edit (#39): commit on blur/Enter into
// the matching channelConfig strip's label, Escape cancels. Port of
// inline-app.js's wireLiveNameEdit, now store-driven.
/* c8 ignore start -- DOM-wiring glue, no jsdom in this harness
   (renderToString doesn't run effects); exercised by
   tests/e2e/live-capture.spec.ts ("per-channel labels: workspace inline rename
   and fallback (#39)"). */
function wireLiveNameEdit(nameEl: HTMLElement): void {
  const idx = parseInt(nameEl.closest('.live-ch')?.getAttribute('data-ch') ?? '', 10);
  let original = nameEl.textContent;
  nameEl.addEventListener('focus', () => { original = nameEl.textContent; });
  const commit = () => {
    const strip = useLiveCaptureStore.getState().channelConfig[idx];
    if (!strip || nameEl.textContent === original) return;
    useLiveCaptureStore.getState().setStripLabel(idx, nameEl.textContent ?? '');
    const resolved = resolveStripName(
      useLiveCaptureStore.getState().channelConfig[idx],
      useLiveCaptureStore.getState().lastLiveChannels?.[idx] ?? null,
      idx,
    );
    nameEl.textContent = resolved;
    original = resolved;
    window.renderChannelConfig?.();
  };
  nameEl.addEventListener('blur', commit);
  nameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); nameEl.textContent = original; nameEl.blur(); }
  });
}

// Strip selection (#668): drives the docked EQ pane's "Selected" section.
// Toggles the .selected/aria-current classes on the current DOM imperatively
// (the board does NOT subscribe to selectedChannel — patchEqPane + React's
// LiveEqPane react), matching inline-app.js's selectStrip().
function selectStrip(idx: number): void {
  useLiveCaptureStore.getState().setSelectedChannel(idx);
}
/* c8 ignore stop */

export default function LiveCapturePanel(): JSX.Element | null {
  const {
    appMode, channelConfig, channelGroups, isCapturing, liveMode, devices, selectedDevice,
    boardShapeVersion, hasTick, selectedChannel, measurementSource,
  } = useStoreShallow(useLiveCaptureStore, (s) => ({
    appMode: s.appMode,
    channelConfig: s.channelConfig,
    channelGroups: s.channelGroups,
    isCapturing: s.isCapturing,
    liveMode: s.liveMode,
    devices: s.devices,
    selectedDevice: s.selectedDevice,
    boardShapeVersion: s.boardShapeVersion,
    hasTick: s.lastTick !== null,
    selectedChannel: s.selectedChannel,
    measurementSource: s.measurementSource,
  }));
  const settings = useStoreShallow(useSettingsStore, (s) => s.settings);
  const lapCoaching = useStoreShallow(useLiveCaptureStore, (s) => s.lapCoaching);
  const focusedInputIndex = useStoreShallow(useLiveCaptureStore, (s) => s.focusedInputIndex);

  // Local dismiss state: forcing a re-render lets bannerHTML re-read
  // localStorage after markSetupComplete (the guide is gated on it).
  const [, setGuideDismissed] = useState(false);

  if (appMode !== 'live') return null;

  const state = liveBoardState();
  const dawShell = dawShellShowing(settings, appMode);
  const adjustmentsHTML = liveAdjustmentsPanelHTML(state);

  // Board renders: DAW shell (#517), the zero-track hero (#294), or the meter
  // workspace. The adjustments panel follows the shell/board (matches the old
  // syncLiveAdjustmentsPanel call sites) but not the hero (which never synced
  // it). Rendered via dangerouslySetInnerHTML so the DOM is byte-identical to
  // the imperative renderers and React only rebuilds on discrete changes.
  let innerHTML: string;
  if (dawShell) innerHTML = dawShellHTML(state) + adjustmentsHTML;
  else if (workspaceIsEmpty(state.channelConfig)) innerHTML = heroHTML(state);
  else innerHTML = boardHTML(state) + adjustmentsHTML;

  /* c8 ignore start -- delegated DOM handlers + effect wiring, no jsdom in
     this harness (renderToString doesn't run effects or dispatch events);
     exercised by tests/e2e/live-capture.spec.ts, live-capture-workspace.spec.ts,
     named-channel-groups.spec.ts, and live-capture-report-card.spec.ts. */
  useLayoutEffect(() => {
    // Mirror the old renderers' hide-the-React-curve-view while the board is
    // live — but never clobber the failed-start error/loading state, which is
    // set after the board's own render in the capture IPC flow (last-writer
    // wins in the old synchronous code; React's async commit would otherwise
    // erase it).
    const panel = useSpectrumStore.getState();
    if (panel.panelState !== 'error' && panel.panelState !== 'loading') panel.setPanelState('meters');
    // The header stats row + ideal-profile wrap: flex while the meter board is
    // showing (capturing with a tick), none while idle — the chrome the old
    // renderLiveMeters/renderLiveWorkspace toggled (mirrors renderLiveMeters'
    // 'flex' vs renderLiveWorkspace's 'none').
    const row = document.getElementById('stats-row');
    if (row) row.style.display = liveBoardShowing(liveBoardState()) ? 'flex' : 'none';
    const ipWrap = document.getElementById('ideal-profile-wrap');
    if (ipWrap) ipWrap.style.display = 'none';
    // Re-wire inline name edits after a DOM rebuild; nodes React keeps are
    // skipped (they already carry their wiring).
    document.querySelectorAll('#live-island .sb-live-meters .live-ch-name').forEach((nameEl) => {
      const el = nameEl as HTMLElement;
      if (el.dataset.nameWired) return;
      el.dataset.nameWired = '1';
      wireLiveNameEdit(el);
    });
    if (dawShell) window.liveDawShellRepaint?.();
  }, [dawShell, appMode, boardShapeVersion, channelConfig, channelGroups, isCapturing, liveMode, devices, selectedDevice, hasTick, selectedChannel, measurementSource, lapCoaching, focusedInputIndex, settings]);

  const handleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // Guided first-use setup dismiss (#294): retire the banner permanently.
    if (target.closest('#live-setup-skip')) {
      markSetupGuideComplete(window.localStorage);
      setGuideDismissed(true);
      return;
    }
    // Live coaching dispositions (#613/#614) — port of the inline click branch.
    const lapActionBtn = target.closest('[data-lap-action]');
    if (lapActionBtn) {
      const s = useLiveCaptureStore.getState();
      const deviceName = deviceNameFor(s.selectedDevice, s.devices);
      const savedProfiles = ((useSettingsStore.getState().settings || {}).inputInstrumentProfiles || {})[deviceName] || {};
      const focus = lapFocusView({
        focusedIndex: s.focusedInputIndex,
        channelConfig: s.channelConfig,
        channels: s.lastLiveChannels,
        savedInstrumentProfiles: savedProfiles,
      });
      const context = lapObservationContext(s.liveWindows, s.measurementSource, focus);
      s.applyLapAction(lapActionBtn.getAttribute('data-lap-action') ?? '', Date.now(), context);
      return;
    }
    // Strip selection (#668): clicking anywhere on a strip (but not one of its
    // interactive controls) inspects it in the docked EQ pane.
    const stripEl = target.closest('.live-ch');
    if (stripEl && !target.closest('button, select, [contenteditable], input')) {
      selectStrip(parseInt(stripEl.getAttribute('data-ch') ?? '', 10));
    }
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target as HTMLElement;
    const stripEl = target.closest('.live-ch');
    if (stripEl && target === stripEl) {
      e.preventDefault();
      selectStrip(parseInt(stripEl.getAttribute('data-ch') ?? '', 10));
    }
  };

  const handleChange = (e: ReactChangeEvent<HTMLDivElement>) => {
    // Focused-input selector (#525) — ephemeral, routes through the store so
    // the React adjustments panel re-renders.
    const sel = (e.target as HTMLElement).closest('.lap-focus-select') as HTMLSelectElement | null;
    if (!sel) return;
    useLiveCaptureStore.getState().setFocusedInputIndex(sel.value === '' ? null : parseInt(sel.value, 10));
  };
  /* c8 ignore stop */

  return (
    <div onClick={handleClick} onKeyDown={handleKeyDown} onChange={handleChange}>
      <div dangerouslySetInnerHTML={{ __html: innerHTML }} />
    </div>
  );
}
