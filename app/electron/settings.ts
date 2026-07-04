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

export interface AppSettings {
  /** Master switch for all AI/LLM analysis. Default false (off). */
  aiEnabled: boolean;
  /** Selected ideal EQ profile id (PRD 05). Empty = auto by content type. */
  idealProfile: string;
  /** Saved capture setups. Default []. */
  rigs: CaptureRig[];
  /** Id of the currently selected rig, or null when none. Default null. */
  activeRigId: string | null;
}

const DEFAULTS: AppSettings = {
  aiEnabled: false,
  idealProfile: '',
  rigs: [],
  activeRigId: null,
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
 * Persist the file layer verbatim (rigs and flags), preserving fields not being
 * changed. Callers pass the mutated file view — never getSettings()'s
 * env-resolved view — so transient env overrides stay read-time only.
 */
function writeSettingsFile(file: Partial<AppSettings>): void {
  const persisted: AppSettings = {
    aiEnabled: file.aiEnabled ?? DEFAULTS.aiEnabled,
    idealProfile: file.idealProfile ?? DEFAULTS.idealProfile,
    rigs: file.rigs ?? DEFAULTS.rigs,
    activeRigId: file.activeRigId ?? DEFAULTS.activeRigId,
  };
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(persisted, null, 2));
  } catch (err) {
    logWarn(`could not write settings.json: ${String(err)}`);
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
    // Rigs have no env layer — they are pure persisted data.
    rigs: file.rigs ?? DEFAULTS.rigs,
    activeRigId: file.activeRigId ?? DEFAULTS.activeRigId,
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
  return readSettingsFile('for listRigs').rigs ?? DEFAULTS.rigs;
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
export function upsertRig(rig: Partial<CaptureRig> & Omit<CaptureRig, 'id'>): AppSettings {
  if (!rig.name || typeof rig.name !== 'string') {
    throw new Error('upsertRig: rig.name is required');
  }
  const id = rig.id && typeof rig.id === 'string' ? rig.id : randomUUID();
  const next: CaptureRig = { ...rig, id };

  const file = readSettingsFile('before upsertRig');
  const rigs = [...(file.rigs ?? DEFAULTS.rigs)];
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
  const rigs = (file.rigs ?? DEFAULTS.rigs).filter((r) => r.id !== id);
  const activeRigId =
    (file.activeRigId ?? DEFAULTS.activeRigId) === id
      ? null
      : (file.activeRigId ?? DEFAULTS.activeRigId);

  writeSettingsFile({ ...file, rigs, activeRigId });
  return getSettings();
}

/**
 * Select a rig as active; returns the effective settings. Passing null clears
 * the selection. An id not present among the saved rigs is ignored (no-op).
 */
export function setActiveRig(id: string | null): AppSettings {
  const file = readSettingsFile('before setActiveRig');
  const rigs = file.rigs ?? DEFAULTS.rigs;
  if (id !== null && !rigs.some((r) => r.id === id)) {
    // Unknown id — leave the selection untouched.
    return getSettings();
  }
  writeSettingsFile({ ...file, activeRigId: id });
  return getSettings();
}
