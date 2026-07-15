// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import {
  createSettingsStore,
  useSettingsStore,
  buildLlmPatch,
  validateAiSave,
  effectiveStoragePath,
  AI_MODEL_HINTS,
  type AiSettingsForm,
} from './settingsStore';
import { createMockSoundBuddy } from '../mock-sound-buddy';

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useSettingsStore.setState({ settings: null, llmConfig: null, settingsError: null });
});

const BASE_SETTINGS = {
  aiEnabled: false,
  idealProfile: '',
  customIdealProfiles: [],
  storageDir: '',
  rigs: [],
  activeRigId: null,
  usageSignalEnabled: false,
};

const BASE_LLM_CONFIG = {
  provider: '',
  model: '',
  ollamaHost: '',
  apiBaseUrl: '',
  hasApiKey: false,
  apiKeyProvider: '',
};

function baseForm(overrides: Partial<AiSettingsForm> = {}): AiSettingsForm {
  return {
    tab: 'hosted',
    ollamaModel: '',
    ollamaHost: '',
    provider: 'openai',
    hostedModel: 'gpt-4o-mini',
    apiBaseUrl: '',
    apiKey: '',
    aiEnabled: false,
    ...overrides,
  };
}

describe('createSettingsStore', () => {
  it('starts with a fresh, idle state', () => {
    const mock = createMockSoundBuddy();
    const store = createSettingsStore(() => mock.api);

    expect(store.getState().settings).toBeNull();
    expect(store.getState().llmConfig).toBeNull();
    expect(store.getState().settingsError).toBeNull();
    expect(store.getState().aiDialogOpen).toBe(false);
    expect(store.getState().storageDialogOpen).toBe(false);
  });

  it('loads settings and llm config together', async () => {
    const mock = createMockSoundBuddy({
      getSettings: async () => {
        mock.calls.push({ method: 'getSettings', args: [] });
        return { ...BASE_SETTINGS, aiEnabled: true };
      },
      getLlmConfig: async () => {
        mock.calls.push({ method: 'getLlmConfig', args: [] });
        return { ...BASE_LLM_CONFIG, provider: 'ollama', model: 'llama3' };
      },
    });
    const store = createSettingsStore(() => mock.api);

    await store.getState().loadSettings();

    expect(store.getState().settings?.aiEnabled).toBe(true);
    expect(store.getState().llmConfig?.provider).toBe('ollama');
    expect(store.getState().settingsError).toBeNull();
    expect(mock.calls.map((c) => c.method)).toEqual(expect.arrayContaining(['getSettings', 'getLlmConfig']));
  });

  it('updates settings and records the IPC call', async () => {
    const updated = { ...BASE_SETTINGS, aiEnabled: true };
    const mock = createMockSoundBuddy({
      updateSettings: async (patch) => {
        mock.calls.push({ method: 'updateSettings', args: [patch] });
        return updated;
      },
    });
    const store = createSettingsStore(() => mock.api);

    await store.getState().updateSettings({ aiEnabled: true });

    expect(store.getState().settings).toEqual(updated);
    expect(mock.calls).toContainEqual({ method: 'updateSettings', args: [{ aiEnabled: true }] });
  });

  it('captures a rejected loadSettings promise as an error', async () => {
    const mock = createMockSoundBuddy({
      getSettings: () => Promise.reject(new Error('disk read failed')),
    });
    const store = createSettingsStore(() => mock.api);

    await store.getState().loadSettings();

    expect(store.getState().settingsError).toBe('disk read failed');
  });

  it('captures a rejected loadSettings promise that is not an Error instance', async () => {
    const mock = createMockSoundBuddy({
      getSettings: () => Promise.reject('disk read failed'),
    });
    const store = createSettingsStore(() => mock.api);

    await store.getState().loadSettings();

    expect(store.getState().settingsError).toBe('disk read failed');
  });

  it('captures a rejected updateSettings promise and retains previous settings', async () => {
    const initial = { ...BASE_SETTINGS };
    const mock = createMockSoundBuddy({
      updateSettings: () => Promise.reject(new Error('write failed')),
    });
    const store = createSettingsStore(() => mock.api);
    store.setState({ settings: initial });

    await store.getState().updateSettings({ aiEnabled: true });

    expect(store.getState().settingsError).toBe('write failed');
    expect(store.getState().settings).toEqual(initial);
  });

  it('captures a rejected updateSettings promise that is not an Error instance', async () => {
    const mock = createMockSoundBuddy({
      updateSettings: () => Promise.reject('write failed'),
    });
    const store = createSettingsStore(() => mock.api);

    await store.getState().updateSettings({ aiEnabled: true });

    expect(store.getState().settingsError).toBe('write failed');
  });

  it('binds the default hook to the window preload bridge', async () => {
    const mock = createMockSoundBuddy({
      getSettings: async () => ({ ...BASE_SETTINGS, aiEnabled: true }),
    });
    (globalThis as { window?: unknown }).window = { soundBuddy: mock.api };

    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState().settings?.aiEnabled).toBe(true);
  });

  describe('openAiDialog', () => {
    it('loads llmConfig, appVersion, and probes ollama', async () => {
      const mock = createMockSoundBuddy({
        getLlmConfig: async () => ({ ...BASE_LLM_CONFIG, provider: 'ollama', model: 'llama3' }),
        getAppVersion: async () => '1.2.3',
        detectOllama: async () => ({ ok: true, models: ['llama3', 'mistral'] }),
      });
      const store = createSettingsStore(() => mock.api);

      await store.getState().openAiDialog();
      // detectOllama is kicked without being awaited by openAiDialog itself.
      await Promise.resolve();
      await Promise.resolve();

      expect(store.getState().aiDialogOpen).toBe(true);
      expect(store.getState().llmConfig?.provider).toBe('ollama');
      expect(store.getState().appVersion).toBe('1.2.3');
      expect(store.getState().ollamaProbe).toEqual({ status: 'ok', models: ['llama3', 'mistral'] });
    });

    it('falls back to an empty config and null version on IPC failure', async () => {
      const mock = createMockSoundBuddy({
        getLlmConfig: () => Promise.reject(new Error('boom')),
        getAppVersion: () => Promise.reject(new Error('boom')),
        detectOllama: async () => ({ ok: false, reason: 'not-running' }),
      });
      const store = createSettingsStore(() => mock.api);

      await store.getState().openAiDialog();

      expect(store.getState().llmConfig).toEqual(BASE_LLM_CONFIG);
      expect(store.getState().appVersion).toBeNull();
    });

    it('reports a running-but-empty Ollama as "none"', async () => {
      const mock = createMockSoundBuddy({
        detectOllama: async () => ({ ok: true, models: [] }),
      });
      const store = createSettingsStore(() => mock.api);

      await store.getState().openAiDialog();
      await Promise.resolve();

      expect(store.getState().ollamaProbe).toEqual({ status: 'none', models: [] });
    });

    it('reports a non-running Ollama distinctly from a generic probe error', async () => {
      const mock = createMockSoundBuddy({
        detectOllama: async () => ({ ok: false, reason: 'not-running' }),
      });
      const store = createSettingsStore(() => mock.api);

      await store.getState().openAiDialog();
      await Promise.resolve();

      expect(store.getState().ollamaProbe).toEqual({ status: 'not-running', models: [] });
    });

    it('reports a probe throw as an error with the thrown message', async () => {
      const mock = createMockSoundBuddy({
        detectOllama: () => Promise.reject(new Error('ECONNREFUSED')),
      });
      const store = createSettingsStore(() => mock.api);

      await store.getState().openAiDialog();
      await Promise.resolve();

      expect(store.getState().ollamaProbe).toEqual({
        status: 'error',
        models: [],
        reason: 'Error: ECONNREFUSED',
      });
    });
  });

  it('closeAiDialog closes the dialog', () => {
    const mock = createMockSoundBuddy();
    const store = createSettingsStore(() => mock.api);
    store.setState({ aiDialogOpen: true });

    store.getState().closeAiDialog();

    expect(store.getState().aiDialogOpen).toBe(false);
  });

  describe('probeOllama stale-response guard', () => {
    it('only the last overlapping probe lands', async () => {
      let resolveFirst!: (v: unknown) => void;
      const first = new Promise((resolve) => {
        resolveFirst = resolve;
      });
      let calls = 0;
      const mock = createMockSoundBuddy({
        detectOllama: async () => {
          calls++;
          if (calls === 1) return first;
          return { ok: true, models: ['second-model'] };
        },
      });
      const store = createSettingsStore(() => mock.api);

      const p1 = store.getState().probeOllama('http://one');
      const p2 = store.getState().probeOllama('http://two');
      resolveFirst({ ok: true, models: ['first-model'] });
      await Promise.all([p1, p2]);

      expect(store.getState().ollamaProbe).toEqual({ status: 'ok', models: ['second-model'] });
    });
  });

  describe('testProvider', () => {
    it('reports a successful connection', async () => {
      const mock = createMockSoundBuddy({ testLlmProvider: async () => ({ ok: true }) });
      const store = createSettingsStore(() => mock.api);

      await store.getState().testProvider({ provider: 'openai', apiKey: 'sk-x' });

      expect(store.getState().aiTestResult).toEqual({ text: 'Connected ✓', kind: 'ok' });
    });

    it('reports a failure reason', async () => {
      const mock = createMockSoundBuddy({
        testLlmProvider: async () => ({ ok: false, reason: 'bad key' }),
      });
      const store = createSettingsStore(() => mock.api);

      await store.getState().testProvider({ provider: 'openai', apiKey: 'sk-x' });

      expect(store.getState().aiTestResult).toEqual({ text: 'bad key', kind: 'err' });
    });

    it('reports a thrown error', async () => {
      const mock = createMockSoundBuddy({
        testLlmProvider: () => Promise.reject(new Error('network down')),
      });
      const store = createSettingsStore(() => mock.api);

      await store.getState().testProvider({ provider: 'openai' });

      expect(store.getState().aiTestResult).toEqual({ text: 'Error: network down', kind: 'err' });
    });
  });

  describe('testOllamaConnection', () => {
    it('reports Connected when reachable, even with zero models', async () => {
      const mock = createMockSoundBuddy({ detectOllama: async () => ({ ok: true, models: [] }) });
      const store = createSettingsStore(() => mock.api);

      await store.getState().testOllamaConnection('http://localhost:11434');

      expect(store.getState().aiTestResult).toEqual({ text: 'Connected ✓', kind: 'ok' });
    });

    it('reports Not connected when unreachable', async () => {
      const mock = createMockSoundBuddy({ detectOllama: async () => ({ ok: false, reason: 'not-running' }) });
      const store = createSettingsStore(() => mock.api);

      await store.getState().testOllamaConnection();

      expect(store.getState().aiTestResult).toEqual({ text: 'Not connected', kind: 'err' });
    });
  });

  describe('saveAiSettings', () => {
    it('saves the ollama patch, updates aiEnabled, and closes', async () => {
      const mock = createMockSoundBuddy({
        saveLlmConfig: async (patch) => {
          mock.calls.push({ method: 'saveLlmConfig', args: [patch] });
          return { ok: true, config: { ...BASE_LLM_CONFIG, provider: 'ollama', model: 'llama3' } };
        },
        updateSettings: async (patch) => {
          mock.calls.push({ method: 'updateSettings', args: [patch] });
          return { ...BASE_SETTINGS, aiEnabled: true };
        },
      });
      const store = createSettingsStore(() => mock.api);
      store.setState({ aiDialogOpen: true });

      await store.getState().saveAiSettings(
        baseForm({ tab: 'ollama', ollamaModel: 'llama3', ollamaHost: ' http://host ', aiEnabled: true })
      );

      expect(mock.calls).toContainEqual({
        method: 'saveLlmConfig',
        args: [{ provider: 'ollama', model: 'llama3', ollamaHost: 'http://host' }],
      });
      expect(mock.calls).toContainEqual({ method: 'updateSettings', args: [{ aiEnabled: true }] });
      expect(store.getState().llmConfig?.model).toBe('llama3');
      expect(store.getState().aiDialogOpen).toBe(false);
    });

    it('rejects a hosted save with an empty model for a known provider', async () => {
      const mock = createMockSoundBuddy({ saveLlmConfig: async () => ({ ok: true, config: BASE_LLM_CONFIG }) });
      const store = createSettingsStore(() => mock.api);
      store.setState({ aiDialogOpen: true });

      await store.getState().saveAiSettings(baseForm({ provider: 'openai', hostedModel: '  ' }));

      expect(store.getState().aiDialogOpen).toBe(true);
      expect(store.getState().aiTestResult).toEqual({
        text: `Enter a model name first (e.g. ${AI_MODEL_HINTS.openai}).`,
        kind: 'err',
      });
      expect(mock.calls.some((c) => c.method === 'saveLlmConfig')).toBe(false);
    });

    it('keeps the dialog open and reports the reason when the save fails', async () => {
      const mock = createMockSoundBuddy({
        saveLlmConfig: async () => ({ ok: false, reason: 'disk full' }),
      });
      const store = createSettingsStore(() => mock.api);
      store.setState({ aiDialogOpen: true });

      await store.getState().saveAiSettings(baseForm());

      expect(store.getState().aiDialogOpen).toBe(true);
      expect(store.getState().aiTestResult).toEqual({ text: 'disk full', kind: 'err' });
    });

    it('keeps the dialog open when the save throws', async () => {
      const mock = createMockSoundBuddy({
        saveLlmConfig: () => Promise.reject(new Error('IPC gone')),
      });
      const store = createSettingsStore(() => mock.api);
      store.setState({ aiDialogOpen: true });

      await store.getState().saveAiSettings(baseForm());

      expect(store.getState().aiDialogOpen).toBe(true);
      expect(store.getState().aiTestResult).toEqual({ text: 'Error: IPC gone', kind: 'err' });
    });

    it('still closes the dialog when the non-fatal updateSettings call fails', async () => {
      const mock = createMockSoundBuddy({
        saveLlmConfig: async () => ({ ok: true, config: BASE_LLM_CONFIG }),
        updateSettings: () => Promise.reject(new Error('write failed')),
      });
      const store = createSettingsStore(() => mock.api);
      store.setState({ aiDialogOpen: true });

      await store.getState().saveAiSettings(baseForm());

      expect(store.getState().aiDialogOpen).toBe(false);
      expect(store.getState().settingsError).toBe('write failed');
    });
  });

  describe('openStorageDialog', () => {
    it('reports usage when a folder already has recordings', async () => {
      const mock = createMockSoundBuddy({
        getStorageUsage: async () => ({
          path: '/Users/pat/Music/Sound Buddy',
          isDefault: true,
          defaultPath: '/Users/pat/Music/Sound Buddy',
          bytes: 123456,
          human: '120 KB',
          exists: true,
        }),
      });
      const store = createSettingsStore(() => mock.api);

      await store.getState().openStorageDialog();

      expect(store.getState().storageDialogOpen).toBe(true);
      expect(store.getState().storageUsageText).toBe('Using 120 KB on this Mac — no limit.');
      expect(store.getState().storageDefaultPath).toBe('/Users/pat/Music/Sound Buddy');
      expect(store.getState().storagePendingDir).toBeNull();
    });

    it('reports an empty-folder message when nothing exists yet', async () => {
      const mock = createMockSoundBuddy({
        getStorageUsage: async () => ({
          path: '',
          isDefault: true,
          defaultPath: '/Users/pat/Music/Sound Buddy',
          bytes: 0,
          human: '0 B',
          exists: false,
        }),
      });
      const store = createSettingsStore(() => mock.api);

      await store.getState().openStorageDialog();

      expect(store.getState().storageUsageText).toBe('Nothing recorded yet — no limit on how much you can store.');
    });

    it('clears the usage text when the IPC call throws', async () => {
      const mock = createMockSoundBuddy({
        getStorageUsage: () => Promise.reject(new Error('fs error')),
      });
      const store = createSettingsStore(() => mock.api);

      await store.getState().openStorageDialog();

      expect(store.getState().storageUsageText).toBe('');
    });

    it('resets any leftover pending dir from a previous session', async () => {
      const mock = createMockSoundBuddy({
        getStorageUsage: async () => null as never,
      });
      const store = createSettingsStore(() => mock.api);
      store.setState({ storagePendingDir: '/some/old/pick' });

      await store.getState().openStorageDialog();

      expect(store.getState().storagePendingDir).toBeNull();
      expect(store.getState().storageUsageText).toBe('');
    });
  });

  it('closeStorageDialog closes the dialog', () => {
    const mock = createMockSoundBuddy();
    const store = createSettingsStore(() => mock.api);
    store.setState({ storageDialogOpen: true });

    store.getState().closeStorageDialog();

    expect(store.getState().storageDialogOpen).toBe(false);
  });

  describe('chooseStorageFolder', () => {
    it('sets the pending dir when the user picks a folder', async () => {
      const mock = createMockSoundBuddy({ openDirDialog: async () => '/new/folder' });
      const store = createSettingsStore(() => mock.api);

      await store.getState().chooseStorageFolder();

      expect(store.getState().storagePendingDir).toBe('/new/folder');
    });

    it('leaves the pending dir untouched when the user cancels', async () => {
      const mock = createMockSoundBuddy({ openDirDialog: async () => null });
      const store = createSettingsStore(() => mock.api);
      store.setState({ storagePendingDir: '/kept' });

      await store.getState().chooseStorageFolder();

      expect(store.getState().storagePendingDir).toBe('/kept');
    });
  });

  it('resetStorageDir marks the pending dir as reset-to-default', () => {
    const mock = createMockSoundBuddy();
    const store = createSettingsStore(() => mock.api);

    store.getState().resetStorageDir();

    expect(store.getState().storagePendingDir).toBe('');
  });

  describe('saveStorageSettings', () => {
    it('writes storageDir only when a folder was picked this session', async () => {
      const mock = createMockSoundBuddy({
        updateSettings: async (patch) => {
          mock.calls.push({ method: 'updateSettings', args: [patch] });
          return { ...BASE_SETTINGS };
        },
      });
      const store = createSettingsStore(() => mock.api);
      store.setState({ storagePendingDir: '/chosen', settings: { ...BASE_SETTINGS } });

      await store.getState().saveStorageSettings(false);

      expect(mock.calls).toContainEqual({ method: 'updateSettings', args: [{ storageDir: '/chosen' }] });
      expect(mock.calls.some((c) => 'usageSignalEnabled' in (c.args[0] as object))).toBe(false);
      expect(store.getState().storageDialogOpen).toBe(false);
    });

    it('skips the storageDir write when nothing was picked', async () => {
      const mock = createMockSoundBuddy({
        updateSettings: async (patch) => {
          mock.calls.push({ method: 'updateSettings', args: [patch] });
          return { ...BASE_SETTINGS };
        },
      });
      const store = createSettingsStore(() => mock.api);
      store.setState({ storagePendingDir: null, settings: { ...BASE_SETTINGS } });

      await store.getState().saveStorageSettings(false);

      expect(mock.calls.some((c) => c.method === 'updateSettings')).toBe(false);
    });

    it('writes usageSignalEnabled only when it changed', async () => {
      const mock = createMockSoundBuddy({
        updateSettings: async (patch) => {
          mock.calls.push({ method: 'updateSettings', args: [patch] });
          return { ...BASE_SETTINGS, usageSignalEnabled: true };
        },
      });
      const store = createSettingsStore(() => mock.api);
      store.setState({ storagePendingDir: null, settings: { ...BASE_SETTINGS, usageSignalEnabled: false } });

      await store.getState().saveStorageSettings(true);

      expect(mock.calls).toContainEqual({ method: 'updateSettings', args: [{ usageSignalEnabled: true }] });
    });
  });
});

describe('buildLlmPatch', () => {
  it('builds an ollama patch, trimming the host', () => {
    expect(
      buildLlmPatch(baseForm({ tab: 'ollama', ollamaModel: 'llama3', ollamaHost: ' http://host:11434 ' }))
    ).toEqual({ provider: 'ollama', model: 'llama3', ollamaHost: 'http://host:11434' });
  });

  it('builds a hosted patch for a known provider, trimming the model', () => {
    expect(buildLlmPatch(baseForm({ provider: 'openai', hostedModel: ' gpt-4o-mini ' }))).toEqual({
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiBaseUrl: '',
    });
  });

  it('includes the base URL only for the custom provider', () => {
    expect(
      buildLlmPatch(
        baseForm({ provider: 'custom', hostedModel: 'my-model', apiBaseUrl: ' https://x.example.com ' })
      )
    ).toEqual({ provider: 'custom', model: 'my-model', apiBaseUrl: 'https://x.example.com' });
  });

  it('clears apiBaseUrl for a non-custom provider even if one was typed', () => {
    expect(
      buildLlmPatch(baseForm({ provider: 'anthropic', hostedModel: 'claude', apiBaseUrl: 'https://stale' }))
    ).toEqual({ provider: 'anthropic', model: 'claude', apiBaseUrl: '' });
  });

  it('omits apiKey entirely when the field is empty (keeps the saved key)', () => {
    expect(buildLlmPatch(baseForm({ apiKey: '' }))).not.toHaveProperty('apiKey');
  });

  it('includes apiKey when the field has a value', () => {
    expect(buildLlmPatch(baseForm({ apiKey: 'sk-new' }))).toMatchObject({ apiKey: 'sk-new' });
  });
});

describe('validateAiSave', () => {
  it('requires a model for a known hosted provider', () => {
    expect(validateAiSave(baseForm({ provider: 'openai', hostedModel: '' }))).toBe(
      `Enter a model name first (e.g. ${AI_MODEL_HINTS.openai}).`
    );
  });

  it('passes a known hosted provider with a model', () => {
    expect(validateAiSave(baseForm({ provider: 'openai', hostedModel: 'gpt-4o-mini' }))).toBeNull();
  });

  it('passes a pass-through (pi login) provider with no model', () => {
    expect(validateAiSave(baseForm({ provider: 'copilot', hostedModel: '' }))).toBeNull();
  });

  it('never validates the ollama tab', () => {
    expect(validateAiSave(baseForm({ tab: 'ollama', ollamaModel: '' }))).toBeNull();
  });
});

describe('effectiveStoragePath', () => {
  it('uses the loaded path when nothing is pending', () => {
    expect(effectiveStoragePath(null, '/loaded', '/default')).toBe('/loaded');
  });

  it('uses the default path when reset', () => {
    expect(effectiveStoragePath('', '/loaded', '/default')).toBe('/default');
  });

  it('uses the chosen path when one was picked', () => {
    expect(effectiveStoragePath('/chosen', '/loaded', '/default')).toBe('/chosen');
  });
});
