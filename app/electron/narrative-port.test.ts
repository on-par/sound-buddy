// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp/sb-narrative-test') } }));
vi.mock('./llm-config', () => ({
  DEFAULT_OLLAMA_HOST: 'http://localhost:11434',
  getApiKey: vi.fn(),
  getLlmConfig: vi.fn(),
  normalizeHostUrl: (host: string) => {
    const trimmed = host.trim().replace(/\/+$/, '');
    if (!trimmed) return trimmed;
    return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  },
}));

const writeFileSyncMock = vi.fn();
vi.mock('fs', () => ({ writeFileSync: (...args: unknown[]) => writeFileSyncMock(...args) }));

import { getApiKey, getLlmConfig } from './llm-config';
import {
  buildPiRuntimeConfig,
  applyPiEnv,
  getNarrativePort,
  listNarrativeModels,
  testProvider,
  type AdapterImporter,
} from './narrative-port';

const getLlmConfigMock = getLlmConfig as unknown as Mock;
const getApiKeyMock = getApiKey as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
  writeFileSyncMock.mockReset();
});

// ─── buildPiRuntimeConfig ───────────────────────────────────────────────────

describe('buildPiRuntimeConfig', () => {
  it('maps openai to OPENAI_API_KEY with no modelsJson', () => {
    const result = buildPiRuntimeConfig({ provider: 'openai', model: 'gpt-4o-mini' }, 'sk-live');
    expect(result).toEqual({ env: { OPENAI_API_KEY: 'sk-live' } });
  });

  it('maps anthropic to ANTHROPIC_API_KEY', () => {
    const result = buildPiRuntimeConfig({ provider: 'anthropic', model: 'claude-sonnet-4-6' }, 'sk-ant');
    expect(result.env).toEqual({ ANTHROPIC_API_KEY: 'sk-ant' });
    expect(result.modelsJson).toBeUndefined();
  });

  it('maps google to GEMINI_API_KEY, not GOOGLE_API_KEY', () => {
    const result = buildPiRuntimeConfig({ provider: 'google', model: 'gemini-2.0-flash' }, 'sk-goog');
    expect(result.env).toEqual({ GEMINI_API_KEY: 'sk-goog' });
    expect(result.env['GOOGLE_API_KEY']).toBeUndefined();
  });

  it('produces no env entries when no key is supplied for a hosted provider', () => {
    const result = buildPiRuntimeConfig({ provider: 'openai', model: 'gpt-4o-mini' }, undefined);
    expect(result.env).toEqual({});
  });

  it('shapes the ollama modelsJson with a /v1-suffixed baseUrl and the given model', () => {
    const result = buildPiRuntimeConfig(
      { provider: 'ollama', model: 'llama3.2', ollamaHost: 'http://box:11434' },
      undefined,
    );
    expect(result.env).toEqual({});
    expect(result.modelsJson).toEqual({
      providers: {
        ollama: {
          name: 'Ollama',
          baseUrl: 'http://box:11434/v1',
          api: 'openai-completions',
          models: [{ id: 'llama3.2' }],
        },
      },
    });
  });

  it('falls back to the default host and default model for ollama', () => {
    const result = buildPiRuntimeConfig({ provider: 'ollama' }, undefined);
    expect(result.modelsJson).toEqual({
      providers: {
        ollama: {
          name: 'Ollama',
          baseUrl: 'http://localhost:11434/v1',
          api: 'openai-completions',
          models: [{ id: 'llama3.2' }],
        },
      },
    });
  });

  it('shapes the custom provider modelsJson with an interpolated key placeholder', () => {
    const result = buildPiRuntimeConfig(
      { provider: 'custom', model: 'my-model', apiBaseUrl: 'https://my-endpoint.example.com/' },
      'super-secret-key',
    );
    expect(result.env).toEqual({ SOUND_BUDDY_CUSTOM_API_KEY: 'super-secret-key' });
    expect(result.modelsJson).toEqual({
      providers: {
        custom: {
          name: 'Custom (OpenAI-compatible)',
          baseUrl: 'https://my-endpoint.example.com',
          api: 'openai-completions',
          apiKey: '${SOUND_BUDDY_CUSTOM_API_KEY}',
          models: [{ id: 'my-model' }],
        },
      },
    });
    // The decrypted key must never appear literally in the written JSON.
    expect(JSON.stringify(result.modelsJson)).not.toContain('super-secret-key');
  });

  it('omits apiKey/env for custom when no key is supplied', () => {
    const result = buildPiRuntimeConfig({ provider: 'custom', model: 'my-model', apiBaseUrl: 'https://x' }, undefined);
    expect(result.env).toEqual({});
    expect((result.modelsJson as { providers: { custom: { apiKey?: string } } }).providers.custom.apiKey).toBeUndefined();
  });

  it('returns an empty config for an unknown pass-through provider', () => {
    const result = buildPiRuntimeConfig({ provider: 'github-copilot', model: 'whatever' }, undefined);
    expect(result).toEqual({ env: {} });
  });
});

// ─── applyPiEnv ──────────────────────────────────────────────────────────────

describe('applyPiEnv', () => {
  const OWNED = 'SOUND_BUDDY_TEST_OWNED_VAR';
  const PREEXISTING = 'SOUND_BUDDY_TEST_PREEXISTING_VAR';

  beforeEach(() => {
    delete process.env[OWNED];
    delete process.env[PREEXISTING];
  });

  it('sets each provided var on process.env', () => {
    applyPiEnv({ [OWNED]: 'value-1' });
    expect(process.env[OWNED]).toBe('value-1');
  });

  it('removes a var it previously set when a later call omits it', () => {
    applyPiEnv({ [OWNED]: 'value-1' });
    applyPiEnv({});
    expect(process.env[OWNED]).toBeUndefined();
  });

  it('never deletes a var it did not set itself', () => {
    process.env[PREEXISTING] = 'user-value';
    applyPiEnv({ [OWNED]: 'value-1' });
    applyPiEnv({});
    expect(process.env[PREEXISTING]).toBe('user-value');
    delete process.env[PREEXISTING];
  });
});

// ─── getNarrativePort ────────────────────────────────────────────────────────

describe('getNarrativePort', () => {
  function fakeImporter(ctor: Mock): AdapterImporter {
    return () => Promise.resolve({ PiNarrativeAdapter: ctor as unknown as never });
  }

  it('constructs the adapter with the expected provider/modelId/modelsJsonPath', async () => {
    getLlmConfigMock.mockReturnValue({ provider: 'ollama', model: 'llama3.2', ollamaHost: 'http://localhost:11434' });
    getApiKeyMock.mockReturnValue(undefined);
    const ctor = vi.fn(function (this: unknown) {
      return { streamNarrative: vi.fn(), listModels: vi.fn() };
    });
    const result = await getNarrativePort(fakeImporter(ctor));
    expect('port' in result).toBe(true);
    expect(ctor).toHaveBeenCalledWith({
      provider: 'ollama',
      modelId: 'llama3.2',
      modelsJsonPath: '/tmp/sb-narrative-test/pi-models.json',
    });
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      '/tmp/sb-narrative-test/pi-models.json',
      expect.stringContaining('"ollama"'),
    );
  });

  it('defaults the ollama model id to llama3.2 when unset', async () => {
    getLlmConfigMock.mockReturnValue({ provider: 'ollama' });
    getApiKeyMock.mockReturnValue(undefined);
    const ctor = vi.fn(function () { return { streamNarrative: vi.fn(), listModels: vi.fn() }; });
    await getNarrativePort(fakeImporter(ctor));
    expect(ctor).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'llama3.2' }));
  });

  it('passes through cfg.model unmodified for a hosted provider', async () => {
    getLlmConfigMock.mockReturnValue({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
    getApiKeyMock.mockReturnValue('sk-ant');
    const ctor = vi.fn(function () { return { streamNarrative: vi.fn(), listModels: vi.fn() }; });
    await getNarrativePort(fakeImporter(ctor));
    expect(ctor).toHaveBeenCalledWith({ provider: 'anthropic', modelId: 'claude-sonnet-4-6', modelsJsonPath: undefined });
  });

  it('returns an actionable error result when the importer rejects', async () => {
    getLlmConfigMock.mockReturnValue({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
    getApiKeyMock.mockReturnValue('sk-ant');
    const importer: AdapterImporter = () => Promise.reject(new Error('module not found'));
    const result = await getNarrativePort(importer);
    expect('error' in result).toBe(true);
    const error = (result as { error: string }).error;
    expect(error).toContain('module not found');
    expect(error).toMatch(/update/i);
  });
});

// ─── listNarrativeModels ─────────────────────────────────────────────────────

describe('listNarrativeModels', () => {
  it('returns the models the adapter reports', async () => {
    getLlmConfigMock.mockReturnValue({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
    getApiKeyMock.mockReturnValue('sk-ant');
    const models = [{ provider: 'anthropic', id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' }];
    const ctor = vi.fn(function () { return { streamNarrative: vi.fn(), listModels: vi.fn().mockResolvedValue(models) }; });
    const importer: AdapterImporter = () =>
      Promise.resolve({ PiNarrativeAdapter: ctor as unknown as never });
    const result = await listNarrativeModels(importer);
    expect(result).toEqual(models);
  });

  it('returns an empty list when the adapter import fails', async () => {
    getLlmConfigMock.mockReturnValue({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
    getApiKeyMock.mockReturnValue('sk-ant');
    const importer: AdapterImporter = () => Promise.reject(new Error('boom'));
    const result = await listNarrativeModels(importer);
    expect(result).toEqual([]);
  });

  it('returns an empty list when the port itself throws', async () => {
    getLlmConfigMock.mockReturnValue({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
    getApiKeyMock.mockReturnValue('sk-ant');
    const ctor = vi.fn(function () {
      return {
        streamNarrative: vi.fn(),
        listModels: vi.fn().mockRejectedValue(new Error('registry unavailable')),
      };
    });
    const importer: AdapterImporter = () =>
      Promise.resolve({ PiNarrativeAdapter: ctor as unknown as never });
    const result = await listNarrativeModels(importer);
    expect(result).toEqual([]);
  });
});

// ─── testProvider ────────────────────────────────────────────────────────────

describe('testProvider', () => {
  it('requires a key for a hosted provider with none stored', async () => {
    getApiKeyMock.mockReturnValue(undefined);
    const result = await testProvider({ provider: 'openai' });
    expect(result).toEqual({ ok: false, reason: 'Paste an API key first.' });
  });

  it('reports models found for the provider', async () => {
    const models = [
      { provider: 'openai', id: 'gpt-4o-mini', name: 'GPT-4o mini' },
      { provider: 'anthropic', id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
    ];
    const ctor = vi.fn(function () { return { streamNarrative: vi.fn(), listModels: vi.fn().mockResolvedValue(models) }; });
    const importer: AdapterImporter = () =>
      Promise.resolve({ PiNarrativeAdapter: ctor as unknown as never });
    const result = await testProvider({ provider: 'openai', apiKey: 'sk-live' }, importer);
    expect(result).toEqual({ ok: true, models: ['gpt-4o-mini'] });
  });

  it('reports failure when the registry lists no models for the provider', async () => {
    const ctor = vi.fn(function () { return { streamNarrative: vi.fn(), listModels: vi.fn().mockResolvedValue([]) }; });
    const importer: AdapterImporter = () =>
      Promise.resolve({ PiNarrativeAdapter: ctor as unknown as never });
    const result = await testProvider({ provider: 'openai', apiKey: 'sk-live' }, importer);
    expect(result).toEqual({
      ok: false,
      reason: 'openai is not configured — check the key (Pi lists no models for it).',
    });
  });

  it('falls back to the stored key, scoped to the requested provider', async () => {
    getApiKeyMock.mockImplementation((provider?: string) => (provider === 'openai' ? 'sk-stored' : undefined));
    const models = [{ provider: 'openai', id: 'gpt-4o-mini', name: 'GPT-4o mini' }];
    const ctor = vi.fn(function () { return { streamNarrative: vi.fn(), listModels: vi.fn().mockResolvedValue(models) }; });
    const importer: AdapterImporter = () =>
      Promise.resolve({ PiNarrativeAdapter: ctor as unknown as never });
    const result = await testProvider({ provider: 'openai' }, importer);
    expect(getApiKeyMock).toHaveBeenCalledWith('openai');
    expect(result).toEqual({ ok: true, models: ['gpt-4o-mini'] });
  });

  it('resolves a failure (never throws) when the adapter import fails', async () => {
    const importer: AdapterImporter = () => Promise.reject(new Error('boom'));
    const result = await testProvider({ provider: 'openai', apiKey: 'sk-live' }, importer);
    expect(result).toEqual({ ok: false, reason: 'boom' });
  });
});
