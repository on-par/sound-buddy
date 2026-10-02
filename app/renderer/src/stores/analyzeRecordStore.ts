// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Backs AnalyzeRecordControl.tsx (#1636) — Analyze's record-to-file control,
// the only record path reachable while Session (appMode 'live') sits behind
// the default-off `session` flag. Calls the existing start-live IPC with
// mode 'record' directly, targeting the room-mic device and the single
// channel Analyze is listening to. Deliberately never imports
// analyzeEntryStore — that store imports this one (to stop a recording on
// stopListening/exitAnalyze), and the reverse import would create a cycle.
// Factory pattern with injected deps, mirroring analyzeEntryStore.ts's shape.

import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import type { StartLiveOpts, StopLiveResult } from '../../../electron/ipc/api';
import { recordPayload } from '../analyze-record';
import { getSoundBuddy } from '../useElectron';
import { useLiveCaptureStore } from './liveCaptureStore';
import { deviceIndexForName } from '../measurement-device-state';

export type AnalyzeRecordPhase = 'idle' | 'starting' | 'recording' | 'stopping';

export const RECORD_BOARD_BUSY_ERROR = 'A Session capture is running — stop it, then press Record again.';
export const RECORD_NO_DEVICE_ERROR = 'Room mic not found — reconnect it or pick it in Settings ▸ Audio, then press Record.';
export const RECORD_START_FAILED_ERROR = 'Could not start recording — check the room mic, then press Record again.';
export const RECORD_NO_FILE_ERROR = 'Recording stopped but no file was written — check the room mic is sending audio, then record again.';
export const RECORD_STOP_FAILED_ERROR = 'Could not stop the recording — press Stop recording again; if it keeps running, quit and reopen Sound Buddy.';

export interface AnalyzeRecordDeps {
  startLive(opts: StartLiveOpts): Promise<{ success: boolean; error?: string } | undefined>;
  stopLive(): Promise<StopLiveResult>;
  revealPath(targetPath: string): Promise<unknown>;
  // Room-mic device index-as-string, or null when it can't be resolved
  // (deviceIndexForName of the secondary-measurement device name).
  resolveDevice(): string | null;
  getCadence(): { windowSecs: number; meterIntervalMs: number };
  // True while a Session (board) capture owns the single start-live slot.
  isBoardCapturing(): boolean;
  now(): number;
}

export interface AnalyzeRecordState {
  phase: AnalyzeRecordPhase;
  startedAt: number | null;
  channel: number | null;
  lastSessionDir: string | null;
  error: string | null;
  start(channel: number): Promise<void>;
  stop(): Promise<void>;
  reveal(): Promise<void>;
}

export function createAnalyzeRecordStore(deps: AnalyzeRecordDeps): UseBoundStore<StoreApi<AnalyzeRecordState>> {
  return create<AnalyzeRecordState>()((set, get) => ({
    phase: 'idle',
    startedAt: null,
    channel: null,
    lastSessionDir: null,
    error: null,

    async start(channel) {
      if (get().phase !== 'idle') return;
      if (deps.isBoardCapturing()) {
        set({ error: RECORD_BOARD_BUSY_ERROR });
        return;
      }
      const device = deps.resolveDevice();
      if (device === null) {
        set({ error: RECORD_NO_DEVICE_ERROR });
        return;
      }
      set({ phase: 'starting', error: null, lastSessionDir: null, channel });
      let result: { success: boolean; error?: string } | undefined;
      try {
        result = await deps.startLive(recordPayload(device, channel, deps.getCadence()));
      } catch {
        set({ phase: 'idle', channel: null, error: RECORD_START_FAILED_ERROR });
        return;
      }
      if (!result?.success) {
        set({ phase: 'idle', channel: null, error: result?.error ?? RECORD_START_FAILED_ERROR });
        return;
      }
      set({ phase: 'recording', startedAt: deps.now() });
    },

    async stop() {
      if (get().phase !== 'recording') return;
      set({ phase: 'stopping' });
      let result: StopLiveResult;
      try {
        result = await deps.stopLive();
      } catch {
        set({ phase: 'recording', error: RECORD_STOP_FAILED_ERROR });
        return;
      }
      if (!result.success) {
        set({ phase: 'recording', error: RECORD_STOP_FAILED_ERROR });
        return;
      }
      set({
        phase: 'idle',
        startedAt: null,
        channel: null,
        lastSessionDir: result.sessionDir,
        error: result.sessionDir ? null : RECORD_NO_FILE_ERROR,
      });
    },

    async reveal() {
      const dir = get().lastSessionDir;
      if (!dir) return;
      await deps.revealPath(dir);
    },
  }));
}

export const useAnalyzeRecordStore = createAnalyzeRecordStore({
  startLive: (opts) => getSoundBuddy().startLive(opts) as Promise<{ success: boolean; error?: string } | undefined>,
  stopLive: () => getSoundBuddy().stopLive(),
  revealPath: (targetPath) => getSoundBuddy().revealPath(targetPath),
  resolveDevice: () => {
    const s = useLiveCaptureStore.getState();
    return deviceIndexForName(s.devices, s.secondaryMeasurement.deviceName);
  },
  getCadence: () => {
    const s = useLiveCaptureStore.getState();
    return { windowSecs: s.windowSecs, meterIntervalMs: s.meterIntervalMs };
  },
  isBoardCapturing: () => useLiveCaptureStore.getState().isCapturing,
  now: () => Date.now(),
});
