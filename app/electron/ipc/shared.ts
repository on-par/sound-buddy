// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Shared paths, tool resolution, and process-env helpers used across the ipc/
// handler modules (analysis, live capture, playback). Split out of the former
// monolithic ipc.ts (#225) since every domain module spawns sox/ffprobe/python
// the same way.

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { log } from '../logger';
import { getSettings } from '../settings';
import { LLM_SECRET_ENV_VARS } from '../narrative-port';

// Dev repo root. Only meaningful when running from a checkout — inside a
// packaged .app REPO_ROOT is never dereferenced (toolBin/SCRIPTS_DIR/pythonBin
// all prefer the bundled resourcesPath first). Walk up from this file looking
// for packages/audio-engine rather than a fixed `../../../..` — this file's
// depth under the repo root differs between the compiled program (dist/electron/ipc,
// one level deeper for the `dist` folder) and running straight from TS source
// (electron/ipc, e.g. under Vitest), so a fixed offset resolves one directory
// too high in the latter case.
// Exported for testing — pure, no electron dependency.
export function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'packages', 'audio-engine'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}
export const REPO_ROOT = findRepoRoot(__dirname);

// The Python scripts ship as extraResources (Contents/Resources/scripts) in a
// packaged .app; in dev they live in the monorepo.
// c8 ignore: packaged-app path resolution; vitest always runs unpackaged.
export const SCRIPTS_DIR = app.isPackaged /* c8 ignore next */
  ? path.join(process.resourcesPath, 'scripts')
  : path.join(REPO_ROOT, 'packages', 'audio-engine', 'scripts');
export const SPECTRUM_SCRIPT = path.join(SCRIPTS_DIR, 'spectrum.py');
export const STREAM_SCRIPT = path.join(SCRIPTS_DIR, 'stream.py');
export const PLAYBACK_SCRIPT = path.join(SCRIPTS_DIR, 'playback.py');

// Bundled demo recording for the first-run onboarding flow (#69). Like the
// Python scripts it must live OUTSIDE the asar archive so the external
// sox/ffprobe processes can read it — it ships as extraResources
// (Contents/Resources/assets) in a packaged .app; in dev it lives under app/assets.
export const APP_ROOT = path.resolve(__dirname, '..', '..', '..');
// c8 ignore: packaged-app path resolution; vitest always runs unpackaged.
export const DEMO_AUDIO = app.isPackaged /* c8 ignore next */
  ? path.join(process.resourcesPath, 'assets', 'demo.wav')
  : path.join(APP_ROOT, 'assets', 'demo.wav');

// Bundled post-update "what's new" note (#271) — a short markdown file authored
// per release, read once and shown as a dismissible banner crediting shipped,
// user-requested items. Same packaged-vs-dev resolution as DEMO_AUDIO; ships
// via the same `assets` extraResources mapping in electron-builder.yml.
// c8 ignore: packaged-app path resolution; vitest always runs unpackaged.
export const WHATS_NEW_NOTE = app.isPackaged /* c8 ignore next */
  ? path.join(process.resourcesPath, 'assets', 'whats-new.md')
  : path.join(APP_ROOT, 'assets', 'whats-new.md');

// Native helpers (sox, ffprobe) are bundled at Contents/Resources/bin in a
// packaged .app (see build/afterPack.js). In dev they come from PATH. Resolving
// to the bundled copy means the app never depends on a Homebrew install.
// c8 ignore: packaged-app path resolution; vitest always runs unpackaged.
const BUNDLED_BIN_DIR = app.isPackaged /* c8 ignore next */
  ? path.join(process.resourcesPath, 'bin')
  : null;
export function toolBin(name: string): string {
  // c8 ignore start -- BUNDLED_BIN_DIR is always null under vitest (packaged-app
  // path resolution); this branch only runs inside a packaged .app.
  if (BUNDLED_BIN_DIR) {
    const bundled = path.join(BUNDLED_BIN_DIR, name);
    if (fs.existsSync(bundled)) return bundled;
  }
  // c8 ignore stop
  return name; // fall back to PATH (dev / unbundled)
}

// Env for spawned Python: prepend the bundled bin dir so spectrum.py's ffmpeg
// fallback (m4a/aac decode) finds it without a system install. Also
// strips any AI-provider API key narrative-port.ts may have set on
// process.env — these audio-analysis subprocesses have nothing to do with
// the AI narrative feature and must never inherit its secrets.
export function childEnv(): NodeJS.ProcessEnv {
  // c8 ignore: packaged-app path resolution; vitest always runs unpackaged
  // (BUNDLED_BIN_DIR is always null), so this branch is unreachable in tests.
  /* c8 ignore start */
  const env: NodeJS.ProcessEnv = BUNDLED_BIN_DIR
    ? { ...process.env, PATH: `${BUNDLED_BIN_DIR}${path.delimiter}${process.env.PATH ?? ''}` }
    : /* c8 ignore stop */ { ...process.env };
  for (const key of LLM_SECRET_ENV_VARS) delete env[key];
  return env;
}

// The audio-engine scripts need numpy/scipy/soundfile/sounddevice, which the
// system `python3` usually lacks (and Homebrew's is externally-managed). Prefer,
// in order: an explicit override, the per-user venv created by
// scripts/setup-macos.sh, the dev repo .venv, then bare `python3`. Resolved
// lazily so app.setName()/userData is applied before we read it.
let cachedPython: string | undefined;
export function pythonBin(): string {
  if (cachedPython) return cachedPython;
  const candidates = [
    process.env.SOUND_BUDDY_PYTHON,
    // Bundled relocatable interpreter (Contents/Resources/python) — packaged
    // apps. c8 ignore: packaged-app path resolution; vitest always runs unpackaged.
    /* c8 ignore start */
    app.isPackaged
      ? path.join(process.resourcesPath, 'python', 'bin', 'python3')
      : /* c8 ignore stop */ undefined,
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

// Incrementally parse newline-delimited JSON from a subprocess stdout stream.
// Buffers partial lines across chunks (a JSON object may be split mid-line by
// the OS pipe), skips blank lines, and silently ignores non-JSON lines —
// stream.py/playback.py may emit stray diagnostics on stdout. Data after the
// final newline is never delivered (matches the previous inline readers).
export interface NdjsonSource {
  on(event: 'data', listener: (chunk: Buffer) => void): unknown;
}

export function readNdjsonLines(
  stream: NdjsonSource,
  onObject: (data: Record<string, unknown>) => void,
): void {
  let lineBuffer = '';
  stream.on('data', (chunk: Buffer) => {
    lineBuffer += chunk.toString();
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        onObject(JSON.parse(trimmed) as Record<string, unknown>);
      } catch {
        // ignore non-JSON lines
      }
    }
  });
}
