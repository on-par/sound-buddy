// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Owns #live-island's VISIBILITY, the per-tick meter controller, and renders
// the board itself (TD-001 slice 6g, #710). The board markup is no longer
// built by inline-app.js's renderLiveWorkspace()/renderLiveMeters()/
// renderDawShell() — <LiveCapturePanel> renders it from liveCaptureStore's
// discrete state (reading lastTick/lastLiveChannels imperatively at render
// time), and the meter controller mounted here patches the per-tick values
// straight to that React-rendered DOM (ADR-0005). What changed versus 6c:
// window.liveWorkspaceRuntime.patchTick is gone; the patch callback now calls
// the pure appliers (patchLiveChannel per strip, patchGroupSummaries,
// patchEqPaneSection via eqPanePatchPlan, patchStatsRow) directly, and the
// still-inline DAW waveform/playhead painters via the window.dawShellRuntime
// bridge (slice 6j).
//
// liveCaptureStore IS the single source of truth for board SHAPE
// (channelConfig/channelGroups/isCapturing/liveMode/devices/selectedChannel)
// — React re-renders <LiveCapturePanel> on those fields (useSyncExternalStore),
// replacing the old syncLiveCaptureMirror -> renderWorkspace() imperative
// subscription. Per-tick meter values never round-trip through React state —
// the controller below patches the DOM directly from liveCaptureStore's
// lastTick.

import { useEffect, type JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useSettingsStore } from './stores/settingsStore';
import { createLiveMeterController, type LiveMeterSnapshot } from './live-meter-controller';
import { liveLevelReadout, patchLevelReadout } from './live-level-readout';
import {
  patchLiveChannel,
  patchGroupSummaries,
  patchEqPaneSection,
  patchEqPaneLevelTiles,
  levelPercent,
  eqPaneView,
  eqPanePatchPlan,
  measurementChannel,
} from './live-capture-panel';
import {
  stripViewAt,
  currentEqPaneChannels,
  liveStatsRowView,
  selectedEqPaneLevelTilesView,
  patchStatsRow,
  dawShellPatchView,
  getDawWorkspaceState,
  getDawShellRuntime,
  liveWorkspaceViewState,
  boardRunning,
} from './live-workspace-view';
import { roomPaneOverride } from './measurement-device-state';
import type { LiveEvent } from './live-capture-panel';
import LiveCapturePanel from './LiveCapturePanel';

/* c8 ignore start -- DOM-patching meter-tick applier, no jsdom in this
   harness (renderToString doesn't run effects, and the patch only fires on
   the mounted controller's rAF) — exercised by tests/e2e/live-capture.spec.ts
   (in-place tick patch with the surviving data-marker, stats row, EQ-pane
   arcs) and named-channel-groups.spec.ts (group-summary refresh). */
function applyLiveTick(snap: LiveMeterSnapshot): void {
  const lc = useLiveCaptureStore.getState();
  const tick = snap.lastTick;
  if (!tick || !tick.channels || tick.channels.length === 0) return;
  const state = liveWorkspaceViewState(lc, useSettingsStore.getState().settings);
  const body = document.getElementById('live-island');
  if (!body) return;

  // Room stats row: the board strip, or the secondary mic when it owns the
  // room (mirrors onLiveEvent/onMeasurementEvent — it updates even while the
  // DAW shell is showing, where the row is display:none).
  if (!snap.secondaryActive) {
    const statsCh = measurementChannel(tick.channels, snap.measurementSource);
    if (statsCh) patchStatsRow(liveStatsRowView(statsCh));
  } else if (snap.lastMeasurementChannels && snap.lastMeasurementChannels[0]) {
    patchStatsRow(liveStatsRowView(snap.lastMeasurementChannels[0]));
  }

  // DAW shell patch path (#517/#518/#520): the shell owns the pane, so only
  // the transport chip and the still-inline waveform/playhead painters refresh
  // per tick — the EQ-pane arcs stay on the meter workspace, exactly like the
  // old renderDawShell hand-off.
  if (getDawWorkspaceState().showShell(state.settings, state.appMode)) {
    const shell = body.querySelector('.daw-shell');
    if (shell) {
      const view = dawShellPatchView(state);
      const chip = shell.querySelector('.daw-transport-state');
      if (chip && chip.textContent !== view.transportChip) {
        chip.textContent = view.transportChip;
        chip.className = `daw-transport-state daw-transport-state-${view.transportChip.toLowerCase()}`;
      }
      const mixLane = shell.querySelector('.daw-mix-lane');
      if (mixLane && mixLane.getAttribute('data-capture-mode') !== view.captureMode) {
        mixLane.setAttribute('data-capture-mode', view.captureMode);
      }
      tick.channels.forEach((ch, index) => {
        const fill = shell.querySelector<HTMLElement>(`.daw-track-head[data-ch="${index}"] .daw-track-head-level-fill`);
        if (fill) fill.style.width = `${levelPercent(ch.rms, false)}%`;
      });
    }
    getDawShellRuntime()?.renderPlayhead?.();
    getDawShellRuntime()?.renderWaveform?.();
    return;
  }

  // Per-strip patching (ADR-0005): patch in place while the strip set is
  // unchanged; the React island rebuilds on boardShapeVersion when the count
  // changes. Match by .live-ch COUNT so interleaved group headers don't force
  // a rebuild, and address strips by data-ch since grouping reorders them.
  const stripEls = body.querySelectorAll('.sb-live-meters .live-ch');
  if (stripEls.length === tick.channels.length) {
    tick.channels.forEach((ch, i) => {
      const el = body.querySelector(`.sb-live-meters .live-ch[data-ch="${i}"]`);
      if (el) patchLiveChannel(el, ch, i, stripViewAt(state, i, ch), state.isCapturing);
    });
    const metersWrap = body.querySelector('.sb-live-meters');
    if (metersWrap) patchGroupSummaries(metersWrap, tick.channels, state.channelGroups);
  }

  // Docked EQ pane arcs/bars (#668): patch in place at meter cadence — the
  // LiveEqPane island owns rebuilds (keyed on eqPaneSignature), so only the
  // existing section elements are touched here.
  const channels = currentEqPaneChannels(state);
  const roomOverride = snap.secondaryActive
    ? roomPaneOverride(true, lc.secondaryWindows, lc.lastMeasurementChannels, lc.secondaryMeasurement.deviceName)
    : null;
  const eqView = eqPaneView(channels, state.channelConfig, state.measurementSource, state.selectedChannel, roomOverride);
  const plan = eqPanePatchPlan(eqView);
  const paneBody = document.getElementById('live-eq-pane-body');
  if (paneBody) {
    patchEqPaneSection(paneBody.querySelector('.eq-pane-primary'), plan.primary);
    patchEqPaneSection(paneBody.querySelector('.eq-pane-secondary'), plan.secondary);
    const levelTiles = selectedEqPaneLevelTilesView(tick.channels, state.selectedChannel);
    patchEqPaneLevelTiles(paneBody.querySelector('.eq-pane-inspector'), levelTiles);
  }
}
/* c8 ignore stop */

export default function LiveWorkspace(): JSX.Element {
  const appMode = useStoreShallow(useLiveCaptureStore, (s) => s.appMode);

  /* c8 ignore start -- real rAF + DOM-patching wiring, no jsdom in this
     harness (renderToString doesn't run effects) — exercised by
     tests/e2e/live-capture.spec.ts. createLiveMeterController's own
     coalescing logic is exhaustively unit-tested in
     live-meter-controller.test.ts against fake deps. The header level readout
     (#767) is a second patched surface: the same coalesced store snapshot
     drives the board repaint (applyLiveTick, gated to fresh tick objects so
     capture-state notifications cannot repaint stale data over the idle
     workspace) and liveLevelReadout/patchLevelReadout for #live-level-readout. */
  useEffect(() => {
    let lastPatchedTick: LiveEvent | null = null;
    const controller = createLiveMeterController({
      subscribe: useLiveCaptureStore.subscribe,
      getState: () => {
        const s = useLiveCaptureStore.getState();
        return {
          lastTick: s.lastTick,
          // #847: hold the header #live-level-readout visible across a
          // record-stop demote (ADR-0013/ADR-0014 put the readout on this
          // snapshot) — see boardRunning() in live-workspace-view.ts.
          isCapturing: boardRunning(s),
          measurementSource: s.measurementSource,
          lastMeasurementChannels: s.lastMeasurementChannels,
          // Mirror inline-app.js's secondaryMeasurementActive(): status
          // 'active' AND accumulated windows.
          secondaryActive: s.secondaryMeasurement.status === 'active' && s.secondaryWindows.length > 0,
        };
      },
      raf: (cb) => requestAnimationFrame(cb),
      cancelRaf: (handle) => cancelAnimationFrame(handle),
      patch: (snap) => {
        if (snap.lastTick && snap.lastTick !== lastPatchedTick) {
          lastPatchedTick = snap.lastTick;
          applyLiveTick(snap);
        }
        const el = document.getElementById('live-level-readout');
        if (el) patchLevelReadout(el, liveLevelReadout(snap));
      },
    });
    controller.start();
    return () => controller.stop();
  }, []);

  useEffect(() => {
    // #live-island is a sibling of #spectrum-imperative/#spectrum-island
    // inside #spectrum-body (root-markup.html) — spectrum-chrome.ts's view
    // only knows about the other two, so this island owns its own visibility:
    // shown only while the Live tab is active. Its content is rendered by
    // <LiveCapturePanel> reactively from liveCaptureStore.appMode.
    const island = document.getElementById('live-island');
    if (island) island.style.display = appMode === 'live' ? '' : 'none';
  }, [appMode]);
  /* c8 ignore stop */

  return <LiveCapturePanel />;
}
