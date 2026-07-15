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

export interface RendererStores {
  licensing: typeof useLicensingStore;
  settings: typeof useSettingsStore;
  analysis: typeof useAnalysisStore;
  spectrum: typeof useSpectrumStore;
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
  };
  target.rendererStores = stores;

  if (!crossStoreSubscriptionInstalled) {
    crossStoreSubscriptionInstalled = true;
    useAnalysisStore.subscribe((state, prevState) => {
      if (state.currentAnalysis !== prevState.currentAnalysis) {
        useSpectrumStore.getState().setSpectrumFromAnalysis(state.currentAnalysis);
      }
    });
  }

  return stores;
}
