// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { installStoreBridge, type RendererStores } from './bridge';
import { useLicensingStore } from './licensingStore';
import { useSettingsStore } from './settingsStore';
import { useAnalysisStore } from './analysisStore';
import { useSpectrumStore } from './spectrumStore';

afterEach(() => {
  useAnalysisStore.setState({
    currentAnalysis: null,
    isAnalyzing: false,
    status: 'idle',
    analysisProgress: null,
    analysisError: null,
    selectedFilePath: null,
    historySummary: null,
    liveSource: null,
  });
  useSpectrumStore.setState({
    spectrumData: null,
    bands: {},
    spectralCentroid: null,
    rolloff: null,
    idealProfile: null,
    isAutoProfile: false,
  });
});

describe('installStoreBridge', () => {
  it('installs all four stores on the injected target and returns them', () => {
    const target: { rendererStores?: RendererStores } = {};

    const stores = installStoreBridge(target);

    expect(stores.licensing).toBe(useLicensingStore);
    expect(stores.settings).toBe(useSettingsStore);
    expect(stores.analysis).toBe(useAnalysisStore);
    expect(stores.spectrum).toBe(useSpectrumStore);
    expect(target.rendererStores).toBe(stores);
  });

  it('exposes getState/subscribe on the installed target', () => {
    const target: { rendererStores?: RendererStores } = {};

    installStoreBridge(target);

    expect(target.rendererStores!.licensing.getState().isLicensed).toBe(false);
    expect(typeof target.rendererStores!.settings.subscribe).toBe('function');
  });

  it('wires currentAnalysis changes through to the spectrum store', () => {
    installStoreBridge({});

    useAnalysisStore.getState().setAnalysisFromEvent({ type: 'stats', data: { spectrum: { bands: { bass: -3 } } } });

    expect(useSpectrumStore.getState().spectrumData).toEqual({ bands: { bass: -3 } });
  });

  it('clearing currentAnalysis clears the spectrum store', () => {
    installStoreBridge({});
    useAnalysisStore.getState().setAnalysisFromEvent({ type: 'stats', data: { spectrum: { bands: { bass: -3 } } } });

    useAnalysisStore.getState().clearAnalysis();

    expect(useSpectrumStore.getState().spectrumData).toBeNull();
  });

  it('installs the cross-store subscription at most once across repeated calls', () => {
    installStoreBridge({});
    installStoreBridge({});

    let calls = 0;
    const unsubscribe = useSpectrumStore.subscribe(() => { calls += 1; });

    useAnalysisStore.getState().setAnalysisFromEvent({ type: 'stats', data: { spectrum: { bands: { bass: -1 } } } });

    unsubscribe();
    expect(calls).toBe(1);
  });
});
