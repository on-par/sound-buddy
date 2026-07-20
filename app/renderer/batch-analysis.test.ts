// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';

// batch-analysis is a plain classic script (window.batchAnalysis in the
// browser, module.exports under Node), same shape as recent-services.js —
// the pure batch loop / row-markup logic is exercised without a DOM.
interface SummaryInput {
  sourceFilename: string;
  gradeLetter: string;
  score: number;
}

interface AnalyzeOutcome {
  success: boolean;
  data?: unknown;
  cancelled?: boolean;
  error?: string;
}

type ResultRow =
  | { filePath: string; filename: string; status: 'ok'; gradeLetter: string; score: number; saveError?: string }
  | { filePath: string; filename: string; status: 'cancelled' }
  | { filePath: string; filename: string; status: 'error'; error: string };

interface ProgressEvent {
  index: number;
  total: number;
  filePath: string;
  status: 'running' | 'ok' | 'cancelled' | 'error';
}

interface RunBatchDeps {
  analyzeFile: (filePath: string) => Promise<AnalyzeOutcome>;
  toSummaryInput: (data: unknown, filePath: string) => SummaryInput | null;
  saveSummary: (input: SummaryInput) => Promise<{ success: boolean; error?: string }>;
  onProgress: (event: ProgressEvent) => void;
}

const {
  runBatch,
  batchRowHtml,
  progressText,
  summaryText,
  shouldSuppressPushedResult,
  dirEmptyMessage,
} = require('./batch-analysis.js') as {
  runBatch: (files: string[], deps: RunBatchDeps) => Promise<ResultRow[]>;
  batchRowHtml: (result: ResultRow, index: number, escapeHtml: (s: unknown) => string) => string;
  progressText: (done: number, total: number) => string;
  summaryText: (results: ResultRow[]) => string;
  shouldSuppressPushedResult: (batchRunning: boolean) => boolean;
  dirEmptyMessage: (res: { success: boolean; error?: string } | null) => string;
};

function escapeHtml(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

const FILES = ['/recordings/a.wav', '/recordings/b.wav', '/recordings/c.wav'];

function baseDeps(overrides: Partial<RunBatchDeps> = {}): RunBatchDeps {
  return {
    analyzeFile: vi.fn().mockResolvedValue({ success: true, data: { ok: true } }),
    toSummaryInput: vi.fn().mockReturnValue({ sourceFilename: 'x', gradeLetter: 'A', score: 95 }),
    saveSummary: vi.fn().mockResolvedValue({ success: true }),
    onProgress: vi.fn(),
    ...overrides,
  };
}

describe('runBatch', () => {
  it('analyzes every file sequentially and returns ok results in input order', async () => {
    const deps = baseDeps();
    const results = await runBatch(FILES, deps);

    expect(results).toEqual([
      { filePath: '/recordings/a.wav', filename: 'a.wav', status: 'ok', gradeLetter: 'A', score: 95 },
      { filePath: '/recordings/b.wav', filename: 'b.wav', status: 'ok', gradeLetter: 'A', score: 95 },
      { filePath: '/recordings/c.wav', filename: 'c.wav', status: 'ok', gradeLetter: 'A', score: 95 },
    ]);
    expect(deps.saveSummary).toHaveBeenCalledTimes(3);
  });

  it('calls analyzeFile strictly sequentially — call N+1 only starts after call N resolves', async () => {
    const d1 = deferred<AnalyzeOutcome>();
    const d2 = deferred<AnalyzeOutcome>();
    const d3 = deferred<AnalyzeOutcome>();
    const calls: string[] = [];
    const analyzeFile = vi.fn((fp: string) => {
      calls.push(fp);
      if (fp === FILES[0]) return d1.promise;
      if (fp === FILES[1]) return d2.promise;
      return d3.promise;
    });
    const deps = baseDeps({ analyzeFile });

    const runPromise = runBatch(FILES, deps);
    await Promise.resolve();
    expect(calls).toEqual([FILES[0]]);

    d1.resolve({ success: true, data: {} });
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual([FILES[0], FILES[1]]);

    d2.resolve({ success: true, data: {} });
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual([FILES[0], FILES[1], FILES[2]]);

    d3.resolve({ success: true, data: {} });
    await runPromise;
  });

  it('a middle-file failure does not abort the batch — files 1 and 3 still complete ok', async () => {
    const analyzeFile = vi.fn()
      .mockResolvedValueOnce({ success: true, data: {} })
      .mockResolvedValueOnce({ success: false, error: 'ffprobe exited 1' })
      .mockResolvedValueOnce({ success: true, data: {} });
    const deps = baseDeps({ analyzeFile });

    const results = await runBatch(FILES, deps);

    expect(results[0].status).toBe('ok');
    expect(results[1]).toEqual({ filePath: FILES[1], filename: 'b.wav', status: 'error', error: 'ffprobe exited 1' });
    expect(results[2].status).toBe('ok');
  });

  it('a middle-file thrown rejection does not abort the batch', async () => {
    const analyzeFile = vi.fn()
      .mockResolvedValueOnce({ success: true, data: {} })
      .mockRejectedValueOnce(new Error('IPC channel closed'))
      .mockResolvedValueOnce({ success: true, data: {} });
    const deps = baseDeps({ analyzeFile });

    const results = await runBatch(FILES, deps);

    expect(results[0].status).toBe('ok');
    expect(results[1].status).toBe('error');
    expect((results[1] as { error: string }).error).toContain('IPC channel closed');
    expect(results[2].status).toBe('ok');
  });

  it('a cancelled outcome (#148 abort/timeout) is reported as status:cancelled', async () => {
    const analyzeFile = vi.fn()
      .mockResolvedValueOnce({ success: true, data: {} })
      .mockResolvedValueOnce({ success: false, cancelled: true })
      .mockResolvedValueOnce({ success: true, data: {} });
    const deps = baseDeps({ analyzeFile });

    const results = await runBatch(FILES, deps);

    expect(results[1]).toEqual({ filePath: FILES[1], filename: 'b.wav', status: 'cancelled' });
  });

  it('a saveSummary rejection keeps the row ok and records saveError, without aborting the batch', async () => {
    const saveSummary = vi.fn()
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce({ success: true });
    const deps = baseDeps({ saveSummary });

    const results = await runBatch(FILES, deps);

    expect(results[1].status).toBe('ok');
    expect((results[1] as { saveError?: string }).saveError).toContain('disk full');
    expect((results[0] as { saveError?: string }).saveError).toBeUndefined();
  });

  it('an ungradeable analysis (toSummaryInput returns null) is reported as a specific error', async () => {
    const toSummaryInput = vi.fn()
      .mockReturnValueOnce({ sourceFilename: 'a.wav', gradeLetter: 'A', score: 95 })
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ sourceFilename: 'c.wav', gradeLetter: 'A', score: 95 });
    const deps = baseDeps({ toSummaryInput });

    const results = await runBatch(FILES, deps);

    expect(results[1]).toEqual({
      filePath: FILES[1],
      filename: 'b.wav',
      status: 'error',
      error: "Analyzed, but the result could not be graded — the file may be silent or malformed.",
    });
  });

  it('emits a running and a final onProgress event per file with correct index/total', async () => {
    const deps = baseDeps();
    await runBatch(FILES, deps);

    expect(deps.onProgress).toHaveBeenCalledWith({ index: 0, total: 3, filePath: FILES[0], status: 'running' });
    expect(deps.onProgress).toHaveBeenCalledWith(expect.objectContaining({ index: 0, total: 3, filePath: FILES[0], status: 'ok' }));
    expect(deps.onProgress).toHaveBeenCalledWith({ index: 2, total: 3, filePath: FILES[2], status: 'running' });
    expect(deps.onProgress).toHaveBeenCalledWith(expect.objectContaining({ index: 2, total: 3, filePath: FILES[2], status: 'ok' }));
    expect(deps.onProgress).toHaveBeenCalledTimes(6);
  });

  it('the final onProgress event carries the whole completed row, not just status', async () => {
    const analyzeFile = vi.fn()
      .mockResolvedValueOnce({ success: true, data: {} })
      .mockResolvedValueOnce({ success: false, error: 'ffprobe exited 1' })
      .mockResolvedValueOnce({ success: true, data: {} });
    const deps = baseDeps({ analyzeFile });

    await runBatch(FILES, deps);

    expect(deps.onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ index: 0, total: 3, gradeLetter: 'A', score: 95 }),
    );
    expect(deps.onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ index: 1, total: 3, status: 'error', error: 'ffprobe exited 1' }),
    );
  });

  it('never throws even when everything fails', async () => {
    const deps = baseDeps({ analyzeFile: vi.fn().mockRejectedValue(new Error('boom')) });
    await expect(runBatch(FILES, deps)).resolves.toHaveLength(3);
  });
});

describe('batchRowHtml', () => {
  it('renders an ok row with recent-grade/dir-name/dir-item classes and the grade letter', () => {
    const html = batchRowHtml(
      { filePath: '/x/sunday.wav', filename: 'sunday.wav', status: 'ok', gradeLetter: 'B', score: 82 },
      0,
      escapeHtml,
    );
    expect(html).toContain('dir-item recent-row');
    expect(html).toContain('data-idx="0"');
    expect(html).toContain('recent-grade');
    expect(html).toContain('>B<');
    expect(html).toContain('dir-name');
    expect(html).toContain('sunday.wav');
  });

  it('renders an ok row that carries a saveError with a visible, escaped warning — never a silent-looking success', () => {
    const html = batchRowHtml(
      {
        filePath: '/x/sunday.wav',
        filename: 'sunday.wav',
        status: 'ok',
        gradeLetter: 'B',
        score: 82,
        saveError: 'ENOSPC: no space left on device',
      },
      0,
      escapeHtml,
    );
    expect(html).toContain('batch-error');
    expect(html).toContain('ENOSPC: no space left on device');
    expect(html).toContain('not saved to history');
  });

  it('renders a non-ok row with batch-failed and the specific escaped error', () => {
    const html = batchRowHtml(
      { filePath: '/x/broken.wav', filename: 'broken.wav', status: 'error', error: 'ffprobe exited 1' },
      1,
      escapeHtml,
    );
    expect(html).toContain('batch-failed');
    expect(html).toContain('batch-error');
    expect(html).toContain('ffprobe exited 1');
    expect(html).toContain('>—<');
  });

  it('escapes a filename containing a script-injection payload', () => {
    const html = batchRowHtml(
      { filePath: '/x/evil', filename: '<img src=x onerror=alert(1)>.wav', status: 'ok', gradeLetter: 'A', score: 99 },
      0,
      escapeHtml,
    );
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img');
  });

  it('escapes the error text of a non-ok row', () => {
    const html = batchRowHtml(
      { filePath: '/x/evil', filename: 'evil.wav', status: 'error', error: '<script>alert(1)</script>' },
      0,
      escapeHtml,
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('progressText', () => {
  it('formats "Analyzed N of M"', () => {
    expect(progressText(2, 5)).toBe('Analyzed 2 of 5');
    expect(progressText(0, 3)).toBe('Analyzed 0 of 3');
  });
});

describe('summaryText', () => {
  it('reports only the analyzed count when everything succeeded', () => {
    const results: ResultRow[] = [
      { filePath: 'a', filename: 'a', status: 'ok', gradeLetter: 'A', score: 1 },
      { filePath: 'b', filename: 'b', status: 'ok', gradeLetter: 'A', score: 1 },
      { filePath: 'c', filename: 'c', status: 'ok', gradeLetter: 'A', score: 1 },
    ];
    expect(summaryText(results)).toBe('3 analyzed');
  });

  it('adds the failure clause when some files could not be read', () => {
    const results: ResultRow[] = [
      { filePath: 'a', filename: 'a', status: 'ok', gradeLetter: 'A', score: 1 },
      { filePath: 'b', filename: 'b', status: 'ok', gradeLetter: 'A', score: 1 },
      { filePath: 'c', filename: 'c', status: 'ok', gradeLetter: 'A', score: 1 },
      { filePath: 'd', filename: 'd', status: 'error', error: 'x' },
    ];
    expect(summaryText(results)).toBe("3 analyzed · 1 couldn't be read");
  });
});

describe('shouldSuppressPushedResult', () => {
  it('suppresses only while a batch is running', () => {
    expect(shouldSuppressPushedResult(true)).toBe(true);
    expect(shouldSuppressPushedResult(false)).toBe(false);
  });
});

describe('dirEmptyMessage', () => {
  it('shows the actionable folder-read error instead of the generic empty-folder copy', () => {
    expect(dirEmptyMessage({ success: false, error: 'Could not read that folder — check it still exists and you have permission to read it.' }))
      .toBe('Could not read that folder — check it still exists and you have permission to read it.');
  });

  it('falls back to the generic empty-folder copy for a genuinely empty folder', () => {
    expect(dirEmptyMessage({ success: true, files: [] } as unknown as { success: boolean })).toBe(
      'No audio files in that folder — pick a folder containing your service recordings.',
    );
  });

  it('falls back to the generic copy when the IPC call itself rejected (res is null)', () => {
    expect(dirEmptyMessage(null)).toBe(
      'No audio files in that folder — pick a folder containing your service recordings.',
    );
  });
});
