// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDirectoryStore, type DirectoryApi, type BatchRow } from './directoryStore';
import { createMockSoundBuddy } from '../mock-sound-buddy';
import type { SoundBuddyApi } from '../../../electron/ipc/api';

// batch-analysis.js + grading.js are real, pure classic-script modules — same
// convention as liveCaptureStore.test.ts's armState/groupState requires.
const batchAnalysis = require('../../batch-analysis.js') as {
  runBatch(files: string[], deps: Record<string, unknown>): Promise<BatchRow[]>;
  progressText(done: number, total: number): string;
  summaryText(results: BatchRow[]): string;
  dirEmptyMessage(res: unknown): string;
};
const grading = require('../../grading.js');

function makeStore(overrides: Partial<SoundBuddyApi> = {}) {
  const mock = createMockSoundBuddy(overrides);
  const store = createDirectoryStore(() => mock.api as unknown as DirectoryApi);
  return { store, mock };
}

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { batchAnalysis, grading };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

const FILES = ['/tapes/01-sunday-am.wav', '/tapes/02-wednesday-night.wav'];

describe('createDirectoryStore (TD-001 slice 6h, #711)', () => {
  it('starts empty with nothing running', () => {
    const { store } = makeStore();
    expect(store.getState()).toMatchObject({
      path: '', files: [], rows: [], progress: '', running: false,
    });
  });

  describe('chooseFolder', () => {
    it('does nothing when the dialog is cancelled', async () => {
      const { store, mock } = makeStore({ openDirDialog: async () => null });
      await store.getState().chooseFolder();
      expect(store.getState().path).toBe('');
      expect(store.getState().files).toEqual([]);
      expect(mock.calls.some((c) => c.method === 'listFolderAudio')).toBe(false);
    });

    it('lists the chosen folder, clears the previous results, and stores the empty message', async () => {
      const { store } = makeStore({
        openDirDialog: async () => '/tapes',
        listFolderAudio: async () => ({ success: true, files: FILES }),
      });
      store.setState({ rows: [{ filePath: 'x', filename: 'x', status: 'ok', gradeLetter: 'A' }], progress: 'Analyzed 1 of 1' });
      await store.getState().chooseFolder();
      expect(store.getState().path).toBe('/tapes');
      expect(store.getState().files).toEqual(FILES);
      expect(store.getState().rows).toEqual([]);
      expect(store.getState().progress).toBe('');
    });

    it('stores the default empty-folder message when the folder has no audio files', async () => {
      const { store } = makeStore({
        openDirDialog: async () => '/tapes',
        listFolderAudio: async () => ({ success: true, files: [] }),
      });
      await store.getState().chooseFolder();
      expect(store.getState().files).toEqual([]);
      expect(store.getState().emptyMessage).toBe('No audio files in that folder — pick a folder containing your service recordings.');
    });

    it('surfaces a failed scan as the empty message with no files', async () => {
      const { store } = makeStore({
        openDirDialog: async () => '/tapes',
        listFolderAudio: async () => ({ success: false, error: 'Permission denied', files: [] } as never),
      });
      await store.getState().chooseFolder();
      expect(store.getState().files).toEqual([]);
      expect(store.getState().emptyMessage).toBe('Permission denied');
    });

    it('keeps the folder empty-state message on a rejected IPC call', async () => {
      const { store } = makeStore({
        openDirDialog: async () => '/tapes',
        listFolderAudio: async () => { throw new Error('boom'); },
      });
      await store.getState().chooseFolder();
      expect(store.getState().files).toEqual([]);
      expect(store.getState().emptyMessage).toContain('No audio files in that folder');
    });

    it('guards against re-choosing while a batch is running', async () => {
      const openDirDialog = vi.fn(async () => '/other');
      const { store } = makeStore({ openDirDialog });
      store.setState({ running: true });
      await store.getState().chooseFolder();
      expect(openDirDialog).not.toHaveBeenCalled();
    });
  });

  describe('analyze', () => {
    it('runs the batch loop, accumulates one row per file, and reports the summary', async () => {
      const saveAnalysisSummary = vi.fn(async () => ({ success: true, file: 's.json' }));
      const { store, mock } = makeStore({
        openDirDialog: async () => '/tapes',
        listFolderAudio: async () => ({ success: true, files: FILES }),
        saveAnalysisSummary,
      });
      store.setState({ files: FILES });
      await store.getState().analyze();
      const s = store.getState();
      expect(s.running).toBe(false);
      expect(s.rows).toHaveLength(2);
      expect(s.rows.every((r) => r.status === 'ok')).toBe(true);
      expect(s.progress).toBe('2 analyzed');
      // Each file really went through analyzeFile → summary → saveAnalysisSummary.
      const analyzed = mock.calls.filter((c) => c.method === 'analyzeFile').map((c) => (c.args[0] as { filePath: string }).filePath);
      expect(analyzed).toEqual(FILES);
      expect(saveAnalysisSummary).toHaveBeenCalledTimes(2);
    });

    it('progress reflects the per-file cadence while rows accumulate', async () => {
      const { store } = makeStore({
        openDirDialog: async () => '/tapes',
        listFolderAudio: async () => ({ success: true, files: FILES }),
      });
      store.setState({ files: FILES });
      const progress: string[] = [];
      const unsub = store.subscribe((s, prev) => {
        if (s.progress !== prev.progress) progress.push(s.progress);
      });
      await store.getState().analyze();
      unsub();
      expect(progress).toEqual(['Analyzed 0 of 2', 'Analyzed 1 of 2', 'Analyzed 2 of 2', '2 analyzed']);
    });

    it('turns a failing analyze-file into an error row without aborting the rest', async () => {
      const { store } = makeStore({
        openDirDialog: async () => '/tapes',
        listFolderAudio: async () => ({ success: true, files: FILES }),
        analyzeFile: async (opts) => {
          if (opts.filePath === FILES[0]) return { success: false, error: 'ffprobe exited 1' };
          return createMockSoundBuddy().api.analyzeFile({ filePath: opts.filePath });
        },
      });
      store.setState({ files: FILES });
      await store.getState().analyze();
      const s = store.getState();
      expect(s.running).toBe(false);
      expect(s.rows[0].status).toBe('error');
      expect(s.rows[1].status).toBe('ok');
      expect(s.progress).toContain("1 couldn't be read");
    });

    it('clears running on an unexpected batch throw (never leaves the button stuck)', async () => {
      const { store } = makeStore({});
      store.setState({ files: FILES });
      const throwing = { ...batchAnalysis, runBatch: vi.fn(async () => { throw new Error('boom'); }) };
      (globalThis as { window?: unknown }).window = { batchAnalysis: throwing, grading };
      await expect(store.getState().analyze()).rejects.toThrow('boom');
      expect(store.getState().running).toBe(false);
    });

    it('is a no-op while already running', async () => {
      const runBatch = vi.fn(async () => [] as BatchRow[]);
      const { store } = makeStore({});
      store.setState({ files: FILES, running: true });
      (globalThis as { window?: unknown }).window = { batchAnalysis: { ...batchAnalysis, runBatch }, grading };
      await store.getState().analyze();
      expect(runBatch).not.toHaveBeenCalled();
      expect(store.getState().running).toBe(true);
    });

    it('is a no-op with no chosen files', async () => {
      const { store } = makeStore({});
      await store.getState().analyze();
      expect(store.getState().running).toBe(false);
      expect(store.getState().rows).toEqual([]);
    });
  });
});
