// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Owns #live-island's repaint TIMING (TD-001 slice 6c, #701) — the live
// meter board's actual markup (channel strips, group headers, the guided
// first-use hero/banner, the workspace toolbar, and the DAW shell #517
// hand-off) is still built by inline-app.js's renderLiveWorkspace()/
// renderLiveMeters()/renderDawShell(), bridged here as
// `window.liveWorkspaceRuntime`. Those functions decide patch-vs-rebuild by
// querying #live-island's CURRENT DOM (matching `.live-ch` count against the
// incoming tick) — an imperative pattern that doesn't map onto React
// re-rendering a dangerouslySetInnerHTML string, so this island follows
// SpectrumPanel's own precedent for panelState 'meters': render null and
// hand #live-island back to the bridged imperative renderer. What DOES move
// to React is WHEN that renderer runs: liveCaptureStore is now the single
// source of truth for board SHAPE (channelConfig/channelGroups/
// boardShapeVersion/isCapturing/liveMode/devices/selectedChannel) — this
// component re-triggers the bridged rebuild whenever any of those change,
// replacing the old per-mutation renderLiveWorkspace()/renderLiveMeters()
// call sites scattered through inline-app.js. Per-tick meter values
// (ADR-0005) never round-trip through this component's re-render — the
// live-meter-controller mounted below patches the DOM directly from
// liveCaptureStore's lastTick.

import { useEffect, type JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { createLiveMeterController } from './live-meter-controller';
import type { LiveEvent } from './live-capture-panel';

export interface LiveWorkspaceRuntime {
  /** Rebuilds #live-island for the current board shape (idle workspace, guided first-use hero, the running board, or the DAW shell #517) — called whenever board-shape state changes. */
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
  const { channelConfig, channelGroups, boardShapeVersion, isCapturing, liveMode, devices, selectedChannel, appMode } =
    useStoreShallow(useLiveCaptureStore, (s) => ({
      channelConfig: s.channelConfig,
      channelGroups: s.channelGroups,
      boardShapeVersion: s.boardShapeVersion,
      isCapturing: s.isCapturing,
      liveMode: s.liveMode,
      devices: s.devices,
      selectedChannel: s.selectedChannel,
      appMode: s.appMode,
    }));

  /* c8 ignore start -- real rAF + DOM-patching wiring, no jsdom in this
     harness (renderToString doesn't run effects) — exercised by
     tests/e2e/live-capture.spec.ts. createLiveMeterController's own
     coalescing logic is exhaustively unit-tested in
     live-meter-controller.test.ts against fake deps. */
  useEffect(() => {
    const controller = createLiveMeterController({
      subscribe: useLiveCaptureStore.subscribe,
      getState: () => ({ lastTick: useLiveCaptureStore.getState().lastTick }),
      raf: (cb) => requestAnimationFrame(cb),
      cancelRaf: (handle) => cancelAnimationFrame(handle),
      patch: (win) => window.liveWorkspaceRuntime?.patchTick(win),
    });
    controller.start();
    return () => controller.stop();
  }, []);

  useEffect(() => {
    // #live-island is a sibling of #spectrum-imperative/#spectrum-island
    // inside #spectrum-body (root-markup.html) — spectrum-chrome.ts's view
    // only knows about the other two, so this island owns its own
    // visibility: shown only while the Live tab is active, hidden (and its
    // stale content left in place, cheaply repainted on the next appMode
    // === 'live' render) otherwise.
    const island = document.getElementById('live-island');
    if (island) island.style.display = appMode === 'live' ? '' : 'none';
    if (appMode === 'live') window.liveWorkspaceRuntime?.renderWorkspace();
    // Board-shape fields feed the bridged renderWorkspace() (not read
    // directly here) — listed so this effect re-fires exactly when any of
    // them change, mirroring the old per-mutation call sites they replace.
  }, [channelConfig, channelGroups, boardShapeVersion, isCapturing, liveMode, devices, selectedChannel, appMode]);
  /* c8 ignore stop */

  return null;
}
