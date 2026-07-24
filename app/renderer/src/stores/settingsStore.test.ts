// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createSettingsStore, useSettingsStore } from './settingsStore';
import { createMockSoundBuddy } from '../mock-sound-buddy';

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useSettingsStore.setState({ settings: null, settingsError: null });
});

describe('createSettingsStore', () => {
  it('starts with a fresh, idle state', () => {
    const mock = createMockSoundBuddy();
    const store = createSettingsStore(() => mock.api);

    expect(store.getState().settings).toBeNull();
    expect(store.getState().settingsError).toBeNull();
  });

  it('loads settings', async () => {
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
          channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {}, crashReportingEnabled: false, dawWorkspaceEnabled: false, liveAdjustmentsEnabled: false, reportFirstUxEnabled: false, shareChurchName: '', weeklyReminderEnabled: false, weeklyReminderServiceDay: 0,
        };
      },
    });
    const store = createSettingsStore(() => mock.api);

    await store.getState().loadSettings();

    expect(store.getState().settings?.aiEnabled).toBe(true);
    expect(store.getState().settingsError).toBeNull();
    expect(mock.calls.map((c) => c.method)).toEqual(expect.arrayContaining(['getSettings']));
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
      channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {}, crashReportingEnabled: false, dawWorkspaceEnabled: false, liveAdjustmentsEnabled: false, reportFirstUxEnabled: false, shareChurchName: '', weeklyReminderEnabled: false, weeklyReminderServiceDay: 0,
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
      channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {}, crashReportingEnabled: false, dawWorkspaceEnabled: false, liveAdjustmentsEnabled: false, reportFirstUxEnabled: false, shareChurchName: '', weeklyReminderEnabled: false, weeklyReminderServiceDay: 0,
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

  it('starts with the dialog closed', () => {
    const mock = createMockSoundBuddy();
    const store = createSettingsStore(() => mock.api);

    expect(store.getState().dialogOpen).toBe(false);
  });

  it('openDialog and closeDialog flip dialogOpen', () => {
    const mock = createMockSoundBuddy();
    const store = createSettingsStore(() => mock.api);

    store.getState().openDialog();
    expect(store.getState().dialogOpen).toBe(true);

    store.getState().closeDialog();
    expect(store.getState().dialogOpen).toBe(false);
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
        channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {}, crashReportingEnabled: false, dawWorkspaceEnabled: false, liveAdjustmentsEnabled: false, reportFirstUxEnabled: false, shareChurchName: '', weeklyReminderEnabled: false, weeklyReminderServiceDay: 0,
      }),
    });
    (globalThis as { window?: unknown }).window = { soundBuddy: mock.api };

    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState().settings?.aiEnabled).toBe(true);
  });
});
