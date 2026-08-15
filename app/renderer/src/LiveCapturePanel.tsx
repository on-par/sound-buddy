// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The live-capture workspace board island (TD-001 slice 6g, #710) — replaces
// the never-mounted props component this file used to be (its props API is
// gone; LiveCapturePanel.test.ts was rewritten to pin the board markup).
// LiveCapturePanel subscribes to liveCaptureStore's DISCRETE board-shape
// fields and rebuilds #live-island's markup via dangerouslySetInnerHTML from
// the pure live-workspace-view builders, reading lastTick/lastLiveChannels
// imperatively at render time (never via subscription — ADR-0005). Per-tick
// meter values (levels, names, clip flags, group summaries, EQ-pane arcs,
// stats row) are patched straight to the DOM by LiveWorkspace.tsx's mounted
// createLiveMeterController, exactly like the pre-6g bridged renderer.
// React only re-assigns the dangerouslySetInnerHTML strings when they change,
// so the imperative per-tick patches persist between re-renders.
//
// The 6g interaction branches (strip select, keyboard strip select, group
// fold, setup-skip dismiss, lap dispositions, lap-focus-select, inline rename)
// are delegated handlers on this wrapper div — the content is
// dangerouslySetInnerHTML, so React-owned handlers must ride an ancestor. The
// capture controls / channel-group CRUD (add/remove/arm/arm-all/kind/src/
// group/profile/drag-reorder) stay on inline-app.js's #spectrum-body
// listeners (slice 6h) — clicks on React-rendered controls bubble to them
// unchanged.

import { useEffect, type ChangeEvent, type FocusEvent, type JSX, type KeyboardEvent, type MouseEvent } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore, type LapAction } from './stores/liveCaptureStore';
import { useSettingsStore } from './stores/settingsStore';
import { useSpectrumStore } from './stores/spectrumStore';
import { iconSvg } from './report-card';
import {
  liveAdjustmentsPanelHTML,
  liveSetupStepsHTML,
  liveSetupStepsView,
  liveWorkspaceToolbarHTML,
  meterCardHTML,
  dawShellHTML,
  dawShellPatchView,
  addTrackDisabled,
  getTrackWorkspace,
  getLiveSetupState,
  getDawWorkspaceState,
  getDawShellRuntime,
  liveWorkspaceViewState,
} from './live-workspace-view';

// The still-classic live-setup-state.js accessor's storage contract (a
// localStorage-like object; a missing/throwing storage is treated as "not
// done" by the classic script itself).
interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// Per-element "original text" snapshot for the delegated inline rename (#39),
// keyed by the .live-ch-name element being edited. Survives the element being
// replaced between edits (a re-render destroys the node, so the WeakMap entry
// for it is garbage-collected and a fresh snapshot is taken on focus).
const nameOriginals = new WeakMap<Element, string>();

/* c8 ignore start -- DOM-shape helpers for the delegated interaction handlers
   below; no jsdom in this harness (they need real Element/closest/dataset),
   so they ride the handlers' e2e gates — tests/e2e/live-capture.spec.ts's
   inline-rename case exercises nameElOf/stripIndexIn. */
// The .live-ch-name element a focused/blurred target belongs to, or null.
function nameElOf(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  const name = target.closest('.live-ch-name');
  return name && name.contains(target) ? name : null;
}

function stripIndexIn(nameEl: Element): number {
  const strip = nameEl.closest('.live-ch');
  return parseInt((strip as HTMLElement | null)?.dataset.ch ?? '', 10);
}
/* c8 ignore stop */

export default function LiveCapturePanel(): JSX.Element | null {
  const s = useStoreShallow(useLiveCaptureStore, (st) => ({
    channelConfig: st.channelConfig,
    channelGroups: st.channelGroups,
    devices: st.devices,
    selectedDevice: st.selectedDevice,
    isCapturing: st.isCapturing,
    liveMode: st.liveMode,
    appMode: st.appMode,
    selectedChannel: st.selectedChannel,
    measurementSource: st.measurementSource,
    focusedInputIndex: st.focusedInputIndex,
    lapCoaching: st.lapCoaching,
    boardShapeVersion: st.boardShapeVersion,
    liveWindows: st.liveWindows,
  }));
  const settings = useStoreShallow(useSettingsStore, (st) => st.settings);

  // lastTick/lastLiveChannels are animation-rate values — read imperatively at
  // render time, never via subscription. boardShapeVersion (also subscribed
  // above) is what re-renders the board when a tick's channel count changes.
  const lc = useLiveCaptureStore.getState();
  const state = liveWorkspaceViewState(lc, settings, getDawShellRuntime()?.playheadElapsedMs?.() ?? 0);

  const showShell = getDawWorkspaceState().showShell(settings, s.appMode);
  const laneSignature = showShell ? dawShellPatchView(state).laneSignature : '';

  /* c8 ignore start -- effect wiring + imperative chrome, no jsdom in this
     harness (renderToString doesn't run effects) — exercised by
     tests/e2e/live-capture.spec.ts (stats row shows while capturing, spectrum
     panel stays in meters mode) and live-capture-workspace.spec.ts. */
  useEffect(() => {
    if (s.appMode !== 'live') return;
    const statsRow = document.getElementById('stats-row');
    if (statsRow) statsRow.style.display = s.isCapturing && !showShell ? 'flex' : 'none';
    const ipWrap = document.getElementById('ideal-profile-wrap');
    if (ipWrap) ipWrap.style.display = 'none';
    useSpectrumStore.getState().setPanelState('meters'); // hide #spectrum-island's React curve view while the board renders
  }, [s.appMode, s.isCapturing, showShell]);

  // DAW shell (#517/#518/#520): stamp the lane fingerprint (the React
  // rebuild-decision key for same-count rig swaps) and hand the still-inline
  // waveform/playhead painters (slice 6j) the shell to paint after every
  // rebuild — the meter controller re-paints them per tick thereafter.
  useEffect(() => {
    if (!showShell) return;
    const shell = document.getElementById('live-island')?.querySelector('.daw-shell');
    if (shell) shell.setAttribute('data-lane-signature', laneSignature);
    getDawShellRuntime()?.renderPlayhead?.();
    getDawShellRuntime()?.renderWaveform?.();
  }, [showShell, laneSignature]);
  /* c8 ignore stop */

  if (s.appMode !== 'live') return null;

  const adjustmentsHtml = liveAdjustmentsPanelHTML(state);
  let board: string;
  if (showShell) {
    board = dawShellHTML(state);
  } else if (getTrackWorkspace().isEmpty(s.channelConfig.length)) {
    // Guided first-use setup (#294): a zero-track workspace shows an
    // instructional hero (no toolbar) instead of the bare empty state.
    const heroAddDisabled = addTrackDisabled(state);
    board = `<div class="live-setup-hero">`
      + iconSvg('radio', 34)
      + `<h2 class="lsh-title">Set up your live check</h2>`
      + `<p class="lsh-sub">Three steps from silence to live meters.</p>`
      + `<ol class="ls-steps">${liveSetupStepsHTML(liveSetupStepsView(state))}</ol>`
      + `<button type="button" class="btn btn-primary" id="live-ws-add"${heroAddDisabled ? ' disabled' : ''}>${iconSvg('plus', 16)}Add your first track</button>`
      + `</div>`;
  } else {
    const toolbar = liveWorkspaceToolbarHTML(state);
    const banner = getLiveSetupState().shouldShowGuide(window.localStorage as unknown as StorageLike)
      ? `<div class="live-setup-banner" role="note">`
        + `<span class="lsb-title">Getting set up</span>`
        + `<ol class="ls-steps compact">${liveSetupStepsHTML(liveSetupStepsView(state))}</ol>`
        + `<button type="button" class="ghost-btn sm" id="live-setup-skip">Dismiss</button>`
        + `</div>`
      : '';
    board = banner + toolbar + meterCardHTML(state).html;
  }
  const body = board + adjustmentsHtml;

  /* c8 ignore start -- delegated interaction handlers, no jsdom in this
     harness (renderToString doesn't dispatch events) — exercised by
     tests/e2e/live-capture.spec.ts (strip select + inline rename),
     named-channel-groups.spec.ts (group fold), and the live-adjustments
     coaching/disposition paths. */
  function onBoardClick(e: MouseEvent<HTMLDivElement>): void {
    const target = e.target as Element;
    // Guided first-use dismiss (#294): retire the banner permanently. The
    // node is removed directly rather than only via a re-render —
    // renderChannelConfig() early-outs while a capture is running, the same
    // fix the capture-start success path already relies on.
    if (target.closest('#live-setup-skip')) {
      getLiveSetupState().markSetupComplete(window.localStorage as unknown as StorageLike);
      const skipBanner = document.querySelector('#spectrum-body .live-setup-banner');
      if (skipBanner) skipBanner.remove();
      return;
    }
    // Live coaching dispositions (#613/#614) — engineer control over the card.
    const lapActionBtn = target.closest('[data-lap-action]');
    if (lapActionBtn) {
      const action = lapActionBtn.getAttribute('data-lap-action') as LapAction;
      useLiveCaptureStore.getState().lapDispose(action);
      return;
    }
    // Group header fold (#483): collapse the whole group to its summary row.
    const gfold = target.closest('.live-group-fold');
    if (gfold) {
      const g = parseInt(gfold.closest('.live-group-head')?.getAttribute('data-group') ?? '', 10);
      if (Number.isInteger(g)) useLiveCaptureStore.getState().toggleGroupCollapse(g);
      return;
    }
    // Strip selection (#668): clicking anywhere on a strip (but not one of its
    // interactive controls) inspects it in the docked EQ pane. The selected
    // class + aria-current derive from stripViewAt's `selected` field, so the
    // React re-render on selectedChannel handles them — no imperative toggle.
    const stripEl = target.closest('.live-ch');
    if (stripEl && !target.closest('button, select, [contenteditable], input')) {
      const idx = parseInt((stripEl as HTMLElement).dataset.ch ?? '', 10);
      if (Number.isInteger(idx)) useLiveCaptureStore.getState().setSelectedChannel(idx);
    }
  }

  function onBoardKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    const target = e.target as Element;
    // Inline rename (#39): Enter commits via blur, Escape restores + blurs.
    const name = nameElOf(target);
    if (name) {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        if (e.key === 'Escape') {
          const original = nameOriginals.get(name);
          if (original !== undefined) name.textContent = original;
        }
        (name as HTMLElement).blur();
      }
      return;
    }
    // Keyboard strip select (#668): Enter/Space while the strip itself (not
    // one of its interactive children) has focus.
    if (e.key === 'Enter' || e.key === ' ') {
      const stripEl = target.closest('.live-ch');
      if (stripEl && target === stripEl) {
        e.preventDefault();
        const idx = parseInt((stripEl as HTMLElement).dataset.ch ?? '', 10);
        if (Number.isInteger(idx)) useLiveCaptureStore.getState().setSelectedChannel(idx);
      }
    }
  }

  function onBoardChange(e: ChangeEvent<HTMLDivElement>): void {
    const target = e.target as Element;
    // Focused-input selector (#525) — ephemeral, so it just re-renders the
    // adjustments panel from the store.
    const focusSel = target.closest('.lap-focus-select');
    if (focusSel) {
      const value = (e.target as unknown as HTMLSelectElement).value;
      useLiveCaptureStore.getState().setFocusedInputIndex(value === '' ? null : parseInt(value, 10));
    }
  }

  function onNameFocus(e: FocusEvent<HTMLDivElement>): void {
    const name = nameElOf(e.target);
    if (name) nameOriginals.set(name, name.textContent ?? '');
  }

  function onNameBlur(e: FocusEvent<HTMLDivElement>): void {
    const name = nameElOf(e.target);
    if (!name) return;
    const strip = useLiveCaptureStore.getState().channelConfig[stripIndexIn(name)];
    const original = nameOriginals.get(name);
    if (!strip || name.textContent === original) return;
    // setStripLabel (#482) trims/caps and persists keyed by device + strip
    // token; the board re-renders from the store, so the resolved name (label
    // falls back to the device name / Ch N) flows through stripViewAt.
    useLiveCaptureStore.getState().setStripLabel(stripIndexIn(name), name.textContent ?? '');
    // Keep the header badge's measurement label in sync (renderMeasurementBadge
    // is still-inline 6k chrome, reached by name like the 6h mutators do).
    (window as unknown as { renderMeasurementBadge?: () => void }).renderMeasurementBadge?.();
    nameOriginals.set(name, name.textContent ?? '');
  }
  /* c8 ignore stop */

  return (
    <div
      className="live-board-root"
      onClick={onBoardClick}
      onKeyDown={onBoardKeyDown}
      onChange={onBoardChange}
      onFocus={onNameFocus}
      onBlur={onNameBlur}
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}
