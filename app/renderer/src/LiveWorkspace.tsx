// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Owns #live-island's VISIBILITY, the per-tick meter controller, and renders
// the board itself (TD-001 slice 6g, #710). The board markup is no longer
// built by inline-app.js's renderLiveWorkspace()/renderLiveMeters()/
// renderDawShell() — <LiveCapturePanel> renders it from liveCaptureStore's
// discrete state (reading lastTick/lastLiveChannels imperatively at render
// time), and the meter controller mounted here patches the per-tick values
// straight to that React-rendered DOM (ADR-0005). The patch callback refreshes
// arrangement transport state and the still-inline DAW waveform/playhead
// painters via the window.dawShellRuntime bridge (slice 6j).
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
  levelPercent,
  measurementChannel,
} from './live-capture-panel';
import {
  liveStatsRowView,
  patchStatsRow,
  dawShellPatchView,
  getDawShellRuntime,
  liveWorkspaceViewState,
  boardRunning,
} from './live-workspace-view';
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

  // The Session arrangement owns the pane, so the transport chip and the
  // waveform/playhead painters refresh on every live tick.
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
