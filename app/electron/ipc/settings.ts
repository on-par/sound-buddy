// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// App-settings domain (#225 split of the former monolithic ipc.ts): behavior
// flags, storage location, capture rigs, native file/dir dialogs, and the
// file:// URL bridge the sandboxed preload needs for the playback transport.

import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { logWarn } from '../logger';
import {
  getSettings,
  updateSettings,
  listRigs,
  upsertRig,
  deleteRig,
  setActiveRig,
  type CaptureRig,
} from '../settings';
import { isEntitled } from '../license';
import { dirSizeBytes, formatBytes } from '../storage';
import { defaultRecordDir, platformDefaultStorageDir } from './shared';

export function registerSettingsHandlers(): void {
  // get-app-version — the installed app version (from package.json / the
  // packaged .app's Info.plist), shown in the AI Engineer dialog (#202).
  ipcMain.handle('get-app-version', () => app.getVersion());

  // get-settings — read app-behavior flags (AI on/off, ideal profile). The
  // renderer reads this at boot to hide AI affordances when disabled.
  ipcMain.handle('get-settings', () => getSettings());

  // update-settings — persist a partial settings patch (e.g. the ideal EQ
  // profile the user picks in the spectrum header, PRD 05). Only known,
  // type-checked keys are accepted so a stray patch can't pollute settings.json.
  // Returns the merged settings so the renderer stays in sync.
  ipcMain.handle('update-settings', (_event, patch: Record<string, unknown>) => {
    const clean: Partial<ReturnType<typeof getSettings>> = {};
    if (patch && typeof patch === 'object') {
      if (typeof patch.aiEnabled === 'boolean') clean.aiEnabled = patch.aiEnabled;
      if (typeof patch.idealProfile === 'string') clean.idealProfile = patch.idealProfile;
      // Storage location (#91). Trimmed; an empty string resets to the platform
      // default (~/Music/Sound Buddy). No size/count limit is ever applied.
      if (typeof patch.storageDir === 'string') clean.storageDir = patch.storageDir.trim();
    }
    return updateSettings(clean);
  });

  // get-storage-usage — where recordings live and how much disk they use (#91).
  // Purely informational: the byte count is shown in Settings, never compared
  // against a quota or used to gate recording. Reports the effective folder
  // (configured storageDir or the ~/Music/Sound Buddy default) so the UI can
  // show the real path even before the user has chosen one.
  ipcMain.handle('get-storage-usage', async () => {
    const dir = defaultRecordDir();
    const isDefault = !getSettings().storageDir?.trim();
    let bytes = 0;
    try {
      bytes = await dirSizeBytes(dir);
    } catch (err) {
      logWarn(`get-storage-usage: ${String(err)}`);
    }
    return {
      path: dir,
      isDefault,
      defaultPath: platformDefaultStorageDir(),
      bytes,
      human: formatBytes(bytes),
      exists: fs.existsSync(dir),
    };
  });

  // Capture rigs (#36) — thin wrappers over the pure CRUD helpers in settings.ts,
  // which own validation and the layered-persistence discipline. Reads stay
  // ungated so a lapsed license keeps saved rigs accessible (#54: user data is
  // never locked); writes are Pro, matching the renderer's gate.
  ipcMain.handle('list-rigs', () => listRigs());
  ipcMain.handle('save-rig', (_event, rig: CaptureRig) => {
    if (!isEntitled('saved-rigs')) throw new Error('Saving rigs requires a Pro license');
    return upsertRig(rig);
  });
  ipcMain.handle('delete-rig', (_event, id: string) => {
    if (!isEntitled('saved-rigs')) throw new Error('Editing rigs requires a Pro license');
    return deleteRig(id);
  });
  ipcMain.handle('set-active-rig', (_event, id: string | null) => setActiveRig(id));

  // get-demo-audio lives in ipc/analysis.ts (file-analysis domain); onboarding
  // just needs the dev/e2e switch here alongside the other misc app settings.
  // onboarding-disabled — dev/e2e switch (SOUND_BUDDY_DISABLE_ONBOARDING) that
  // suppresses the first-run welcome overlay (#69) so the e2e harness can drive a
  // deterministic UI without the modal scrim intercepting clicks. Mirrors the
  // SOUND_BUDDY_DISABLE_TRIAL switch honored by license.ts. The overlay stays
  // hidden until this resolves at boot, so there's no scrim flash either way.
  ipcMain.handle('onboarding-disabled', () => process.env.SOUND_BUDDY_DISABLE_ONBOARDING === '1');

  // open-file-dialog
  ipcMain.handle('open-file-dialog', async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;
    const { filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        { name: 'Audio Files', extensions: ['wav', 'aif', 'aiff', 'flac', 'mp3', 'ogg', 'm4a'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return filePaths[0] ?? null;
  });

  // open-dir-dialog
  ipcMain.handle('open-dir-dialog', async () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;
    const { filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
    });
    return filePaths[0] ?? null;
  });

  // Playback transport (#180) — a file:// URL an <audio> element can load
  // directly. The sandboxed preload's `url` polyfill lacks pathToFileURL, so
  // this goes through the main process (which has the real Node module). Null
  // when the file is gone (moved/deleted since analysis) so the renderer never
  // points <audio> at a dead path and logs a resource-load error.
  ipcMain.handle('to-file-url', (_event, filePath: string) =>
    fs.existsSync(filePath) ? pathToFileURL(filePath).href : null);
}
