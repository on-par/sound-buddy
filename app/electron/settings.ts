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
import { app } from 'electron';
import { logWarn } from './logger';

export interface AppSettings {
  /** Master switch for all AI/LLM analysis. Default false (off). */
  aiEnabled: boolean;
  /** Selected ideal EQ profile id (PRD 05). Empty = auto by content type. */
  idealProfile: string;
}

const DEFAULTS: AppSettings = {
  aiEnabled: false,
  idealProfile: '',
};

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function envBool(name: string): boolean | undefined {
  const v = process.env[name]?.trim().toLowerCase();
  if (v === undefined || v === '') return undefined;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** Read settings, layering file over defaults and env overrides over the file. */
export function getSettings(): AppSettings {
  let file: Partial<AppSettings> = {};
  try {
    const p = settingsPath();
    if (fs.existsSync(p)) file = JSON.parse(fs.readFileSync(p, 'utf8')) as Partial<AppSettings>;
  } catch (err) {
    logWarn(`could not read settings.json: ${String(err)}`);
  }

  const envAi = envBool('SOUND_BUDDY_AI_ENABLED');

  return {
    aiEnabled: envAi ?? file.aiEnabled ?? DEFAULTS.aiEnabled,
    idealProfile:
      process.env.SOUND_BUDDY_IDEAL_PROFILE?.trim() || file.idealProfile || DEFAULTS.idealProfile,
  };
}

/** Merge and persist a partial update; returns the new settings. */
export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  // Persist the patch over the FILE contents (layered on defaults) — never over
  // getSettings()'s env-resolved view. Otherwise a transient env override (e.g.
  // SOUND_BUDDY_AI_ENABLED=1) would be baked permanently into settings.json,
  // silently defeating the "AI off by default" contract after the env var is
  // removed. Env overrides stay transient (read-time only).
  let file: Partial<AppSettings> = {};
  try {
    const p = settingsPath();
    if (fs.existsSync(p)) file = JSON.parse(fs.readFileSync(p, 'utf8')) as Partial<AppSettings>;
  } catch (err) {
    logWarn(`could not read settings.json before update: ${String(err)}`);
  }

  const persisted: AppSettings = {
    aiEnabled: file.aiEnabled ?? DEFAULTS.aiEnabled,
    idealProfile: file.idealProfile ?? DEFAULTS.idealProfile,
    ...patch,
  };
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(persisted, null, 2));
  } catch (err) {
    logWarn(`could not write settings.json: ${String(err)}`);
  }
  // Return the effective settings (env overrides still apply for reads).
  return getSettings();
}

/** Convenience: is AI/LLM analysis currently allowed? */
export function isAiEnabled(): boolean {
  return getSettings().aiEnabled;
}
