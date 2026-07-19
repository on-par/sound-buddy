// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// App-settings domain (#225 split of the former monolithic ipc.ts): behavior
// flags, storage location, capture rigs, native file/dir dialogs, and the
// file:// URL bridge the sandboxed preload needs for the playback transport.

import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { resolveAppVersion } from '../app-version';
import { logWarn } from '../logger';
import { recordTelemetryEvent, clearTelemetryState } from '../telemetry';
import {
  getSettings,
  updateSettings,
  listRigs,
  upsertRig,
  deleteRig,
  setActiveRig,
  type CaptureRig,
  type PersistedChannelGroup,
} from '../settings';
import { isEntitled } from '../license';
import { dirSizeBytes, formatBytes } from '../storage';
import { APP_ROOT, defaultRecordDir, platformDefaultStorageDir } from './shared';

const DEFAULT_EXPORT_FILENAME = 'report.png';
const PNG_EXTENSION = '.png';
// Cap on a single channel label's stored length (#482) — same value as the
// renderer's MAX_LABEL_LEN (liveCaptureStore.ts / inline-app.js), kept in
// sync by convention since the renderer and this main-process guard must
// agree on what "too long" means.
const MAX_CHANNEL_LABEL_LEN = 40;
// Cap on a group name's stored length (#483) — same value/rationale as
// MAX_CHANNEL_LABEL_LEN, kept as its own named constant since a group name and
// a channel label are conceptually distinct fields that happen to share a cap.
const MAX_GROUP_NAME_LEN = 40;
// Cap on a stored instrument-profile override id (#524) — mirrors the
// renderer's instrument-profiles.js MAX_PROFILE_ID_LEN, kept in sync by
// convention since the renderer and this main-process guard must agree on
// what "too long" means.
const MAX_PROFILE_ID_LEN = 64;

/** A plain, non-array, non-null object. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Guards the update-settings whitelist for channelLabels (#482): `null` when
// `value` isn't a plain non-array object (the patch key is then ignored
// entirely, leaving the stored map untouched). Otherwise rebuilds the map
// from scratch — callers send the FULL next map, so this replaces rather than
// deep-merges with whatever was previously stored.
export function sanitizeChannelLabels(value: unknown): Record<string, Record<string, string>> | null {
  if (!isPlainObject(value)) return null;

  const clean: Record<string, Record<string, string>> = {};
  for (const [deviceName, tokenMap] of Object.entries(value)) {
    if (!isPlainObject(tokenMap)) continue;
    const labels: Record<string, string> = {};
    for (const [token, label] of Object.entries(tokenMap)) {
      if (token === '' || typeof label !== 'string') continue;
      const trimmed = label.trim().slice(0, MAX_CHANNEL_LABEL_LEN);
      if (trimmed === '') continue;
      labels[token] = trimmed;
    }
    if (Object.keys(labels).length > 0) clean[deviceName] = labels;
  }
  return clean;
}

// Guards the update-settings whitelist for channelGroups (#483): `null` when
// `value` isn't a plain non-array object (the patch key is then ignored
// entirely, leaving the stored map untouched). Otherwise rebuilds the map
// from scratch — callers send the FULL next map, so this replaces rather than
// deep-merges with whatever was previously stored. Mirrors
// sanitizeChannelLabels's discipline, extended for the group shape:
//  - a group needs a non-empty (post-trim) `name`, capped at MAX_GROUP_NAME_LEN
//  - `members` is filtered to non-negative integers, deduped in order
//  - `collapsed` is kept only when it's literally `true`
//  - a group with an empty `members` list is still kept (a named empty group
//    is legal — "No strips assigned"); a device whose group list ends up
//    empty is dropped (absence hydrates to [], same as channelLabels)
export function sanitizeChannelGroups(value: unknown): Record<string, PersistedChannelGroup[]> | null {
  if (!isPlainObject(value)) return null;

  const clean: Record<string, PersistedChannelGroup[]> = {};
  for (const [deviceName, groupList] of Object.entries(value)) {
    if (!Array.isArray(groupList)) continue;
    const groups: PersistedChannelGroup[] = [];
    for (const g of groupList) {
      if (!isPlainObject(g) || typeof g.name !== 'string') continue;
      const name = g.name.trim().slice(0, MAX_GROUP_NAME_LEN);
      if (name === '') continue;
      const seen = new Set<number>();
      const members: number[] = [];
      if (Array.isArray(g.members)) {
        for (const m of g.members) {
          if (Number.isInteger(m) && (m as number) >= 0 && !seen.has(m as number)) {
            seen.add(m as number);
            members.push(m as number);
          }
        }
      }
      const group: PersistedChannelGroup = { name, members };
      if (g.collapsed === true) group.collapsed = true;
      groups.push(group);
    }
    if (groups.length > 0) clean[deviceName] = groups;
  }
  return clean;
}

// Guards the update-settings whitelist for inputInstrumentProfiles (#524):
// `null` when `value` isn't a plain non-array object (the patch key is then
// ignored entirely, leaving the stored map untouched). Otherwise rebuilds the
// map from scratch — callers send the FULL next map, so this replaces rather
// than deep-merges with whatever was previously stored. Exact mirror of
// sanitizeChannelLabels. Deliberately does NOT validate the profile id against
// the renderer's built-in profile list — that list lives in instrument-
// profiles.js and an unknown id is already treated as "auto" on read
// (effectiveProfileId), so structural sanitization is sufficient here and
// keeps the main process decoupled from the renderer's profile catalog.
export function sanitizeInputInstrumentProfiles(value: unknown): Record<string, Record<string, string>> | null {
  if (!isPlainObject(value)) return null;

  const clean: Record<string, Record<string, string>> = {};
  for (const [deviceName, tokenMap] of Object.entries(value)) {
    if (!isPlainObject(tokenMap)) continue;
    const profiles: Record<string, string> = {};
    for (const [token, profileId] of Object.entries(tokenMap)) {
      if (token === '' || typeof profileId !== 'string') continue;
      const trimmed = profileId.trim().slice(0, MAX_PROFILE_ID_LEN);
      if (trimmed === '') continue;
      profiles[token] = trimmed;
    }
    if (Object.keys(profiles).length > 0) clean[deviceName] = profiles;
  }
  return clean;
}

// Pure helper behind the save-report-image handler (#368): basename-strips a
// suggested filename (defense-in-depth against a tampered IPC argument — the
// renderer already sanitizes it via report-export.ts's sanitizeCardFilename/
// buildExportFilename) and forces a .png extension so the save dialog always
// offers a valid PNG name, even given a blank or extension-less suggestion.
export function safeExportFilename(name: string): string {
  const parts = name.split(/[\\/]/);
  const basename = parts[parts.length - 1].trim();
  if (basename === '') return DEFAULT_EXPORT_FILENAME;
  return basename.toLowerCase().endsWith(PNG_EXTENSION) ? basename : `${basename}${PNG_EXTENSION}`;
}

export function registerSettingsHandlers(): void {
  // get-app-version — the installed app version, shown in the AI Engineer
  // dialog (#202). Reads package.json directly via resolveAppVersion rather
  // than Electron's own app.getVersion() — see app-version.ts for why.
  ipcMain.handle('get-app-version', () => resolveAppVersion(APP_ROOT));

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
      // Opt-in anonymous usage counts (#145) — gates all recording/sending in
      // telemetry.ts (#474).
      if (typeof patch.usageSignalEnabled === 'boolean') {
        clean.usageSignalEnabled = patch.usageSignalEnabled;
      }
      // Persisted per-device channel labels (#482). Replaces the whole stored
      // map — callers always send the full next map, never a partial merge.
      const labels = sanitizeChannelLabels(patch.channelLabels);
      if (labels) clean.channelLabels = labels;
      // Persisted per-device named channel groups (#483). Same full-map
      // replace discipline as channelLabels.
      const groups = sanitizeChannelGroups(patch.channelGroups);
      if (groups) clean.channelGroups = groups;
      // Persisted per-device instrument-profile overrides for live inputs
      // (#524). Same full-map replace discipline as channelLabels.
      const instrumentProfiles = sanitizeInputInstrumentProfiles(patch.inputInstrumentProfiles);
      if (instrumentProfiles) clean.inputInstrumentProfiles = instrumentProfiles;
      // Opt-in crash reporting (#473) — gates all capture/sending in
      // crash-reporting.ts.
      if (typeof patch.crashReportingEnabled === 'boolean') {
        clean.crashReportingEnabled = patch.crashReportingEnabled;
      }
      // Opt-in experimental DAW-style Live workspace (#516) — a pure UI gate,
      // consumed by the renderer only.
      if (typeof patch.dawWorkspaceEnabled === 'boolean') {
        clean.dawWorkspaceEnabled = patch.dawWorkspaceEnabled;
      }
      // Opt-in experimental live adjustments area (#522) — a pure UI gate,
      // consumed by the renderer only.
      if (typeof patch.liveAdjustmentsEnabled === 'boolean') {
        clean.liveAdjustmentsEnabled = patch.liveAdjustmentsEnabled;
      }
      // Opt-in report-first-ux epic gate (#538) — a pure UI gate, consumed by
      // the renderer only; also env-overridable at read time
      // (SOUND_BUDDY_REPORT_FIRST_UX).
      if (typeof patch.reportFirstUxEnabled === 'boolean') {
        clean.reportFirstUxEnabled = patch.reportFirstUxEnabled;
      }
    }
    const result = updateSettings(clean);
    // Opting out of telemetry (#474) clears the pending queue and the
    // install id, so a later opt-in starts with a fresh anonymous identity.
    if (clean.usageSignalEnabled === false) clearTelemetryState();
    return result;
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
        { name: 'Video Files', extensions: ['mp4', 'mov', 'm4v', 'mkv', 'webm'] },
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

  // save-report-image (#368) — local-only save of the Export PNG button's
  // rasterized report card. No network anywhere: a native save dialog, then a
  // direct file write of the bytes the renderer already produced.
  ipcMain.handle('save-report-image', async (_event, bytes: Uint8Array, suggestedName: string) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return { saved: false };
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: safeExportFilename(suggestedName),
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
    });
    if (canceled || !filePath) return { saved: false };
    await fs.promises.writeFile(filePath, Buffer.from(bytes));
    recordTelemetryEvent('report_exported');
    return { saved: true, filePath };
  });

  // Playback transport (#180) — a file:// URL an <audio> element can load
  // directly. The sandboxed preload's `url` polyfill lacks pathToFileURL, so
  // this goes through the main process (which has the real Node module). Null
  // when the file is gone (moved/deleted since analysis) so the renderer never
  // points <audio> at a dead path and logs a resource-load error.
  ipcMain.handle('to-file-url', (_event, filePath: string) =>
    fs.existsSync(filePath) ? pathToFileURL(filePath).href : null);
}
