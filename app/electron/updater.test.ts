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
  const release = { tag_name: 'v9.9.9', html_url: 'https://example.com/rel', body: 'notes' };

  it('notifies the renderer when an update is available (silent=true)', async () => {
    stubFetchJson(release);
    const win = makeWin();

    await checkForUpdates(win, true);

    const expected: UpdateInfo = {
      version: '9.9.9',
      url: 'https://example.com/rel',
      notes: 'notes',
    };
    expect(win.webContents.send).toHaveBeenCalledTimes(1);
    expect(win.webContents.send).toHaveBeenCalledWith('update-available', expected);
    expect(log).toHaveBeenCalled();
  });

  it('calls the GitHub Releases API with a User-Agent header', async () => {
    stubFetchJson(release);
    const win = makeWin();

    await checkForUpdates(win, true);

    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/on-par/sound-buddy-releases/releases/latest',
      expect.objectContaining({ headers: expect.objectContaining({ 'User-Agent': 'SoundBuddy' }) }),
    );
  });

  it('reports up to date on a manual check (silent=false)', async () => {
    stubFetchJson({ tag_name: 'v0.2.0' });
    const win = makeWin();

    await checkForUpdates(win, false);

    expect(win.webContents.send).toHaveBeenCalledWith('update-status', {
      state: 'up-to-date',
      version: '0.2.0',
    });
    expect(log).toHaveBeenCalled();
  });

  it('stays quiet when up to date and silent', async () => {
    stubFetchJson({ tag_name: 'v0.2.0' });
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

  it('reports an error on a non-OK response (private-repo 404)', async () => {
    stubFetchJson({}, false, 404);
    const win = makeWin();

    await checkForUpdates(win, false);

    expect(logWarn).toHaveBeenCalledWith(expect.stringContaining('404'));
    expect(win.webContents.send).toHaveBeenCalledWith('update-status', { state: 'error' });
  });

  it('reports an error when tag_name is missing', async () => {
    stubFetchJson({});
    const win = makeWin();

    await checkForUpdates(win, false);

    expect(win.webContents.send).toHaveBeenCalledWith('update-status', { state: 'error' });
  });

  it('resolves without throwing when the window is null', async () => {
    stubFetchJson(release);

    await expect(checkForUpdates(null, false)).resolves.toBeUndefined();
  });

  it('does not send to a destroyed window', async () => {
    stubFetchJson(release);
    const win = makeWin(true);

    await checkForUpdates(win, false);

    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it('falls back to the releases page and empty notes when missing', async () => {
    stubFetchJson({ tag_name: 'v9.9.9' });
    const win = makeWin();

    await checkForUpdates(win, true);

    expect(win.webContents.send).toHaveBeenCalledWith('update-available', {
      version: '9.9.9',
      url: RELEASES_PAGE,
      notes: '',
    });
  });

  it('truncates release notes to 2000 characters', async () => {
    stubFetchJson({ tag_name: 'v9.9.9', body: 'x'.repeat(3000) });
    const win = makeWin();

    await checkForUpdates(win, true);

    const call = vi.mocked(win.webContents.send).mock.calls[0];
    const payload = call[1] as UpdateInfo;
    expect(payload.notes.length).toBe(2000);
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
