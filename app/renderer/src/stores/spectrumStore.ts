// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { create } from 'zustand';
import type { SpectrumData, BandKey } from '../spectrum-display';

export interface SpectrumState {
  spectrumData: SpectrumData | null;
  bands: Partial<Record<BandKey, number>>;
  spectralCentroid: number | null;
  rolloff: number | null;
  setSpectrumFromAnalysis(analysis: unknown): void;
  clearSpectrum(): void;
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
} as const;

export const useSpectrumStore = create<SpectrumState>()((set) => ({
  ...EMPTY_STATE,
  setSpectrumFromAnalysis(analysis) {
    const s = extractSpectrum(analysis);
    if (!s) {
      set({ ...EMPTY_STATE });
      return;
    }
    const rolloff = (s as { spectralRolloff85?: unknown }).spectralRolloff85;
    set({
      spectrumData: s,
      bands: s.bands ?? {},
      spectralCentroid: Number.isFinite(s.spectralCentroid) ? (s.spectralCentroid as number) : null,
      rolloff: Number.isFinite(rolloff) ? (rolloff as number) : null,
    });
  },
  clearSpectrum() {
    set({ ...EMPTY_STATE });
  },
}));
