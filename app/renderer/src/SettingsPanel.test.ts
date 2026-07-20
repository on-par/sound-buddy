// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import SettingsPanel, {
  modelsForProvider,
  keyPlaceholder,
  hostedModelValidation,
  buildLlmPatch,
  ollamaStatusFor,
  probeOllama,
  loadSettingsSeed,
  testConnection,
  save,
} from './SettingsPanel';
import { ElectronContext } from './useElectron';
import { createSettingsStore, useSettingsStore } from './stores/settingsStore';
import { createMockSoundBuddy } from './mock-sound-buddy';
import type { LlmModelInfo, PublicLlmConfig } from '../../electron/ipc/api';

const MODELS: LlmModelInfo[] = [
  { provider: 'openai', id: 'gpt-4o-mini', name: 'GPT-4o mini' },
  { provider: 'openai', id: 'gpt-4o', name: 'GPT-4o' },
  { provider: 'anthropic', id: 'claude-sonnet-5', name: 'Claude Sonnet 5' },
];

afterEach(() => {
  useSettingsStore.setState({ settings: null, llmConfig: null, settingsError: null, dialogOpen: false });
});

function renderMarkup(): string {
  const mock = createMockSoundBuddy();
  return renderToString(createElement(ElectronContext.Provider, { value: mock.api }, createElement(SettingsPanel)));
}

describe('modelsForProvider', () => {
  it('filters and maps ids for the given provider', () => {
    expect(modelsForProvider(MODELS, 'openai')).toEqual(['gpt-4o-mini', 'gpt-4o']);
    expect(modelsForProvider(MODELS, 'anthropic')).toEqual(['claude-sonnet-5']);
    expect(modelsForProvider(MODELS, 'google')).toEqual([]);
  });
});

describe('keyPlaceholder', () => {
  it('offers the saved-key hint when a key is saved for this provider', () => {
    const cfg: PublicLlmConfig = { provider: 'openai', model: '', ollamaHost: '', apiBaseUrl: '', hasApiKey: true, apiKeyProvider: 'openai' };
    expect(keyPlaceholder(cfg, 'openai')).toBe('••••••••••  (saved — paste to replace)');
  });

  it('offers the generic placeholder when the saved key belongs to a different provider', () => {
    const cfg: PublicLlmConfig = { provider: 'openai', model: '', ollamaHost: '', apiBaseUrl: '', hasApiKey: true, apiKeyProvider: 'openai' };
    expect(keyPlaceholder(cfg, 'anthropic')).toBe('Paste your API key');
  });

  it('offers the generic placeholder when there is no saved config', () => {
    expect(keyPlaceholder(null, 'openai')).toBe('Paste your API key');
  });
});

describe('hostedModelValidation', () => {
  it('requires a model for hosted providers', () => {
    expect(hostedModelValidation('openai', '', MODELS)).toBe('Enter a model name first (e.g. gpt-4o-mini).');
  });

  it('falls back to a generic example when no models are cached', () => {
    expect(hostedModelValidation('openai', '', [])).toBe('Enter a model name first (e.g. model-name).');
  });

  it('passes when a model is present', () => {
    expect(hostedModelValidation('openai', 'gpt-4o', MODELS)).toBeNull();
  });

  it('does not require a model for pass-through providers', () => {
    expect(hostedModelValidation('copilot', '', MODELS)).toBeNull();
  });
});

describe('buildLlmPatch', () => {
  it('builds an ollama patch', () => {
    expect(buildLlmPatch('ollama', { ollamaModel: 'llama3', ollamaHost: ' http://x ', provider: '', hostedModel: '', baseUrl: '', apiKey: '' })).toEqual({
      provider: 'ollama',
      model: 'llama3',
      ollamaHost: 'http://x',
    });
  });

  it('builds a hosted patch with apiBaseUrl only for custom', () => {
    expect(
      buildLlmPatch('hosted', { ollamaModel: '', ollamaHost: '', provider: 'openai', hostedModel: 'gpt-4o', baseUrl: 'https://x', apiKey: '' })
    ).toEqual({ provider: 'openai', model: 'gpt-4o', apiBaseUrl: '' });

    expect(
      buildLlmPatch('hosted', { ollamaModel: '', ollamaHost: '', provider: 'custom', hostedModel: 'm', baseUrl: ' https://x ', apiKey: '' })
    ).toEqual({ provider: 'custom', model: 'm', apiBaseUrl: 'https://x' });
  });

  it('omits apiKey when the field is empty (keep the saved key)', () => {
    const patch = buildLlmPatch('hosted', { ollamaModel: '', ollamaHost: '', provider: 'openai', hostedModel: 'gpt-4o', baseUrl: '', apiKey: '' });
    expect(patch).not.toHaveProperty('apiKey');
  });

  it('includes apiKey when the field is filled', () => {
    const patch = buildLlmPatch('hosted', { ollamaModel: '', ollamaHost: '', provider: 'openai', hostedModel: 'gpt-4o', baseUrl: '', apiKey: 'sk-x' });
    expect(patch).toMatchObject({ apiKey: 'sk-x' });
  });
});

describe('ollamaStatusFor', () => {
  it('reports the detected model count', () => {
    expect(ollamaStatusFor({ ok: true, models: ['a', 'b'] })).toEqual({
      text: 'Ollama detected — 2 models available.',
      kind: 'ok',
    });
  });

  it('pluralizes a single model', () => {
    expect(ollamaStatusFor({ ok: true, models: ['a'] })).toEqual({
      text: 'Ollama detected — 1 model available.',
      kind: 'ok',
    });
  });

  it('reports zero models with the pull hint', () => {
    expect(ollamaStatusFor({ ok: true, models: [] })).toEqual({
      text: 'Ollama is running but has no models — run "ollama pull llama3.2" first.',
      kind: 'err',
    });
  });

  it('reports not-running with the install link flag', () => {
    expect(ollamaStatusFor({ ok: false, reason: 'not-running' })).toEqual({
      text: 'Ollama not detected — ',
      kind: 'err',
      showInstallLink: true,
    });
  });

  it('reports an unknown reason', () => {
    expect(ollamaStatusFor({ ok: false, reason: 'ECONNREFUSED' })).toEqual({
      text: 'Could not reach Ollama: ECONNREFUSED',
      kind: 'err',
    });
  });

  it('reports an unknown error with no reason', () => {
    expect(ollamaStatusFor(null)).toEqual({ text: 'Could not reach Ollama: unknown error', kind: 'err' });
  });
});

describe('probeOllama', () => {
  it('returns the detect result on success', async () => {
    const mock = createMockSoundBuddy({ detectOllama: async () => ({ ok: true, models: ['llama3'] }) });
    expect(await probeOllama(mock.api, 'http://localhost:11434')).toEqual({ ok: true, models: ['llama3'] });
  });

  it('normalizes a rejected probe to { ok: false, reason }', async () => {
    const mock = createMockSoundBuddy({ detectOllama: () => Promise.reject(new Error('down')) });
    expect(await probeOllama(mock.api, '')).toEqual({ ok: false, reason: 'Error: down' });
  });
});

describe('loadSettingsSeed', () => {
  it('lands on the ollama tab with no saved provider', async () => {
    const mock = createMockSoundBuddy({
      getLlmConfig: async () => ({ provider: '', model: '', ollamaHost: '', apiBaseUrl: '', hasApiKey: false, apiKeyProvider: '' }),
      listLlmModels: async () => MODELS,
    });
    const seed = await loadSettingsSeed(mock.api, false);
    expect(seed.tab).toBe('ollama');
    expect(seed.provider).toBe('openai');
    expect(seed.passthroughOption).toBeNull();
    expect(seed.enableAi).toBe(true); // no provider configured yet ⇒ default on
    expect(seed.modelsCache).toEqual(MODELS);
  });

  it('lands on the hosted tab for a known provider and seeds enableAi from settings', async () => {
    const mock = createMockSoundBuddy({
      getLlmConfig: async () => ({ provider: 'openai', model: 'gpt-4o', ollamaHost: '', apiBaseUrl: '', hasApiKey: true, apiKeyProvider: 'openai' }),
    });
    const seed = await loadSettingsSeed(mock.api, true);
    expect(seed.tab).toBe('hosted');
    expect(seed.provider).toBe('openai');
    expect(seed.hostedModel).toBe('gpt-4o');
    expect(seed.passthroughOption).toBeNull();
    expect(seed.enableAi).toBe(true);
  });

  it('injects a pass-through option for an unrecognized pre-#76 provider', async () => {
    const mock = createMockSoundBuddy({
      getLlmConfig: async () => ({ provider: 'copilot', model: 'gpt-4', ollamaHost: '', apiBaseUrl: '', hasApiKey: false, apiKeyProvider: '' }),
    });
    const seed = await loadSettingsSeed(mock.api, true);
    expect(seed.provider).toBe('copilot');
    expect(seed.passthroughOption).toEqual({ value: 'copilot', label: 'copilot (via pi login)' });
  });

  it('falls back to defaults when getLlmConfig rejects', async () => {
    const mock = createMockSoundBuddy({ getLlmConfig: () => Promise.reject(new Error('io error')) });
    const seed = await loadSettingsSeed(mock.api, true);
    expect(seed.tab).toBe('ollama');
    expect(seed.enableAi).toBe(true);
  });

  it('falls back to an empty model cache when listLlmModels rejects', async () => {
    const mock = createMockSoundBuddy({ listLlmModels: () => Promise.reject(new Error('io error')) });
    const seed = await loadSettingsSeed(mock.api, true);
    expect(seed.modelsCache).toEqual([]);
  });
});

describe('testConnection', () => {
  it('reports success', async () => {
    const mock = createMockSoundBuddy({ testLlmProvider: async () => ({ ok: true }) });
    expect(await testConnection(mock.api, { provider: 'openai', apiKey: 'sk-good', apiBaseUrl: '' })).toEqual({
      text: 'Connected ✓',
      kind: 'ok',
    });
  });

  it('reports a failure reason', async () => {
    const mock = createMockSoundBuddy({ testLlmProvider: async () => ({ ok: false, reason: 'check your key' }) });
    expect(await testConnection(mock.api, { provider: 'openai', apiKey: 'sk-bad', apiBaseUrl: '' })).toEqual({
      text: 'check your key',
      kind: 'err',
    });
  });

  it('reports a generic failure when no reason is given', async () => {
    const mock = createMockSoundBuddy({ testLlmProvider: async () => undefined });
    expect(await testConnection(mock.api, { provider: 'openai', apiKey: '', apiBaseUrl: '' })).toEqual({
      text: 'Connection failed',
      kind: 'err',
    });
  });
});

describe('save', () => {
  it('blocks the save and focuses the model field when a hosted model is missing', async () => {
    const mock = createMockSoundBuddy();
    const store = createSettingsStore(() => mock.api);
    let result: { text: string; kind: '' | 'ok' | 'err' } | null = null;
    let focused = false;

    await save(
      'hosted',
      { ollamaModel: '', ollamaHost: '', provider: 'openai', hostedModel: '', baseUrl: '', apiKey: '' },
      MODELS,
      store,
      true,
      (r) => { result = r; },
      () => { focused = true; }
    );

    expect(result).toEqual({ text: 'Enter a model name first (e.g. gpt-4o-mini).', kind: 'err' });
    expect(focused).toBe(true);
    expect(mock.calls.some((c) => c.method === 'saveLlmConfig')).toBe(false);
  });

  it('saves, folds in the enable toggle, and closes the dialog on success', async () => {
    const config: PublicLlmConfig = { provider: 'ollama', model: 'llama3', ollamaHost: '', apiBaseUrl: '', hasApiKey: false, apiKeyProvider: '' };
    const mock = createMockSoundBuddy({
      saveLlmConfig: async () => ({ ok: true, config }),
      updateSettings: async (patch) => {
        mock.calls.push({ method: 'updateSettings', args: [patch] });
        return { aiEnabled: true, idealProfile: '', customIdealProfiles: [], storageDir: '', rigs: [], activeRigId: null, usageSignalEnabled: false, channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {}, crashReportingEnabled: false, dawWorkspaceEnabled: false, liveAdjustmentsEnabled: false, reportFirstUxEnabled: false, weeklyReminderEnabled: false, weeklyReminderServiceDay: 0 };
      },
    });
    const store = createSettingsStore(() => mock.api);
    store.getState().openDialog();

    await save(
      'ollama',
      { ollamaModel: 'llama3', ollamaHost: '', provider: '', hostedModel: '', baseUrl: '', apiKey: '' },
      [],
      store,
      true,
      () => {},
      () => {}
    );

    expect(store.getState().dialogOpen).toBe(false);
    expect(mock.calls).toContainEqual({ method: 'updateSettings', args: [{ aiEnabled: true }] });
  });

  it('reports the failure reason and leaves the dialog open when the save itself fails', async () => {
    const mock = createMockSoundBuddy({ saveLlmConfig: async () => ({ ok: false, reason: 'model is required' }) });
    const store = createSettingsStore(() => mock.api);
    store.getState().openDialog();
    let result: { text: string; kind: '' | 'ok' | 'err' } | null = null;

    await save(
      'ollama',
      { ollamaModel: 'llama3', ollamaHost: '', provider: '', hostedModel: '', baseUrl: '', apiKey: '' },
      [],
      store,
      true,
      (r) => { result = r; },
      () => {}
    );

    expect(result).toEqual({ text: 'model is required', kind: 'err' });
    expect(store.getState().dialogOpen).toBe(true);
  });
});

describe('SettingsPanel markup', () => {
  it('renders hidden by default with both tabs present', () => {
    const html = renderMarkup();
    expect(html).toContain('id="ai-dialog"');
    expect(html).toContain('style="display:none"');
    expect(html).toContain('id="ai-tab-ollama"');
    expect(html).toContain('id="ai-tab-hosted"');
    expect(html).toContain('id="ai-tab-btn-ollama"');
    expect(html).toContain('id="ai-tab-btn-hosted"');
  });

  it('shows flex display when the dialog is open', () => {
    useSettingsStore.setState({ dialogOpen: true });
    const html = renderMarkup();
    expect(html).toContain('style="display:flex"');
  });

  it('renders the four static provider options', () => {
    const html = renderMarkup();
    expect(html).toContain('>OpenAI<');
    expect(html).toContain('>Anthropic<');
    expect(html).toContain('>Google<');
    expect(html).toContain('>Custom (OpenAI-compatible)<');
  });

  it('renders an empty version footer before the app-version fetch resolves', () => {
    const html = renderMarkup();
    expect(html).toMatch(/<p class="ai-dialog-version" id="ai-dialog-version"><\/p>/);
  });

  it('defaults the Ollama tab active and the hosted pane hidden', () => {
    const html = renderMarkup();
    expect(html).toContain('id="ai-tab-btn-ollama" role="tab" aria-selected="true"');
    expect(html).toMatch(/id="ai-tab-hosted" style="display:none"/);
  });
});
