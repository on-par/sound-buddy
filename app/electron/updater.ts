// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { app, BrowserWindow, shell } from 'electron';
import { log, logWarn } from './logger';
import { LATEST_MANIFEST_URL, parseUpdateManifest } from './update-manifest';

// Lightweight "check for updates" — no auto-download/install (that needs a
// Developer ID signature + notarization). We read the stable release manifest
// (the same latest.json contract customers download from, #500/#501) and, if
// it's newer than the running build, tell the renderer to show a banner whose
// button opens the release page in the browser.
//
// Downloads live in a separate PUBLIC repo so the source can stay private; a
// public repo is what makes the anonymous manifest fetch + zip downloads work.
const REPO = 'on-par/sound-buddy-releases';
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

export interface UpdateInfo {
  version: string;
  url: string;
  notes: string;
  downloadUrl: string;
  sha256: string;
  sizeBytes: number;
}

// The update the last checkForUpdates() found (if any) — set right before the
// 'update-available' event fires, so download-update never has to trust a
// renderer-supplied URL/hash: it only ever downloads what main itself vetted.
let availableUpdate: UpdateInfo | null = null;

export function getAvailableUpdate(): UpdateInfo | null {
  return availableUpdate;
}

// Compare dotted numeric versions (e.g. "0.2.0" vs "0.10.1"), ignoring a leading
// "v" and any pre-release suffix. Returns true when `latest` > `current`.
export function isNewer(latest: string, current: string): boolean {
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
  const res = await fetch(LATEST_MANIFEST_URL, {
    headers: { 'User-Agent': 'SoundBuddy' },
  });
  if (!res.ok) {
    logWarn(`update check: manifest fetch returned ${res.status}`);
    return null;
  }
  const parsed = parseUpdateManifest(await res.json());
  if (!parsed.ok) {
    logWarn(`update check: malformed manifest — ${parsed.problems.join('; ')}`);
    return null;
  }
  const m = parsed.manifest;
  return {
    version: m.version,
    url: m.releaseUrl,
    notes: m.notesSummary,
    downloadUrl: m.artifactUrl,
    sha256: m.sha256,
    sizeBytes: m.artifactSizeBytes,
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
  let latest: UpdateInfo | null;
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
    availableUpdate = latest;
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
