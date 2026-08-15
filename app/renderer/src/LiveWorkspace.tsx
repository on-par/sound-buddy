// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Owns #live-island's VISIBILITY, the per-tick meter controller, and the
// mounted live board (slice 6g, #710). The board itself is LiveCapturePanel,
// rendered into #live-island by this island — it subscribes ONLY to discrete
// store fields and renders the board HTML through dangerouslySetInnerHTML
// (see LiveCapturePanel.tsx). Per-tick meter values (ADR-0005) never
// round-trip through React state: the live-meter-controller mounted below
// coalesces every store change into ONE snapshot per animation frame and
// patches the React-rendered DOM straight from liveCaptureStore — the board
// strips (patchBoardTick), the docked EQ pane (patchEqPane), the header stats
// row (patchStatsRow), and the top-right dB readout (patchLevelReadout) — all
// never through React. This replaces inline-app.js's
// window.liveWorkspaceRuntime.patchTick/renderWorkspace, which are deleted.

import { useEffect, type JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { createLiveMeterController } from './live-meter-controller';
import { liveLevelReadout, patchLevelReadout } from './live-level-readout';
import { patchBoardTick, patchEqPane, patchStatsRow } from './live-board';
import type { LiveEvent } from './live-capture-panel';
import LiveCapturePanel from './LiveCapturePanel';

export default function LiveWorkspace(): JSX.Element {
  const appMode = useStoreShallow(useLiveCaptureStore, (s) => s.appMode);

  /* c8 ignore start -- real rAF + DOM-patching wiring, no jsdom in this
     harness (renderToString doesn't run effects) — exercised by
     tests/e2e/live-capture.spec.ts + live-capture-workspace.spec.ts. The
     controller's coalescing logic is exhaustively unit-tested in
     live-meter-controller.test.ts against fake deps; the appliers are
     c8-ignored in live-board.ts with their e2e gates named. */
  useEffect(() => {
    let lastPatchedTick: LiveEvent | null = null;
    const controller = createLiveMeterController({
      subscribe: useLiveCaptureStore.subscribe,
      getState: () => {
        const s = useLiveCaptureStore.getState();
        return {
          lastTick: s.lastTick,
          isCapturing: s.isCapturing,
          measurementSource: s.measurementSource,
          lastMeasurementChannels: s.lastMeasurementChannels,
          secondaryActive: s.secondaryMeasurement.status === 'active' && s.secondaryWindows.length > 0,
        };
      },
      raf: (cb) => requestAnimationFrame(cb),
      cancelRaf: (handle) => cancelAnimationFrame(handle),
      patch: (snap) => {
        // Fresh tick objects repaint the board (gated exactly like the old
        // window.liveWorkspaceRuntime.patchTick gating); the EQ pane, stats
        // row, and header readout refresh on every coalesced snapshot.
        if (snap.lastTick && snap.lastTick !== lastPatchedTick) {
          lastPatchedTick = snap.lastTick;
          patchBoardTick(useLiveCaptureStore.getState());
        }
        patchEqPane(useLiveCaptureStore.getState());
        patchStatsRow(useLiveCaptureStore.getState(), 'live');
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
    // shown only while the Live tab is active.
    const island = document.getElementById('live-island');
    if (island) island.style.display = appMode === 'live' ? '' : 'none';
  }, [appMode]);
  /* c8 ignore stop */

  return <LiveCapturePanel />;
}
