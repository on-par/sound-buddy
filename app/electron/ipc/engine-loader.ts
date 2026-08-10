// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Loads the @sound-buddy/audio-engine parsers (#151) — the app's single
// source of sox/ffprobe/spectrum/ebur128 analysis. #396 declares the engine
// as a `file:` dependency in app/package.json so the coupling is visible to
// npm and static analysis, but runtime loading still goes through
// bundled-cjs-loader.ts: the app's main process compiles CommonJS (see
// app/tsconfig.json) and the packaged .app ships zero node_modules
// (Contents/Resources/engine instead), so a normal ESM import can't be used
// at runtime. Instead the engine gains a second, CJS-only build of just the
// parser subtree (packages/audio-engine/dist-cjs — see that package's
// tsconfig.cjs.json), loaded here via loadBundledCjs('engine', ...).

import { bundledResourceDir, loadBundledCjs } from '../bundled-cjs-loader';

type EngineSox = typeof import('@sound-buddy/audio-engine/dist-cjs/analyze/sox');
type EngineFfprobe = typeof import('@sound-buddy/audio-engine/dist-cjs/analyze/ffprobe');
type EngineSpectrum = typeof import('@sound-buddy/audio-engine/dist-cjs/analyze/spectrum');
type EngineEbur128 = typeof import('@sound-buddy/audio-engine/dist-cjs/analyze/ebur128');
type EngineOrchestrate = typeof import('@sound-buddy/audio-engine/dist-cjs/analyze/orchestrate');
type EngineExtract = typeof import('@sound-buddy/audio-engine/dist-cjs/analyze/extract');
type EngineStream = typeof import('@sound-buddy/audio-engine/dist-cjs/stream/index');
type EnginePlayback = typeof import('@sound-buddy/audio-engine/dist-cjs/playback/index');
type EngineNdjson = typeof import('@sound-buddy/audio-engine/dist-cjs/ndjson');

export type { LiveOptions } from '@sound-buddy/audio-engine/dist-cjs/stream/index';
export type { PlaybackOptions } from '@sound-buddy/audio-engine/dist-cjs/playback/index';

export function engineParsersDir(): string {
  return bundledResourceDir('engine');
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
  buildStreamArgs: EngineStream['buildStreamArgs'];
  buildPlaybackArgs: EnginePlayback['buildPlaybackArgs'];
}

let cachedParsers: EngineParsers | undefined;

// Loaded lazily (first analyze call), not at module top, so unrelated app
// tests that merely import ./ipc don't crash when dist-cjs is stale/missing.
export function loadEngineParsers(): EngineParsers {
  if (cachedParsers) return cachedParsers;

  const sox = loadBundledCjs<EngineSox>('engine', 'analyze/sox.js');
  const ffprobe = loadBundledCjs<EngineFfprobe>('engine', 'analyze/ffprobe.js');
  const spectrum = loadBundledCjs<EngineSpectrum>('engine', 'analyze/spectrum.js');
  const ebur128 = loadBundledCjs<EngineEbur128>('engine', 'analyze/ebur128.js');
  const orchestrate = loadBundledCjs<EngineOrchestrate>('engine', 'analyze/orchestrate.js');
  const extract = loadBundledCjs<EngineExtract>('engine', 'analyze/extract.js');
  const stream = loadBundledCjs<EngineStream>('engine', 'stream/index.js');
  const playback = loadBundledCjs<EnginePlayback>('engine', 'playback/index.js');

  cachedParsers = {
    runSox: sox.runSox,
    runFfprobe: ffprobe.runFfprobe,
    runSpectrum: spectrum.runSpectrum,
    runEbur128: ebur128.runEbur128,
    parseEbur128Summary: ebur128.parseEbur128Summary,
    analyzeAudio: orchestrate.analyzeAudio,
    isVideoFile: extract.isVideoFile,
    extractAudioToWav: extract.extractAudioToWav,
    buildStreamArgs: stream.buildStreamArgs,
    buildPlaybackArgs: playback.buildPlaybackArgs,
  };
  return cachedParsers;
}

export interface EngineUtils {
  readNdjsonLines: EngineNdjson['readNdjsonLines'];
}

let cachedUtils: EngineUtils | undefined;

// Loaded lazily (first call), not at module top — mirrors loadEngineParsers.
export function loadEngineUtils(): EngineUtils {
  if (cachedUtils) return cachedUtils;
  const ndjson = loadBundledCjs<EngineNdjson>('engine', 'ndjson.js');
  cachedUtils = { readNdjsonLines: ndjson.readNdjsonLines };
  return cachedUtils;
}
