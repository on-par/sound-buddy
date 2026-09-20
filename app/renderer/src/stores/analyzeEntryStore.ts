// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Backs AnalyzeEntryDialog.tsx, the two-choice modal ModeTabs.tsx opens for
// the Analyze tab once analyze-entry.ts's shouldOfferListenLive gate is on
// (#1468, lc-05). "Listen live" starts the existing room-mic secondary-source
// state machine (measurement-device-state.ts / liveCaptureStore) — deliberately
// the ONLY path this dialog can take: no startLiveCapture, no console connect,
// no channelConfig, no appMode: 'live' (ADR: Analyze's live entry stays
// room-mic-only; see the plan for #1468). Factory pattern with injected deps
// (constitution: side effects injected, not imported globally), mirroring
// consoleNetworkConsentStore.ts's shape.

import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import { resolveListenLiveChoice } from '../analyze-entry';
import { captureOptsFromCadence, type StartCaptureOpts } from '../measurement-device-state';
import { chooseAndAnalyzeFile } from '../report-card-chrome';
import { useLiveCaptureStore } from './liveCaptureStore';
import { useSettingsStore } from './settingsStore';

export interface AnalyzeEntryDeps {
  chooseAndAnalyzeFile(): Promise<void>;
  getSecondaryDeviceName(): string;
  getCadence(): { windowSecs: number; meterIntervalMs: number };
  startSecondaryMeasurement(opts: StartCaptureOpts): Promise<void>;
  openSettingsAudio(): void;
}

export interface AnalyzeEntryState {
  dialogOpen: boolean;
  open(): void;
  close(): void;
  chooseFile(): Promise<void>;
  listenLive(): Promise<void>;
}

export function createAnalyzeEntryStore(
  deps: AnalyzeEntryDeps
): UseBoundStore<StoreApi<AnalyzeEntryState>> {
  return create<AnalyzeEntryState>()((set) => ({
    dialogOpen: false,

    open() {
      set({ dialogOpen: true });
    },

    close() {
      set({ dialogOpen: false });
    },

    async chooseFile() {
      set({ dialogOpen: false });
      await deps.chooseAndAnalyzeFile();
    },

    async listenLive() {
      const choice = resolveListenLiveChoice(deps.getSecondaryDeviceName());
      set({ dialogOpen: false });
      if (choice === 'needsSecondarySource') {
        deps.openSettingsAudio();
        return;
      }
      const { windowSecs, meterIntervalMs } = deps.getCadence();
      await deps.startSecondaryMeasurement(captureOptsFromCadence(windowSecs, meterIntervalMs));
    },
  }));
}

export const useAnalyzeEntryStore = createAnalyzeEntryStore({
  chooseAndAnalyzeFile,
  getSecondaryDeviceName: () => useLiveCaptureStore.getState().secondaryMeasurement.deviceName,
  getCadence: () => {
    const state = useLiveCaptureStore.getState();
    return { windowSecs: state.windowSecs, meterIntervalMs: state.meterIntervalMs };
  },
  startSecondaryMeasurement: (opts) => useLiveCaptureStore.getState().startSecondaryMeasurement(opts),
  openSettingsAudio: () => useSettingsStore.getState().openDialog('audio'),
});
