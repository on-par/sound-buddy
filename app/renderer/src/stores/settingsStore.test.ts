// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createSettingsStore, useSettingsStore } from './settingsStore';
import { createMockSoundBuddy } from '../mock-sound-buddy';
import { ALL_FEATURE_FLAGS_OFF, resolveFeatureFlags } from '../../../electron/feature-flags';

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useSettingsStore.setState({ settings: null, settingsError: null, featureFlags: ALL_FEATURE_FLAGS_OFF });
});

describe('createSettingsStore', () => {
  it('starts with a fresh, idle state', () => {
    const mock = createMockSoundBuddy();
    const store = createSettingsStore(() => mock.api);

    expect(store.getState().settings).toBeNull();
    expect(store.getState().settingsError).toBeNull();
    expect(store.getState().featureFlags).toEqual(ALL_FEATURE_FLAGS_OFF);
  });

  it('loads settings', async () => {
    const mock = createMockSoundBuddy({
      getSettings: async () => {
        mock.calls.push({ method: 'getSettings', args: [] });
        return {
          idealProfile: '',
          customIdealProfiles: [],
          storageDir: '',
          rigs: [],
          activeRigId: null,
          usageSignalEnabled: false,
          channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {}, crashReportingEnabled: true, liveAdjustmentsEnabled: false, advancedFeaturesEnabled: true, lineCheckCalibrationEnabled: false, shareChurchName: '', weeklyReminderEnabled: false, weeklyReminderServiceDay: 0, liveEqPaneWidth: 360, measurementDeviceName: '', gradingProfile: 'casual' as const, gradingRubric: {}, consoleNetworkConsentGranted: false, soundcheckBuses: [], splCalibrationOffsetDb: null, lastAppMode: '',
        };
      },
    });
    const store = createSettingsStore(() => mock.api);

    await store.getState().loadSettings();

    expect(store.getState().settings?.crashReportingEnabled).toBe(true);
    expect(store.getState().settingsError).toBeNull();
    expect(mock.calls.map((c) => c.method)).toEqual(expect.arrayContaining(['getSettings']));
  });

  it('updates settings and records the IPC call', async () => {
    const updated = {
      idealProfile: '',
      customIdealProfiles: [],
      storageDir: '',
      rigs: [],
      activeRigId: null,
      usageSignalEnabled: false,
      channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {}, crashReportingEnabled: true, liveAdjustmentsEnabled: false, advancedFeaturesEnabled: true, lineCheckCalibrationEnabled: false, shareChurchName: '', weeklyReminderEnabled: false, weeklyReminderServiceDay: 0, liveEqPaneWidth: 360, measurementDeviceName: '', gradingProfile: 'casual' as const, gradingRubric: {}, consoleNetworkConsentGranted: false, soundcheckBuses: [], splCalibrationOffsetDb: null, lastAppMode: '',
    };
    const mock = createMockSoundBuddy({
      updateSettings: async (patch) => {
        mock.calls.push({ method: 'updateSettings', args: [patch] });
        return updated;
      },
    });
    const store = createSettingsStore(() => mock.api);

    await store.getState().updateSettings({ crashReportingEnabled: true });

    expect(store.getState().settings).toEqual(updated);
    expect(mock.calls).toContainEqual({ method: 'updateSettings', args: [{ crashReportingEnabled: true }] });
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

  // #1520: loadSettings pulls the resolved feature flags over IPC too.
  it('loadSettings stores the feature flags returned by getFeatureFlags', async () => {
    const onFlags = resolveFeatureFlags({ SOUND_BUDDY_FEATURES: 'console' });
    const mock = createMockSoundBuddy({ getFeatureFlags: async () => onFlags });
    const store = createSettingsStore(() => mock.api);

    await store.getState().loadSettings();

    expect(store.getState().featureFlags).toEqual(onFlags);
  });

  it('a rejected getFeatureFlags leaves the flags all-off without touching settingsError', async () => {
    const mock = createMockSoundBuddy({
      getFeatureFlags: () => Promise.reject(new Error('ipc unavailable')),
    });
    const store = createSettingsStore(() => mock.api);

    await store.getState().loadSettings();

    expect(store.getState().featureFlags).toEqual(ALL_FEATURE_FLAGS_OFF);
    expect(store.getState().settingsError).toBeNull();
    expect(store.getState().settings).not.toBeNull();
  });

  it('captures a rejected updateSettings promise and retains previous settings', async () => {
    const initial = {
      idealProfile: '',
      customIdealProfiles: [],
      storageDir: '',
      rigs: [],
      activeRigId: null,
      usageSignalEnabled: false,
      channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {}, crashReportingEnabled: false, liveAdjustmentsEnabled: false, advancedFeaturesEnabled: true, lineCheckCalibrationEnabled: false, shareChurchName: '', weeklyReminderEnabled: false, weeklyReminderServiceDay: 0, liveEqPaneWidth: 360, measurementDeviceName: '', gradingProfile: 'casual' as const, gradingRubric: {}, consoleNetworkConsentGranted: false, soundcheckBuses: [], splCalibrationOffsetDb: null, lastAppMode: '',
    };
    const mock = createMockSoundBuddy({
      updateSettings: () => Promise.reject(new Error('write failed')),
    });
    const store = createSettingsStore(() => mock.api);
    store.setState({ settings: initial });

    await store.getState().updateSettings({ crashReportingEnabled: true });

    expect(store.getState().settingsError).toBe('write failed');
    expect(store.getState().settings).toEqual(initial);
  });

  it('captures a rejected updateSettings promise that is not an Error instance', async () => {
    const mock = createMockSoundBuddy({
      updateSettings: () => Promise.reject('write failed'),
    });
    const store = createSettingsStore(() => mock.api);

    await store.getState().updateSettings({ crashReportingEnabled: true });

    expect(store.getState().settingsError).toBe('write failed');
  });

  it('grantConsoleNetworkConsent records the IPC call and updates settings state (#747)', async () => {
    const updated = {
      idealProfile: '',
      customIdealProfiles: [],
      storageDir: '',
      rigs: [],
      activeRigId: null,
      usageSignalEnabled: false,
      channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {}, crashReportingEnabled: false, liveAdjustmentsEnabled: false, advancedFeaturesEnabled: true, lineCheckCalibrationEnabled: false, shareChurchName: '', weeklyReminderEnabled: false, weeklyReminderServiceDay: 0, liveEqPaneWidth: 360, measurementDeviceName: '', gradingProfile: 'casual' as const, gradingRubric: {}, consoleNetworkConsentGranted: true, soundcheckBuses: [], splCalibrationOffsetDb: null, lastAppMode: '',
    };
    const mock = createMockSoundBuddy({
      grantConsoleNetworkConsent: async () => {
        mock.calls.push({ method: 'grantConsoleNetworkConsent', args: [] });
        return updated;
      },
    });
    const store = createSettingsStore(() => mock.api);

    await store.getState().grantConsoleNetworkConsent();

    expect(store.getState().settings).toEqual(updated);
    expect(mock.calls).toContainEqual({ method: 'grantConsoleNetworkConsent', args: [] });
  });

  it('captures a rejected grantConsoleNetworkConsent promise as an error', async () => {
    const mock = createMockSoundBuddy({
      grantConsoleNetworkConsent: () => Promise.reject(new Error('write failed')),
    });
    const store = createSettingsStore(() => mock.api);

    await store.getState().grantConsoleNetworkConsent();

    expect(store.getState().settingsError).toBe('write failed');
  });

  it('captures a rejected grantConsoleNetworkConsent promise that is not an Error instance', async () => {
    const mock = createMockSoundBuddy({
      grantConsoleNetworkConsent: () => Promise.reject('write failed'),
    });
    const store = createSettingsStore(() => mock.api);

    await store.getState().grantConsoleNetworkConsent();

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

  it('openDialog() with no argument requests no particular section', () => {
    const mock = createMockSoundBuddy();
    const store = createSettingsStore(() => mock.api);

    store.getState().openDialog();

    expect(store.getState().dialogSection).toBeNull();
  });

  // #1468 (lc-05): AnalyzeEntryDialog's "Listen live" choice routes here with
  // 'audio' when no secondary measurement device is configured yet.
  it('openDialog(section) records the requested landing section', () => {
    const mock = createMockSoundBuddy();
    const store = createSettingsStore(() => mock.api);

    store.getState().openDialog('audio');

    expect(store.getState().dialogOpen).toBe(true);
    expect(store.getState().dialogSection).toBe('audio');
  });

  it('a later plain openDialog() clears a previously requested section', () => {
    const mock = createMockSoundBuddy();
    const store = createSettingsStore(() => mock.api);

    store.getState().openDialog('audio');
    store.getState().closeDialog();
    store.getState().openDialog();

    expect(store.getState().dialogSection).toBeNull();
  });

  it('binds the default hook to the window preload bridge', async () => {
    const mock = createMockSoundBuddy({
      getSettings: async () => ({
        idealProfile: '',
        customIdealProfiles: [],
        storageDir: '',
        rigs: [],
        activeRigId: null,
        usageSignalEnabled: false,
        channelLabels: {}, channelGroups: {}, inputInstrumentProfiles: {}, crashReportingEnabled: true, liveAdjustmentsEnabled: false, advancedFeaturesEnabled: true, lineCheckCalibrationEnabled: false, shareChurchName: '', weeklyReminderEnabled: false, weeklyReminderServiceDay: 0, liveEqPaneWidth: 360, measurementDeviceName: '', gradingProfile: 'casual' as const, gradingRubric: {}, consoleNetworkConsentGranted: false, soundcheckBuses: [], splCalibrationOffsetDb: null, lastAppMode: '',
      }),
    });
    (globalThis as { window?: unknown }).window = { soundBuddy: mock.api };

    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState().settings?.crashReportingEnabled).toBe(true);
  });
});
