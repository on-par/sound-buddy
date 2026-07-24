// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Bridges the licensing/settings Zustand stores onto `window.rendererStores`
// so the still-inline app.js — a classic script injected by App.tsx, outside
// React's tree — can read and subscribe to state React owns (TD-001 slice 3,
// #421). Installed before the boot scripts run; see App.tsx.

import { useLicensingStore } from './licensingStore';
import { useSettingsStore } from './settingsStore';
import { useAnalysisStore } from './analysisStore';
import { useSpectrumStore } from './spectrumStore';
import { useLiveCaptureStore } from './liveCaptureStore';
import { useSceneDiffStore } from './sceneDiffStore';
import { liveReportCardSource } from '../live-capture-panel';

export interface RendererStores {
  licensing: typeof useLicensingStore;
  settings: typeof useSettingsStore;
  analysis: typeof useAnalysisStore;
  spectrum: typeof useSpectrumStore;
  liveCapture: typeof useLiveCaptureStore;
}

declare global {
  interface Window {
    rendererStores?: RendererStores;
  }
}

// Installed at most once per module lifetime: the analysis→spectrum
// subscription below is on the singleton stores themselves (not the injected
// target), so re-running installStoreBridge (e.g. a second App mount) must
// not stack a second subscriber that would double-fire setSpectrumFromAnalysis.
let crossStoreSubscriptionInstalled = false;

// Accepts an injectable target so it's testable without a DOM `window` (the
// constitution's "side effects are injected" rule) — defaults to the real
// `window` in the running app.
export function installStoreBridge(
  target: { rendererStores?: RendererStores } = window as unknown as { rendererStores?: RendererStores }
): RendererStores {
  const stores: RendererStores = {
    licensing: useLicensingStore,
    settings: useSettingsStore,
    analysis: useAnalysisStore,
    spectrum: useSpectrumStore,
    liveCapture: useLiveCaptureStore,
  };
  target.rendererStores = stores;

  if (!crossStoreSubscriptionInstalled) {
    crossStoreSubscriptionInstalled = true;
    useAnalysisStore.subscribe((state, prevState) => {
      if (state.currentAnalysis !== prevState.currentAnalysis) {
        useSpectrumStore.getState().setSpectrumFromAnalysis(state.currentAnalysis);
      }
    });
    // Replaces inline-app.js's syncLiveSource(): the live-capture card's
    // report-card source is derived from liveCaptureStore.liveWindows
    // wherever that buffer changes (TD-001 slice 5, #423).
    useLiveCaptureStore.subscribe((state, prevState) => {
      if (state.liveWindows !== prevState.liveWindows
        || state.measurementSource !== prevState.measurementSource
        || state.channelConfig !== prevState.channelConfig) {
        useAnalysisStore.getState().setLiveSource(
          liveReportCardSource(state.liveWindows, state.measurementSource, state.channelConfig));
      }
    });
    // Clearing the audio analysis (#264) also clears any scene-file
    // comparison — SceneChanges renders unconditionally alongside whatever
    // report card is showing, so without this a stale console-changes panel
    // from an earlier session would linger across Clear. clearAnalysis() is
    // the only analysisStore action that sets status back to 'idle'.
    useAnalysisStore.subscribe((state, prevState) => {
      if (state.status === 'idle' && prevState.status !== 'idle') {
        useSceneDiffStore.getState().clearScenes();
      }
    });

    // bindIpcEvents() registers this module's sb.onLiveEvent (liveCapture)
    // listeners exactly once — guarded by the same
    // crossStoreSubscriptionInstalled flag so a second App mount can't
    // double-bind them (TD-001 slice 5, #423).
    useLiveCaptureStore.getState().bindIpcEvents();
  }

  return stores;
}
