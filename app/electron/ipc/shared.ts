// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Shared paths, tool resolution, and process-env helpers used across the ipc/
// handler modules (analysis, live capture, playback). Split out of the former
// monolithic ipc.ts (#225) since every domain module spawns sox/ffprobe/python
// the same way.

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { log } from '../logger';
import { getSettings } from '../settings';

export const execFileAsync = promisify(execFile);

// Dev repo root (three levels up from app/dist/electron/). Only meaningful when
// running from a checkout — inside a packaged .app this points into the bundle.
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

// The Python scripts ship as extraResources (Contents/Resources/scripts) in a
// packaged .app; in dev they live in the monorepo.
export const SCRIPTS_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'scripts')
  : path.join(REPO_ROOT, 'packages', 'audio-engine', 'scripts');
export const SPECTRUM_SCRIPT = path.join(SCRIPTS_DIR, 'spectrum.py');
export const STREAM_SCRIPT = path.join(SCRIPTS_DIR, 'stream.py');
export const PLAYBACK_SCRIPT = path.join(SCRIPTS_DIR, 'playback.py');

// Bundled demo recording for the first-run onboarding flow (#69). Like the
// Python scripts it must live OUTSIDE the asar archive so the external
// sox/ffprobe processes can read it — it ships as extraResources
// (Contents/Resources/assets) in a packaged .app; in dev it lives under app/assets.
const APP_ROOT = path.resolve(__dirname, '..', '..', '..');
export const DEMO_AUDIO = app.isPackaged
  ? path.join(process.resourcesPath, 'assets', 'demo.wav')
  : path.join(APP_ROOT, 'assets', 'demo.wav');

// Native helpers (sox, ffprobe) are bundled at Contents/Resources/bin in a
// packaged .app (see build/afterPack.js). In dev they come from PATH. Resolving
// to the bundled copy means the app never depends on a Homebrew install.
const BUNDLED_BIN_DIR = app.isPackaged ? path.join(process.resourcesPath, 'bin') : null;
export function toolBin(name: string): string {
  if (BUNDLED_BIN_DIR) {
    const bundled = path.join(BUNDLED_BIN_DIR, name);
    if (fs.existsSync(bundled)) return bundled;
  }
  return name; // fall back to PATH (dev / unbundled)
}

// Env for spawned Python: prepend the bundled bin dir so librosa/audioread can
// find the bundled ffmpeg (m4a/aac decode) without a system install.
export function childEnv(): NodeJS.ProcessEnv {
  if (!BUNDLED_BIN_DIR) return process.env;
  return { ...process.env, PATH: `${BUNDLED_BIN_DIR}${path.delimiter}${process.env.PATH ?? ''}` };
}

// The audio-engine scripts need librosa/soundfile/sounddevice/scipy, which the
// system `python3` usually lacks (and Homebrew's is externally-managed). Prefer,
// in order: an explicit override, the per-user venv created by
// scripts/setup-macos.sh, the dev repo .venv, then bare `python3`. Resolved
// lazily so app.setName()/userData is applied before we read it.
let cachedPython: string | undefined;
export function pythonBin(): string {
  if (cachedPython) return cachedPython;
  const candidates = [
    process.env.SOUND_BUDDY_PYTHON,
    // Bundled relocatable interpreter (Contents/Resources/python) — packaged apps.
    app.isPackaged ? path.join(process.resourcesPath, 'python', 'bin', 'python3') : undefined,
    path.join(app.getPath('userData'), 'venv', 'bin', 'python3'),
    path.join(REPO_ROOT, '.venv', 'bin', 'python3'),
  ].filter((p): p is string => Boolean(p));
  cachedPython = candidates.find((p) => fs.existsSync(p)) ?? 'python3';
  log(`python interpreter: ${cachedPython}`);
  return cachedPython;
}

// The built-in fallback storage folder — used when the user has not chosen one
// (settings.storageDir === '') and as the label default in the UI. Used by
// both ipc/live-capture.ts (Record-mode session folders) and ipc/settings.ts's
// get-storage-usage handler, which reports this same effective folder before
// the user has ever picked one — hence living here with the other shared
// path/tool resolution rather than in either domain module.
export function platformDefaultStorageDir(): string {
  return path.join(app.getPath('music'), 'Sound Buddy');
}

// Default folder for Record-mode captures when the renderer doesn't pass one:
// the user-configured storage folder (#91), falling back to ~/Music/Sound Buddy.
// There is no cap on how much this folder holds — storage is the user's own disk.
export function defaultRecordDir(): string {
  return getSettings().storageDir?.trim() || platformDefaultStorageDir();
}
