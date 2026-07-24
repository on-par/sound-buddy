// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Persisted app settings — a small JSON file in the app's user-data dir.
//
//   ~/Library/Application Support/SoundBuddy/settings.json
//
// Settings here are app-behavior flags the UI reads at boot and (later)
// writes from Preferences.

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { app } from 'electron';
import { logWarn } from './logger';
import type {
  AppSettings,
  CaptureRig,
  CaptureRigChannel,
  PreflightBaseline,
  CustomIdealProfile,
  PersistedChannelGroup,
} from './ipc/api';

// These DTOs are homed in ipc/api.ts (TD-011, #405) — the renderer-safe
// boundary type both tsc programs share — and re-exported here so existing
// importers of './settings' don't need to change their import path.
export type { AppSettings, CaptureRig, CaptureRigChannel, PreflightBaseline, CustomIdealProfile, PersistedChannelGroup };

const MIN_SERVICE_DAY = 0;
const MAX_SERVICE_DAY = 6;

const DEFAULTS: AppSettings = {
  idealProfile: '',
  customIdealProfiles: [],
  storageDir: '',
  rigs: [],
  activeRigId: null,
  usageSignalEnabled: false,
  channelLabels: {},
  channelGroups: {},
  inputInstrumentProfiles: {},
  crashReportingEnabled: false,
  dawWorkspaceEnabled: false,
  liveAdjustmentsEnabled: false,
  reportFirstUxEnabled: false,
  shareChurchName: '',
  weeklyReminderEnabled: false,
  weeklyReminderServiceDay: 0,
};

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

/**
 * Read the raw settings.json (file layer only — no defaults, no env). Returns
 * `{}` when the file is absent or unreadable. This is the single source the
 * layered-persistence writers mutate, so an env override is never baked in.
 */
function readSettingsFile(context: string): Partial<AppSettings> {
  try {
    const p = settingsPath();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')) as Partial<AppSettings>;
  } catch (err) {
    logWarn(`could not read settings.json ${context}: ${String(err)}`);
  }
  return {};
}

/**
 * The rigs array from a raw file view, defaulting to a fresh empty array when
 * the key is absent or corrupted (hand-edited to a non-array). Always returns a
 * new array for the default case so callers can never mutate a shared default.
 */
function fileRigs(file: Partial<AppSettings>): CaptureRig[] {
  return Array.isArray(file.rigs) ? file.rigs : [];
}

function fileCustomIdealProfiles(file: Partial<AppSettings>): CustomIdealProfile[] {
  return Array.isArray(file.customIdealProfiles) ? file.customIdealProfiles : [];
}

/**
 * The weeklyReminderServiceDay value from a raw file view, defaulting to
 * `DEFAULTS.weeklyReminderServiceDay` when the key is absent or corrupted
 * (hand-edited to a non-integer or out-of-range value) — mirrors fileRigs's
 * "corrupted value falls back to the default" discipline.
 */
function fileWeeklyReminderServiceDay(file: Partial<AppSettings>): number {
  const v = file.weeklyReminderServiceDay;
  return typeof v === 'number' && Number.isInteger(v) && v >= MIN_SERVICE_DAY && v <= MAX_SERVICE_DAY
    ? v
    : DEFAULTS.weeklyReminderServiceDay;
}

/**
 * The channelLabels map from a raw file view, defaulting to a fresh empty
 * object when the key is absent or corrupted (hand-edited to a non-object or
 * an array). Always returns a new object for the default case so callers can
 * never mutate a shared default.
 */
function fileChannelLabels(file: Partial<AppSettings>): Record<string, Record<string, string>> {
  const v = file.channelLabels;
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

/**
 * The channelGroups map from a raw file view, defaulting to a fresh empty
 * object when the key is absent or corrupted (hand-edited to a non-object or
 * an array) — mirrors fileChannelLabels (#482) for #483's per-device groups.
 * Always returns a new object for the default case so callers can never
 * mutate a shared default.
 */
function fileChannelGroups(file: Partial<AppSettings>): Record<string, PersistedChannelGroup[]> {
  const v = file.channelGroups;
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

/**
 * The inputInstrumentProfiles map from a raw file view, defaulting to a
 * fresh empty object when the key is absent or corrupted (hand-edited to a
 * non-object or an array) — exact mirror of fileChannelLabels (#524). Always
 * returns a new object for the default case so callers can never mutate a
 * shared default.
 */
function fileInputInstrumentProfiles(file: Partial<AppSettings>): Record<string, Record<string, string>> {
  const v = file.inputInstrumentProfiles;
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

/**
 * Persist the file layer, preserving any fields not being changed — including
 * unknown top-level keys a future version may add. Callers pass the mutated file
 * view — never getSettings()'s env-resolved view — so transient env overrides
 * stay read-time only. Rethrows a write failure so a lost save surfaces to the
 * caller instead of resolving as a silent success.
 */
function writeSettingsFile(file: Partial<AppSettings>): void {
  const persisted: AppSettings = {
    ...file,
    idealProfile: file.idealProfile ?? DEFAULTS.idealProfile,
    customIdealProfiles: fileCustomIdealProfiles(file),
    storageDir: file.storageDir ?? DEFAULTS.storageDir,
    rigs: fileRigs(file),
    activeRigId: file.activeRigId ?? DEFAULTS.activeRigId,
    usageSignalEnabled: file.usageSignalEnabled ?? DEFAULTS.usageSignalEnabled,
    channelLabels: fileChannelLabels(file),
    channelGroups: fileChannelGroups(file),
    inputInstrumentProfiles: fileInputInstrumentProfiles(file),
    crashReportingEnabled: file.crashReportingEnabled ?? DEFAULTS.crashReportingEnabled,
    dawWorkspaceEnabled: file.dawWorkspaceEnabled ?? DEFAULTS.dawWorkspaceEnabled,
    liveAdjustmentsEnabled: file.liveAdjustmentsEnabled ?? DEFAULTS.liveAdjustmentsEnabled,
    reportFirstUxEnabled: file.reportFirstUxEnabled ?? DEFAULTS.reportFirstUxEnabled,
    shareChurchName: typeof file.shareChurchName === 'string' ? file.shareChurchName : DEFAULTS.shareChurchName,
    weeklyReminderEnabled: file.weeklyReminderEnabled ?? DEFAULTS.weeklyReminderEnabled,
    weeklyReminderServiceDay: fileWeeklyReminderServiceDay(file),
  };
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(persisted, null, 2));
  } catch (err) {
    logWarn(`could not write settings.json: ${String(err)}`);
    throw err;
  }
}

function envBool(name: string): boolean | undefined {
  const v = process.env[name]?.trim().toLowerCase();
  if (v === undefined || v === '') return undefined;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** Read settings, layering file over defaults and env overrides over the file. */
export function getSettings(): AppSettings {
  const file = readSettingsFile('for read');

  const envReportFirstUx = envBool('SOUND_BUDDY_REPORT_FIRST_UX');

  return {
    idealProfile:
      process.env.SOUND_BUDDY_IDEAL_PROFILE?.trim() || file.idealProfile || DEFAULTS.idealProfile,
    customIdealProfiles: fileCustomIdealProfiles(file),
    storageDir:
      process.env.SOUND_BUDDY_STORAGE_DIR?.trim() || file.storageDir || DEFAULTS.storageDir,
    // Rigs have no env layer — they are pure persisted data.
    rigs: fileRigs(file),
    activeRigId: file.activeRigId ?? DEFAULTS.activeRigId,
    // No env layer — there is no behavior to gate at launch, so this flag is
    // pure persisted data (like rigs).
    usageSignalEnabled: file.usageSignalEnabled ?? DEFAULTS.usageSignalEnabled,
    // Channel labels have no env layer — pure persisted data, like rigs.
    channelLabels: fileChannelLabels(file),
    // Channel groups (#483) have no env layer — pure persisted data, like rigs.
    channelGroups: fileChannelGroups(file),
    // Instrument-profile overrides (#524) have no env layer — pure persisted
    // data, like channelLabels.
    inputInstrumentProfiles: fileInputInstrumentProfiles(file),
    // No env layer — opt-in crash reporting (#473) must be an explicit user
    // action, same rationale as usageSignalEnabled.
    crashReportingEnabled: file.crashReportingEnabled ?? DEFAULTS.crashReportingEnabled,
    // No env layer — opting into the experimental DAW workspace (#516) must
    // be an explicit user action, same rationale as crashReportingEnabled.
    dawWorkspaceEnabled: file.dawWorkspaceEnabled ?? DEFAULTS.dawWorkspaceEnabled,
    // No env layer — opting into experimental live adjustments (#522) must
    // be an explicit user action, same rationale as dawWorkspaceEnabled.
    liveAdjustmentsEnabled: file.liveAdjustmentsEnabled ?? DEFAULTS.liveAdjustmentsEnabled,
    // A launch-time env override (SOUND_BUDDY_REPORT_FIRST_UX) so the epic
    // can be dogfooded without a Settings toggle, unlike the other
    // experimental UI gates above.
    reportFirstUxEnabled: envReportFirstUx ?? file.reportFirstUxEnabled ?? DEFAULTS.reportFirstUxEnabled,
    // No env layer — a church name is user-authored copy for the Share
    // Image export (#265), not a launch-time behavior toggle.
    shareChurchName: typeof file.shareChurchName === 'string' ? file.shareChurchName : DEFAULTS.shareChurchName,
    // No env layer — opting into the local weekly reminder (#268) must be an
    // explicit user action, same rationale as crashReportingEnabled.
    weeklyReminderEnabled: file.weeklyReminderEnabled ?? DEFAULTS.weeklyReminderEnabled,
    weeklyReminderServiceDay: fileWeeklyReminderServiceDay(file),
  };
}

/** Merge and persist a partial update; returns the new settings. */
export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  // Persist the patch over the FILE contents (layered on defaults) — never over
  // getSettings()'s env-resolved view. Otherwise a transient env override (e.g.
  // SOUND_BUDDY_REPORT_FIRST_UX=1) would be baked permanently into
  // settings.json, silently defeating the launch-time-only contract after the
  // env var is removed. Env overrides stay transient (read-time only).
  const file = readSettingsFile('before update');
  writeSettingsFile({ ...file, ...patch });
  // Return the effective settings (env overrides still apply for reads).
  return getSettings();
}

// ── Capture rigs (CRUD) ───────────────────────────────────────────────────────
// All mutations follow the same layered-persistence discipline as
// updateSettings: read the FILE layer → mutate → write the FILE layer. Env
// overrides for idealProfile are therefore never baked into a rig write, and
// rigs themselves have no env layer.

/** All saved rigs, in stored order (env overrides don't touch rigs). */
export function listRigs(): CaptureRig[] {
  return fileRigs(readSettingsFile('for listRigs'));
}

/** Find one rig by id, or undefined. */
export function getRig(id: string): CaptureRig | undefined {
  return listRigs().find((r) => r.id === id);
}

/**
 * Insert (new id) or replace-in-place (existing id) a rig; returns the effective
 * settings. A rig without an id gets a freshly generated one. Requires a
 * non-empty `name`; a missing name throws (minimal validation).
 */
export function upsertRig(rig: Omit<CaptureRig, 'id'> & { id?: string }): AppSettings {
  if (rig == null || typeof rig !== 'object' || typeof rig.name !== 'string' || rig.name === '') {
    throw new Error('upsertRig: rig.name is required');
  }
  const id = rig.id && typeof rig.id === 'string' ? rig.id : randomUUID();
  const next: CaptureRig = { ...rig, id };

  const file = readSettingsFile('before upsertRig');
  const rigs = [...fileRigs(file)];
  const idx = rigs.findIndex((r) => r.id === id);
  if (idx >= 0) rigs[idx] = next;
  else rigs.push(next);

  writeSettingsFile({ ...file, rigs });
  return getSettings();
}

/**
 * Remove a rig by id; returns the effective settings. Unknown id is a no-op.
 * If the removed rig was active, activeRigId is cleared to null.
 */
export function deleteRig(id: string): AppSettings {
  const file = readSettingsFile('before deleteRig');
  const current = fileRigs(file);
  // Unknown id — nothing to remove, so skip the write entirely.
  if (!current.some((r) => r.id === id)) return getSettings();

  const rigs = current.filter((r) => r.id !== id);
  const activeRigId = file.activeRigId === id ? null : (file.activeRigId ?? DEFAULTS.activeRigId);

  writeSettingsFile({ ...file, rigs, activeRigId });
  return getSettings();
}

/**
 * Select a rig as active; returns the effective settings. Passing null clears
 * the selection. An id not present among the saved rigs is ignored (no-op).
 */
export function setActiveRig(id: string | null): AppSettings {
  const file = readSettingsFile('before setActiveRig');
  const rigs = fileRigs(file);
  if (id !== null && !rigs.some((r) => r.id === id)) {
    // Unknown id — leave the selection untouched.
    return getSettings();
  }
  writeSettingsFile({ ...file, activeRigId: id });
  return getSettings();
}
