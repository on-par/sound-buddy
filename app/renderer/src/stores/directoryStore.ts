// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Single source of truth for the Directory tab's batch-analyze workflow
// (#270) — TD-001 slice 6h (#711): ported off inline-app.js's batchFiles/
// batchRunning module vars + the #dir-choose-btn/#dir-analyze-btn listeners
// onto the ADR-0005 pattern (discrete state here, thin React render in
// DirectoryPanel.tsx). Follows liveCaptureStore.ts's factory pattern — an
// injected API so side effects stay testable — and reads the pure
// batch-analysis.js classic-script off `window` via a typed accessor (same
// convention as liveCaptureStore.ts's armState/groupState reads). The batch
// loop itself (runBatch) and the row/progress/summary text builders stay in
// batch-analysis.js, untouched.

import { create } from 'zustand';
import { getSoundBuddy } from '../useElectron';
import { reportCardSourceFromAnalysis, buildAnalysisSummaryInput, type SummaryGradingApi } from '../report-card';
import type { AnalysisPayload } from '@sound-buddy/shared';
import type { SoundBuddyApi, DialogApi, AnalysisSummaryInput } from '../../../electron/ipc/api';

export type DirectoryApi = Pick<SoundBuddyApi, 'listFolderAudio' | 'analyzeFile' | 'saveAnalysisSummary'> &
  Pick<DialogApi, 'openDirDialog'>;

// One batch result row — the shape batch-analysis.js's runBatch emits per
// file (status ok/error/cancelled, with the grade/score or the reason).
export interface BatchRow {
  filePath: string;
  filename: string;
  status: 'ok' | 'error' | 'cancelled';
  gradeLetter?: string;
  score?: number;
  error?: string;
  saveError?: string;
}

// The final onProgress event per file — runBatch assigns the full row onto
// the running event ({ index, total, ...row }), so it carries the row fields
// plus the positional progress fields the caller paints with. The initial
// per-file event is status 'running' (no row yet), which the analyze loop
// skips; the completion event carries the row.
export type BatchRunEvent = Omit<BatchRow, 'status'> & {
  status: BatchRow['status'] | 'running';
  index: number;
  total: number;
};

export interface DirectoryState {
  path: string;
  files: string[];
  rows: BatchRow[];
  progress: string;
  emptyMessage: string;
  running: boolean;

  chooseFolder(): Promise<void>;
  analyze(): Promise<void>;
}

// The pure batch-analysis.js classic-script (boot-injected by App.tsx, read
// the same way liveCaptureStore reads armState/groupState).
interface BatchAnalysisApi {
  runBatch(
    files: string[],
    deps: {
      analyzeFile(fp: string): Promise<{ success: boolean; cancelled?: boolean; error?: string; data?: unknown }>;
      toSummaryInput(data: unknown, fp: string): AnalysisSummaryInput | null;
      saveSummary(input: AnalysisSummaryInput): Promise<unknown>;
      onProgress(event: BatchRunEvent): void;
    },
  ): Promise<BatchRow[]>;
  batchRowHtml(result: BatchRow, index: number, escapeHtml: (s: string) => string): string;
  progressText(done: number, total: number): string;
  summaryText(results: BatchRow[]): string;
  shouldSuppressPushedResult(batchRunning: boolean): boolean;
  dirEmptyMessage(res: unknown): string;
}

type GradingApi = SummaryGradingApi;

function getBatchAnalysis(): BatchAnalysisApi {
  return (window as unknown as { batchAnalysis: BatchAnalysisApi }).batchAnalysis;
}
function getGrading(): GradingApi {
  return (window as unknown as { grading: GradingApi }).grading;
}

export function createDirectoryStore(getApi: () => DirectoryApi) {
  return create<DirectoryState>()((set, get) => ({
    path: '',
    files: [],
    rows: [],
    progress: '',
    emptyMessage: '',
    running: false,

    async chooseFolder() {
      // A batch already in flight owns #dir-path/#dir-results/files until it
      // finishes — picking a new folder mid-run would repaint the panel out
      // from under it while its onProgress callback keeps appending the OLD
      // folder's rows under the NEW folder's path. The button is also disabled
      // while running (DirectoryPanel), this guard covers a click already
      // queued just before that disable took effect.
      if (get().running) return;
      const dir = await getApi().openDirDialog();
      if (!dir) return;
      set({ path: dir, rows: [], progress: '' });
      let res: unknown;
      try {
        res = await getApi().listFolderAudio(dir);
      } catch (err) {
        console.warn('listFolderAudio failed', err);
        res = null;
      }
      const files = (res && (res as { success?: boolean; files?: unknown }).success
        && Array.isArray((res as { files?: unknown }).files))
        ? (res as { files: string[] }).files
        : [];
      set({ files, emptyMessage: getBatchAnalysis().dirEmptyMessage(res) });
    },

    async analyze() {
      const state = get();
      if (state.running || state.files.length === 0) return;
      const batch = getBatchAnalysis();
      const total = state.files.length;
      set({ running: true, rows: [], progress: batch.progressText(0, total) });

      try {
        const rows = await batch.runBatch(state.files, {
          analyzeFile: (fp) => getApi().analyzeFile({ filePath: fp }),
          toSummaryInput: (data, _fp) => {
            // Mirrors analysisStore's cast: analyze-file's DTO is the mirrored
            // renderer shape of @sound-buddy/shared's AnalysisPayload.
            const src = reportCardSourceFromAnalysis(data as AnalysisPayload);
            return src ? buildAnalysisSummaryInput(src, getGrading(), 'file') : null;
          },
          saveSummary: (input) => getApi().saveAnalysisSummary(input),
          onProgress: (event) => {
            if (event.status === 'running') return;
            set((s) => ({
              progress: batch.progressText(event.index + 1, event.total),
              // After the 'running' skip the event carries the full row
              // ({ index, total, ...row } from runBatch's final per-file emit).
              rows: [...s.rows, event as BatchRow],
            }));
          },
        });
        set({ progress: batch.summaryText(rows) });
      } finally {
        // Never leaves the button stuck — an unexpected throw still clears
        // running (runBatch itself turns per-file failures into error rows).
        set({ running: false });
      }
    },
  }));
}

export const useDirectoryStore = createDirectoryStore(getSoundBuddy);
