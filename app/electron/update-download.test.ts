// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Writable } from 'stream';
import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import * as fs from 'fs';

vi.mock('electron', () => ({
  BrowserWindow: class {},
  app: { getPath: vi.fn(() => '/mock/downloads') },
  shell: { showItemInFolder: vi.fn() },
}));
vi.mock('./logger', () => ({ log: vi.fn(), logWarn: vi.fn() }));

import { app } from 'electron';
import { log, logWarn } from './logger';
import {
  downloadAndVerify,
  startUpdateDownload,
  cancelUpdateDownload,
  realDeps,
  type UpdateDownloadDeps,
} from './update-download';
import type { UpdateInfo } from './updater';

function makeInfo(overrides: Partial<UpdateInfo> = {}): UpdateInfo {
  return {
    version: '9.9.9',
    url: 'https://example.com/rel',
    notes: 'notes',
    downloadUrl: 'https://example.com/dl/SoundBuddy.zip',
    sha256: 'a'.repeat(64),
    sizeBytes: 0,
    ...overrides,
  };
}

// Fake fetch Response with an async-iterable `body` of Uint8Array chunks,
// mirroring the WHATWG ReadableStream that Node's real fetch returns.
function fakeResponse(opts: {
  ok?: boolean;
  status?: number;
  contentLength?: string | null;
  body?: AsyncIterable<Uint8Array> | null;
}) {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers: { get: (name: string) => (name === 'content-length' ? (opts.contentLength ?? null) : null) },
    body: opts.body === undefined ? asyncIterable([]) : opts.body,
  };
}

function asyncIterable(chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i >= chunks.length) return { done: true as const, value: undefined };
          return { done: false as const, value: chunks[i++] };
        },
      };
    },
  };
}

// An async-iterable body that throws mid-stream (network error or, when
// `abortSignal` is given, an AbortError once the signal is aborted).
function throwingBody(chunks: Uint8Array[], opts: { abortSignal?: AbortSignal } = {}): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (opts.abortSignal?.aborted) {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            throw err;
          }
          if (i >= chunks.length) {
            throw new Error('stream broke');
          }
          return { done: false as const, value: chunks[i++] };
        },
      };
    },
  };
}

interface DepsHarness {
  deps: UpdateDownloadDeps;
  writes: Record<string, Buffer[]>;
  calls: { rename: Array<[string, string]>; unlink: string[]; mkdir: string[] };
  onStatus: ReturnType<typeof vi.fn>;
}

function makeDeps(overrides: Partial<UpdateDownloadDeps> = {}): DepsHarness {
  const writes: Record<string, Buffer[]> = {};
  const calls = { rename: [] as Array<[string, string]>, unlink: [] as string[], mkdir: [] as string[] };
  const onStatus = vi.fn();

  const createWriteStream = ((p: string) => {
    const chunks: Buffer[] = [];
    writes[p] = chunks;
    return new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
    });
    // The test double only needs write()/end()/close/drain/destroy semantics
    // (a real Writable provides all of them), not fs.WriteStream's full surface.
  }) as unknown as typeof fs.createWriteStream;

  const deps: UpdateDownloadDeps = {
    fetchImpl: vi.fn() as unknown as typeof fetch,
    createWriteStream,
    rename: vi.fn(async (from: string, to: string) => {
      calls.rename.push([from, to]);
    }),
    unlink: vi.fn(async (p: string) => {
      calls.unlink.push(p);
    }),
    mkdir: vi.fn(async (p: string) => {
      calls.mkdir.push(p);
    }),
    createHashImpl: createHash,
    downloadsDir: vi.fn(() => '/mock/downloads'),
    onStatus,
    ...overrides,
  };

  return { deps, writes, calls, onStatus };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('downloadAndVerify', () => {
  it('writes chunks in order, verifies, renames, and returns done', async () => {
    const bytes = Buffer.from('hello world, this is a test payload for sha256 verification');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const info = makeInfo({ sizeBytes: bytes.length, sha256 });
    const { deps, writes, calls, onStatus } = makeDeps({
      fetchImpl: vi.fn(async () =>
        fakeResponse({ body: asyncIterable([bytes.subarray(0, 20), bytes.subarray(20)]) })
      ) as unknown as typeof fetch,
    });

    const result = await downloadAndVerify(info, deps, new AbortController().signal);

    expect(result).toEqual({ state: 'done', filePath: '/mock/downloads/SoundBuddy.zip', version: '9.9.9' });
    expect(Buffer.concat(writes['/mock/downloads/SoundBuddy.zip.partial'])).toEqual(bytes);
    expect(calls.rename).toEqual([
      ['/mock/downloads/SoundBuddy.zip.partial', '/mock/downloads/SoundBuddy.zip'],
    ]);
    expect(calls.unlink).toEqual([]);
    expect(deps.mkdir).toHaveBeenCalledWith('/mock/downloads');

    const statuses = onStatus.mock.calls.map((c) => c[0]);
    const downloading = statuses.filter((s) => s.state === 'downloading');
    expect(downloading.length).toBeGreaterThan(0);
    const percents = downloading.map((s) => s.percent);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
    expect(statuses.some((s) => s.state === 'verifying')).toBe(true);
  });

  it('throttles progress: two chunks in the same integer percent emit one downloading status', async () => {
    const info = makeInfo({ sizeBytes: 1000, sha256: 'x'.repeat(64) });
    const { deps, onStatus } = makeDeps({
      fetchImpl: vi.fn(async () =>
        fakeResponse({ body: asyncIterable([new Uint8Array([1]), new Uint8Array([2])]) })
      ) as unknown as typeof fetch,
    });

    await downloadAndVerify(info, deps, new AbortController().signal);

    const downloading = onStatus.mock.calls.map((c) => c[0]).filter((s) => s.state === 'downloading');
    expect(downloading).toHaveLength(1);
    expect(downloading[0].percent).toBe(0);
  });

  it('reports totalBytes 0 and percent 0 when size is unknown', async () => {
    const info = makeInfo({ sizeBytes: 0, sha256: createHash('sha256').update(Buffer.from('x')).digest('hex') });
    const { deps, onStatus } = makeDeps({
      fetchImpl: vi.fn(async () =>
        fakeResponse({ contentLength: null, body: asyncIterable([Buffer.from('x')]) })
      ) as unknown as typeof fetch,
    });

    await downloadAndVerify(info, deps, new AbortController().signal);

    const downloading = onStatus.mock.calls.map((c) => c[0]).filter((s) => s.state === 'downloading');
    expect(downloading).toEqual([{ state: 'downloading', receivedBytes: 1, totalBytes: 0, percent: 0 }]);
  });

  it('manifest sizeBytes wins over the content-length header', async () => {
    const bytes = Buffer.from('abc');
    const info = makeInfo({ sizeBytes: 200, sha256: createHash('sha256').update(bytes).digest('hex') });
    const { deps, onStatus } = makeDeps({
      fetchImpl: vi.fn(async () =>
        fakeResponse({ contentLength: '9999999', body: asyncIterable([bytes]) })
      ) as unknown as typeof fetch,
    });

    await downloadAndVerify(info, deps, new AbortController().signal);

    const downloading = onStatus.mock.calls.map((c) => c[0]).filter((s) => s.state === 'downloading');
    expect(downloading[0].totalBytes).toBe(200);
  });

  it('uses the content-length header when manifest sizeBytes is 0', async () => {
    const bytes = Buffer.from('abc');
    const info = makeInfo({ sizeBytes: 0, sha256: createHash('sha256').update(bytes).digest('hex') });
    const { deps, onStatus } = makeDeps({
      fetchImpl: vi.fn(async () =>
        fakeResponse({ contentLength: '500', body: asyncIterable([bytes]) })
      ) as unknown as typeof fetch,
    });

    await downloadAndVerify(info, deps, new AbortController().signal);

    const downloading = onStatus.mock.calls.map((c) => c[0]).filter((s) => s.state === 'downloading');
    expect(downloading[0].totalBytes).toBe(500);
  });

  it('deletes the partial file and returns an actionable error on checksum mismatch', async () => {
    const bytes = Buffer.from('some payload bytes');
    const info = makeInfo({ sizeBytes: bytes.length, sha256: 'f'.repeat(64) }); // wrong digest
    const { deps, calls } = makeDeps({
      fetchImpl: vi.fn(async () => fakeResponse({ body: asyncIterable([bytes]) })) as unknown as typeof fetch,
    });

    const result = await downloadAndVerify(info, deps, new AbortController().signal);

    expect(calls.unlink).toEqual(['/mock/downloads/SoundBuddy.zip.partial']);
    expect(calls.rename).toEqual([]);
    expect(result.state).toBe('error');
    if (result.state === 'error') {
      expect(result.message).toMatch(/verif/i);
      expect(result.message).toMatch(/try again/i);
    }
  });

  it('returns an actionable error on an HTTP failure with no fs writes', async () => {
    const info = makeInfo();
    const { deps, calls, writes } = makeDeps({
      fetchImpl: vi.fn(async () => fakeResponse({ ok: false, status: 500 })) as unknown as typeof fetch,
    });

    const result = await downloadAndVerify(info, deps, new AbortController().signal);

    expect(result.state).toBe('error');
    if (result.state === 'error') expect(result.message).toContain('HTTP 500');
    expect(calls.rename).toEqual([]);
    expect(calls.unlink).toEqual([]);
    expect(Object.keys(writes)).toEqual([]);
  });

  it('returns an actionable error when the response has no body', async () => {
    const info = makeInfo();
    const { deps } = makeDeps({
      fetchImpl: vi.fn(async () => fakeResponse({ body: null })) as unknown as typeof fetch,
    });

    const result = await downloadAndVerify(info, deps, new AbortController().signal);

    expect(result).toEqual({ state: 'error', message: 'download returned no data — try again later' });
  });

  it('unlinks the partial file and returns an error on a mid-stream network failure', async () => {
    const info = makeInfo({ sizeBytes: 10 });
    const { deps, calls } = makeDeps({
      fetchImpl: vi.fn(async () =>
        fakeResponse({ body: throwingBody([new Uint8Array([1, 2, 3])]) })
      ) as unknown as typeof fetch,
    });

    const result = await downloadAndVerify(info, deps, new AbortController().signal);

    expect(calls.unlink).toEqual(['/mock/downloads/SoundBuddy.zip.partial']);
    expect(result.state).toBe('error');
    expect(logWarn).toHaveBeenCalled();
  });

  it('unlinks the partial file and returns cancelled when the signal aborts mid-stream', async () => {
    const info = makeInfo({ sizeBytes: 10 });
    const controller = new AbortController();
    const { deps, calls } = makeDeps({
      fetchImpl: vi.fn(async () =>
        fakeResponse({ body: throwingBody([new Uint8Array([1, 2, 3])], { abortSignal: controller.signal }) })
      ) as unknown as typeof fetch,
    });

    const promise = downloadAndVerify(info, deps, controller.signal);
    controller.abort();
    const result = await promise;

    expect(calls.unlink).toEqual(['/mock/downloads/SoundBuddy.zip.partial']);
    expect(result).toEqual({ state: 'cancelled' });
  });

  it('derives the filename from the download URL basename, percent-decoded', async () => {
    const bytes = Buffer.from('x');
    const info = makeInfo({
      downloadUrl: 'https://example.com/dl/Sound%20Buddy.zip',
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    const { deps } = makeDeps({
      fetchImpl: vi.fn(async () => fakeResponse({ body: asyncIterable([bytes]) })) as unknown as typeof fetch,
    });

    const result = await downloadAndVerify(info, deps, new AbortController().signal);

    expect(result).toMatchObject({ filePath: '/mock/downloads/Sound Buddy.zip' });
  });

  it('awaits drain when the write stream reports backpressure', async () => {
    class FakeWriteStream extends EventEmitter {
      destroyed = false;
      writes: Buffer[] = [];
      private firstWrite = true;
      write(chunk: Buffer): boolean {
        this.writes.push(chunk);
        if (this.firstWrite) {
          this.firstWrite = false;
          setImmediate(() => this.emit('drain'));
          return false;
        }
        return true;
      }
      end(): void {
        setImmediate(() => this.emit('close'));
      }
      destroy(): void {
        this.destroyed = true;
      }
    }
    const stream = new FakeWriteStream();
    const bytes = Buffer.from('backpressure payload');
    const info = makeInfo({ sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    const { deps } = makeDeps({
      createWriteStream: (() => stream) as unknown as typeof fs.createWriteStream,
      fetchImpl: vi.fn(async () =>
        fakeResponse({ body: asyncIterable([bytes.subarray(0, 5), bytes.subarray(5)]) })
      ) as unknown as typeof fetch,
    });

    const result = await downloadAndVerify(info, deps, new AbortController().signal);

    expect(result.state).toBe('done');
    expect(Buffer.concat(stream.writes)).toEqual(bytes);
  });

  it('swallows a failing best-effort unlink after a mid-stream error', async () => {
    const info = makeInfo({ sizeBytes: 10 });
    const { deps } = makeDeps({
      unlink: vi.fn(async () => {
        throw new Error('unlink failed');
      }),
      fetchImpl: vi.fn(async () =>
        fakeResponse({ body: throwingBody([new Uint8Array([1, 2, 3])]) })
      ) as unknown as typeof fetch,
    });

    const result = await downloadAndVerify(info, deps, new AbortController().signal);

    expect(result.state).toBe('error');
  });

  it('does not attempt to destroy the write stream when creating it failed before assignment', async () => {
    const info = makeInfo({ sizeBytes: 10 });
    const { deps, calls } = makeDeps({
      createWriteStream: (() => {
        throw new Error('disk full');
      }) as unknown as typeof fs.createWriteStream,
      fetchImpl: vi.fn(async () => fakeResponse({ body: asyncIterable([new Uint8Array([1])]) })) as unknown as typeof fetch,
    });

    const result = await downloadAndVerify(info, deps, new AbortController().signal);

    expect(result.state).toBe('error');
    expect(calls.unlink).toEqual(['/mock/downloads/SoundBuddy.zip.partial']);
  });

  it('falls back to a generated filename when the URL path has no basename', async () => {
    const bytes = Buffer.from('x');
    const info = makeInfo({
      downloadUrl: 'https://example.com/',
      version: '3.4.5',
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    const { deps } = makeDeps({
      fetchImpl: vi.fn(async () => fakeResponse({ body: asyncIterable([bytes]) })) as unknown as typeof fetch,
    });

    const result = await downloadAndVerify(info, deps, new AbortController().signal);

    expect(result).toMatchObject({ filePath: '/mock/downloads/SoundBuddy-3.4.5.zip' });
  });
});

describe('startUpdateDownload', () => {
  it('returns an error result when there is no update info', async () => {
    const result = await startUpdateDownload(null, null, makeDeps().deps);
    expect(result).toEqual({
      success: false,
      error: 'No update available to download — run Check for Updates first.',
    });
  });

  it('rejects a second concurrent download while one is in progress', async () => {
    const info = makeInfo();
    let resolveFetch!: () => void;
    const { deps } = makeDeps({
      fetchImpl: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFetch = () => resolve(fakeResponse({ ok: false, status: 500 }));
          })
      ) as unknown as typeof fetch,
    });

    const first = startUpdateDownload(null, info, deps);
    const second = await startUpdateDownload(null, info, makeDeps().deps);

    expect(second).toEqual({ success: false, error: 'An update download is already in progress.' });

    resolveFetch();
    await first;
  });

  it('forwards the terminal status through onStatus and returns success on done', async () => {
    const bytes = Buffer.from('payload');
    const info = makeInfo({ sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    const { deps, onStatus } = makeDeps({
      fetchImpl: vi.fn(async () => fakeResponse({ body: asyncIterable([bytes]) })) as unknown as typeof fetch,
    });

    const result = await startUpdateDownload(null, info, deps);

    expect(result).toEqual({ success: true });
    const terminalCalls = onStatus.mock.calls.map((c) => c[0]).filter((s) => s.state === 'done');
    expect(terminalCalls).toHaveLength(1);
    expect(log).toHaveBeenCalled();
  });

  it('returns success:false with the error message on a failed download', async () => {
    const info = makeInfo();
    const { deps, onStatus } = makeDeps({
      fetchImpl: vi.fn(async () => fakeResponse({ ok: false, status: 500 })) as unknown as typeof fetch,
    });

    const result = await startUpdateDownload(null, info, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain('HTTP 500');
    expect(onStatus.mock.calls.map((c) => c[0]).some((s) => s.state === 'error')).toBe(true);
  });

  it('returns success:false with no error message when cancelled', async () => {
    const info = makeInfo({ sizeBytes: 10 });
    const controller = new AbortController();
    const { deps } = makeDeps({
      fetchImpl: vi.fn(async () =>
        fakeResponse({ body: throwingBody([new Uint8Array([1])], { abortSignal: controller.signal }) })
      ) as unknown as typeof fetch,
    });

    const promise = startUpdateDownload(null, info, deps);
    controller.abort();
    const result = await promise;

    expect(result).toEqual({ success: false });
  });

  it('lets a subsequent download start once the previous one finishes', async () => {
    const { deps: deps1 } = makeDeps({
      fetchImpl: vi.fn(async () => fakeResponse({ ok: false, status: 500 })) as unknown as typeof fetch,
    });
    const { deps: deps2 } = makeDeps({
      fetchImpl: vi.fn(async () => fakeResponse({ ok: false, status: 500 })) as unknown as typeof fetch,
    });

    await startUpdateDownload(null, makeInfo(), deps1);
    const second = await startUpdateDownload(null, makeInfo(), deps2);

    expect(second.error).not.toBe('An update download is already in progress.');
  });
});

describe('cancelUpdateDownload', () => {
  it('aborts the active controller, unwinding the in-flight download as cancelled', async () => {
    const info = makeInfo({ sizeBytes: 10 });
    const controller = new AbortController();
    const { deps } = makeDeps({
      fetchImpl: vi.fn(async (_url, opts: RequestInit) => {
        (opts.signal as AbortSignal).addEventListener('abort', () => controller.abort());
        return fakeResponse({ body: throwingBody([new Uint8Array([1])], { abortSignal: opts.signal as AbortSignal }) });
      }) as unknown as typeof fetch,
    });

    const promise = startUpdateDownload(null, info, deps);
    cancelUpdateDownload();
    const result = await promise;

    expect(result).toEqual({ success: false });
  });

  it('is a no-op when there is no active download', () => {
    expect(() => cancelUpdateDownload()).not.toThrow();
  });
});

describe('revealDownloadedUpdate', () => {
  it('returns an error result when nothing has been downloaded yet', async () => {
    vi.resetModules();
    const fresh = await import('./update-download');
    const result = fresh.revealDownloadedUpdate(vi.fn());
    expect(result).toEqual({
      success: false,
      error: 'No verified download to reveal — download the update first.',
    });
  });

  it('calls the injected showItemInFolder with the final path after a successful download', async () => {
    vi.resetModules();
    const fresh = await import('./update-download');
    const bytes = Buffer.from('payload');
    const info = makeInfo({ sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    const { deps } = makeDeps({
      fetchImpl: vi.fn(async () => fakeResponse({ body: asyncIterable([bytes]) })) as unknown as typeof fetch,
    });

    await fresh.startUpdateDownload(null, info, deps);
    const showItemInFolder = vi.fn();
    const result = fresh.revealDownloadedUpdate(showItemInFolder);

    expect(result).toEqual({ success: true });
    expect(showItemInFolder).toHaveBeenCalledWith('/mock/downloads/SoundBuddy.zip');
  });

  it('defaults to the real shell.showItemInFolder when no override is given', async () => {
    vi.resetModules();
    const fresh = await import('./update-download');
    const { shell: freshShell } = await import('electron');
    const bytes = Buffer.from('payload');
    const info = makeInfo({ sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    const { deps } = makeDeps({
      fetchImpl: vi.fn(async () => fakeResponse({ body: asyncIterable([bytes]) })) as unknown as typeof fetch,
    });

    await fresh.startUpdateDownload(null, info, deps);
    fresh.revealDownloadedUpdate();

    expect(freshShell.showItemInFolder).toHaveBeenCalledWith('/mock/downloads/SoundBuddy.zip');
  });
});

describe('realDeps', () => {
  it('downloadsDir() resolves via app.getPath("downloads")', () => {
    const deps = realDeps(null);
    expect(deps.downloadsDir()).toBe('/mock/downloads');
    expect(app.getPath).toHaveBeenCalledWith('downloads');
  });

  it('wires the real fs/crypto implementations', () => {
    const deps = realDeps(null);
    expect(deps.createWriteStream).toBe(fs.createWriteStream);
    expect(deps.createHashImpl).toBe(createHash);
  });

  it('rename/unlink/mkdir delegate to fs.promises', async () => {
    const renameSpy = vi.spyOn(fs.promises, 'rename').mockResolvedValue(undefined);
    const unlinkSpy = vi.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);
    const mkdirSpy = vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);

    const deps = realDeps(null);
    await deps.rename('/a', '/b');
    await deps.unlink('/a');
    await deps.mkdir('/dir');

    expect(renameSpy).toHaveBeenCalledWith('/a', '/b');
    expect(unlinkSpy).toHaveBeenCalledWith('/a');
    expect(mkdirSpy).toHaveBeenCalledWith('/dir', { recursive: true });

    renameSpy.mockRestore();
    unlinkSpy.mockRestore();
    mkdirSpy.mockRestore();
  });

  it('onStatus sends update-download-status to a live window', () => {
    const win = { isDestroyed: () => false, webContents: { send: vi.fn() } } as unknown as import('electron').BrowserWindow;
    const deps = realDeps(win);

    deps.onStatus({ state: 'verifying' });

    expect(win.webContents.send).toHaveBeenCalledWith('update-download-status', { state: 'verifying' });
  });

  it('onStatus does not send to a destroyed window', () => {
    const win = { isDestroyed: () => true, webContents: { send: vi.fn() } } as unknown as import('electron').BrowserWindow;
    const deps = realDeps(win);

    deps.onStatus({ state: 'verifying' });

    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it('onStatus does not throw when the window is null', () => {
    const deps = realDeps(null);
    expect(() => deps.onStatus({ state: 'verifying' })).not.toThrow();
  });
});
