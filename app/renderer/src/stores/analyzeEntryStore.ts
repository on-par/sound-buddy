// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Backs AnalyzeEntryDialog.tsx, the two-choice modal for the Analyze tab's
// no-room-mic-configured fallback (#1468, lc-05), and enterAnalyze(), the
// Analyze tab's single entry action (#1485): a configured secondary
// measurement device starts live listening directly, a missing one opens the
// dialog. "Listen live" starts the existing room-mic secondary-source
// state machine (measurement-device-state.ts / liveCaptureStore) — deliberately
// the ONLY path this dialog can take: no startLiveCapture, no console connect,
// no channelConfig, no appMode: 'live' (ADR: Analyze's live entry stays
// room-mic-only; see the plan for #1468). Factory pattern with injected deps
// (constitution: side effects injected, not imported globally), mirroring
// consoleNetworkConsentStore.ts's shape.

import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import { resolveAnalyzeEntry, resolveListenLiveChoice } from '../analyze-entry';
import { captureOptsFromCadence, type StartCaptureOpts } from '../measurement-device-state';
import { chooseAndAnalyzeFile } from '../report-card-chrome';
import { useLiveCaptureStore } from './liveCaptureStore';
import { useSettingsStore } from './settingsStore';

export interface AnalyzeEntryDeps {
  chooseAndAnalyzeFile(): Promise<void>;
  getSecondaryDeviceName(): string;
  getCadence(): { windowSecs: number; meterIntervalMs: number };
  startSecondaryMeasurement(opts: StartCaptureOpts): Promise<void>;
  stopSecondaryMeasurement(): Promise<void>;
  openSettingsAudio(): void;
}

export interface AnalyzeEntryState {
  dialogOpen: boolean;
  // #1469 (lc-06): Analyze's own "am I in the live-listening state" flag —
  // deliberately NOT inferred from secondaryMeasurement.status === 'active',
  // which is also true for a Settings-started room mic during a Session
  // capture. Set only by listenLive()'s startListening branch, cleared only
  // by stopListening(); AnalyzeLiveEqPanel.tsx gates its entire view on it.
  listening: boolean;
  // #1487: broader than `listening` — "the Analyze stage is open," true from
  // the moment enterAnalyze() runs (whichever fork it takes) until
  // exitAnalyze() (called by mode-switch.ts's switchMode() on every tab
  // change) clears it. Stays true across a listen -> stopListening ->
  // chooseFile() handoff, so a file-derived result still renders in Analyze
  // chrome instead of vanishing the instant the room mic stops. `listening`
  // itself keeps its narrower meaning — this field never substitutes for it.
  analyzeStage: boolean;
  open(): void;
  close(): void;
  chooseFile(): Promise<void>;
  listenLive(): Promise<void>;
  stopListening(): Promise<void>;
  enterAnalyze(): Promise<void>;
  exitAnalyze(): void;
  // #1510: the non-interactive stage opener used by boot and Simple-mode
  // Report Card redirects (mode-switch.ts's showAnalyzeStage()) — sets
  // analyzeStage only, never `listening` or `dialogOpen`, so landing here
  // never auto-starts a room-mic listen or pops the entry dialog.
  // enterAnalyze() stays the Analyze tab click's own action.
  showStage(): void;
}

export function createAnalyzeEntryStore(
  deps: AnalyzeEntryDeps
): UseBoundStore<StoreApi<AnalyzeEntryState>> {
  return create<AnalyzeEntryState>()((set, get) => ({
    dialogOpen: false,
    listening: false,
    analyzeStage: false,

    open() {
      set({ dialogOpen: true });
    },

    close() {
      set({ dialogOpen: false });
    },

    // #1485: the single teardown point for every file-load entry point (this
    // dialog, the Analyze island's Load file… button, the Report Card
    // toolbar's load button) — stops an active room-mic listen before the
    // picker opens, so no file analysis can ever render behind a still-running
    // live listen.
    async chooseFile() {
      set({ dialogOpen: false });
      if (get().listening) await get().stopListening();
      await deps.chooseAndAnalyzeFile();
    },

    // #1485: the Analyze tab's entry action. Live room-mic listening is the
    // default; the dialog is the no-device-configured fork. Never opens a file
    // picker on its own. Already-listening is a no-op — re-clicking the
    // Analyze tab (it never becomes the "active" workspace mode, so nothing
    // marks it as already selected) must not restart an in-progress capture.
    async enterAnalyze() {
      set({ analyzeStage: true });
      if (get().listening) return;
      if (resolveAnalyzeEntry(deps.getSecondaryDeviceName()) === 'openDialog') {
        set({ dialogOpen: true });
        return;
      }
      await get().listenLive();
    },

    // #1487: the mode-switch teardown hook — switchMode() calls this on every
    // tab change so the Analyze results rail/live-EQ island don't linger once
    // the user has navigated elsewhere. Deliberately never touches `listening`
    // — a still-running room-mic listen survives a tab switch exactly as it
    // does today (see analyzeStage's doc comment above).
    exitAnalyze() {
      set({ analyzeStage: false });
    },

    showStage() {
      set({ analyzeStage: true });
    },

    async listenLive() {
      const choice = resolveListenLiveChoice(deps.getSecondaryDeviceName());
      set({ dialogOpen: false });
      if (choice === 'needsSecondarySource') {
        deps.openSettingsAudio();
        return;
      }
      set({ listening: true });
      const { windowSecs, meterIntervalMs } = deps.getCadence();
      await deps.startSecondaryMeasurement(captureOptsFromCadence(windowSecs, meterIntervalMs));
    },

    async stopListening() {
      set({ listening: false });
      await deps.stopSecondaryMeasurement();
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
  stopSecondaryMeasurement: () => useLiveCaptureStore.getState().stopSecondaryMeasurement(),
  openSettingsAudio: () => useSettingsStore.getState().openDialog('audio'),
});
