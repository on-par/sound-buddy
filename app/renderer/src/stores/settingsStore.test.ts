// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createSettingsStore, useSettingsStore } from './settingsStore';
import { createMockSoundBuddy } from '../mock-sound-buddy';

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useSettingsStore.setState({ settings: null, llmConfig: null, settingsError: null });
});

describe('createSettingsStore', () => {
  it('starts with a fresh, idle state', () => {
    const mock = createMockSoundBuddy();
    const store = createSettingsStore(() => mock.api);

    expect(store.getState().settings).toBeNull();
    expect(store.getState().llmConfig).toBeNull();
    expect(store.getState().settingsError).toBeNull();
  });

  it('loads settings and llm config together', async () => {
    const mock = createMockSoundBuddy({
      getSettings: async () => {
        mock.calls.push({ method: 'getSettings', args: [] });
        return {
          aiEnabled: true,
          idealProfile: '',
          customIdealProfiles: [],
          storageDir: '',
          rigs: [],
          activeRigId: null,
          usageSignalEnabled: false,
        };
      },
      getLlmConfig: async () => {
        mock.calls.push({ method: 'getLlmConfig', args: [] });
        return {
          provider: 'ollama',
          model: 'llama3',
          ollamaHost: '',
          apiBaseUrl: '',
          hasApiKey: false,
          apiKeyProvider: '',
        };
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
    const updated = {
      aiEnabled: true,
      idealProfile: '',
      customIdealProfiles: [],
      storageDir: '',
      rigs: [],
      activeRigId: null,
      usageSignalEnabled: false,
    };
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
    const initial = {
      aiEnabled: false,
      idealProfile: '',
      customIdealProfiles: [],
      storageDir: '',
      rigs: [],
      activeRigId: null,
      usageSignalEnabled: false,
    };
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
      getSettings: async () => ({
        aiEnabled: true,
        idealProfile: '',
        customIdealProfiles: [],
        storageDir: '',
        rigs: [],
        activeRigId: null,
        usageSignalEnabled: false,
      }),
    });
    (globalThis as { window?: unknown }).window = { soundBuddy: mock.api };

    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState().settings?.aiEnabled).toBe(true);
  });
});
