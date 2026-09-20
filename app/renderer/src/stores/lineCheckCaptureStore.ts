// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The line-check capture control's store (lc-04, #1467, epic #1462):
// start/stop a capture on the channel lc-01 identifies, handing the averaged
// curve off to lc-02's captureLineCheckProfile on stop. Same createXStore(deps)
// factory shape as ringoutStore.ts. The per-tick sample buffer, the target
// index, and the live-frame unsubscribe are closure variables, never store
// state (ADR-0140) — nothing outside start()/stop() needs to read them, and a
// buffer that never enters React state can't leak into a render path or be
// inspected/mutated from outside this module.

import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import { GRID_FREQS } from '@sound-buddy/audio-engine/dist/profiles/index.js';
import type { AppSettings, CustomIdealProfile, UpdateSettingsPatch } from '../../../electron/ipc/api';
import { registerLiveFrameHook } from '../live-frame-hooks';
import { useLiveCaptureStore } from './liveCaptureStore';
import { useSettingsStore } from './settingsStore';
import { useIdealProfilesStore } from './idealProfilesStore';
import { getArmState, getRigReconcile, getInstrumentProfiles, type ArmStateApi, type RigReconcileApi, type InstrumentProfilesApi } from '../live-workspace-view';
import { liveAnalyzerCurve, deviceNameFor, type LiveMeterChannel, type LiveDevice, type StripConfig } from '../live-capture-panel';
import type { SpectrumCurve } from '../spectrum-display';
import { averageCaptureCurve } from '../line-check-capture-control';
import { captureLineCheckProfile } from '../line-check-capture';
import { getSoundBuddy } from '../useElectron';
import type { IdealCurvesApi } from '../ideal-profiles';

export interface LineCheckCaptureDeps {
  /** Registers a per-live-tick callback (ADR-0134: the shared Live rAF loop,
   *  never a store-owned one) and returns the unregister function. */
  subscribeLive(onFrame: () => void): () => void;
  /** The current tick's curve for `index`, or null before a tick / off-grid —
   *  a null tick is skipped rather than treated as silence. */
  curveAt(index: number): SpectrumCurve | null;
  /** Turns the averaged curve into a persisted CustomIdealProfile for the
   *  strip at `index` (lc-02's captureLineCheckProfile). Resolves false when
   *  the curve is unusable or there's no channel configured at that index. */
  persist(curve: SpectrumCurve | null, index: number): Promise<boolean>;
}

export interface LineCheckCaptureState {
  capturing: boolean;
  status: string;
  start(index: number): void;
  stop(): Promise<void>;
}

const CAPTURING_STATUS = 'Capturing…';
const SAVING_STATUS = 'Saving capture…';
const SAVED_STATUS = 'Capture saved.';
const FAILED_STATUS = 'Capture failed — try again.';

export function createLineCheckCaptureStore(deps: LineCheckCaptureDeps): UseBoundStore<StoreApi<LineCheckCaptureState>> {
  let samples: SpectrumCurve[] = [];
  let targetIndex: number | null = null;
  let unsubscribe: (() => void) | null = null;

  return create<LineCheckCaptureState>()((set, get) => ({
    capturing: false,
    status: '',

    start(index) {
      if (get().capturing) return;
      samples = [];
      targetIndex = index;
      unsubscribe = deps.subscribeLive(() => {
        const curve = deps.curveAt(index);
        if (curve) samples.push(curve);
      });
      set({ capturing: true, status: CAPTURING_STATUS });
    },

    async stop() {
      if (!get().capturing) return;
      unsubscribe?.();
      unsubscribe = null;
      const index = targetIndex;
      const curve = averageCaptureCurve(samples);
      samples = [];
      targetIndex = null;
      set({ capturing: false, status: SAVING_STATUS });
      const ok = index !== null && await deps.persist(curve, index);
      set({ status: ok ? SAVED_STATUS : FAILED_STATUS });
    },
  }));
}

// The slice of liveCaptureStore's state persistLineCheckCapture needs to
// resolve a strip's device name + token — named here (mirrors
// LiveWorkspaceStoreSlice) so this module doesn't import the whole
// LiveCaptureState shape for four fields.
export interface CaptureStripSlice {
  channelConfig: StripConfig[];
  lastLiveChannels: LiveMeterChannel[] | null;
  selectedDevice: string;
  devices: LiveDevice[];
}

export interface LineCheckPersistDeps {
  liveCapture: CaptureStripSlice;
  armState: Pick<ArmStateApi, 'stripToken'>;
  rigReconcile: Pick<RigReconcileApi, 'resolveStripLabel'>;
  instrumentProfiles: Pick<InstrumentProfilesApi, 'recordOverride'>;
  getCurves(): IdealCurvesApi;
  getCustomProfiles(): CustomIdealProfile[];
  getOverrides(): Record<string, Record<string, string>> | null | undefined;
  writeSettings(patch: UpdateSettingsPatch): Promise<AppSettings>;
  /** Called once with the write's resulting settings — the caller's job is to
   *  re-sync any store (settingsStore's cache, idealProfilesStore) that reads
   *  from a snapshot of settings rather than this write's return value. */
  onSettingsWritten(settings: AppSettings): void;
}

/** Resolves the strip at `index` to a (deviceName, token, label) triple and
 *  hands the averaged capture off to lc-02's captureLineCheckProfile. False
 *  (no write) when there's no strip configured at `index` — nothing to
 *  persist against. Deps are injected (LiveEqPane.tsx's
 *  ClassificationChangeDeps pattern) so this is testable without a real
 *  window/IPC bridge. */
export async function persistLineCheckCapture(
  curve: SpectrumCurve | null,
  index: number,
  deps: LineCheckPersistDeps,
): Promise<boolean> {
  const strip = deps.liveCapture.channelConfig[index] ?? null;
  if (!strip) return false;
  const ch = deps.liveCapture.lastLiveChannels ? deps.liveCapture.lastLiveChannels[index] ?? null : null;
  const deviceName = deviceNameFor(deps.liveCapture.selectedDevice, deps.liveCapture.devices);
  const token = deps.armState.stripToken(strip);
  const stripLabel = deps.rigReconcile.resolveStripLabel(strip, ch, index);
  return captureLineCheckProfile(curve ?? undefined, GRID_FREQS, deviceName, token, stripLabel, {
    getCurves: deps.getCurves,
    getCustomProfiles: deps.getCustomProfiles,
    getOverrides: deps.getOverrides,
    recordOverride: deps.instrumentProfiles.recordOverride,
    // captureLineCheckProfile writes customIdealProfiles + inputInstrumentProfiles
    // straight through the IPC bridge, bypassing settingsStore's own
    // updateSettings — so both settingsStore's cached settings AND
    // idealProfilesStore must be re-hydrated from the write's result
    // (onSettingsWritten below), or a second capture (on another strip, or on
    // this one) would build its recordOverride/upsertProfile off a stale
    // snapshot and silently drop the first capture.
    updateSettings: async (patch) => {
      const settings = await deps.writeSettings(patch);
      deps.onSettingsWritten(settings);
      return settings;
    },
  });
}

function getIdealCurves(): IdealCurvesApi {
  return (window as unknown as { idealCurves: IdealCurvesApi }).idealCurves;
}

export const useLineCheckCaptureStore = createLineCheckCaptureStore({
  subscribeLive: registerLiveFrameHook,
  curveAt: (index) => {
    const lc = useLiveCaptureStore.getState();
    const ch = lc.lastLiveChannels ? lc.lastLiveChannels[index] : null;
    return ch ? liveAnalyzerCurve(ch as LiveMeterChannel) : null;
  },
  persist: (curve, index) => persistLineCheckCapture(curve, index, {
    liveCapture: useLiveCaptureStore.getState(),
    armState: getArmState(),
    rigReconcile: getRigReconcile(),
    instrumentProfiles: getInstrumentProfiles(),
    getCurves: getIdealCurves,
    getCustomProfiles: () => useIdealProfilesStore.getState().customProfiles,
    getOverrides: () => useSettingsStore.getState().settings?.inputInstrumentProfiles,
    writeSettings: (patch) => getSoundBuddy().updateSettings(patch),
    onSettingsWritten: (settings) => {
      useSettingsStore.setState({ settings });
      useIdealProfilesStore.getState().hydrate(settings);
    },
  }),
});
