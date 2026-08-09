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
import { useIdealProfilesStore } from './idealProfilesStore';
import { useRigStore } from './rigStore';
import { useSoundcheckStore } from './soundcheckStore';
import { useRingoutStore } from './ringoutStore';
import { useFeedbackDialogStore } from './feedbackDialogStore';
import { liveReportCardSource } from '../live-capture-panel';
import { roomFeed } from '../measurement-device-state';
import { spectrumTransport, type SpectrumTransport } from '../spectrum-transport';

interface GradingProfileSyncApi {
  setGradingProfile(id: string): void;
}
function getGradingForProfileSync(): GradingProfileSyncApi {
  return (window as unknown as { grading: GradingProfileSyncApi }).grading;
}

export interface RendererStores {
  licensing: typeof useLicensingStore;
  settings: typeof useSettingsStore;
  analysis: typeof useAnalysisStore;
  spectrum: typeof useSpectrumStore;
  liveCapture: typeof useLiveCaptureStore;
  idealProfiles: typeof useIdealProfilesStore;
  rig: typeof useRigStore;
  soundcheck: typeof useSoundcheckStore;
  ringout: typeof useRingoutStore;
}

declare global {
  interface Window {
    rendererStores?: RendererStores;
    spectrumTransport?: SpectrumTransport;
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
  target: { rendererStores?: RendererStores; spectrumTransport?: SpectrumTransport } =
    window as unknown as { rendererStores?: RendererStores; spectrumTransport?: SpectrumTransport }
): RendererStores {
  const stores: RendererStores = {
    licensing: useLicensingStore,
    settings: useSettingsStore,
    analysis: useAnalysisStore,
    spectrum: useSpectrumStore,
    liveCapture: useLiveCaptureStore,
    idealProfiles: useIdealProfilesStore,
    rig: useRigStore,
    soundcheck: useSoundcheckStore,
    ringout: useRingoutStore,
  };
  target.rendererStores = stores;
  target.spectrumTransport = spectrumTransport;

  if (!crossStoreSubscriptionInstalled) {
    crossStoreSubscriptionInstalled = true;
    useAnalysisStore.subscribe((state, prevState) => {
      if (state.currentAnalysis !== prevState.currentAnalysis) {
        useSpectrumStore.getState().setSpectrumFromAnalysis(state.currentAnalysis);
      }
    });
    // Replaces inline-app.js's syncLiveSource(): the live-capture card's
    // report-card source is derived from liveCaptureStore.liveWindows
    // wherever that buffer changes (TD-001 slice 5, #423). #460: also reacts
    // to secondaryWindows/secondaryMeasurement so the graded source follows
    // the same Room feed as the badge/stats row (roomFeed(), inline-app.js's
    // secondaryMeasurementActive()) — the secondary mic when active, the
    // board strip otherwise (byte-identical to #423 when the flag is off).
    useLiveCaptureStore.subscribe((state, prevState) => {
      if (state.liveWindows !== prevState.liveWindows
        || state.measurementSource !== prevState.measurementSource
        || state.channelConfig !== prevState.channelConfig
        || state.secondaryWindows !== prevState.secondaryWindows
        || state.secondaryMeasurement !== prevState.secondaryMeasurement) {
        const secondaryActive = state.secondaryMeasurement.status === 'active' && state.secondaryWindows.length > 0;
        const feed = roomFeed(
          secondaryActive,
          state.secondaryWindows,
          state.secondaryMeasurement.deviceName,
          state.liveWindows,
          state.measurementSource,
          state.channelConfig,
        );
        useAnalysisStore.getState().setLiveSource(
          liveReportCardSource(feed.windows, feed.source, feed.config));
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
    // Same guard for soundcheckStore's sb.onPlaybackEvent listener (TD-001
    // slice 6d, #702).
    useSoundcheckStore.getState().bindIpcEvents();
    // Same guard for feedbackDialogStore's FeedbackApi.onOpenFeedbackDialog
    // listener — the Help-menu push channel (TD-001 slice 6f, #704).
    useFeedbackDialogStore.getState().bindIpcEvents();

    // Ideal-profile selection glue (TD-001 slice 6b, #700), replacing
    // inline-app.js's syncIdealProfile call sites: seed idealProfilesStore
    // once settings finish their first load, re-resolve the active profile
    // whenever the analyzed file (and so its content type) changes, and
    // whenever the selection/custom-profile set itself changes.
    useSettingsStore.subscribe((state, prevState) => {
      if (state.settings != null && prevState.settings == null) {
        useIdealProfilesStore.getState().hydrate(state.settings);
      }
    });
    useAnalysisStore.subscribe((state, prevState) => {
      if (state.currentAnalysis !== prevState.currentAnalysis) {
        useIdealProfilesStore.getState().syncActiveProfile();
      }
    });
    useIdealProfilesStore.subscribe((state, prevState) => {
      if (state.selectedId !== prevState.selectedId || state.customProfiles !== prevState.customProfiles) {
        useIdealProfilesStore.getState().syncActiveProfile();
      }
    });

    // Grading-strictness profile (#266): keep grading.js's live CONFIG in sync
    // with the persisted setting. Every report-card consumer (ReportCardIsland,
    // the toolbar's Share Image, buildMetricRows/bandBreakdownHTML) reads CONFIG
    // off the same window.grading singleton, so this one mutation point is
    // enough for the whole app to agree — see grading.js's setGradingProfile.
    useSettingsStore.subscribe((state, prevState) => {
      if (state.settings?.gradingProfile !== prevState.settings?.gradingProfile) {
        getGradingForProfileSync().setGradingProfile(state.settings?.gradingProfile ?? 'casual');
      }
    });

    // #460/#724: seed the secondary-device picker's remembered NAME from the
    // persisted measurementDeviceName setting, only while idle ('off') so a
    // live selection or an in-flight reconnect is never stomped by an
    // unrelated settings save — mirrors inline-app.js's old
    // applySecondaryMeasurementSettings seed step.
    useSettingsStore.subscribe((state, prevState) => {
      const name = state.settings?.measurementDeviceName ?? '';
      if (name === (prevState.settings?.measurementDeviceName ?? '')) return;
      const cur = useLiveCaptureStore.getState().secondaryMeasurement;
      if (cur.status === 'off' && cur.deviceName !== name) {
        useLiveCaptureStore.setState({ secondaryMeasurement: { status: 'off', deviceName: name } });
      }
    });
  }

  return stores;
}
