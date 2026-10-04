// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Backs the Analyze stage's Live/File modes (#1468, lc-05) and enterAnalyze(),
// the Analyze tab's single entry action (#1485). #1646: Analyze always lands
// on Live — a configured secondary measurement device is listened to
// directly, and with none configured the listen runs on the system default
// input (liveCaptureStore resolves an empty device name to stream.py's
// default). There is no route to Settings > Audio and no File-or-live dialog
// any more: both were the "Live opens Settings" / "File is the default" bug.
// Listening starts the existing room-mic secondary-source state machine
// (measurement-device-state.ts / liveCaptureStore) — never startLiveCapture,
// a console connect, channelConfig or appMode: 'live' (Analyze's live entry
// stays room-mic-only; see the plan for #1468). Factory pattern with injected
// deps (constitution: side effects injected, not imported globally).
//
// #1604: "a configured secondary measurement device" means the effective
// name — the in-memory liveCaptureStore name, falling back to the persisted
// settings.measurementDeviceName — not just the in-memory one. bridge.ts only
// seeds the in-memory name from settings while idle, so a user with a
// configured room mic could otherwise still land on the system default input
// before that seed lands.

import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import { effectiveSecondaryDeviceName } from '../analyze-entry';
import { captureOptsFromCadence, deviceInputCount, type StartCaptureOpts } from '../measurement-device-state';
import { chooseAndAnalyzeFile } from '../report-card-chrome';
import { useLiveCaptureStore } from './liveCaptureStore';
import { useSettingsStore } from './settingsStore';
import { useAnalysisStore } from './analysisStore';
import { useAnalyzeRecordStore } from './analyzeRecordStore';

export interface AnalyzeEntryDeps {
  chooseAndAnalyzeFile(): Promise<void>;
  getSecondaryDeviceName(): string;
  getCadence(): { windowSecs: number; meterIntervalMs: number };
  startSecondaryMeasurement(opts: StartCaptureOpts): Promise<void>;
  stopSecondaryMeasurement(): Promise<void>;
  // #1522: analyzes an already-resolved disk path (a File-drop path, never a
  // native-dialog result) — the single production wiring is
  // analysisStore.selectFile(fp) followed by startAnalysis(fp).
  analyzeFilePath(filePath: string): Promise<void>;
  // #1524: the room-mic device's input count, for clamping listenChannel to a
  // valid index. Production wiring reads liveCaptureStore.devices +
  // secondaryMeasurement.deviceName through deviceInputCount().
  getSecondaryInputCount(): number;
  // #1604: the persisted settings.measurementDeviceName ('' if unset or
  // settings not yet loaded) — read alongside getSecondaryDeviceName() so
  // "no device configured" means neither in-memory nor persisted, not just
  // "not yet seeded into liveCaptureStore" (bridge.ts only seeds it while idle).
  getPersistedSecondaryDeviceName(): string;
  // #1604: puts a persisted-only name into liveCaptureStore before a listen
  // starts, so startSecondaryMeasurement resolves a real device index instead
  // of landing on 'disconnected' with an empty in-memory name.
  adoptSecondaryDeviceName(name: string): void;
  // #1636: stops Analyze's record-to-file control's active recording, if
  // any — a recording must never outlive the Analyze listen it was started
  // from. Production wiring is analyzeRecordStore.stop(), already a no-op
  // when nothing is recording.
  stopRecording(): Promise<void>;
}

export interface AnalyzeEntryState {
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
  // #1524: Analyze's single-select listen channel — a 0-based index into the
  // room-mic device's inputs, in-memory only (never persisted to
  // settings.json — see the #1524 ADR). Survives stopListening() so the next
  // listen resumes on it; only listenLive()'s clamp and selectListenChannel()
  // ever change it.
  listenChannel: number;
  chooseFile(): Promise<void>;
  listenLive(): Promise<void>;
  // #1637: the Analyze Live toggle's single action — a no-op while already
  // listening (re-pressing Live must not restart the stream), otherwise
  // exactly listenLive(): it starts the listen in place on the configured
  // device (in-memory or persisted, #1604) or, with none, on the system
  // default input (#1646). It never opens Settings.
  activateLive(): Promise<void>;
  stopListening(): Promise<void>;
  enterAnalyze(): Promise<void>;
  exitAnalyze(): void;
  // #1510: the non-interactive stage opener used by boot and Simple-mode
  // Report Card redirects (mode-switch.ts's showAnalyzeStage()) — sets
  // analyzeStage only, never `listening`, so landing here never starts a
  // room-mic listen by itself (boot's post-hydration auto-listen, #1577, is
  // the separate seam that does).
  // enterAnalyze() stays the Analyze tab click's own action.
  showStage(): void;
  // #1522: the File toggle's action — stops an active listen (same teardown
  // rule as chooseFile()) but never opens the native picker. Analyze's
  // File mode is otherwise "load a file however you like" (drop or the
  // existing Load file… button).
  switchToFile(): Promise<void>;
  // #1522: the dropzone's onDrop action — tears down an active listen, then
  // analyzes an already-resolved disk path (from droppedAudioPath).
  analyzeDroppedFile(filePath: string): Promise<void>;
  // #1524: switch (or, while not listening, merely record) the listen
  // channel. Ignores an invalid or unchanged channel. While listening it
  // stops the old-channel stream before starting the new one, so no old-N
  // data (secondaryWindows/lastMeasurementChannels) survives the switch.
  selectListenChannel(channel: number): Promise<void>;
}

export function createAnalyzeEntryStore(
  deps: AnalyzeEntryDeps
): UseBoundStore<StoreApi<AnalyzeEntryState>> {
  // #1604: "no device configured" means neither the in-memory liveCaptureStore
  // name nor the persisted settings.measurementDeviceName — never just the
  // former, which bridge.ts only seeds while idle.
  const resolveDeviceName = (): string =>
    effectiveSecondaryDeviceName(deps.getSecondaryDeviceName(), deps.getPersistedSecondaryDeviceName());

  return create<AnalyzeEntryState>()((set, get) => ({
    listening: false,
    analyzeStage: false,
    listenChannel: 0,

    // #1485: the single teardown point for every file-load button (the
    // Analyze island's Load file… and File-mode dropzone, the Report Card
    // toolbar's load button) — stops an active room-mic listen before the
    // picker opens, so no file analysis can ever render behind a still-running
    // live listen. (#1646: bridge.ts applies the same rule to every other
    // file-result entry point via shouldYieldLiveToFileResult.)
    async chooseFile() {
      if (get().listening) await get().stopListening();
      await deps.chooseAndAnalyzeFile();
    },

    // #1485/#1646: the Analyze tab's entry action — always Live. Never opens
    // a file picker, a dialog or Settings. Already-listening is a no-op —
    // re-clicking the Analyze tab must not restart an in-progress capture.
    // mode-switch.ts's enterAnalyzeFromTab() (#1588) lands appMode 'analyze'
    // first, then calls this unchanged.
    async enterAnalyze() {
      set({ analyzeStage: true });
      if (get().listening) return;
      await get().listenLive();
    },

    // #1487: the mode-switch teardown hook — switchMode() calls this on every
    // tab change so the Analyze results rail/live-EQ island don't linger once
    // the user has navigated elsewhere. A configured room mic's listen
    // survives a tab switch (see analyzeStage's doc comment above). #1646: a
    // system-default-input listen (no device configured) does not — Session's
    // room feed and EQ pane read any active secondary stream, and with no
    // device chosen they must keep metering the board channel.
    exitAnalyze() {
      set({ analyzeStage: false });
      if (get().listening && resolveDeviceName() === '') {
        // Fire-and-forget (exitAnalyze() stays sync for switchMode());
        // stopListening() stops an active recording first (#1636).
        void get().stopListening();
        return;
      }
      // #1636: fire-and-forget — exitAnalyze() stays sync, matching its
      // existing callers (mode-switch.ts's switchMode()).
      void deps.stopRecording();
    },

    showStage() {
      set({ analyzeStage: true });
    },

    // #1646: listens on the configured device, or — with none configured —
    // on the system default input (an empty device name, which
    // liveCaptureStore.startSecondaryMeasurement hands to stream.py as its
    // default input). Never routes to Settings.
    async listenLive() {
      const live = deps.getSecondaryDeviceName();
      const name = effectiveSecondaryDeviceName(live, deps.getPersistedSecondaryDeviceName());
      set({ analyzeStage: true });
      // #1604: the live name is empty but a persisted one resolved — adopt it
      // into liveCaptureStore before starting, so startSecondaryMeasurement
      // resolves a real device index instead of the system default input.
      if (live === '' && name !== '') deps.adoptSecondaryDeviceName(name);
      // #1524: clamp a stale listenChannel (e.g. carried over from a wider
      // device) into range for the device actually being listened to.
      const channel = Math.max(0, Math.min(get().listenChannel, deps.getSecondaryInputCount() - 1));
      set({ listening: true, listenChannel: channel });
      const { windowSecs, meterIntervalMs } = deps.getCadence();
      await deps.startSecondaryMeasurement(captureOptsFromCadence(windowSecs, meterIntervalMs, channel));
    },

    async activateLive() {
      if (get().listening) return;
      await get().listenLive();
    },

    async stopListening() {
      set({ listening: false });
      // #1636: stop an active recording before tearing down the secondary
      // measurement, so a recording never outlives the Analyze listen.
      await deps.stopRecording();
      await deps.stopSecondaryMeasurement();
    },

    // #1524: while listening, awaits stopSecondaryMeasurement() before
    // startSecondaryMeasurement() — strictly in that order — so the old
    // channel's stream (and secondaryWindows/lastMeasurementChannels, cleared
    // by both store actions) never overlaps the new one. `listening` itself
    // stays true throughout the switch.
    async selectListenChannel(channel) {
      if (!Number.isInteger(channel) || channel < 0 || channel === get().listenChannel) return;
      set({ listenChannel: channel });
      if (!get().listening) return;
      await deps.stopSecondaryMeasurement();
      const { windowSecs, meterIntervalMs } = deps.getCadence();
      await deps.startSecondaryMeasurement(captureOptsFromCadence(windowSecs, meterIntervalMs, channel));
    },

    // #1522: mirrors chooseFile()'s teardown-before-action rule, but never
    // calls chooseAndAnalyzeFile — the File toggle only switches mode; the
    // dropzone or the existing Load file… button does the actual loading.
    async switchToFile() {
      if (get().listening) await get().stopListening();
    },

    // #1522: the dropzone's onDrop action — same stop-before-load ordering
    // as chooseFile(), but for an already-resolved disk path instead of a
    // native-dialog result.
    async analyzeDroppedFile(filePath) {
      set({ analyzeStage: true });
      if (get().listening) await get().stopListening();
      await deps.analyzeFilePath(filePath);
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
  analyzeFilePath: async (fp) => {
    useAnalysisStore.getState().selectFile(fp);
    await useAnalysisStore.getState().startAnalysis(fp);
  },
  getSecondaryInputCount: () => {
    const s = useLiveCaptureStore.getState();
    return deviceInputCount(s.devices, s.secondaryMeasurement.deviceName);
  },
  getPersistedSecondaryDeviceName: () => useSettingsStore.getState().settings?.measurementDeviceName ?? '',
  adoptSecondaryDeviceName: (name) => useLiveCaptureStore.getState().setSecondaryDeviceName(name),
  stopRecording: () => useAnalyzeRecordStore.getState().stop(),
});
