// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { create } from 'zustand';
import { getSoundBuddy } from '../useElectron';
import type { AnalysisApi, AnalysisProgress } from '../../../electron/ipc/api';

export interface AnalysisState {
  // AnalyzeFileResult.data is deliberately unknown at the boundary (TD-011).
  currentAnalysis: unknown;
  isAnalyzing: boolean;
  analysisProgress: AnalysisProgress | null;
  analysisError: string | null;
  startAnalysis(filePath: string): Promise<void>;
  cancelAnalysis(): Promise<void>;
  bindIpcEvents(): void;
}

export function createAnalysisStore(getApi: () => AnalysisApi) {
  return create<AnalysisState>()((set) => ({
    currentAnalysis: null,
    isAnalyzing: false,
    analysisProgress: null,
    analysisError: null,
    async startAnalysis(filePath) {
      set({ isAnalyzing: true, analysisProgress: null, analysisError: null });
      try {
        const result = await getApi().analyzeFile({ filePath });
        if (result.success) {
          set({ currentAnalysis: result.data, isAnalyzing: false });
        } else if (result.cancelled) {
          set({ isAnalyzing: false });
        } else {
          set({
            isAnalyzing: false,
            analysisError:
              result.error ?? 'Analysis failed — check the file is a readable audio file and try again.',
          });
        }
      } catch (err) {
        set({ isAnalyzing: false, analysisError: err instanceof Error ? err.message : String(err) });
      }
    },
    async cancelAnalysis() {
      await getApi().cancelAnalysis();
    },
    bindIpcEvents() {
      const api = getApi();
      api.onAnalysisProgress((p) => set({ analysisProgress: p }));
      api.onAnalysisResult((data) => set({ currentAnalysis: data, isAnalyzing: false }));
    },
  }));
}

export const useAnalysisStore = createAnalysisStore(getSoundBuddy);
