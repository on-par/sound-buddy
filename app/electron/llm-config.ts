// Persisted LLM provider config — the file behind the AI settings screen (#76).
//
//   ~/Library/Application Support/SoundBuddy/llm.json
//
// This is separate from settings.json (app-behavior flags). The API key is
// NEVER stored in plaintext: it is encrypted with Electron safeStorage (backed
// by the macOS Keychain) and persisted as base64 ciphertext in `apiKeyEnc`.
// The decrypted key exists only transiently in the main process, and is never
// sent to the renderer — reads go through getPublicLlmConfig(), which exposes
// only a `hasApiKey` boolean.
//
// Env vars override the file at read time (dev convenience, same layered
// discipline as settings.ts: overrides are never baked into a write).

import * as fs from 'fs';
import * as path from 'path';
import { app, safeStorage } from 'electron';
import { logWarn } from './logger';

/** The persisted file shape (all optional — absent keys fall back at read). */
export interface LlmConfigFile {
  provider?: string;
  model?: string;
  ollamaHost?: string;
  /** Base URL for the "custom" OpenAI-compatible provider. */
  apiBaseUrl?: string;
  /** safeStorage ciphertext, base64. Never the key itself. */
  apiKeyEnc?: string;
  piBin?: string;
}

/** Read-time view used by the LLM engine (env layered over file). */
export interface LlmConfig {
  provider?: string;
  model?: string;
  ollamaHost?: string;
  apiBaseUrl?: string;
  piBin?: string;
}

/** What the renderer sees — no ciphertext, no key material. */
export interface PublicLlmConfig {
  provider: string;
  model: string;
  ollamaHost: string;
  apiBaseUrl: string;
  hasApiKey: boolean;
}

export const DEFAULT_OLLAMA_HOST = 'http://localhost:11434';

function llmConfigPath(): string {
  return path.join(app.getPath('userData'), 'llm.json');
}

/** Raw file layer — `{}` when absent or unreadable. */
function readLlmFile(context: string): LlmConfigFile {
  try {
    const p = llmConfigPath();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')) as LlmConfigFile;
  } catch (err) {
    logWarn(`could not read llm.json ${context}: ${String(err)}`);
  }
  return {};
}

/**
 * Persist the file layer, preserving unknown top-level keys (forward compat).
 * Rethrows a write failure so a lost save surfaces to the caller.
 */
function writeLlmFile(file: LlmConfigFile): void {
  try {
    fs.writeFileSync(llmConfigPath(), JSON.stringify(file, null, 2));
  } catch (err) {
    logWarn(`could not write llm.json: ${String(err)}`);
    throw err;
  }
}

/** Read config, layering env overrides (dev) over the file. */
export function getLlmConfig(): LlmConfig {
  const file = readLlmFile('for read');
  return {
    provider: process.env.SOUND_BUDDY_LLM_PROVIDER?.trim() || file.provider,
    model: process.env.SOUND_BUDDY_LLM_MODEL?.trim() || file.model,
    ollamaHost: process.env.SOUND_BUDDY_OLLAMA_HOST?.trim() || file.ollamaHost,
    apiBaseUrl: process.env.SOUND_BUDDY_LLM_BASE_URL?.trim() || file.apiBaseUrl,
    piBin: process.env.SOUND_BUDDY_PI_BIN?.trim() || file.piBin,
  };
}

/** The renderer-safe view (never includes key material). */
export function getPublicLlmConfig(): PublicLlmConfig {
  const cfg = getLlmConfig();
  const file = readLlmFile('for public read');
  return {
    provider: cfg.provider || '',
    model: cfg.model || '',
    ollamaHost: cfg.ollamaHost || DEFAULT_OLLAMA_HOST,
    apiBaseUrl: cfg.apiBaseUrl || '',
    hasApiKey: Boolean(process.env.SOUND_BUDDY_LLM_API_KEY?.trim() || file.apiKeyEnc),
  };
}

/** A renderer patch: `apiKey` semantics — undefined = keep, '' = clear. */
export interface LlmConfigPatch {
  provider?: string;
  model?: string;
  ollamaHost?: string;
  apiBaseUrl?: string;
  apiKey?: string;
}

/**
 * Merge and persist a settings-screen save. Encrypts a newly pasted key via
 * safeStorage; keeps the existing ciphertext when the key field was untouched.
 * Throws when a key was supplied but OS-level encryption is unavailable —
 * storing it plaintext is not an acceptable fallback.
 */
export function saveLlmConfig(patch: LlmConfigPatch): PublicLlmConfig {
  const file = readLlmFile('before save');
  const next: LlmConfigFile = { ...file };

  if (typeof patch.provider === 'string') next.provider = patch.provider.trim();
  if (typeof patch.model === 'string') next.model = patch.model.trim();
  if (typeof patch.ollamaHost === 'string') {
    next.ollamaHost = patch.ollamaHost.trim() || DEFAULT_OLLAMA_HOST;
  }
  if (typeof patch.apiBaseUrl === 'string') next.apiBaseUrl = patch.apiBaseUrl.trim();

  if (typeof patch.apiKey === 'string') {
    const key = patch.apiKey.trim();
    if (!key) {
      delete next.apiKeyEnc;
    } else {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error(
          'Secure key storage is unavailable on this system — the key was not saved.',
        );
      }
      next.apiKeyEnc = safeStorage.encryptString(key).toString('base64');
    }
  }

  writeLlmFile(next);
  return getPublicLlmConfig();
}

/**
 * The decrypted API key for main-process use only (env override first). Returns
 * undefined when no key is stored or the ciphertext can't be decrypted (e.g.
 * llm.json copied from another machine — the Keychain entry doesn't travel).
 */
export function getApiKey(): string | undefined {
  const env = process.env.SOUND_BUDDY_LLM_API_KEY?.trim();
  if (env) return env;
  const enc = readLlmFile('for key read').apiKeyEnc;
  if (!enc) return undefined;
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'));
  } catch (err) {
    logWarn(`could not decrypt stored API key: ${String(err)}`);
    return undefined;
  }
}
