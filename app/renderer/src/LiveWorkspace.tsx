// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Owns #live-island's VISIBILITY and the per-tick meter controller (TD-001
// slice 6c, #701) — the live meter board's actual markup (channel strips,
// group headers, the guided first-use hero/banner, the workspace toolbar,
// and the DAW shell #517 hand-off) is still built by inline-app.js's
// renderLiveWorkspace()/renderLiveMeters()/renderDawShell(), bridged here as
// `window.liveWorkspaceRuntime`. Those functions decide patch-vs-rebuild by
// querying #live-island's CURRENT DOM (matching `.live-ch` count against the
// incoming tick) — an imperative pattern that doesn't map onto React
// re-rendering a dangerouslySetInnerHTML string, so this island follows
// SpectrumPanel's own precedent for panelState 'meters': render null and
// hand #live-island back to the bridged imperative renderer.
//
// liveCaptureStore IS the single source of truth for board SHAPE
// (channelConfig/channelGroups/isCapturing/liveMode/devices/selectedChannel)
// — but WHAT re-triggers window.liveWorkspaceRuntime.renderWorkspace() on a
// shape change is inline-app.js's own syncLiveCaptureMirror store
// subscription, not a React effect here: renderLiveWorkspace()/
// renderLiveMeters() need to run synchronously with the mutation (they read
// #live-island's current DOM to decide patch-vs-rebuild), and React's own
// re-render/effect flush isn't synchronous with the store update that
// triggered it. An earlier version of this component tried driving the
// rebuild from a useEffect keyed on the store's board-shape fields; it
// looked correct against renderToString (which never runs effects) but
// proved unreliable against the real browser in e2e — see
// tests/e2e/live-capture-workspace.spec.ts's "workspace Add track" case.
// Per-tick meter values (ADR-0005) never round-trip through React state
// either way — the live-meter-controller mounted below patches the DOM
// directly from liveCaptureStore's lastTick.

import { useEffect, type JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { createLiveMeterController } from './live-meter-controller';
import { liveLevelReadout, patchLevelReadout } from './live-level-readout';
import type { LiveEvent } from './live-capture-panel';

export interface LiveWorkspaceRuntime {
  /** Rebuilds #live-island for the current board shape (idle workspace, guided first-use hero, the running board, or the DAW shell #517) — called synchronously by inline-app.js's syncLiveCaptureMirror store subscription whenever board-shape state changes. */
  renderWorkspace(): void;
  /** Applies one coalesced live tick to #live-island — patches in place when the strip set is unchanged, else rebuilds; also refreshes the docked EQ pane, the live-adjustments panel, and (if active) the DAW shell's own patch path. */
  patchTick(win: LiveEvent): void;
}

declare global {
  interface Window {
    liveWorkspaceRuntime?: LiveWorkspaceRuntime;
  }
}

export default function LiveWorkspace(): JSX.Element | null {
  const appMode = useStoreShallow(useLiveCaptureStore, (s) => s.appMode);

  /* c8 ignore start -- real rAF + DOM-patching wiring, no jsdom in this
     harness (renderToString doesn't run effects) — exercised by
     tests/e2e/live-capture.spec.ts. createLiveMeterController's own
     coalescing logic is exhaustively unit-tested in
     live-meter-controller.test.ts against fake deps. The header level readout
     (#767) is a second patched surface: the same coalesced store snapshot
     drives the board repaint (patchTick, still gated on isCapturing && lastTick
     — mirroring renderWorkspace's own liveRunning && lastTick guard, so a stop
     with a stale lastTick can't repaint the board over the idle workspace) and
     liveLevelReadout/patchLevelReadout for #live-level-readout. */
  useEffect(() => {
    const controller = createLiveMeterController({
      subscribe: useLiveCaptureStore.subscribe,
      getState: () => {
        const s = useLiveCaptureStore.getState();
        return {
          lastTick: s.lastTick,
          isCapturing: s.isCapturing,
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
        if (snap.isCapturing && snap.lastTick) window.liveWorkspaceRuntime?.patchTick(snap.lastTick);
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
    // only knows about the other two, so this island owns its own
    // visibility: shown only while the Live tab is active. Its content is
    // populated by the still-inline tab-switch handler's own
    // syncSpectrumForMode('live') call (synchronous, unrelated to this
    // effect) and kept in sync thereafter by syncLiveCaptureMirror — see the
    // file header.
    const island = document.getElementById('live-island');
    if (island) island.style.display = appMode === 'live' ? '' : 'none';
  }, [appMode]);
  /* c8 ignore stop */

  return null;
}
