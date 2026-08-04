// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { create } from 'zustand';
import type { SpectrumData, BandKey, IdealProfileLike } from '../spectrum-display';
import { analysisPlaybackInputs } from '../spectrum-transport';

// The spectrum panel's display state (TD-001 slice 6a, #695) — 'meters' means
// inline-app.js still owns #spectrum-imperative right now (live/soundcheck
// meters, the DAW shell — slices 6b-6f), so SpectrumPanel renders null.
export type SpectrumPanelState = 'empty' | 'loading' | 'error' | 'populated' | 'meters';

export type AnalysisStage = 'reading' | 'levels' | 'spectrum';
export const ANALYSIS_STAGES: readonly { stage: AnalysisStage; label: string }[] = [
  { stage: 'reading', label: 'Reading file' },
  { stage: 'levels', label: 'Measuring levels' },
  { stage: 'spectrum', label: 'Analyzing spectrum' },
];

export interface SpectrumState {
  spectrumData: SpectrumData | null;
  bands: Partial<Record<BandKey, number>>;
  spectralCentroid: number | null;
  rolloff: number | null;
  // The active ideal EQ profile (PRD 05) — resolved by the still-inline
  // profile-selection code (explicit pick, or auto by content type) and
  // written here so both report-card and spectrum islands render the same
  // target overlay. Independent of spectrumData: it survives a cleared
  // spectrum, mirroring idealProfileId's lifetime in inline-app.js today.
  idealProfile: IdealProfileLike | null;
  isAutoProfile: boolean;
  // Discrete display state for the spectrum panel (TD-001 slice 6a, #695).
  // React renders from these; the ~60Hz playback tick deliberately stays out
  // of the store — see spectrum-transport.ts's module doc.
  panelState: SpectrumPanelState;
  panelText: string;
  stagesDone: AnalysisStage[];
  // Pinned spectrogram frame; null = whole-file average. Survives a tab
  // switch (store-held) and resets when a new analysis lands.
  selectedFrame: number | null;
  filePath: string | null;
  fallbackDuration: number;
  setSpectrumFromAnalysis(analysis: unknown): void;
  clearSpectrum(): void;
  setIdealProfile(profile: IdealProfileLike | null, isAuto: boolean): void;
  setPanelState(state: SpectrumPanelState, text?: string): void;
  markStageDone(stage: AnalysisStage): void;
  selectFrame(index: number | null): void;
}

// The analysis result is deliberately `unknown` at the boundary (TD-011); this
// narrows it to the `{ spectrum: {...} }` shape produced by audio-engine.
export function extractSpectrum(analysis: unknown): SpectrumData | null {
  if (typeof analysis !== 'object' || analysis === null) return null;
  if (!('spectrum' in analysis)) return null;
  const spectrum = (analysis as { spectrum: unknown }).spectrum;
  if (typeof spectrum !== 'object' || spectrum === null) return null;
  return spectrum as SpectrumData;
}

const EMPTY_STATE = {
  spectrumData: null,
  bands: {},
  spectralCentroid: null,
  rolloff: null,
  panelState: 'empty' as const,
  panelText: '',
  selectedFrame: null,
  filePath: null,
  fallbackDuration: 0,
};

export const useSpectrumStore = create<SpectrumState>()((set) => ({
  ...EMPTY_STATE,
  stagesDone: [],
  setSpectrumFromAnalysis(analysis) {
    const s = extractSpectrum(analysis);
    if (!s) {
      set({ ...EMPTY_STATE });
      return;
    }
    const rolloff = (s as { spectralRolloff85?: unknown }).spectralRolloff85;
    const { filePath, fallbackDuration } = analysisPlaybackInputs(analysis);
    set({
      spectrumData: s,
      bands: s.bands ?? {},
      spectralCentroid: Number.isFinite(s.spectralCentroid) ? (s.spectralCentroid as number) : null,
      rolloff: Number.isFinite(rolloff) ? (rolloff as number) : null,
      selectedFrame: null,
      filePath,
      fallbackDuration,
      panelState: 'populated',
    });
  },
  clearSpectrum() {
    set({ ...EMPTY_STATE });
  },
  idealProfile: null,
  isAutoProfile: false,
  setIdealProfile(profile, isAuto) {
    set({ idealProfile: profile, isAutoProfile: isAuto });
  },
  setPanelState(state, text = '') {
    set((prev) => ({
      panelState: state,
      panelText: text,
      stagesDone: state === 'loading' ? [] : prev.stagesDone,
    }));
  },
  markStageDone(stage) {
    set((prev) => (prev.stagesDone.includes(stage) ? prev : { stagesDone: [...prev.stagesDone, stage] }));
  },
  selectFrame(index) {
    set({ selectedFrame: index });
  },
}));
