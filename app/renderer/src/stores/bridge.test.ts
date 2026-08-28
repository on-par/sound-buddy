// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { installStoreBridge, type RendererStores } from './bridge';
import { useLicensingStore } from './licensingStore';
import { useSettingsStore } from './settingsStore';
import { useAnalysisStore } from './analysisStore';
import { useSpectrumStore } from './spectrumStore';
import { useLiveCaptureStore } from './liveCaptureStore';
import { useSceneDiffStore } from './sceneDiffStore';
import { useIdealProfilesStore } from './idealProfilesStore';
import { useRigStore } from './rigStore';
import { useSoundcheckStore } from './soundcheckStore';
import { useRingoutStore } from './ringoutStore';
import { createMockSoundBuddy } from '../mock-sound-buddy';import { spectrumTransport, type SpectrumTransport } from '../spectrum-transport';
import type { IdealCurvesApi } from '../ideal-profiles';
import type { AppSettings } from '../../../electron/ipc/api';

// ideal-curves is a plain classic script (window.idealCurves / module.exports)
// — idealProfilesStore's default deps read it off window, same as the running app.
const curves = require('../../ideal-curves.js') as IdealCurvesApi;
// grading is a plain classic script (window.grading / module.exports) — the
// #266 settings→CONFIG sync subscription in bridge.ts reads it off window,
// same as the running app.
const grading = require('../../grading.js') as {
  getGradingProfile(): { id: string; label: string };
  setGradingProfile(id: string): void;
  CONFIG: { rms: { acceptableMin: number } };
};

// installStoreBridge()'s cross-store subscription install (guarded by the
// module-level crossStoreSubscriptionInstalled flag) binds the DEFAULT
// liveCapture store instance's IPC listeners exactly once — it reads
// window.soundBuddy via getSoundBuddy(), so it must exist before the first
// installStoreBridge() call in this file.
beforeAll(() => {
  (globalThis as { window?: unknown }).window = {
    soundBuddy: createMockSoundBuddy().api,
    idealCurves: curves,
    grading,
  };
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
  useLiveCaptureStore.setState({
    liveWindows: [], measurementSource: null, channelConfig: [],
    secondaryMeasurement: { status: 'off', deviceName: '' },
  });
  useSceneDiffStore.setState({
    status: 'idle',
    scenePaths: [],
    diff: null,
    nameA: null,
    nameB: null,
    sceneError: null,
  });
  useSettingsStore.setState({ settings: null, settingsError: null, dialogOpen: false });
  useIdealProfilesStore.setState({
    selectedId: '',
    customProfiles: [],
    editor: useIdealProfilesStore.getInitialState().editor,
  });
  // #266 — reset grading.js's shared CONFIG singleton so a profile switch in
  // one test never leaks into the next.
  grading.setGradingProfile('casual');
});

describe('installStoreBridge', () => {
  it('installs all ten stores on the injected target and returns them', () => {
    const target: { rendererStores?: RendererStores } = {};

    const stores = installStoreBridge(target);

    expect(stores.licensing).toBe(useLicensingStore);
    expect(stores.settings).toBe(useSettingsStore);
    expect(stores.analysis).toBe(useAnalysisStore);
    expect(stores.spectrum).toBe(useSpectrumStore);
    expect(stores.liveCapture).toBe(useLiveCaptureStore);
    expect(stores.idealProfiles).toBe(useIdealProfilesStore);
    expect(stores.rig).toBe(useRigStore);
    expect(stores.soundcheck).toBe(useSoundcheckStore);
    expect(stores.ringout).toBe(useRingoutStore);
    expect(stores.directory).toBeDefined();
    expect(target.rendererStores).toBe(stores);
  });

  it('installs the spectrumTransport singleton on the injected target', () => {
    const target: { rendererStores?: RendererStores; spectrumTransport?: SpectrumTransport } = {};

    installStoreBridge(target);

    expect(target.spectrumTransport).toBe(spectrumTransport);
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

    // Spy on the specific action the analysis→spectrum subscription calls
    // (rather than counting every spectrumStore fire) since a single analysis
    // change now legitimately touches spectrumStore twice — once via this
    // subscription, once via the analysis→idealProfiles→spectrum glue below.
    const spy = vi.spyOn(useSpectrumStore.getState(), 'setSpectrumFromAnalysis');

    useAnalysisStore.getState().setAnalysisFromEvent({ type: 'stats', data: { spectrum: { bands: { bass: -1 } } } });

    expect(spy).toHaveBeenCalledTimes(1);
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

  const APP_SETTINGS: AppSettings = {
    idealProfile: 'flat',
    customIdealProfiles: [],
    storageDir: '',
    rigs: [],
    activeRigId: null,
    usageSignalEnabled: false,
    channelLabels: {},
    channelGroups: {},
    inputInstrumentProfiles: {},
    crashReportingEnabled: false,
    liveAdjustmentsEnabled: false,
    reportFirstUxEnabled: false,
    shareChurchName: '',
    weeklyReminderEnabled: false,
    weeklyReminderServiceDay: 0,
    liveEqPaneWidth: 360,
    measurementDeviceName: '',
    gradingProfile: 'casual',
    consoleNetworkConsentGranted: false,
    soundcheckBuses: [],
    splCalibrationOffsetDb: null,
  };

  it('seeds idealProfilesStore from settings once they first load, and pushes the resolved profile into spectrumStore', () => {
    installStoreBridge({});

    useSettingsStore.setState({ settings: APP_SETTINGS });

    expect(useIdealProfilesStore.getState().selectedId).toBe('flat');
    expect(useSpectrumStore.getState().idealProfile).toEqual(expect.objectContaining({ id: 'flat' }));
  });

  it('#266 — syncs grading.js CONFIG to the casual profile on first settings load', () => {
    installStoreBridge({});

    useSettingsStore.setState({ settings: APP_SETTINGS });

    expect(grading.getGradingProfile().id).toBe('casual');
  });

  it('#266 — switching gradingProfile to broadcast shifts grading.js CONFIG, and switching back restores it', () => {
    installStoreBridge({});
    useSettingsStore.setState({ settings: APP_SETTINGS });

    useSettingsStore.setState({ settings: { ...APP_SETTINGS, gradingProfile: 'broadcast' } });

    expect(grading.getGradingProfile().id).toBe('broadcast');
    expect(grading.CONFIG.rms.acceptableMin).toBe(-18);

    useSettingsStore.setState({ settings: { ...APP_SETTINGS, gradingProfile: 'casual' } });

    expect(grading.getGradingProfile().id).toBe('casual');
    expect(grading.CONFIG.rms.acceptableMin).toBe(-20);
  });

  it('#460/#724 — seeds liveCaptureStore.secondaryMeasurement.deviceName from persisted measurementDeviceName on first settings load, while idle', () => {
    installStoreBridge({});

    useSettingsStore.setState({ settings: { ...APP_SETTINGS, measurementDeviceName: 'USB Measurement Mic' } });

    expect(useLiveCaptureStore.getState().secondaryMeasurement).toEqual({
      status: 'off',
      deviceName: 'USB Measurement Mic',
    });
  });

  it('#460/#724 — does not overwrite deviceName while a live selection or reconnect is in flight (status !== off)', () => {
    installStoreBridge({});
    useSettingsStore.setState({ settings: APP_SETTINGS });
    useLiveCaptureStore.setState({ secondaryMeasurement: { status: 'active', deviceName: 'USB Measurement Mic' } });

    useSettingsStore.setState({ settings: { ...APP_SETTINGS, measurementDeviceName: 'Some Other Mic' } });

    expect(useLiveCaptureStore.getState().secondaryMeasurement).toEqual({
      status: 'active',
      deviceName: 'USB Measurement Mic',
    });
  });

  it('#460/#724 — a settings update that leaves measurementDeviceName unchanged is a no-op', () => {
    installStoreBridge({});
    useSettingsStore.setState({ settings: { ...APP_SETTINGS, measurementDeviceName: 'USB Measurement Mic' } });
    const before = useLiveCaptureStore.getState().secondaryMeasurement;

    useSettingsStore.setState({ settings: { ...APP_SETTINGS, measurementDeviceName: 'USB Measurement Mic', crashReportingEnabled: true } });

    expect(useLiveCaptureStore.getState().secondaryMeasurement).toBe(before);
  });

  it('does not re-hydrate idealProfilesStore on a later settings update (only the null→non-null transition seeds it)', async () => {
    installStoreBridge({});
    useSettingsStore.setState({ settings: APP_SETTINGS });
    await useIdealProfilesStore.getState().select('broadcast');

    useSettingsStore.setState({ settings: { ...APP_SETTINGS, crashReportingEnabled: true } });

    expect(useIdealProfilesStore.getState().selectedId).toBe('broadcast');
  });

  it('wires currentAnalysis changes through to idealProfilesStore, re-resolving the auto profile by content type', () => {
    installStoreBridge({});

    useAnalysisStore.getState().setAnalysisFromEvent({ type: 'stats', data: { spectrum: { contentType: 'speech' } } });

    expect(useSpectrumStore.getState().idealProfile).toEqual(expect.objectContaining({ id: 'speech-podcast' }));
    expect(useSpectrumStore.getState().isAutoProfile).toBe(true);
  });

  it('wires idealProfilesStore selection changes through to spectrumStore', async () => {
    installStoreBridge({});

    await useIdealProfilesStore.getState().select('worship-service');

    expect(useSpectrumStore.getState().idealProfile).toEqual(expect.objectContaining({ id: 'worship-service' }));
    expect(useSpectrumStore.getState().isAutoProfile).toBe(false);
  });
});
