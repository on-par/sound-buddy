// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The Feedback Ring-Out Assistant wizard (#366, TD-001 slice 6e, #703) —
// ports inline-app.js's ringoutStepIndex/ringoutCut module vars and
// ringoutSetStatus/ringoutDegradeToManual/renderRingout/the mic-capture
// listener into a real store. Same injected-API async-store shape as
// rigStore.ts. Business logic (which suggestion to show for a given
// step/cut) stays in the existing pure window.feedbackRingout module
// (classic script, unchanged) — this store calls it, doesn't reimplement it.

import { create } from 'zustand';
import { getSoundBuddy } from '../useElectron';
import { deviceListView, type ListDevicesResult } from '../live-capture-panel';
import type { LiveApi, PlaybackApi, AnalysisApi, StartLiveOpts, StopLiveResult, AnalyzeFileResult } from '../../../electron/ipc/api';

export type RingoutApi = Pick<LiveApi, 'listDevices' | 'startLive' | 'stopLive'>
  & Pick<PlaybackApi, 'readSession'>
  & Pick<AnalysisApi, 'analyzeFile'>;

export interface RingoutCut { freq: number; gainDb: number; q: number }
export interface RingoutProfile { mic: string; cuts: RingoutCut[] }

// feedback-ringout-state.js stays a classic script — read via a typed window
// cast, matching ReportCardIsland.tsx's getGrading()-style pattern.
interface FeedbackRingoutApi {
  MIN_FREQ_HZ: number;
  MAX_FREQ_HZ: number;
  stepCount(): number;
  clampStep(i: number): number;
  isFirstStep(i: number): boolean;
  isLastStep(i: number): boolean;
  stepIndexById(id: string): number;
  stepHtml(index: number, escapeHtml: (s: unknown) => string): string;
  suggestionHtml(cut: RingoutCut | null, escapeHtml: (s: unknown) => string): string;
  profileRowHtml(profile: RingoutProfile, escapeHtml: (s: unknown) => string): string;
  identifyRing(curve: unknown, findPeaks: unknown, opts?: unknown): { freq: number; db: number; prominence: number } | null;
  handoffStatus(freq: number): string;
  suggestCut(freq: number, opts?: { gainDb?: number; q?: number }): RingoutCut;
  parseManualFrequency(input: string): number | null;
  formatCut(cut: RingoutCut): string;
  loadProfiles(storage: Storage): { profiles: RingoutProfile[] };
  getProfile(profiles: { profiles: RingoutProfile[] }, mic: string): RingoutProfile | null;
  saveProfile(storage: Storage, profiles: { profiles: RingoutProfile[] }, profile: RingoutProfile): { profiles: RingoutProfile[] };
  deleteProfile(storage: Storage, profiles: { profiles: RingoutProfile[] }, mic: string): { profiles: RingoutProfile[] };
}
function getFeedbackRingout(): FeedbackRingoutApi {
  return (window as unknown as { feedbackRingout: FeedbackRingoutApi }).feedbackRingout;
}
function getFindSpectralPeaks(): unknown {
  return (window as unknown as { audioEngineSpectral: { findSpectralPeaks: unknown } }).audioEngineSpectral.findSpectralPeaks;
}

// The main-process read-session handler returns the session.json file
// parsed as-is (electron/ipc/playback.ts) — richer than soundcheck-panel.ts's
// SessionManifest (which only needs label/kind); this store also needs each
// track's recorded stem filename.
interface RingoutSessionResult {
  success: boolean;
  manifest?: { tracks: Array<{ file?: string }> };
}

const RINGOUT_CAPTURE_WINDOW_SECS = 3; // meter-smoothing window passed to start-live
const RINGOUT_CAPTURE_MS = 4000; // wall-clock record duration for a ring-out sample

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RingoutState {
  stepIndex: number;
  cut: RingoutCut | null;
  status: string;
  profiles: RingoutProfile[];
  capturing: boolean;

  start(freqHz: number | null): void;
  next(): void;
  prev(): void;
  applyManual(rawValue: string): void;
  captureFromMic(): Promise<void>;
  loadProfiles(): void;
  saveProfile(name: string): void;
  recallProfile(mic: string): void;
  deleteProfile(mic: string): void;
}

export function createRingoutStore(getApi: () => RingoutApi) {
  return create<RingoutState>()((set, get) => ({
    stepIndex: 0,
    cut: null,
    status: '',
    profiles: [],
    capturing: false,

    // #372: seeds the wizard from the report card's detected feedback ring
    // (ReportCardIsland's window.rcCallouts.feedbackPeak) — verbatim port of
    // openFeedbackRingout's cut/step assignment. A null freqHz (no detected
    // ring) only clears the status text, exactly as before.
    start(freqHz) {
      const ro = getFeedbackRingout();
      if (freqHz !== null) {
        set({ cut: ro.suggestCut(freqHz), stepIndex: ro.stepIndexById('cut') });
      }
      set({ status: freqHz !== null ? ro.handoffStatus(freqHz) : '' });
    },

    next() {
      set((s) => ({ stepIndex: getFeedbackRingout().clampStep(s.stepIndex + 1) }));
    },

    prev() {
      set((s) => ({ stepIndex: getFeedbackRingout().clampStep(s.stepIndex - 1) }));
    },

    applyManual(rawValue) {
      const ro = getFeedbackRingout();
      const freq = ro.parseManualFrequency(rawValue);
      if (freq === null) {
        set({ status: `Enter a frequency between ${ro.MIN_FREQ_HZ} and ${ro.MAX_FREQ_HZ} Hz.` });
        return;
      }
      set({ cut: ro.suggestCut(freq), status: '' });
    },

    // Best-effort mic capture: record a few seconds via the existing
    // start-live/stop-live (record mode) pipeline, read the stem it wrote,
    // run it through the existing analyze-file pipeline for a fine spectrum
    // curve, then find the ring with the shared findSpectralPeaks core. Any
    // failure (no mic, no entitlement, empty curve, no clear peak) degrades
    // to manual entry — capture is a convenience, manual entry is the
    // guaranteed path. Verbatim port of the #ringout-capture click listener.
    async captureFromMic() {
      const ro = getFeedbackRingout();
      const api = getApi();
      set({ capturing: true });
      try {
        const view = deviceListView((await api.listDevices()) as ListDevicesResult);
        if (!view.devices.length) {
          set({ status: 'No mic detected — enter the frequency manually.' });
          return;
        }

        set({ status: 'Listening for the ring…' });
        const startOpts: StartLiveOpts = { windowSecs: RINGOUT_CAPTURE_WINDOW_SECS, mode: 'record' };
        const started = (await api.startLive(startOpts)) as { success: boolean; error?: string };
        if (!started.success) {
          set({ status: started.error || 'Live capture unavailable — enter the frequency manually.' });
          return;
        }

        await delay(RINGOUT_CAPTURE_MS);
        const stopped: StopLiveResult = await api.stopLive();
        if (!stopped || !stopped.sessionDir) {
          set({ status: 'Capture failed — enter the frequency manually.' });
          return;
        }

        const session = (await api.readSession(stopped.sessionDir)) as RingoutSessionResult | null;
        const track = session && session.success && session.manifest ? session.manifest.tracks[0] : undefined;
        if (!track || !track.file) {
          set({ status: 'Capture failed — enter the frequency manually.' });
          return;
        }

        const analysis: AnalyzeFileResult = await api.analyzeFile({ filePath: `${stopped.sessionDir}/${track.file}` });
        const curve = analysis.success
          ? (analysis.data as { spectrum?: { curve?: unknown } } | undefined)?.spectrum?.curve
          : undefined;
        if (!curve) {
          set({ status: 'Could not analyze the capture — enter the frequency manually.' });
          return;
        }

        const ring = ro.identifyRing(curve, getFindSpectralPeaks());
        if (!ring) {
          set({ status: 'No clear ring detected — try again or enter the frequency manually.' });
          return;
        }

        const cut = ro.suggestCut(ring.freq);
        set({ cut, status: `Captured ${ro.formatCut(cut)}.` });
      } finally {
        set({ capturing: false });
      }
    },

    // Reloads the saved-profile list from storage — called on every visit to
    // the Ring-Out tab (mirrors renderRingout's `profiles = loadProfiles(...)`
    // read on every render) rather than once at store creation, since
    // feedback-ringout-state.js (a classic boot script) isn't guaranteed
    // loaded yet when this store module first evaluates.
    loadProfiles() {
      set({ profiles: getFeedbackRingout().loadProfiles(localStorage).profiles });
    },

    saveProfile(name) {
      const trimmed = name.trim();
      const cut = get().cut;
      if (!trimmed || !cut) return;
      const ro = getFeedbackRingout();
      const next = ro.saveProfile(localStorage, ro.loadProfiles(localStorage), { mic: trimmed, cuts: [cut] });
      set({ profiles: next.profiles });
    },

    recallProfile(mic) {
      const ro = getFeedbackRingout();
      const profile = ro.getProfile(ro.loadProfiles(localStorage), mic);
      if (profile && profile.cuts[0]) set({ cut: profile.cuts[0] });
    },

    deleteProfile(mic) {
      const ro = getFeedbackRingout();
      const next = ro.deleteProfile(localStorage, ro.loadProfiles(localStorage), mic);
      set({ profiles: next.profiles });
    },
  }));
}

export const useRingoutStore = createRingoutStore(getSoundBuddy);
