// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { create } from 'zustand';
import { getSoundBuddy } from '../useElectron';
import type { AnalysisApi, AnalysisProgress } from '../../../electron/ipc/api';

export type AnalysisStatus = 'idle' | 'analyzing' | 'done' | 'cancelled' | 'error';

export interface AnalysisState {
  // AnalyzeFileResult.data is deliberately unknown at the boundary (TD-011).
  currentAnalysis: unknown;
  isAnalyzing: boolean;
  status: AnalysisStatus;
  analysisProgress: AnalysisProgress | null;
  analysisError: string | null;
  // The file path picked in the report-card dropzone, ahead of Analyze being
  // clicked — drives the Analyze button's enabled state and its "Re-analyze"
  // label once an analysis has landed for it.
  selectedFilePath: string | null;
  // A stored report-card summary loaded from Recent Services (#147) — set by
  // setHistorySummary(), read when currentAnalysis/liveSource are both empty.
  historySummary: unknown | null;
  // The live-capture card's resolved report-card source shape (mirrors
  // getReportCardSource()'s live fallback), written by the still-inline live
  // capture code as windows arrive/clear (#208, TD-001 slice 4).
  liveSource: unknown | null;
  // The persisted summary immediately preceding the card currently shown —
  // feeds the "vs. last time" delta, #259.
  prevSummary: unknown | null;
  startAnalysis(filePath: string): Promise<void>;
  cancelAnalysis(): Promise<void>;
  bindIpcEvents(): void;
  selectFile(filePath: string): void;
  clearAnalysis(): void;
  setHistorySummary(summary: unknown | null): void;
  setLiveSource(source: unknown | null): void;
  setPrevSummary(summary: unknown | null): void;
  // The sb.onAnalysisResult 'stats' push path (inline-app.js, #208) — a
  // real-time re-analysis result pushed from the main process outside the
  // normal startAnalysis round trip.
  setAnalysisFromEvent(data: unknown): void;
}

export function createAnalysisStore(getApi: () => AnalysisApi) {
  return create<AnalysisState>()((set) => ({
    currentAnalysis: null,
    isAnalyzing: false,
    status: 'idle',
    analysisProgress: null,
    analysisError: null,
    selectedFilePath: null,
    historySummary: null,
    liveSource: null,
    prevSummary: null,
    async startAnalysis(filePath) {
      set({ isAnalyzing: true, status: 'analyzing', analysisProgress: null, analysisError: null });
      try {
        const result = await getApi().analyzeFile({ filePath });
        if (result.success) {
          // A fresh analysis always wins over a loaded history entry (#147).
          set({ currentAnalysis: result.data, isAnalyzing: false, status: 'done', historySummary: null });
        } else if (result.cancelled) {
          // Cancelled leaves currentAnalysis untouched (#206 semantics).
          set({ isAnalyzing: false, status: 'cancelled' });
        } else {
          set({
            isAnalyzing: false,
            status: 'error',
            analysisError:
              result.error ?? 'Analysis failed — check the file is a readable audio file and try again.',
          });
        }
      } catch (err) {
        set({
          isAnalyzing: false,
          status: 'error',
          analysisError: err instanceof Error ? err.message : String(err),
        });
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
    selectFile(filePath) {
      set({ selectedFilePath: filePath });
    },
    clearAnalysis() {
      set({ currentAnalysis: null, selectedFilePath: null, status: 'idle', prevSummary: null });
    },
    setHistorySummary(summary) {
      set({ historySummary: summary });
    },
    setLiveSource(source) {
      set({ liveSource: source });
    },
    setPrevSummary(summary) {
      set({ prevSummary: summary });
    },
    setAnalysisFromEvent(data) {
      const evt = data as { type?: string; data?: unknown } | null;
      if (evt && evt.type === 'stats' && evt.data) {
        set({ currentAnalysis: evt.data, historySummary: null });
      }
    },
  }));
}

export const useAnalysisStore = createAnalysisStore(getSoundBuddy);
