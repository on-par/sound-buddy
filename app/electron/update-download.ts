// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Streaming download + incremental sha256 verification for an update zip
// (#504). No auto-install — the app is unsigned, so the terminal handoff is
// "Show in Finder"; install stays a user action. Every side effect (fetch,
// fs, crypto, downloads dir, status sink, Finder reveal) is injected via
// UpdateDownloadDeps so downloadAndVerify is fully unit-testable without
// Electron or a network.

import { BrowserWindow, app, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { once } from 'events';
import { log, logWarn } from './logger';
import type { UpdateInfo } from './updater';

export type UpdateDownloadStatus =
  | { state: 'downloading'; receivedBytes: number; totalBytes: number; percent: number }
  | { state: 'verifying' }
  | { state: 'done'; filePath: string; version: string }
  | { state: 'cancelled' }
  | { state: 'error'; message: string };

export interface UpdateDownloadDeps {
  fetchImpl: typeof fetch;
  createWriteStream: typeof fs.createWriteStream;
  rename: (from: string, to: string) => Promise<void>;
  unlink: (p: string) => Promise<void>;
  mkdir: (p: string) => Promise<unknown>;
  createHashImpl: typeof createHash;
  downloadsDir: () => string;
  onStatus: (s: UpdateDownloadStatus) => void;
}

/**
 * Streams `info.downloadUrl` into `<downloads>/<name>.partial`, hashing as it
 * writes, then verifies the digest against `info.sha256` before renaming to
 * the final name. Always returns a terminal status; never throws.
 */
export async function downloadAndVerify(
  info: UpdateInfo,
  deps: UpdateDownloadDeps,
  signal: AbortSignal
): Promise<UpdateDownloadStatus> {
  const dir = deps.downloadsDir();
  await deps.mkdir(dir);

  let name = decodeURIComponent(path.posix.basename(new URL(info.downloadUrl).pathname));
  if (!name) name = `SoundBuddy-${info.version}.zip`;
  const finalPath = path.join(dir, name);
  const partialPath = finalPath + '.partial';

  const res = await deps.fetchImpl(info.downloadUrl, {
    headers: { 'User-Agent': 'SoundBuddy' },
    signal,
  });

  if (!res.ok) {
    return {
      state: 'error',
      message: `download failed (HTTP ${res.status}) — check your connection and try again`,
    };
  }
  if (!res.body) {
    return { state: 'error', message: 'download returned no data — try again later' };
  }

  const totalBytes = info.sizeBytes > 0 ? info.sizeBytes : Number(res.headers.get('content-length')) || 0;

  let out: fs.WriteStream | null = null;
  try {
    out = deps.createWriteStream(partialPath);
    const hash = deps.createHashImpl('sha256');
    let received = 0;
    let lastPercent = -1;

    // res.body is a WHATWG ReadableStream<Uint8Array>; Node's undici typings
    // don't declare it async-iterable even though it is at runtime.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const chunk of res.body as any) {
      const buf = Buffer.from(chunk);
      hash.update(buf);
      if (!out.write(buf)) await once(out, 'drain');
      received += buf.length;
      const percent = totalBytes > 0 ? Math.min(100, Math.floor((received / totalBytes) * 100)) : 0;
      if (percent !== lastPercent) {
        lastPercent = percent;
        deps.onStatus({ state: 'downloading', receivedBytes: received, totalBytes, percent });
      }
    }
    out.end();
    await once(out, 'close');

    deps.onStatus({ state: 'verifying' });
    const digest = hash.digest('hex');
    if (digest !== info.sha256) {
      await deps.unlink(partialPath);
      return {
        state: 'error',
        message:
          'downloaded file failed checksum verification and was deleted — the download may be corrupted; try again',
      };
    }

    await deps.rename(partialPath, finalPath);
    return { state: 'done', filePath: finalPath, version: info.version };
  } catch (err) {
    if (out && !out.destroyed) out.destroy();
    await deps.unlink(partialPath).catch(() => {});
    if (signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
      return { state: 'cancelled' };
    }
    logWarn(`update download failed: ${String(err)}`);
    return {
      state: 'error',
      message: `download failed (${String(err)}) — check your connection and try again`,
    };
  }
}

let activeController: AbortController | null = null;
let lastDownloadedPath: string | null = null;

export function realDeps(win: BrowserWindow | null): UpdateDownloadDeps {
  return {
    fetchImpl: fetch,
    createWriteStream: fs.createWriteStream,
    rename: (from, to) => fs.promises.rename(from, to),
    unlink: (p) => fs.promises.unlink(p),
    mkdir: (p) => fs.promises.mkdir(p, { recursive: true }),
    createHashImpl: createHash,
    downloadsDir: () => app.getPath('downloads'),
    onStatus: (s) => {
      if (win && !win.isDestroyed()) win.webContents.send('update-download-status', s);
    },
  };
}

export async function startUpdateDownload(
  win: BrowserWindow | null,
  info: UpdateInfo | null,
  deps: UpdateDownloadDeps = realDeps(win)
): Promise<{ success: boolean; error?: string }> {
  if (!info) {
    return { success: false, error: 'No update available to download — run Check for Updates first.' };
  }
  if (activeController) {
    return { success: false, error: 'An update download is already in progress.' };
  }

  const controller = new AbortController();
  activeController = controller;
  let terminal: UpdateDownloadStatus;
  try {
    terminal = await downloadAndVerify(info, deps, controller.signal);
  } finally {
    activeController = null;
  }

  deps.onStatus(terminal);

  if (terminal.state === 'done') {
    lastDownloadedPath = terminal.filePath;
    log(`update download complete: ${terminal.filePath}`);
  }

  return {
    success: terminal.state === 'done',
    error: terminal.state === 'error' ? terminal.message : undefined,
  };
}

export function cancelUpdateDownload(): void {
  activeController?.abort();
}

export function revealDownloadedUpdate(
  showItemInFolder: (p: string) => void = shell.showItemInFolder
): { success: boolean; error?: string } {
  if (!lastDownloadedPath) {
    return { success: false, error: 'No verified download to reveal — download the update first.' };
  }
  showItemInFolder(lastDownloadedPath);
  return { success: true };
}
