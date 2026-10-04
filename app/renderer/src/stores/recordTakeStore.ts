// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Backs the header Record take (#1648): Main + Measurement only, through the
// dedicated start-record-take/stop-record-take IPC. It never touches
// liveCaptureStore's capture (Session's start-live) or the secondary
// measurement stream the Live RTA listens on — recording can't stop, replace
// or retarget the live analyzer. Sources are resolved from Settings ▸ Audio
// at the moment of the press (record-take.ts). Factory pattern with injected
// deps, mirroring analyzeRecordStore.ts. See ADR-0160.

import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import type { StartRecordTakeOpts, StartRecordTakeResult, StopRecordTakeResult } from '../../../electron/ipc/api';
import type { LiveDevice } from '../live-capture-panel';
import { resolveRecordSources, type RecordTake, type RecordTakePhase } from '../record-take';
import { captureOptsFromCadence } from '../measurement-device-state';
import { getSoundBuddy } from '../useElectron';
import { useLiveCaptureStore } from './liveCaptureStore';

export const RECORD_TAKE_START_FAILED_ERROR = 'Could not start recording — check both inputs in Settings ▸ Audio, then press Record again.';
export const RECORD_TAKE_STOP_FAILED_ERROR = 'Could not stop the recording — press Stop again; if it keeps running, quit and reopen Sound Buddy.';
export const RECORD_TAKE_NO_FILE_ERROR = 'Recording stopped but no audio was written — check both inputs are connected in Settings ▸ Audio, then record again.';

function missingSourceError(source: 'Main' | 'Measurement'): string {
  return `${source} input wrote no audio — check it is connected and selected in Settings ▸ Audio, then record again.`;
}

export interface RecordTakeDeps {
  startRecordTake(opts: StartRecordTakeOpts): Promise<StartRecordTakeResult>;
  stopRecordTake(): Promise<StopRecordTakeResult>;
  revealPath(targetPath: string): Promise<unknown>;
  getSources(): { devices: LiveDevice[]; selectedDevice: string; measurementDeviceName: string };
  getCadence(): { windowSecs: number; meterIntervalMs: number };
  getRecordDir(): string;
  now(): number;
}

export interface RecordTakeState {
  phase: RecordTakePhase;
  startedAt: number | null;
  // Human labels of what the running take records, e.g. "X32 USB · Ch 17–18 (stereo)".
  sources: { main: string; measurement: string } | null;
  lastTake: RecordTake | null;
  error: string | null;
  // Per-source channel token; null = mono/stereo as the device presents.
  mainChannels: string | null;
  measurementChannels: string | null;
  start(): Promise<void>;
  stop(): Promise<void>;
  reveal(): Promise<void>;
  setMainChannels(token: string | null): void;
  setMeasurementChannels(token: string | null): void;
}

export function createRecordTakeStore(deps: RecordTakeDeps): UseBoundStore<StoreApi<RecordTakeState>> {
  return create<RecordTakeState>()((set, get) => ({
    phase: 'idle',
    startedAt: null,
    sources: null,
    lastTake: null,
    error: null,
    mainChannels: null,
    measurementChannels: null,

    async start() {
      if (get().phase !== 'idle') return;
      const resolved = resolveRecordSources({
        ...deps.getSources(),
        mainChannels: get().mainChannels,
        measurementChannels: get().measurementChannels,
      });
      if (!resolved.ok) {
        set({ error: resolved.error });
        return;
      }
      set({ phase: 'starting', error: null, lastTake: null, sources: resolved.labels });
      const cadence = deps.getCadence();
      const { windowSecs, intervalSecs } = captureOptsFromCadence(cadence.windowSecs, cadence.meterIntervalMs);
      const recordDir = deps.getRecordDir();
      let result: StartRecordTakeResult | undefined;
      try {
        result = await deps.startRecordTake({
          main: resolved.main,
          measurement: resolved.measurement,
          windowSecs,
          intervalSecs,
          recordDir: recordDir || undefined,
        });
      } catch {
        result = undefined;
      }
      if (!result?.success) {
        set({ phase: 'idle', sources: null, error: result?.error ?? RECORD_TAKE_START_FAILED_ERROR });
        return;
      }
      set({ phase: 'recording', startedAt: deps.now() });
    },

    async stop() {
      if (get().phase !== 'recording') return;
      set({ phase: 'stopping' });
      let result: StopRecordTakeResult | undefined;
      try {
        result = await deps.stopRecordTake();
      } catch {
        result = undefined;
      }
      if (!result?.success) {
        set({ phase: 'recording', error: RECORD_TAKE_STOP_FAILED_ERROR });
        return;
      }
      const { takeDir, files } = result;
      let error: string | null = null;
      if (takeDir === null) error = RECORD_TAKE_NO_FILE_ERROR;
      else if (files.main === null) error = missingSourceError('Main');
      else if (files.measurement === null) error = missingSourceError('Measurement');
      set({
        phase: 'idle',
        startedAt: null,
        sources: null,
        lastTake: takeDir === null ? null : { dir: takeDir, files },
        error,
      });
    },

    async reveal() {
      const take = get().lastTake;
      if (!take) return;
      await deps.revealPath(take.dir);
    },

    setMainChannels(token) {
      set({ mainChannels: token });
    },

    setMeasurementChannels(token) {
      set({ measurementChannels: token });
    },
  }));
}

/* c8 ignore start -- production wiring onto the real stores/IPC; every branch is covered via createRecordTakeStore's injected deps above */
export const useRecordTakeStore = createRecordTakeStore({
  startRecordTake: (opts) => getSoundBuddy().startRecordTake(opts),
  stopRecordTake: () => getSoundBuddy().stopRecordTake(),
  revealPath: (targetPath) => getSoundBuddy().revealPath(targetPath),
  getSources: () => {
    const s = useLiveCaptureStore.getState();
    return { devices: s.devices, selectedDevice: s.selectedDevice, measurementDeviceName: s.secondaryMeasurement.deviceName };
  },
  getCadence: () => {
    const s = useLiveCaptureStore.getState();
    return { windowSecs: s.windowSecs, meterIntervalMs: s.meterIntervalMs };
  },
  getRecordDir: () => useLiveCaptureStore.getState().recordDir,
  now: () => Date.now(),
});
/* c8 ignore stop */
