// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Bridges the Electron main process to the provider-agnostic NarrativePort
// (packages/audio-engine/src/narrative) backed by the Pi SDK
// (@earendil-works/pi-coding-agent). Replaces llm.ts's per-provider HTTP/CLI
// code (TD-004 slice 3, #427) — Ollama, hosted providers (a pasted key), and
// pi subscription logins all flow through Pi's ModelRegistry instead of
// hand-rolled request shaping.
//
// Runtime risk (deliberately not "fixed" in this slice — see the PR body for
// the follow-up issue):
//  (a) the Pi SDK declares `engines.node >= 22.19`; Electron 31 bundles Node
//      20, so the dynamic import below can THROW at runtime on some builds.
//      Every entry point here catches that and resolves an actionable error
//      — never rejects (a rejection would skip 'llm-done' and wedge the
//      renderer's AI button, see llm.ts/ipc/narrative.ts).
//  (b) the packaged .app ships zero node_modules today (afterPack.js bundles
//      only the dist-cjs parsers into Contents/Resources/engine) — in a
//      packaged build the adapter import WILL fail until packaging also
//      bundles the ESM audio-engine + pi SDK. That packaging work is
//      deliberately out of scope here.

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { getApiKey, getLlmConfig, normalizeHostUrl, DEFAULT_OLLAMA_HOST, type LlmConfig } from './llm-config';
import { logWarn } from './logger';
// Type-only — erased at build time, so this never pulls the ESM audio-engine
// dist into app/electron's CommonJS runtime module graph (only used by name
// for `tsc`'s benefit).
import type { ModelInfo, NarrativePort } from '@sound-buddy/audio-engine/dist/narrative/port';

const ADAPTER_SPECIFIER = '@sound-buddy/audio-engine/dist/narrative/pi-adapter.js';

type AdapterModule = {
  PiNarrativeAdapter: new (opts: {
    provider?: string;
    modelId?: string;
    modelsJsonPath?: string;
  }) => NarrativePort;
};

export type AdapterImporter = () => Promise<AdapterModule>;

// app/tsconfig.json compiles the main process as CommonJS, which demotes a
// literal `await import(...)` to `require()` under TS — `require()` cannot
// load audio-engine's ESM dist. Routing the specifier through `new Function`
// hides it from TS's CJS transform so the real dynamic `import()` reaches V8
// at runtime instead.
const dynamicImport = new Function('specifier', 'return import(specifier);') as (
  specifier: string,
) => Promise<unknown>;

/* c8 ignore start -- only reachable inside a real Electron CJS runtime; unit
   tests exercise every caller via an injected fake AdapterImporter instead. */
const defaultImporter: AdapterImporter = () => dynamicImport(ADAPTER_SPECIFIER) as Promise<AdapterModule>;
/* c8 ignore stop */

const HOSTED = new Set(['openai', 'anthropic', 'google', 'custom']);

const CUSTOM_KEY_ENV = 'SOUND_BUDDY_CUSTOM_API_KEY';

// Pi resolves a pasted key from these env vars per provider (pi-ai's
// env-api-keys.js) — google is GEMINI_API_KEY, not GOOGLE_API_KEY.
const HOSTED_ENV_VAR: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GEMINI_API_KEY',
};

const MODELS_JSON_FILENAME = 'pi-models.json';

export interface PiRuntimeConfig {
  env: Record<string, string>;
  modelsJson?: object;
}

/**
 * Pure mapping from a saved LLM config (+ resolved key) to what the Pi SDK
 * needs: env vars for built-in hosted providers, or a models.json descriptor
 * for providers Pi has no built-in knowledge of (Ollama, a custom
 * OpenAI-compatible endpoint). Everything else (pi subscription pass-through
 * providers) needs neither — pi's own `~/.pi/agent` auth applies.
 */
export function buildPiRuntimeConfig(cfg: LlmConfig, apiKey: string | undefined): PiRuntimeConfig {
  const provider = cfg.provider;

  if (provider && provider in HOSTED_ENV_VAR) {
    const envVar = HOSTED_ENV_VAR[provider];
    return { env: apiKey ? { [envVar]: apiKey } : {} };
  }

  if (provider === 'ollama') {
    const baseUrl = `${normalizeHostUrl(cfg.ollamaHost || DEFAULT_OLLAMA_HOST)}/v1`;
    return {
      env: {},
      modelsJson: {
        providers: {
          ollama: {
            name: 'Ollama',
            baseUrl,
            api: 'openai-completions',
            models: [{ id: cfg.model || 'llama3.2' }],
          },
        },
      },
    };
  }

  if (provider === 'custom') {
    const baseUrl = (cfg.apiBaseUrl || '').replace(/\/+$/, '');
    return {
      env: apiKey ? { [CUSTOM_KEY_ENV]: apiKey } : {},
      modelsJson: {
        providers: {
          custom: {
            name: 'Custom (OpenAI-compatible)',
            baseUrl,
            api: 'openai-completions',
            // The literal placeholder — never the decrypted key — goes in the
            // file. Pi interpolates it from process.env at read time.
            ...(apiKey ? { apiKey: `\${${CUSTOM_KEY_ENV}}` } : {}),
            models: [{ id: cfg.model }],
          },
        },
      },
    };
  }

  return { env: {} };
}

// Tracks which env vars THIS module has set, so a later call that no longer
// needs one deletes only what it owns — a dev's shell-exported OPENAI_API_KEY
// must survive across provider switches.
const ownedEnvVars = new Set<string>();

export function applyPiEnv(env: Record<string, string>): void {
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
    ownedEnvVars.add(key);
  }
  for (const key of [...ownedEnvVars]) {
    if (!(key in env)) {
      delete process.env[key];
      ownedEnvVars.delete(key);
    }
  }
}

/** Writes modelsJson (when present) to userData, idempotent/cheap to redo every call. */
function writeModelsJson(modelsJson: object | undefined): string | undefined {
  if (!modelsJson) return undefined;
  const filePath = path.join(app.getPath('userData'), MODELS_JSON_FILENAME);
  fs.writeFileSync(filePath, JSON.stringify(modelsJson, null, 2));
  return filePath;
}

async function loadPort(
  cfg: LlmConfig,
  apiKey: string | undefined,
  modelId: string | undefined,
  importer: AdapterImporter,
): Promise<{ port: NarrativePort }> {
  const runtime = buildPiRuntimeConfig(cfg, apiKey);
  applyPiEnv(runtime.env);
  const modelsJsonPath = writeModelsJson(runtime.modelsJson);
  const { PiNarrativeAdapter } = await importer();
  return { port: new PiNarrativeAdapter({ provider: cfg.provider, modelId, modelsJsonPath }) };
}

export type NarrativePortResult = { port: NarrativePort } | { error: string };

/**
 * Load the configured NarrativePort. Model id rules preserve llm.ts's prior
 * behavior: ollama defaults to llama3.2; every other provider passes
 * cfg.model through as-is (the hosted-provider "no model configured" gate is
 * the caller's job — see llm.ts — since it needs the NarrativeOutcome shape,
 * not this function's `{ error }` shape).
 */
export async function getNarrativePort(importer: AdapterImporter = defaultImporter): Promise<NarrativePortResult> {
  const cfg = getLlmConfig();
  const apiKey = getApiKey(cfg.provider);
  const modelId = cfg.provider === 'ollama' ? cfg.model || 'llama3.2' : cfg.model;
  try {
    return await loadPort(cfg, apiKey, modelId, importer);
  } catch (err) {
    return {
      error: `AI engine failed to load: ${err instanceof Error ? err.message : String(err)}. This build may not support in-app AI — check for a Sound Buddy update.`,
    };
  }
}

/** Model list for the settings screen's provider/model pickers. Never throws. */
export async function listNarrativeModels(importer: AdapterImporter = defaultImporter): Promise<ModelInfo[]> {
  const cfg = getLlmConfig();
  const apiKey = getApiKey(cfg.provider);
  try {
    const { port } = await loadPort(cfg, apiKey, cfg.model, importer);
    return await port.listModels();
  } catch (err) {
    logWarn(`could not list AI models: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

export interface ProbeResult {
  ok: boolean;
  /** Model ids Pi's registry reports for the provider, when the probe succeeds. */
  models?: string[];
  reason?: string;
}

/**
 * "Test connection" for the API-key settings tab. This is a configuration
 * check via Pi's registry, not a network round-trip: the old per-provider
 * `/v1/models` HTTP probe is exactly the provider-specific HTTP code this
 * slice removes, and a live completion would spend the user's own tokens on
 * every click. Key authenticity is proven on first narrative instead, whose
 * errors already stream into the AI panel.
 */
export async function testProvider(
  opts: { provider: string; apiKey?: string; apiBaseUrl?: string },
  importer: AdapterImporter = defaultImporter,
): Promise<ProbeResult> {
  // The stored-key fallback is scoped to the provider it was pasted for — a
  // saved OpenAI key must not be tried against Anthropic just because the
  // user flipped the dropdown before testing.
  const candidateKey = opts.apiKey?.trim() || getApiKey(opts.provider);
  if (HOSTED.has(opts.provider) && !candidateKey) {
    return { ok: false, reason: 'Paste an API key first.' };
  }

  const cfg: LlmConfig = { provider: opts.provider, model: 'test', apiBaseUrl: opts.apiBaseUrl };
  try {
    const { port } = await loadPort(cfg, candidateKey, cfg.model, importer);
    const models = await port.listModels();
    const ids = models.filter((m) => m.provider === opts.provider).map((m) => m.id);
    if (ids.length === 0) {
      return {
        ok: false,
        reason: `${opts.provider} is not configured — check the key (Pi lists no models for it).`,
      };
    }
    return { ok: true, models: ids };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
