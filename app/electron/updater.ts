import { app, BrowserWindow, shell } from 'electron';
import { log, logWarn } from './logger';

// Lightweight "check for updates" — no auto-download/install (that needs a
// Developer ID signature + notarization). We ask the GitHub Releases API for the
// latest tag and, if it's newer than the running build, tell the renderer to
// show a banner whose button opens the release page in the browser.
//
// Downloads live in a separate PUBLIC repo so the source can stay private; a
// public repo is what makes the anonymous Releases API + zip downloads work.
const REPO = 'on-par/sound-buddy-releases';
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

export interface UpdateInfo {
  version: string;
  url: string;
  notes: string;
}

// Compare dotted numeric versions (e.g. "0.2.0" vs "0.10.1"), ignoring a leading
// "v" and any pre-release suffix. Returns true when `latest` > `current`.
function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) =>
    v.replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

async function fetchLatest(): Promise<UpdateInfo | null> {
  // GitHub requires a User-Agent. A private repo returns 404 to anonymous
  // requests — handled as "no update" rather than an error surfaced to the user.
  const res = await fetch(LATEST_RELEASE_API, {
    headers: { 'User-Agent': 'SoundBuddy', Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) {
    logWarn(`update check: GitHub API returned ${res.status}`);
    return null;
  }
  const data = (await res.json()) as { tag_name?: string; html_url?: string; body?: string };
  if (!data.tag_name) return null;
  return {
    version: data.tag_name.replace(/^v/, ''),
    url: data.html_url || RELEASES_PAGE,
    notes: (data.body || '').slice(0, 2000),
  };
}

/**
 * Check for a newer release.
 * @param silent  when true (startup check), stay quiet unless an update exists;
 *                when false (manual "Check for Updates…"), also report
 *                up-to-date / unreachable so the menu action gives feedback.
 */
export async function checkForUpdates(win: BrowserWindow | null, silent: boolean): Promise<void> {
  const current = app.getVersion();
  let latest: UpdateInfo | null = null;
  try {
    latest = await fetchLatest();
  } catch (err) {
    logWarn(`update check failed: ${String(err)}`);
    if (!silent && win && !win.isDestroyed()) {
      win.webContents.send('update-status', { state: 'error' });
    }
    return;
  }

  if (!latest) {
    // Couldn't determine the latest release (offline, or a private repo returning
    // 404 to anonymous requests). Don't claim "up to date" — say so on a manual check.
    if (!silent && win && !win.isDestroyed()) {
      win.webContents.send('update-status', { state: 'error' });
    }
    return;
  }

  if (isNewer(latest.version, current)) {
    log(`update available: ${current} → ${latest.version}`);
    if (win && !win.isDestroyed()) win.webContents.send('update-available', latest);
    return;
  }

  log(`update check: up to date (${current})`);
  if (!silent && win && !win.isDestroyed()) {
    win.webContents.send('update-status', { state: 'up-to-date', version: current });
  }
}

export function openReleasePage(url?: string): void {
  void shell.openExternal(url || RELEASES_PAGE);
}
