import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getVersion: vi.fn(() => '0.2.0') },
  shell: { openExternal: vi.fn(async () => {}) },
  BrowserWindow: class {},
}));
vi.mock('./logger', () => ({ log: vi.fn(), logWarn: vi.fn() }));

import { app, shell, BrowserWindow } from 'electron';
import { log, logWarn } from './logger';
import { isNewer, checkForUpdates, openReleasePage, type UpdateInfo } from './updater';
import { LATEST_MANIFEST_URL } from './update-manifest';

const RELEASES_PAGE = 'https://github.com/on-par/sound-buddy-releases/releases/latest';

function makeWin(destroyed = false): BrowserWindow {
  return {
    isDestroyed: () => destroyed,
    webContents: { send: vi.fn() },
  } as unknown as BrowserWindow;
}

function stubFetchJson(body: unknown, ok = true, status = 200): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, status, json: async () => body })));
}

function validManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    version: '9.9.9',
    channel: 'latest',
    notesSummary: 'notes',
    releaseUrl: 'https://example.com/rel',
    artifactUrl: 'https://example.com/rel.zip',
    artifactSizeBytes: 123,
    sha256: 'a'.repeat(64),
    publishedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

const SHA256 = 'a'.repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(app.getVersion).mockReturnValue('0.2.0');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isNewer', () => {
  it('compares numerically, not lexicographically', () => {
    expect(isNewer('0.10.1', '0.2.0')).toBe(true);
    expect(isNewer('0.2.0', '0.10.1')).toBe(false);
  });

  it('is false for equal versions', () => {
    expect(isNewer('1.0.0', '1.0.0')).toBe(false);
  });

  it('strips a leading v from both sides', () => {
    expect(isNewer('v0.2.0', '0.2.0')).toBe(false);
    expect(isNewer('0.2.0', 'v0.2.0')).toBe(false);
    expect(isNewer('v0.3.0', '0.2.0')).toBe(true);
  });

  it('strips a pre-release suffix', () => {
    expect(isNewer('0.2.0-beta', '0.2.0')).toBe(false);
  });

  it('treats a missing segment as 0', () => {
    expect(isNewer('0.2.0.1', '0.2.0')).toBe(true);
    expect(isNewer('0.2.0', '0.2.0.1')).toBe(false);
  });

  it('treats a malformed segment as 0', () => {
    expect(isNewer('abc', '')).toBe(false);
    expect(isNewer('', '')).toBe(false);
    expect(isNewer('v', '0.0.0')).toBe(false);
    expect(isNewer('0.0.1', 'abc')).toBe(true);
  });
});

describe('checkForUpdates', () => {
  const manifest = validManifest();

  it('notifies the renderer when an update is available (silent=true)', async () => {
    stubFetchJson(manifest);
    const win = makeWin();

    await checkForUpdates(win, true);

    const expected: UpdateInfo = {
      version: '9.9.9',
      url: 'https://example.com/rel',
      notes: 'notes',
      downloadUrl: 'https://example.com/rel.zip',
      sha256: SHA256,
      sizeBytes: 123,
    };
    expect(win.webContents.send).toHaveBeenCalledTimes(1);
    expect(win.webContents.send).toHaveBeenCalledWith('update-available', expected);
    expect(log).toHaveBeenCalled();
  });

  it('calls the manifest URL with a User-Agent header', async () => {
    stubFetchJson(manifest);
    const win = makeWin();

    await checkForUpdates(win, true);

    expect(fetch).toHaveBeenCalledWith(
      LATEST_MANIFEST_URL,
      expect.objectContaining({ headers: expect.objectContaining({ 'User-Agent': 'SoundBuddy' }) }),
    );
  });

  it('reports up to date on a manual check (silent=false)', async () => {
    stubFetchJson(validManifest({ version: '0.2.0' }));
    const win = makeWin();

    await checkForUpdates(win, false);

    expect(win.webContents.send).toHaveBeenCalledWith('update-status', {
      state: 'up-to-date',
      version: '0.2.0',
    });
    expect(log).toHaveBeenCalled();
  });

  it('stays quiet when up to date and silent', async () => {
    stubFetchJson(validManifest({ version: '0.2.0' }));
    const win = makeWin();

    await checkForUpdates(win, true);

    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it('reports an error on a network failure, manual check', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const win = makeWin();

    await expect(checkForUpdates(win, false)).resolves.toBeUndefined();

    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('update check failed'));
    expect(win.webContents.send).toHaveBeenCalledWith('update-status', { state: 'error' });
  });

  it('stays quiet on a network failure when silent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const win = makeWin();

    await expect(checkForUpdates(win, true)).resolves.toBeUndefined();

    expect(logWarn).toHaveBeenCalled();
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it('reports an error on invalid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('bad json');
        },
      })),
    );
    const win = makeWin();

    await expect(checkForUpdates(win, false)).resolves.toBeUndefined();

    expect(logWarn).toHaveBeenCalled();
    expect(win.webContents.send).toHaveBeenCalledWith('update-status', { state: 'error' });
  });

  it('reports an error on a non-OK response (404/500)', async () => {
    stubFetchJson({}, false, 404);
    const win = makeWin();

    await checkForUpdates(win, false);

    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('404'));
    expect(win.webContents.send).toHaveBeenCalledWith('update-status', { state: 'error' });
  });

  it('reports an error when the manifest is malformed', async () => {
    stubFetchJson({ schemaVersion: 1 });
    const win = makeWin();

    await checkForUpdates(win, false);

    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('malformed manifest'));
    expect(win.webContents.send).toHaveBeenCalledWith('update-status', { state: 'error' });
  });

  it('reports an error when the manifest version has a leading "v"', async () => {
    stubFetchJson(validManifest({ version: 'v9.9.9' }));
    const win = makeWin();

    await checkForUpdates(win, false);

    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('malformed manifest'));
    expect(win.webContents.send).toHaveBeenCalledWith('update-status', { state: 'error' });
  });

  it('stays quiet on a malformed manifest when silent', async () => {
    stubFetchJson({ schemaVersion: 1 });
    const win = makeWin();

    await checkForUpdates(win, true);

    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('malformed manifest'));
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it('resolves without throwing when the window is null', async () => {
    stubFetchJson(manifest);

    await expect(checkForUpdates(null, false)).resolves.toBeUndefined();
  });

  it('does not send to a destroyed window', async () => {
    stubFetchJson(manifest);
    const win = makeWin(true);

    await checkForUpdates(win, false);

    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it('produces update-available even with unknown forward-compat fields (AC 4)', async () => {
    stubFetchJson(validManifest({ deltaUrl: 'https://example.com/delta.zip', minimumOsVersion: '26.0' }));
    const win = makeWin();

    await checkForUpdates(win, true);

    expect(win.webContents.send).toHaveBeenCalledWith('update-available', {
      version: '9.9.9',
      url: 'https://example.com/rel',
      notes: 'notes',
      downloadUrl: 'https://example.com/rel.zip',
      sha256: SHA256,
      sizeBytes: 123,
    });
  });
});

describe('getAvailableUpdate', () => {
  it('is null before any check', async () => {
    vi.resetModules();
    const fresh = await import('./updater');
    expect(fresh.getAvailableUpdate()).toBeNull();
  });

  it('holds the UpdateInfo after a successful check that found an update', async () => {
    vi.resetModules();
    stubFetchJson(validManifest());
    const fresh = await import('./updater');
    const win = makeWin();

    await fresh.checkForUpdates(win, true);

    expect(fresh.getAvailableUpdate()).toEqual({
      version: '9.9.9',
      url: 'https://example.com/rel',
      notes: 'notes',
      downloadUrl: 'https://example.com/rel.zip',
      sha256: SHA256,
      sizeBytes: 123,
    });
  });

  it('stays null after an up-to-date check', async () => {
    vi.resetModules();
    stubFetchJson(validManifest({ version: '0.2.0' }));
    const fresh = await import('./updater');
    const win = makeWin();

    await fresh.checkForUpdates(win, false);

    expect(fresh.getAvailableUpdate()).toBeNull();
  });
});

describe('openReleasePage', () => {
  it('opens the given URL', () => {
    openReleasePage('https://example.com/x');

    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com/x');
  });

  it('falls back to the releases page when no URL is given', () => {
    openReleasePage();

    expect(shell.openExternal).toHaveBeenCalledWith(RELEASES_PAGE);
  });
});
