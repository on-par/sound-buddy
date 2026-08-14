// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { create } from 'zustand';
import { getSoundBuddy } from '../useElectron';
import type { AnalysisApi, AnalysisProgress, AnalysisSummary } from '../../../electron/ipc/api';
import type { AnalysisPayload } from '@sound-buddy/shared';
import type { ReportCardSource } from '../report-card';

export type AnalysisStatus = 'idle' | 'analyzing' | 'done' | 'cancelled' | 'error';

export interface AnalysisState {
  // The analyze-file payload, typed against the shared AnalysisPayload
  // contract (#748) — no longer unknown at the boundary.
  currentAnalysis: AnalysisPayload | null;
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
  historySummary: AnalysisSummary | null;
  // The live-capture card's resolved report-card source shape (mirrors
  // getReportCardSource()'s live fallback), written by the still-inline live
  // capture code as windows arrive/clear (#208, TD-001 slice 4).
  liveSource: ReportCardSource | null;
  // The persisted summary immediately preceding the card currently shown —
  // feeds the "vs. last time" delta, #259.
  prevSummary: AnalysisSummary | null;
  // Basename of the record saveAnalysisSummary just wrote for the currently-
  // shown fresh card (#267) — null until that fire-and-forget save resolves,
  // and whenever a historical card is loaded instead (the handoff note is
  // add-at-save-time only). Lets the report card address the record it just
  // wrote in a follow-up setAnalysisSummaryNote call.
  lastSavedSummaryFile: string | null;
  startAnalysis(filePath: string): Promise<void>;
  cancelAnalysis(): Promise<void>;
  bindIpcEvents(): void;
  selectFile(filePath: string): void;
  clearAnalysis(): void;
  setHistorySummary(summary: AnalysisSummary | null): void;
  setLiveSource(source: ReportCardSource | null): void;
  setPrevSummary(summary: AnalysisSummary | null): void;
  setLastSavedSummaryFile(file: string | null): void;
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
    lastSavedSummaryFile: null,
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
      // The 'analysis-result' stream stays a deliberately-`unknown` envelope
      // (TD-011) — the pre-existing single cast is the allowed escape.
      api.onAnalysisResult((data) => set({ currentAnalysis: data as AnalysisPayload, isAnalyzing: false }));
    },
    selectFile(filePath) {
      set({ selectedFilePath: filePath });
    },
    clearAnalysis() {
      set({ currentAnalysis: null, selectedFilePath: null, status: 'idle', prevSummary: null, lastSavedSummaryFile: null });
    },
    setHistorySummary(summary) {
      set({ historySummary: summary, lastSavedSummaryFile: null });
    },
    setLiveSource(source) {
      set({ liveSource: source });
    },
    setPrevSummary(summary) {
      set({ prevSummary: summary });
    },
    setLastSavedSummaryFile(file) {
      set({ lastSavedSummaryFile: file });
    },
    setAnalysisFromEvent(data) {
      const evt = data as { type?: string; data?: unknown } | null;
      if (evt && evt.type === 'stats' && evt.data) {
        // The runtime `type === 'stats' && data` guard is the shape validation
        // (the pre-existing narrowing), so this is the single allowed cast.
        set({ currentAnalysis: evt.data as AnalysisPayload, historySummary: null });
      }
    },
  }));
}

export const useAnalysisStore = createAnalysisStore(getSoundBuddy);
