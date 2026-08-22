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
  SoundcheckBus,
} from './ipc/api';

// These DTOs are homed in ipc/api.ts (TD-011, #405) — the renderer-safe
// boundary type both tsc programs share — and re-exported here so existing
// importers of './settings' don't need to change their import path.
export type { AppSettings, CaptureRig, CaptureRigChannel, PreflightBaseline, CustomIdealProfile, PersistedChannelGroup, SoundcheckBus };

// ── Per-field invariants (SETTING_SPECS) ────────────────────────────────────
// Every AppSettings field's default, file-layer sanitizer, IPC-patch
// sanitizer, and (for the three env-backed fields) read-time env layering is
// declared exactly once here (#747). getSettings()/writeSettingsFile() and the
// update-settings IPC whitelist all derive from SETTING_SPECS, so a new
// setting is one spec entry plus the AppSettings/UpdateSettingsPatch types in
// ipc/api.ts — not ~8 scattered edit sites.

// Cap on a single channel label's stored length (#482) — same value as the
// renderer's MAX_LABEL_LEN (liveCaptureStore.ts / inline-app.js). Kept in sync
// by settings-length-caps-drift.test.ts since the renderer and this
// main-process guard must agree on what "too long" means.
export const MAX_CHANNEL_LABEL_LEN = 40;
// Cap on a group name's stored length (#483) — same value/rationale as
// MAX_CHANNEL_LABEL_LEN, kept as its own named constant since a group name and
// a channel label are conceptually distinct fields that happen to share a cap.
const MAX_GROUP_NAME_LEN = 40;
// Cap on a stored instrument-profile override id (#524) — mirrors the
// renderer's instrument-profiles.js MAX_PROFILE_ID_LEN, guarded by
// settings-length-caps-drift.test.ts.
export const MAX_PROFILE_ID_LEN = 64;
// Cap on the persisted Share Image church-name setting (#265) — mirrors the
// renderer's share-card.ts MAX_CHURCH_NAME_LEN, guarded by
// settings-length-caps-drift.test.ts. Defined here too since main can't import
// from the renderer program.
export const MAX_SHARE_CHURCH_NAME_LEN = 40;
// Cap on the persisted secondary measurement device name (#460). OS device
// names are short; the cap only guards a hand-crafted settings.json payload
// from bloating the stored preference.
const MAX_MEASUREMENT_DEVICE_NAME_LEN = 128;
// Valid range for weeklyReminderServiceDay (#268) — 0 = Sunday … 6 = Saturday,
// matching Date.prototype.getDay().
const MIN_SERVICE_DAY = 0;
const MAX_SERVICE_DAY = 6;
// Cap on a saved soundcheck bus name (#756) — mirrors MAX_GROUP_NAME_LEN's
// cap/rationale; a bus name is a short display label, not prose.
export const MAX_BUS_NAME_LEN = 40;
// Cap on a saved soundcheck bus match pattern (#756) — same value/rationale
// as MAX_BUS_NAME_LEN, kept as its own named constant since a pattern and a
// name are conceptually distinct fields that happen to share a cap.
export const MAX_BUS_PATTERN_LEN = 40;

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

// Guards the update-settings whitelist for shareChurchName (#265): `null`
// when `value` isn't a string (the patch key is then ignored entirely,
// leaving the stored setting untouched). Otherwise trims and caps the
// length — an empty string is a valid, meaningful result (it's how the user
// clears the name back to the privacy-preserving default).
export function sanitizeShareChurchName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim().slice(0, MAX_SHARE_CHURCH_NAME_LEN);
}

// Guards the update-settings whitelist for soundcheckBuses (#756): `null` when
// `value` isn't an array (the patch key is then ignored entirely, leaving the
// stored list untouched). Otherwise rebuilds the array from scratch — callers
// send the FULL next list, so this replaces rather than deep-merges with
// whatever was previously stored (same discipline as sanitizeChannelGroups).
// Per entry, skip unless: it's a plain object; `id`/`name`/`pattern` are
// non-empty (post-trim) strings capped at their named length caps; `pattern`
// contains at least one [A-Za-z0-9] char (a pattern with no alphanumeric
// content can never match anything, so it's malformed, not merely useless);
// `outputChannel` is a non-negative integer. Duplicate ids are dropped
// keeping the first occurrence.
export function sanitizeSoundcheckBuses(value: unknown): SoundcheckBus[] | null {
  if (!Array.isArray(value)) return null;

  const clean: SoundcheckBus[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isPlainObject(entry)) continue;
    if (typeof entry.id !== 'string') continue;
    const id = entry.id.trim().slice(0, MAX_BUS_NAME_LEN);
    if (id === '' || seen.has(id)) continue;
    if (typeof entry.name !== 'string') continue;
    const name = entry.name.trim().slice(0, MAX_BUS_NAME_LEN);
    if (name === '') continue;
    if (typeof entry.pattern !== 'string') continue;
    const pattern = entry.pattern.trim().slice(0, MAX_BUS_PATTERN_LEN);
    if (pattern === '' || !/[A-Za-z0-9]/.test(pattern)) continue;
    if (!Number.isInteger(entry.outputChannel) || (entry.outputChannel as number) < 0) continue;
    seen.add(id);
    clean.push({ id, name, pattern, outputChannel: entry.outputChannel as number });
  }
  return clean;
}

/**
 * Per-field spec describing one AppSettings field's invariants (#747): its
 * default value, its file-layer sanitizer, its (optional) IPC-patch
 * sanitizer, and its (optional) read-time env layering. SETTING_SPECS is the
 * single owner — getSettings()/writeSettingsFile() iterate it and the
 * update-settings IPC whitelist derives from sanitizePatch.
 *
 * Generic over the field's VALUE type (not its key): the map is declared as
 * `{ [K in keyof AppSettings]: SettingSpec<AppSettings[K]> }`, so T is e.g.
 * `string` for idealProfile or `boolean` for usageSignalEnabled.
 */
export interface SettingSpec<T> {
  default: T;
  sanitizeFile: (v: unknown) => T;
  sanitizePatch?: (v: unknown) => T | undefined;
  envRead?: (fileValue: T) => T;
}

// Every key of AppSettings gets exactly one entry — enforced at compile time
// by the mapped type and at runtime by settings.test.ts's spec-coverage test.
// Each entry lifts the field's semantics verbatim from the pre-#747 code so
// behavior is byte-identical.
export const SETTING_SPECS: { [K in keyof AppSettings]: SettingSpec<AppSettings[K]> } = {
  idealProfile: {
    default: '',
    sanitizeFile: (v) => ((v ?? SETTING_SPECS.idealProfile.default) as string),
    sanitizePatch: (v) => (typeof v === 'string' ? v : undefined),
    envRead: (f) => process.env.SOUND_BUDDY_IDEAL_PROFILE?.trim() || f,
  },
  customIdealProfiles: {
    // Returns the stored array by reference, exactly as the pre-#747
    // fileCustomIdealProfiles did — not patchable via IPC (profiles have their
    // own CRUD surface), no env layer.
    default: [],
    sanitizeFile: (v) => (Array.isArray(v) ? v : SETTING_SPECS.customIdealProfiles.default),
  },
  storageDir: {
    default: '',
    sanitizeFile: (v) => ((v ?? SETTING_SPECS.storageDir.default) as string),
    sanitizePatch: (v) => (typeof v === 'string' ? v.trim() : undefined),
    envRead: (f) => process.env.SOUND_BUDDY_STORAGE_DIR?.trim() || f,
  },
  rigs: {
    default: [],
    // Fresh array literal for the default case so callers can never mutate a
    // shared default — not patchable via IPC (rigs have dedicated CRUD IPC).
    sanitizeFile: (v) => (Array.isArray(v) ? v : []),
  },
  activeRigId: {
    default: null,
    sanitizeFile: (v) => ((v ?? SETTING_SPECS.activeRigId.default) as string | null),
  },
  usageSignalEnabled: {
    default: false,
    sanitizeFile: (v) => ((v ?? SETTING_SPECS.usageSignalEnabled.default) as boolean),
    sanitizePatch: (v) => (typeof v === 'boolean' ? v : undefined),
  },
  channelLabels: {
    default: {},
    sanitizeFile: (v) => (isPlainObject(v) ? (v as Record<string, Record<string, string>>) : {}),
    sanitizePatch: (v) => sanitizeChannelLabels(v) ?? undefined,
  },
  channelGroups: {
    default: {},
    sanitizeFile: (v) => (isPlainObject(v) ? (v as Record<string, PersistedChannelGroup[]>) : {}),
    sanitizePatch: (v) => sanitizeChannelGroups(v) ?? undefined,
  },
  inputInstrumentProfiles: {
    default: {},
    sanitizeFile: (v) => (isPlainObject(v) ? (v as Record<string, Record<string, string>>) : {}),
    sanitizePatch: (v) => sanitizeInputInstrumentProfiles(v) ?? undefined,
  },
  crashReportingEnabled: {
    default: false,
    sanitizeFile: (v) => ((v ?? SETTING_SPECS.crashReportingEnabled.default) as boolean),
    sanitizePatch: (v) => (typeof v === 'boolean' ? v : undefined),
  },
  liveAdjustmentsEnabled: {
    default: false,
    sanitizeFile: (v) => ((v ?? SETTING_SPECS.liveAdjustmentsEnabled.default) as boolean),
    sanitizePatch: (v) => (typeof v === 'boolean' ? v : undefined),
  },
  reportFirstUxEnabled: {
    default: false,
    sanitizeFile: (v) => ((v ?? SETTING_SPECS.reportFirstUxEnabled.default) as boolean),
    sanitizePatch: (v) => (typeof v === 'boolean' ? v : undefined),
    envRead: (f) => envBool('SOUND_BUDDY_REPORT_FIRST_UX') ?? f,
  },
  shareChurchName: {
    default: '',
    sanitizeFile: (v) => (typeof v === 'string' ? v : SETTING_SPECS.shareChurchName.default),
    sanitizePatch: (v) => sanitizeShareChurchName(v) ?? undefined,
  },
  weeklyReminderEnabled: {
    default: false,
    sanitizeFile: (v) => ((v ?? SETTING_SPECS.weeklyReminderEnabled.default) as boolean),
    sanitizePatch: (v) => (typeof v === 'boolean' ? v : undefined),
  },
  weeklyReminderServiceDay: {
    default: 0,
    sanitizeFile: (v) =>
      typeof v === 'number' && Number.isInteger(v) && v >= MIN_SERVICE_DAY && v <= MAX_SERVICE_DAY
        ? v
        : SETTING_SPECS.weeklyReminderServiceDay.default,
    sanitizePatch: (v) =>
      typeof v === 'number' && Number.isInteger(v) && v >= MIN_SERVICE_DAY && v <= MAX_SERVICE_DAY
        ? v
        : undefined,
  },
  liveEqPaneWidth: {
    default: 360,
    sanitizeFile: (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : SETTING_SPECS.liveEqPaneWidth.default),
    sanitizePatch: (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined),
  },
  measurementDeviceName: {
    default: '',
    sanitizeFile: (v) => (typeof v === 'string' ? v : SETTING_SPECS.measurementDeviceName.default),
    sanitizePatch: (v) => (typeof v === 'string' ? v.trim().slice(0, MAX_MEASUREMENT_DEVICE_NAME_LEN) : undefined),
  },
  gradingProfile: {
    default: 'casual',
    sanitizeFile: (v) => (v === 'casual' || v === 'broadcast' ? v : SETTING_SPECS.gradingProfile.default),
    sanitizePatch: (v) => (v === 'casual' || v === 'broadcast' ? v : undefined),
  },
  // Tier 2 (console-network) consent (#378 / ADR-0006). sanitizeFile is
  // unchanged from today so updateSettings({ consoleNetworkConsentGranted:
  // true }) (settings.test.ts) and grantConsoleNetworkConsent() still persist
  // true. sanitizePatch REJECTS true — a true patch is dropped at the
  // update-settings IPC boundary, so Settings can only ever revoke (false);
  // granting goes exclusively through the dedicated grant-console-network-
  // consent IPC (ipc/settings.ts → grantConsoleNetworkConsent()).
  consoleNetworkConsentGranted: {
    default: false,
    sanitizeFile: (v) => ((v ?? SETTING_SPECS.consoleNetworkConsentGranted.default) as boolean),
    sanitizePatch: (v) => (v === false ? false : undefined),
  },
  soundcheckBuses: {
    default: [],
    sanitizeFile: (v) => sanitizeSoundcheckBuses(v) ?? [],
    sanitizePatch: (v) => sanitizeSoundcheckBuses(v) ?? undefined,
  },
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
 * Persist the file layer, preserving any fields not being changed — including
 * unknown top-level keys a future version may add. Every known key is
 * backfilled through its SETTING_SPECS.sanitizeFile so a corrupted or absent
 * value is repaired to the field's default. Callers pass the mutated file
 * view — never getSettings()'s env-resolved view — so transient env overrides
 * stay read-time only. Rethrows a write failure so a lost save surfaces to the
 * caller instead of resolving as a silent success.
 */
function writeSettingsFile(file: Partial<AppSettings>): void {
  const persisted: Record<string, unknown> = { ...file };
  for (const key of Object.keys(SETTING_SPECS) as Array<keyof AppSettings>) {
    // The heterogeneous mapped-type union (one SettingSpec per field) is not
    // directly indexable-and-callable under tsc --noEmit, so each entry is
    // widened to the shared SettingSpec<union> shape (see getSettings below).
    const spec = SETTING_SPECS[key] as SettingSpec<AppSettings[keyof AppSettings]>;
    persisted[key] = spec.sanitizeFile(file[key]);
  }
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
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(SETTING_SPECS) as Array<keyof AppSettings>) {
    const spec = SETTING_SPECS[key] as SettingSpec<AppSettings[keyof AppSettings]>;
    const fileValue = spec.sanitizeFile(file[key]);
    result[key] = spec.envRead ? spec.envRead(fileValue) : fileValue;
  }
  return result as unknown as AppSettings;
}

/** Merge and persist a partial update; returns the new settings. */
export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  // Persist the patch over the FILE contents (layered on defaults) — never over
  // getSettings()'s env-resolved view. Otherwise a transient env override (e.g.
  // SOUND_BUDDY_REPORT_FIRST_UX=1) would be baked permanently into
  // settings.json, silently defeating the launch-time-only contract after the
  // env var is removed. Env overrides stay transient (read-time only).
  const file = readSettingsFile('before update');
  const nextFile = { ...file, ...patch };
  writeSettingsFile(nextFile);
  // Return the effective settings (env overrides still apply for reads).
  return getSettings();
}

/**
 * The only main-side path that sets consoleNetworkConsentGranted=true
 * (ADR-0006 / #747). The generic update-settings patch path's sanitizePatch
 * rejects true, so this dedicated IPC-backed function is how the first-run
 * consent modal's Allow click persists consent.
 */
export function grantConsoleNetworkConsent(): AppSettings {
  return updateSettings({ consoleNetworkConsentGranted: true });
}

// ── Capture rigs (CRUD) ───────────────────────────────────────────────────────
// All mutations follow the same layered-persistence discipline as
// updateSettings: read the FILE layer → mutate → write the FILE layer. Env
// overrides for idealProfile are therefore never baked into a rig write, and
// rigs themselves have no env layer. File-layer sanitization lives in
// SETTING_SPECS (spec.sanitizeFile), not duplicated here.

/** All saved rigs, in stored order (env overrides don't touch rigs). */
export function listRigs(): CaptureRig[] {
  return SETTING_SPECS.rigs.sanitizeFile(readSettingsFile('for listRigs').rigs);
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
  const rigs = [...SETTING_SPECS.rigs.sanitizeFile(file.rigs)];
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
  const current = SETTING_SPECS.rigs.sanitizeFile(file.rigs);
  // Unknown id — nothing to remove, so skip the write entirely.
  if (!current.some((r) => r.id === id)) return getSettings();

  const rigs = current.filter((r) => r.id !== id);
  const activeRigId = file.activeRigId === id ? null : (file.activeRigId ?? SETTING_SPECS.activeRigId.default);

  writeSettingsFile({ ...file, rigs, activeRigId });
  return getSettings();
}

/**
 * Select a rig as active; returns the effective settings. Passing null clears
 * the selection. An id not present among the saved rigs is ignored (no-op).
 */
export function setActiveRig(id: string | null): AppSettings {
  const file = readSettingsFile('before setActiveRig');
  const rigs = SETTING_SPECS.rigs.sanitizeFile(file.rigs);
  if (id !== null && !rigs.some((r) => r.id === id)) {
    // Unknown id — leave the selection untouched.
    return getSettings();
  }
  writeSettingsFile({ ...file, activeRigId: id });
  return getSettings();
}
