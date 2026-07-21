// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import {
  toUpdateInfo,
  toDownloadStatus,
  wireAutoUpdater,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  type AutoUpdaterDeps,
  type AutoUpdaterLike,
} from './auto-updater';

interface FakeUpdater extends AutoUpdaterLike {
  handlers: Record<string, Array<(...a: unknown[]) => void>>;
  fire: (event: string, ...args: unknown[]) => void;
}

function makeFakeUpdater(): FakeUpdater {
  const handlers: Record<string, Array<(...a: unknown[]) => void>> = {};
  return {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    handlers,
    on(event: string, listener: (...args: unknown[]) => void) {
      (handlers[event] ??= []).push(listener);
      return this;
    },
    fire(event: string, ...args: unknown[]) {
      for (const h of handlers[event] ?? []) h(...args);
    },
    checkForUpdates: vi.fn(async () => null),
    downloadUpdate: vi.fn(async () => null),
    quitAndInstall: vi.fn(),
  };
}

function makeDeps(updater: FakeUpdater = makeFakeUpdater()): AutoUpdaterDeps {
  return {
    updater,
    send: vi.fn(),
    currentVersion: vi.fn(() => '1.0.0'),
    log: vi.fn(),
    logWarn: vi.fn(),
  };
}

const RELEASE_URL_PREFIX = 'https://github.com/on-par/sound-buddy-releases/releases/tag/v';

describe('toUpdateInfo', () => {
  it('maps version + notes and constructs the release page url', () => {
    const info = toUpdateInfo({ version: '1.4.2', releaseNotes: 'Adds a thing.' });
    expect(info).toEqual({
      version: '1.4.2',
      url: `${RELEASE_URL_PREFIX}1.4.2`,
      notes: 'Adds a thing.',
    });
  });

  it('defaults notes to an empty string when releaseNotes is missing', () => {
    const info = toUpdateInfo({ version: '1.4.2' });
    expect(info.notes).toBe('');
  });

  it('defaults notes to an empty string when releaseNotes is not a string', () => {
    const info = toUpdateInfo({ version: '1.4.2', releaseNotes: [{ version: '1.4.2', note: 'x' }] });
    expect(info.notes).toBe('');
  });
});

describe('toDownloadStatus', () => {
  it('maps transferred/total/percent to a downloading status', () => {
    expect(toDownloadStatus({ transferred: 50, total: 100, percent: 50 })).toEqual({
      state: 'downloading',
      receivedBytes: 50,
      totalBytes: 100,
      percent: 50,
    });
  });

  it('handles a zero total (indeterminate progress) without dividing by zero', () => {
    expect(toDownloadStatus({ transferred: 10, total: 0, percent: 0 })).toEqual({
      state: 'downloading',
      receivedBytes: 10,
      totalBytes: 0,
      percent: 0,
    });
  });
});

describe('wireAutoUpdater', () => {
  it('disables autoDownload (the banner is the user consent) and enables autoInstallOnAppQuit', () => {
    const updater = makeFakeUpdater();
    wireAutoUpdater(makeDeps(updater));

    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(true);
  });

  it('sends update-available with the mapped info and logs it', () => {
    const updater = makeFakeUpdater();
    const deps = makeDeps(updater);
    wireAutoUpdater(deps);

    updater.fire('update-available', { version: '2.0.0', releaseNotes: 'notes' });

    expect(deps.send).toHaveBeenCalledWith('update-available', {
      version: '2.0.0',
      url: `${RELEASE_URL_PREFIX}2.0.0`,
      notes: 'notes',
    });
    expect(deps.log).toHaveBeenCalled();
  });

  it('sends update-download-status "downloading" on download-progress', () => {
    const updater = makeFakeUpdater();
    const deps = makeDeps(updater);
    wireAutoUpdater(deps);

    updater.fire('download-progress', { transferred: 1, total: 2, percent: 50 });

    expect(deps.send).toHaveBeenCalledWith('update-download-status', {
      state: 'downloading',
      receivedBytes: 1,
      totalBytes: 2,
      percent: 50,
    });
  });

  it('sends update-download-status "done" with the version on update-downloaded', () => {
    const updater = makeFakeUpdater();
    const deps = makeDeps(updater);
    wireAutoUpdater(deps);

    updater.fire('update-downloaded', { version: '2.0.0' });

    expect(deps.send).toHaveBeenCalledWith('update-download-status', { state: 'done', version: '2.0.0' });
  });

  describe('update-not-available', () => {
    it('sends update-status up-to-date when the triggering check was not silent', async () => {
      const updater = makeFakeUpdater();
      const deps = makeDeps(updater);
      wireAutoUpdater(deps);
      await checkForUpdates(deps, false);

      updater.fire('update-not-available');

      expect(deps.send).toHaveBeenCalledWith('update-status', { state: 'up-to-date', version: '1.0.0' });
    });

    it('sends nothing when the triggering check was silent', async () => {
      const updater = makeFakeUpdater();
      const deps = makeDeps(updater);
      wireAutoUpdater(deps);
      await checkForUpdates(deps, true);

      updater.fire('update-not-available');

      expect(deps.send).not.toHaveBeenCalled();
    });
  });

  describe('error', () => {
    it('logs and sends update-status error when the triggering check was not silent', async () => {
      const updater = makeFakeUpdater();
      const deps = makeDeps(updater);
      wireAutoUpdater(deps);
      await checkForUpdates(deps, false);

      updater.fire('error', new Error('offline'));

      expect(deps.logWarn).toHaveBeenCalledWith(expect.stringContaining('offline'));
      expect(deps.send).toHaveBeenCalledWith('update-status', { state: 'error' });
    });

    it('logs but sends nothing when the triggering check was silent', async () => {
      const updater = makeFakeUpdater();
      const deps = makeDeps(updater);
      wireAutoUpdater(deps);
      await checkForUpdates(deps, true);

      updater.fire('error', new Error('offline'));

      expect(deps.logWarn).toHaveBeenCalled();
      expect(deps.send).not.toHaveBeenCalled();
    });
  });
});

describe('checkForUpdates', () => {
  it('calls updater.checkForUpdates()', async () => {
    const updater = makeFakeUpdater();
    const deps = makeDeps(updater);
    wireAutoUpdater(deps);

    await checkForUpdates(deps, true);

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it('resolves without throwing when updater.checkForUpdates() rejects', async () => {
    const updater = makeFakeUpdater();
    updater.checkForUpdates = vi.fn(async () => {
      throw new Error('offline');
    });
    const deps = makeDeps(updater);
    wireAutoUpdater(deps);

    await expect(checkForUpdates(deps, false)).resolves.toBeUndefined();
  });
});

describe('downloadUpdate', () => {
  it('returns success:true when the download completes', async () => {
    const deps = makeDeps();

    await expect(downloadUpdate(deps)).resolves.toEqual({ success: true });
  });

  it('returns success:false with an actionable message when the download rejects', async () => {
    const updater = makeFakeUpdater();
    updater.downloadUpdate = vi.fn(async () => {
      throw new Error('network drop');
    });
    const deps = makeDeps(updater);

    const result = await downloadUpdate(deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain('network drop');
    expect(deps.logWarn).toHaveBeenCalled();
  });
});

describe('installUpdate', () => {
  it('calls quitAndInstall', () => {
    const updater = makeFakeUpdater();
    const deps = makeDeps(updater);

    installUpdate(deps);

    expect(updater.quitAndInstall).toHaveBeenCalledTimes(1);
  });
});
