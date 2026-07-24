// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { installStoreBridge, type RendererStores } from './bridge';
import { useLicensingStore } from './licensingStore';
import { useSettingsStore } from './settingsStore';
import { useAnalysisStore } from './analysisStore';
import { useSpectrumStore } from './spectrumStore';
import { useLiveCaptureStore } from './liveCaptureStore';
import { useSceneDiffStore } from './sceneDiffStore';
import { createMockSoundBuddy } from '../mock-sound-buddy';

// installStoreBridge()'s cross-store subscription install (guarded by the
// module-level crossStoreSubscriptionInstalled flag) binds the DEFAULT
// liveCapture store instance's IPC listeners exactly once — it reads
// window.soundBuddy via getSoundBuddy(), so it must exist before the first
// installStoreBridge() call in this file.
beforeAll(() => {
  (globalThis as { window?: unknown }).window = { soundBuddy: createMockSoundBuddy().api };
});

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
  useLiveCaptureStore.setState({ liveWindows: [], measurementSource: null, channelConfig: [] });
  useSceneDiffStore.setState({
    status: 'idle',
    scenePaths: [],
    diff: null,
    nameA: null,
    nameB: null,
    sceneError: null,
  });
});

describe('installStoreBridge', () => {
  it('installs all five stores on the injected target and returns them', () => {
    const target: { rendererStores?: RendererStores } = {};

    const stores = installStoreBridge(target);

    expect(stores.licensing).toBe(useLicensingStore);
    expect(stores.settings).toBe(useSettingsStore);
    expect(stores.analysis).toBe(useAnalysisStore);
    expect(stores.spectrum).toBe(useSpectrumStore);
    expect(stores.liveCapture).toBe(useLiveCaptureStore);
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

  it('clearAnalysis (#264) also clears a stale scene-file comparison, since SceneChanges renders alongside whatever report card is showing', () => {
    installStoreBridge({});
    useAnalysisStore.setState({ status: 'done' });
    useSceneDiffStore.setState({
      status: 'done',
      scenePaths: ['/scenes/before.scn', '/scenes/after.scn'],
      diff: { changes: [], summary: '0 changes found', bySection: { channels: [], dcas: [], main: [] } },
      nameA: 'Before',
      nameB: 'After',
      sceneError: null,
    });

    useAnalysisStore.getState().clearAnalysis();

    expect(useSceneDiffStore.getState().status).toBe('idle');
    expect(useSceneDiffStore.getState().scenePaths).toEqual([]);
    expect(useSceneDiffStore.getState().nameA).toBeNull();
  });

  it('does not clear an in-progress scene comparison on transitions that are not a Clear (e.g. a fresh analysis starting)', () => {
    installStoreBridge({});
    useSceneDiffStore.setState({ status: 'one-loaded', scenePaths: ['/scenes/before.scn'] });

    useAnalysisStore.getState().selectFile('/tmp/service.wav');
    void useAnalysisStore.getState().startAnalysis('/tmp/service.wav');

    expect(useSceneDiffStore.getState().status).toBe('one-loaded');
    expect(useSceneDiffStore.getState().scenePaths).toEqual(['/scenes/before.scn']);
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

  it('wires liveCaptureStore.liveWindows through to analysisStore.liveSource', () => {
    installStoreBridge({});

    useLiveCaptureStore.setState({
      liveWindows: [{
        type: 'window', window: 1, ts: 0, masking: [],
        channels: [{ index: 0, name: 'Main', rms: -18, peak: -6, clipping: false, centroid: 1200, rolloff: 8000, bands: { sub_bass: -50, bass: -20, low_mid: -22, mid: -16, high_mid: -25, presence: -30, brilliance: -60 } }],
      }],
    });

    const source = useAnalysisStore.getState().liveSource as { filename: string } | null;
    expect(source?.filename).toBe('Live capture — Main (window #1)');
  });

  it('clears analysisStore.liveSource once liveWindows empties out', () => {
    installStoreBridge({});
    useLiveCaptureStore.setState({
      liveWindows: [{
        type: 'window', window: 1, ts: 0, masking: [],
        channels: [{ index: 0, name: 'Main', rms: -1, peak: -1, clipping: false, centroid: 1, rolloff: 1, bands: {} }],
      }],
    });
    expect(useAnalysisStore.getState().liveSource).not.toBeNull();

    useLiveCaptureStore.getState().clearLiveWindows();

    expect(useAnalysisStore.getState().liveSource).toBeNull();
  });

  it('re-derives analysisStore.liveSource from the current liveWindows when measurementSource changes', () => {
    installStoreBridge({});
    useLiveCaptureStore.setState({
      liveWindows: [{
        type: 'window', window: 1, ts: 0, masking: [],
        channels: [
          { index: 0, name: 'Main', rms: -1, peak: -1, clipping: false, centroid: 1, rolloff: 1, bands: {} },
          { index: 1, name: 'Vocals', rms: -18, peak: -6, clipping: true, centroid: 1800, rolloff: 8000, bands: {} },
        ],
      }],
    });
    expect((useAnalysisStore.getState().liveSource as { filename: string } | null)?.filename)
      .toBe('Live capture — Main (window #1)');

    useLiveCaptureStore.setState({ measurementSource: 1 });

    const source = useAnalysisStore.getState().liveSource as { filename: string } | null;
    expect(source?.filename).toBe('Live capture — Vocals (window #1)');
  });

  it('re-derives analysisStore.liveSource from the current liveWindows when channelConfig changes', () => {
    installStoreBridge({});
    useLiveCaptureStore.setState({
      liveWindows: [{
        type: 'window', window: 1, ts: 0, masking: [],
        channels: [{ index: 0, name: 'Main', rms: -1, peak: -1, clipping: false, centroid: 1, rolloff: 1, bands: {} }],
      }],
    });
    expect((useAnalysisStore.getState().liveSource as { filename: string } | null)?.filename)
      .toBe('Live capture — Main (window #1)');

    useLiveCaptureStore.setState({ channelConfig: [{ kind: 'mono', a: 0, b: 1, label: 'Crowd Mic' }] });

    const source = useAnalysisStore.getState().liveSource as { filename: string } | null;
    expect(source?.filename).toBe('Live capture — Crowd Mic (window #1)');
  });

  it('uses the strip label from channelConfig when measurementSource selects a labeled strip', () => {
    installStoreBridge({});
    useLiveCaptureStore.setState({
      channelConfig: [
        { kind: 'mono', a: 0, b: 1 },
        { kind: 'mono', a: 1, b: 2, label: 'Crowd Mic' },
      ],
    });
    useLiveCaptureStore.setState({
      liveWindows: [{
        type: 'window', window: 1, ts: 0, masking: [],
        channels: [
          { index: 0, name: 'Main', rms: -1, peak: -1, clipping: false, centroid: 1, rolloff: 1, bands: {} },
          { index: 1, name: 'Vocals', rms: -18, peak: -6, clipping: true, centroid: 1800, rolloff: 8000, bands: {} },
        ],
      }],
      measurementSource: 1,
    });

    const source = useAnalysisStore.getState().liveSource as { filename: string } | null;
    expect(source?.filename).toBe('Live capture — Crowd Mic (window #1)');
  });
});
