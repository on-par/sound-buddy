// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Persisted app settings — a small JSON file in the app's user-data dir.
//
//   ~/Library/Application Support/SoundBuddy/settings.json
//
// This is separate from llm.json (the AI *provider* config). Settings here are
// app-behavior flags the UI reads at boot and (later) writes from Preferences.
//
// AI is OFF by default: all LLM/AI analysis is disabled unless the user opts in
// (settings.json `"aiEnabled": true`, or env `SOUND_BUDDY_AI_ENABLED=1`). The AI
// code stays fully wired in — this flag only gates it.

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { app } from 'electron';
import { logWarn } from './logger';

/**
 * One strip of a rig's channel config — mirrors the renderer's inline shape
 * (`{ kind, a, b }` at index.html ~896). `a`/`b` are device channel indices;
 * `b` is only meaningful for a stereo pair. `label` is written later by #39.
 */
export interface CaptureRigChannel {
  kind: 'mono' | 'stereo';
  a: number;
  b: number;
  label?: string;
}

/**
 * A saved capture setup ("rig"): a named device + channel + capture config the
 * user can reload instead of re-seeding defaults each launch. The device is
 * matched by {@link deviceName}, not index, so it survives device reordering.
 */
export interface CaptureRig {
  /** Stable id, generated on create. */
  id: string;
  name: string;
  /** Input device matched by name (resilient to reordering). */
  deviceName: string;
  channelConfig: CaptureRigChannel[];
  mode: 'monitor' | 'record';
  recordDir: string;
  /** Real-time meter cadence (ms). */
  intervalMs: number;
  /** Rolling analysis window (seconds). */
  windowSecs: number;
  /** LLM analysis cadence (ms); optional until #37 wires the slider. */
  llmIntervalMs?: number;
}

export interface CustomIdealProfile {
  id: string;
  label: string;
  description: string;
  freqs: number[];
  dbOffsets: number[];
  source?: 'manual' | 'analysis';
  createdAt?: string;
  updatedAt?: string;
}

export interface AppSettings {
  /** Master switch for all AI/LLM analysis. Default false (off). */
  aiEnabled: boolean;
  /** Selected ideal EQ profile id (PRD 05). Empty = auto by content type. */
  idealProfile: string;
  /** User-authored ideal EQ curves for analysis/report comparison. */
  customIdealProfiles: CustomIdealProfile[];
  /**
   * Folder where recordings, stems, and captured sessions are stored (#91).
   * Empty = the platform default (`~/Music/Sound Buddy`), resolved by the main
   * process. There is deliberately no size/count/duration cap on this folder —
   * storage is the user's own disk (#68). Users who want sync/backup point this
   * inside a folder their cloud client already syncs (iCloud/Dropbox/Drive).
   */
  storageDir: string;
  /** Saved capture setups. Default []. */
  rigs: CaptureRig[];
  /** Id of the currently selected rig, or null when none. Default null. */
  activeRigId: string | null;
  /**
   * Opt-in anonymous usage counts (#145). Default false (off). This is a
   * persisted preference ONLY — no collection, batching, or network code
   * exists anywhere in the app, and none may be added until a receiving
   * endpoint ships in the worker (re-verify before wiring anything).
   */
  usageSignalEnabled: boolean;
}

const DEFAULTS: AppSettings = {
  aiEnabled: false,
  idealProfile: '',
  customIdealProfiles: [],
  storageDir: '',
  rigs: [],
  activeRigId: null,
  usageSignalEnabled: false,
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
 * Persist the file layer, preserving any fields not being changed — including
 * unknown top-level keys a future version may add. Callers pass the mutated file
 * view — never getSettings()'s env-resolved view — so transient env overrides
 * stay read-time only. Rethrows a write failure so a lost save surfaces to the
 * caller instead of resolving as a silent success.
 */
function writeSettingsFile(file: Partial<AppSettings>): void {
  const persisted: AppSettings = {
    ...file,
    aiEnabled: file.aiEnabled ?? DEFAULTS.aiEnabled,
    idealProfile: file.idealProfile ?? DEFAULTS.idealProfile,
    customIdealProfiles: fileCustomIdealProfiles(file),
    storageDir: file.storageDir ?? DEFAULTS.storageDir,
    rigs: fileRigs(file),
    activeRigId: file.activeRigId ?? DEFAULTS.activeRigId,
    usageSignalEnabled: file.usageSignalEnabled ?? DEFAULTS.usageSignalEnabled,
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

  const envAi = envBool('SOUND_BUDDY_AI_ENABLED');

  return {
    aiEnabled: envAi ?? file.aiEnabled ?? DEFAULTS.aiEnabled,
    idealProfile:
      process.env.SOUND_BUDDY_IDEAL_PROFILE?.trim() || file.idealProfile || DEFAULTS.idealProfile,
    customIdealProfiles: fileCustomIdealProfiles(file),
    storageDir:
      process.env.SOUND_BUDDY_STORAGE_DIR?.trim() || file.storageDir || DEFAULTS.storageDir,
    // Rigs have no env layer — they are pure persisted data.
    rigs: fileRigs(file),
    activeRigId: file.activeRigId ?? DEFAULTS.activeRigId,
    // No env layer — unlike aiEnabled there is no behavior to gate, so this
    // flag is pure persisted data (like rigs).
    usageSignalEnabled: file.usageSignalEnabled ?? DEFAULTS.usageSignalEnabled,
  };
}

/** Merge and persist a partial update; returns the new settings. */
export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  // Persist the patch over the FILE contents (layered on defaults) — never over
  // getSettings()'s env-resolved view. Otherwise a transient env override (e.g.
  // SOUND_BUDDY_AI_ENABLED=1) would be baked permanently into settings.json,
  // silently defeating the "AI off by default" contract after the env var is
  // removed. Env overrides stay transient (read-time only).
  const file = readSettingsFile('before update');
  writeSettingsFile({ ...file, ...patch });
  // Return the effective settings (env overrides still apply for reads).
  return getSettings();
}

/** Convenience: is AI/LLM analysis currently allowed? */
export function isAiEnabled(): boolean {
  return getSettings().aiEnabled;
}

// ── Capture rigs (CRUD) ───────────────────────────────────────────────────────
// All mutations follow the same layered-persistence discipline as
// updateSettings: read the FILE layer → mutate → write the FILE layer. Env
// overrides for aiEnabled/idealProfile are therefore never baked into a rig
// write, and rigs themselves have no env layer.

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
