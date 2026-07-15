// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import SettingsPanel, {
  SettingsPanelView,
  apiKeyPlaceholder,
  modelPlaceholder,
  type SettingsPanelViewProps,
} from './SettingsPanel';
import { ElectronContext } from './useElectron';
import { createMockSoundBuddy } from './mock-sound-buddy';
import type { PublicLlmConfig } from '../../electron/ipc/api';

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

const NOOP = () => {};

function baseProps(overrides: Partial<SettingsPanelViewProps> = {}): SettingsPanelViewProps {
  return {
    aiOpen: false,
    tab: 'ollama',
    ollamaHost: '',
    ollamaModel: '',
    ollamaProbe: { status: 'probing', models: [] },
    providerOptions: [
      { value: 'openai', label: 'OpenAI' },
      { value: 'anthropic', label: 'Anthropic' },
      { value: 'google', label: 'Google' },
      { value: 'custom', label: 'Custom (OpenAI-compatible)' },
    ],
    provider: 'openai',
    hostedModel: '',
    apiBaseUrl: '',
    apiKey: '',
    apiKeyPlaceholderText: 'Paste your API key',
    modelPlaceholderText: 'gpt-4o-mini',
    aiEnabledChecked: false,
    testResult: { text: '', kind: '' },
    appVersion: null,
    onTabChange: NOOP,
    onOllamaHostChange: NOOP,
    onOllamaHostBlur: NOOP,
    onOllamaModelChange: NOOP,
    onProviderChange: NOOP,
    onHostedModelChange: NOOP,
    onApiBaseUrlChange: NOOP,
    onApiKeyChange: NOOP,
    onAiEnabledChange: NOOP,
    onTest: NOOP,
    onSaveAi: NOOP,
    onCloseAi: NOOP,
    onOpenReleasePage: NOOP,
    storageOpen: false,
    storagePath: '~/Music/Sound Buddy',
    showStorageReset: false,
    storageUsageText: '',
    usageSignalChecked: false,
    onChooseFolder: NOOP,
    onResetStorageDir: NOOP,
    onUsageSignalChange: NOOP,
    onSaveStorage: NOOP,
    onCloseStorage: NOOP,
    ...overrides,
  };
}

function renderView(props: SettingsPanelViewProps): string {
  return renderToString(createElement(SettingsPanelView, props));
}

describe('SettingsPanelView', () => {
  it('renders both dialogs closed by default', () => {
    const html = renderView(baseProps());

    expect(html).toMatch(/id="ai-dialog"[^>]*style="display:none"/);
    expect(html).toMatch(/id="storage-dialog"[^>]*style="display:none"/);
    expect(html).toContain('data-react-island="settings"');
  });

  it('renders the AI dialog open on the ollama tab by default', () => {
    const html = renderView(baseProps({ aiOpen: true }));

    expect(html).toMatch(/id="ai-dialog"[^>]*style="display:flex"/);
    expect(html).toMatch(/id="ai-tab-ollama"[^>]*style="display:flex"/);
    expect(html).toMatch(/id="ai-tab-hosted"[^>]*style="display:none"/);
    expect(html).toContain('ai-tab active" id="ai-tab-btn-ollama"');
  });

  it('renders the hosted tab active and visible when selected', () => {
    const html = renderView(baseProps({ aiOpen: true, tab: 'hosted' }));

    expect(html).toMatch(/id="ai-tab-ollama"[^>]*style="display:none"/);
    expect(html).toMatch(/id="ai-tab-hosted"[^>]*style="display:flex"/);
    expect(html).toContain('ai-tab active" id="ai-tab-btn-hosted"');
  });

  it('shows the base URL field only for the custom provider', () => {
    const hidden = renderView(baseProps({ aiOpen: true, tab: 'hosted', provider: 'openai' }));
    expect(hidden).toMatch(/id="ai-baseurl-field"[^>]*style="display:none"/);

    const shown = renderView(baseProps({ aiOpen: true, tab: 'hosted', provider: 'custom' }));
    expect(shown).toMatch(/id="ai-baseurl-field"[^>]*style="display:flex"/);
  });

  it('renders every Ollama probe status with the exact copy from inline-app.js', () => {
    const probing = renderView(baseProps({ aiOpen: true, ollamaProbe: { status: 'probing', models: [] } }));
    expect(probing).toContain('Looking for Ollama…');

    const oneModel = renderView(
      baseProps({ aiOpen: true, ollamaProbe: { status: 'ok', models: ['llama3'] } })
    );
    expect(oneModel).toContain('Ollama detected — 1 model available.');

    const twoModels = renderView(
      baseProps({ aiOpen: true, ollamaProbe: { status: 'ok', models: ['llama3', 'mistral'] } })
    );
    expect(twoModels).toContain('Ollama detected — 2 models available.');

    const none = renderView(baseProps({ aiOpen: true, ollamaProbe: { status: 'none', models: [] } }));
    expect(none).toContain('Ollama is running but has no models — run');
    expect(none).toContain('<code>ollama pull llama3.2</code>');

    const notRunning = renderView(
      baseProps({ aiOpen: true, ollamaProbe: { status: 'not-running', models: [] } })
    );
    expect(notRunning).toContain('Ollama not detected —');
    expect(notRunning).toContain('href="https://ollama.com/download"');
    expect(notRunning).toContain('install it from ollama.com');

    const error = renderView(
      baseProps({ aiOpen: true, ollamaProbe: { status: 'error', models: [], reason: 'ECONNREFUSED' } })
    );
    expect(error).toContain('Could not reach Ollama: ECONNREFUSED');

    const errorNoReason = renderView(baseProps({ aiOpen: true, ollamaProbe: { status: 'error', models: [] } }));
    expect(errorNoReason).toContain('Could not reach Ollama: unknown error');
  });

  it('disables the model select when there are no models', () => {
    const html = renderView(baseProps({ aiOpen: true, ollamaProbe: { status: 'none', models: [] } }));
    expect(html).toMatch(/id="ai-ollama-model"[^>]*disabled=""/);
  });

  it('renders the appVersion line, or blank when unavailable', () => {
    const withVersion = renderView(baseProps({ aiOpen: true, appVersion: '1.2.3' }));
    expect(withVersion).toContain('Sound Buddy 1.2.3');

    const withoutVersion = renderView(baseProps({ aiOpen: true, appVersion: null }));
    expect(withoutVersion).toMatch(/id="ai-dialog-version">\s*<\/p>/);
  });

  it('renders the test result with its kind class', () => {
    const html = renderView(baseProps({ aiOpen: true, testResult: { text: 'Connected ✓', kind: 'ok' } }));
    expect(html).toContain('Connected ✓');
    expect(html).toMatch(/class="ai-status ok" id="ai-test-result" role="status"/);
  });

  it('renders the storage path, reset button visibility, and usage text', () => {
    const withoutReset = renderView(baseProps({ storageOpen: true, showStorageReset: false }));
    expect(withoutReset).toMatch(/id="storage-reset-btn"[^>]*style="display:none"/);

    const withReset = renderView(
      baseProps({ storageOpen: true, storagePath: '/custom/path', showStorageReset: true, storageUsageText: 'Using 1 MB on this Mac — no limit.' })
    );
    expect(withReset).toContain('/custom/path');
    expect(withReset).not.toMatch(/id="storage-reset-btn"[^>]*style="display:none"/);
    expect(withReset).toContain('Using 1 MB on this Mac — no limit.');
  });

  it('includes every stable id the e2e suite locates by', () => {
    const html = renderView(baseProps({ aiOpen: true, storageOpen: true }));

    for (const id of [
      'ai-dialog',
      'ai-dialog-title',
      'ai-tab-btn-ollama',
      'ai-tab-btn-hosted',
      'ai-ollama-host',
      'ai-ollama-status',
      'ai-ollama-model',
      'ai-provider',
      'ai-baseurl-field',
      'ai-base-url',
      'ai-api-key',
      'ai-hosted-model',
      'ai-test-btn',
      'ai-test-result',
      'ai-enable-toggle',
      'ai-dialog-cancel',
      'ai-dialog-save',
      'ai-dialog-version',
      'storage-dialog',
      'storage-dialog-title',
      'storage-path',
      'storage-change-btn',
      'storage-usage',
      'storage-note',
      'usage-signal-toggle',
      'usage-signal-note',
      'storage-reset-btn',
      'storage-cancel-btn',
      'storage-save-btn',
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });
});

describe('apiKeyPlaceholder', () => {
  const cfg: PublicLlmConfig = {
    provider: 'openai',
    model: 'gpt-4o-mini',
    ollamaHost: '',
    apiBaseUrl: '',
    hasApiKey: true,
    apiKeyProvider: 'openai',
  };

  it('shows the saved-key placeholder when the key belongs to this provider', () => {
    expect(apiKeyPlaceholder(cfg, 'openai')).toBe('••••••••••  (saved — paste to replace)');
  });

  it('shows the paste placeholder when the key belongs to a different provider', () => {
    expect(apiKeyPlaceholder(cfg, 'anthropic')).toBe('Paste your API key');
  });

  it('shows the paste placeholder when there is no saved key', () => {
    expect(apiKeyPlaceholder({ ...cfg, hasApiKey: false }, 'openai')).toBe('Paste your API key');
  });

  it('shows the paste placeholder when llmConfig is null', () => {
    expect(apiKeyPlaceholder(null, 'openai')).toBe('Paste your API key');
  });
});

describe('modelPlaceholder', () => {
  it('returns the known hint for each built-in provider', () => {
    expect(modelPlaceholder('openai')).toBe('gpt-4o-mini');
    expect(modelPlaceholder('anthropic')).toBe('claude-sonnet-4-6');
    expect(modelPlaceholder('google')).toBe('gemini-2.0-flash');
    expect(modelPlaceholder('custom')).toBe('model-name');
  });

  it('falls back to a generic hint for an unknown/pass-through provider', () => {
    expect(modelPlaceholder('copilot')).toBe('model-name');
  });
});

describe('SettingsPanel (connected)', () => {
  it('renders once from the store default state', () => {
    const mock = createMockSoundBuddy();
    const html = renderToString(
      createElement(ElectronContext.Provider, { value: mock.api }, createElement(SettingsPanel))
    );

    expect(html).toContain('id="ai-dialog"');
    expect(html).toContain('id="storage-dialog"');
  });
});
