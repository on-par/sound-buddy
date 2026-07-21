// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// electron-updater adapter (#625). Replaces the hand-rolled latest.json
// reader (update-manifest.ts) and streaming download + sha256 verify
// (update-download.ts) with the standard, maintained electron-updater
// library, which reads the latest-mac.yml feed electron-builder generates
// and verifies its own sha512. Everything here is pure or dependency-injected
// (AutoUpdaterDeps) — main.ts is the only place that touches the real
// electron-updater `autoUpdater` singleton or Electron, so this module is
// fully unit-testable with a fake updater and no Electron sandbox.

const RELEASES_REPO = 'on-par/sound-buddy-releases';

export interface UpdateInfo {
  version: string;
  url: string;
  notes: string;
}

export type UpdateDownloadStatus =
  | { state: 'downloading'; receivedBytes: number; totalBytes: number; percent: number }
  | { state: 'done'; version: string }
  | { state: 'cancelled' }
  | { state: 'error'; message: string };

/** The slice of electron-updater's autoUpdater singleton this module uses. */
export interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  // `any` mirrors electron-updater's own AppUpdater.on listener signature —
  // each event name carries a different payload shape; wireAutoUpdater below
  // narrows the payload per event.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
}

export interface AutoUpdaterDeps {
  updater: AutoUpdaterLike;
  /** win.webContents.send, guarded against a null/destroyed window. */
  send: (channel: string, payload: unknown) => void;
  currentVersion: () => string;
  log: (m: string) => void;
  logWarn: (m: string) => void;
}

/** Maps electron-updater's UpdateInfo (from 'update-available'/'update-downloaded') to our IPC shape. */
export function toUpdateInfo(raw: { version: string; releaseNotes?: string | unknown }): UpdateInfo {
  return {
    version: raw.version,
    url: `https://github.com/${RELEASES_REPO}/releases/tag/v${raw.version}`,
    notes: typeof raw.releaseNotes === 'string' ? raw.releaseNotes : '',
  };
}

/** Maps electron-updater's ProgressInfo (from 'download-progress') to our IPC shape. */
export function toDownloadStatus(p: { transferred: number; total: number; percent: number }): UpdateDownloadStatus {
  return {
    state: 'downloading',
    receivedBytes: p.transferred,
    totalBytes: p.total,
    percent: p.percent,
  };
}

// electron-updater's 'update-not-available'/'error' events fire as the direct
// response to whichever checkForUpdates() call is in flight, but carry no
// reference back to that call's `silent` flag — so it's tracked here. The app
// only ever runs one check at a time (the startup silent check, or the
// manual "Check for Updates…" menu item), so a single shared flag is enough.
let lastCheckWasSilent = true;

/** Wires electron-updater's events to the existing IPC channel names, once, at startup. */
export function wireAutoUpdater(deps: AutoUpdaterDeps): void {
  const { updater, send, currentVersion, log, logWarn } = deps;

  // false: the update banner's Download button is the user's consent to fetch
  // the update; true: once downloaded, install on the user's next quit
  // instead of requiring a separate step.
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;

  updater.on('update-available', (raw: { version: string; releaseNotes?: string | unknown }) => {
    const info = toUpdateInfo(raw);
    log(`update available: ${currentVersion()} → ${info.version}`);
    send('update-available', info);
  });

  updater.on('update-not-available', () => {
    if (lastCheckWasSilent) return;
    send('update-status', { state: 'up-to-date', version: currentVersion() });
  });

  updater.on('error', (err: unknown) => {
    logWarn(`update check failed: ${String(err)}`);
    if (lastCheckWasSilent) return;
    send('update-status', { state: 'error' });
  });

  updater.on('download-progress', (p: { transferred: number; total: number; percent: number }) => {
    send('update-download-status', toDownloadStatus(p));
  });

  updater.on('update-downloaded', (raw: { version: string }) => {
    send('update-download-status', { state: 'done', version: raw.version });
  });
}

/**
 * Check for a newer release.
 * @param silent  when true (startup check), the wired 'update-not-available'/'error'
 *                listeners stay quiet; when false (manual "Check for Updates…"),
 *                they report up-to-date / error so the menu action gives feedback.
 */
export async function checkForUpdates(deps: AutoUpdaterDeps, silent: boolean): Promise<void> {
  lastCheckWasSilent = silent;
  try {
    await deps.updater.checkForUpdates();
  } catch {
    // The wired 'error' listener (see wireAutoUpdater) already logged this
    // and reported it over IPC when non-silent; nothing further to do here.
  }
}

export async function downloadUpdate(deps: AutoUpdaterDeps): Promise<{ success: boolean; error?: string }> {
  try {
    await deps.updater.downloadUpdate();
    return { success: true };
  } catch (err) {
    deps.logWarn(`update download failed: ${String(err)}`);
    return {
      success: false,
      error: `download failed (${String(err)}) — check your connection and try again`,
    };
  }
}

export function installUpdate(deps: AutoUpdaterDeps): void {
  deps.updater.quitAndInstall();
}
