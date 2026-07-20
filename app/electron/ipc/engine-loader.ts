// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Loads the @sound-buddy/audio-engine parsers (#151) — the app's single
// source of sox/ffprobe/spectrum/ebur128 analysis. #396 declares the engine
// as a `file:` dependency in app/package.json so the coupling is visible to
// npm and static analysis, but runtime loading still goes through
// createRequire: the app's main process compiles CommonJS (see
// app/tsconfig.json) and the packaged .app ships zero node_modules
// (Contents/Resources/engine instead), so a normal ESM import can't be used
// at runtime. Instead the engine gains a second, CJS-only build of just the
// parser subtree (packages/audio-engine/dist-cjs — see that package's
// tsconfig.cjs.json), which this module loads at runtime via createRequire
// from a path resolved packaged-vs-dev, mirroring the toolBin()/SCRIPTS_DIR
// pattern in ./shared.

import { createRequire } from 'node:module';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { REPO_ROOT } from './shared';

type EngineSox = typeof import('@sound-buddy/audio-engine/dist-cjs/analyze/sox');
type EngineFfprobe = typeof import('@sound-buddy/audio-engine/dist-cjs/analyze/ffprobe');
type EngineSpectrum = typeof import('@sound-buddy/audio-engine/dist-cjs/analyze/spectrum');
type EngineEbur128 = typeof import('@sound-buddy/audio-engine/dist-cjs/analyze/ebur128');
type EngineOrchestrate = typeof import('@sound-buddy/audio-engine/dist-cjs/analyze/orchestrate');
type EngineExtract = typeof import('@sound-buddy/audio-engine/dist-cjs/analyze/extract');
type EnginePrompts = typeof import('@sound-buddy/audio-engine/dist-cjs/prompts/index');

export function engineParsersDir(): string {
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, 'engine');
    if (fs.existsSync(bundled)) return bundled;
  }
  return path.join(REPO_ROOT, 'packages', 'audio-engine', 'dist-cjs');
}

export interface EngineParsers {
  runSox: EngineSox['runSox'];
  runFfprobe: EngineFfprobe['runFfprobe'];
  runSpectrum: EngineSpectrum['runSpectrum'];
  runEbur128: EngineEbur128['runEbur128'];
  parseEbur128Summary: EngineEbur128['parseEbur128Summary'];
  analyzeAudio: EngineOrchestrate['analyzeAudio'];
  isVideoFile: EngineExtract['isVideoFile'];
  extractAudioToWav: EngineExtract['extractAudioToWav'];
}

let cachedParsers: EngineParsers | undefined;

// Loaded lazily (first analyze call), not at module top, so unrelated app
// tests that merely import ./ipc don't crash when dist-cjs is stale/missing.
export function loadEngineParsers(): EngineParsers {
  if (cachedParsers) return cachedParsers;

  const dir = engineParsersDir();
  const req = createRequire(__filename);
  try {
    const sox: EngineSox = req(path.join(dir, 'analyze', 'sox.js'));
    const ffprobe: EngineFfprobe = req(path.join(dir, 'analyze', 'ffprobe.js'));
    const spectrum: EngineSpectrum = req(path.join(dir, 'analyze', 'spectrum.js'));
    const ebur128: EngineEbur128 = req(path.join(dir, 'analyze', 'ebur128.js'));
    const orchestrate: EngineOrchestrate = req(path.join(dir, 'analyze', 'orchestrate.js'));
    const extract: EngineExtract = req(path.join(dir, 'analyze', 'extract.js'));

    cachedParsers = {
      runSox: sox.runSox,
      runFfprobe: ffprobe.runFfprobe,
      runSpectrum: spectrum.runSpectrum,
      runEbur128: ebur128.runEbur128,
      parseEbur128Summary: ebur128.parseEbur128Summary,
      analyzeAudio: orchestrate.analyzeAudio,
      isVideoFile: extract.isVideoFile,
      extractAudioToWav: extract.extractAudioToWav,
    };
    return cachedParsers;
  } catch (err) {
    throw new Error(
      `audio-engine parsers not found at ${dir} — run \`npm run build\` at the repo root first (builds packages/audio-engine/dist-cjs)`,
      { cause: err },
    );
  }
}

export interface EnginePromptModule {
  SYSTEM_PROMPT: EnginePrompts['SYSTEM_PROMPT'];
  buildLiveSystemPrompt: EnginePrompts['buildLiveSystemPrompt'];
}

let cachedPrompts: EnginePromptModule | undefined;

// Shared AI system prompts (TD-004, #398) — the app must not keep its own
// copies. Loaded lazily on first narrative so unrelated tests importing
// ./ipc don't fail when dist-cjs is stale/missing.
export function loadEnginePrompts(): EnginePromptModule {
  if (cachedPrompts) return cachedPrompts;

  const dir = engineParsersDir();
  const req = createRequire(__filename);
  try {
    const prompts: EnginePrompts = req(path.join(dir, 'prompts', 'index.js'));
    cachedPrompts = {
      SYSTEM_PROMPT: prompts.SYSTEM_PROMPT,
      buildLiveSystemPrompt: prompts.buildLiveSystemPrompt,
    };
    return cachedPrompts;
  } catch (err) {
    throw new Error(
      `audio-engine prompts not found at ${dir} — run \`npm run build\` at the repo root first (builds packages/audio-engine/dist-cjs)`,
      { cause: err },
    );
  }
}
