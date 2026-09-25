// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import { createAnalyzeEntryStore, type AnalyzeEntryDeps } from './analyzeEntryStore';

function createFakeDeps(overrides: Partial<AnalyzeEntryDeps> = {}) {
  const chooseAndAnalyzeFile = vi.fn(async () => {});
  const getSecondaryDeviceName = vi.fn(() => '');
  const getCadence = vi.fn(() => ({ windowSecs: 3, meterIntervalMs: 100 }));
  const startSecondaryMeasurement = vi.fn(async () => {});
  const stopSecondaryMeasurement = vi.fn(async () => {});
  const openSettingsAudio = vi.fn();
  const deps: AnalyzeEntryDeps = {
    chooseAndAnalyzeFile,
    getSecondaryDeviceName,
    getCadence,
    startSecondaryMeasurement,
    stopSecondaryMeasurement,
    openSettingsAudio,
    ...overrides,
  };
  return {
    deps, chooseAndAnalyzeFile, getSecondaryDeviceName, getCadence,
    startSecondaryMeasurement, stopSecondaryMeasurement, openSettingsAudio,
  };
}

describe('createAnalyzeEntryStore (#1468)', () => {
  it('starts with the dialog closed', () => {
    const { deps } = createFakeDeps();
    const store = createAnalyzeEntryStore(deps);

    expect(store.getState().dialogOpen).toBe(false);
  });

  it('open() shows the dialog', () => {
    const { deps } = createFakeDeps();
    const store = createAnalyzeEntryStore(deps);

    store.getState().open();

    expect(store.getState().dialogOpen).toBe(true);
  });

  it('close() hides the dialog without taking any action', () => {
    const { deps, chooseAndAnalyzeFile, startSecondaryMeasurement, openSettingsAudio } = createFakeDeps();
    const store = createAnalyzeEntryStore(deps);
    store.getState().open();

    store.getState().close();

    expect(store.getState().dialogOpen).toBe(false);
    expect(chooseAndAnalyzeFile).not.toHaveBeenCalled();
    expect(startSecondaryMeasurement).not.toHaveBeenCalled();
    expect(openSettingsAudio).not.toHaveBeenCalled();
  });

  it('chooseFile() closes the dialog and delegates to the injected file chooser', async () => {
    const { deps, chooseAndAnalyzeFile } = createFakeDeps();
    const store = createAnalyzeEntryStore(deps);
    store.getState().open();

    await store.getState().chooseFile();

    expect(store.getState().dialogOpen).toBe(false);
    expect(chooseAndAnalyzeFile).toHaveBeenCalledTimes(1);
  });

  it('chooseFile() while not listening never stops the secondary measurement (#1485)', async () => {
    const { deps, stopSecondaryMeasurement, chooseAndAnalyzeFile } = createFakeDeps();
    const store = createAnalyzeEntryStore(deps);

    await store.getState().chooseFile();

    expect(stopSecondaryMeasurement).not.toHaveBeenCalled();
    expect(chooseAndAnalyzeFile).toHaveBeenCalledTimes(1);
  });

  it('chooseFile() while listening stops the secondary measurement before opening the picker (#1485)', async () => {
    const { deps, stopSecondaryMeasurement, chooseAndAnalyzeFile } = createFakeDeps({
      getSecondaryDeviceName: () => 'MOTU M2',
    });
    const store = createAnalyzeEntryStore(deps);
    await store.getState().listenLive();
    expect(store.getState().listening).toBe(true);

    await store.getState().chooseFile();

    expect(store.getState().listening).toBe(false);
    expect(stopSecondaryMeasurement).toHaveBeenCalledTimes(1);
    expect(chooseAndAnalyzeFile).toHaveBeenCalledTimes(1);
    const stopOrder = stopSecondaryMeasurement.mock.invocationCallOrder[0];
    const chooseOrder = chooseAndAnalyzeFile.mock.invocationCallOrder[0];
    expect(stopOrder).toBeLessThan(chooseOrder);
  });

  describe('enterAnalyze() (#1485)', () => {
    it('with a configured secondary device: starts listening directly, dialog stays closed, never touches the file chooser', async () => {
      const { deps, startSecondaryMeasurement, chooseAndAnalyzeFile } = createFakeDeps({
        getSecondaryDeviceName: () => 'MOTU M2',
        getCadence: () => ({ windowSecs: 5, meterIntervalMs: 200 }),
      });
      const store = createAnalyzeEntryStore(deps);

      await store.getState().enterAnalyze();

      expect(store.getState().dialogOpen).toBe(false);
      expect(store.getState().listening).toBe(true);
      expect(startSecondaryMeasurement).toHaveBeenCalledWith({ windowSecs: 5, intervalSecs: 0.2 });
      expect(chooseAndAnalyzeFile).not.toHaveBeenCalled();
    });

    it('with no secondary device configured: opens the dialog, starts nothing', async () => {
      const { deps, startSecondaryMeasurement, chooseAndAnalyzeFile, openSettingsAudio } = createFakeDeps({
        getSecondaryDeviceName: () => '',
      });
      const store = createAnalyzeEntryStore(deps);

      await store.getState().enterAnalyze();

      expect(store.getState().dialogOpen).toBe(true);
      expect(store.getState().listening).toBe(false);
      expect(startSecondaryMeasurement).not.toHaveBeenCalled();
      expect(chooseAndAnalyzeFile).not.toHaveBeenCalled();
      expect(openSettingsAudio).not.toHaveBeenCalled();
    });

    it('while already listening: is a no-op, never restarts the secondary measurement', async () => {
      const { deps, startSecondaryMeasurement } = createFakeDeps({
        getSecondaryDeviceName: () => 'MOTU M2',
      });
      const store = createAnalyzeEntryStore(deps);
      await store.getState().enterAnalyze();
      expect(startSecondaryMeasurement).toHaveBeenCalledTimes(1);

      await store.getState().enterAnalyze();

      expect(startSecondaryMeasurement).toHaveBeenCalledTimes(1);
      expect(store.getState().listening).toBe(true);
      expect(store.getState().dialogOpen).toBe(false);
    });
  });

  it('listenLive() with a configured secondary device closes the dialog and starts measurement with the cadence-derived opts', async () => {
    const { deps, startSecondaryMeasurement, openSettingsAudio } = createFakeDeps({
      getSecondaryDeviceName: () => 'MOTU M2',
      getCadence: () => ({ windowSecs: 5, meterIntervalMs: 200 }),
    });
    const store = createAnalyzeEntryStore(deps);
    store.getState().open();

    await store.getState().listenLive();

    expect(store.getState().dialogOpen).toBe(false);
    expect(startSecondaryMeasurement).toHaveBeenCalledWith({ windowSecs: 5, intervalSecs: 0.2 });
    expect(openSettingsAudio).not.toHaveBeenCalled();
  });

  it('listenLive() with no secondary device configured closes the dialog and routes to Settings > Audio instead of starting anything', async () => {
    const { deps, startSecondaryMeasurement, openSettingsAudio } = createFakeDeps({
      getSecondaryDeviceName: () => '',
    });
    const store = createAnalyzeEntryStore(deps);
    store.getState().open();

    await store.getState().listenLive();

    expect(store.getState().dialogOpen).toBe(false);
    expect(openSettingsAudio).toHaveBeenCalledTimes(1);
    expect(startSecondaryMeasurement).not.toHaveBeenCalled();
  });

  it('starts with listening false', () => {
    const { deps } = createFakeDeps();
    const store = createAnalyzeEntryStore(deps);

    expect(store.getState().listening).toBe(false);
  });

  it('listenLive() with a configured secondary device sets listening true (#1469)', async () => {
    const { deps } = createFakeDeps({ getSecondaryDeviceName: () => 'MOTU M2' });
    const store = createAnalyzeEntryStore(deps);

    await store.getState().listenLive();

    expect(store.getState().listening).toBe(true);
  });

  it('listenLive() with no secondary device configured never sets listening true (#1469)', async () => {
    const { deps } = createFakeDeps({ getSecondaryDeviceName: () => '' });
    const store = createAnalyzeEntryStore(deps);

    await store.getState().listenLive();

    expect(store.getState().listening).toBe(false);
  });

  it('stopListening() clears listening and stops the secondary measurement (#1469)', async () => {
    const { deps, stopSecondaryMeasurement } = createFakeDeps({ getSecondaryDeviceName: () => 'MOTU M2' });
    const store = createAnalyzeEntryStore(deps);
    await store.getState().listenLive();
    expect(store.getState().listening).toBe(true);

    await store.getState().stopListening();

    expect(store.getState().listening).toBe(false);
    expect(stopSecondaryMeasurement).toHaveBeenCalledTimes(1);
  });

  describe('analyzeStage (#1487)', () => {
    it('starts with the stage closed', () => {
      const { deps } = createFakeDeps();
      const store = createAnalyzeEntryStore(deps);

      expect(store.getState().analyzeStage).toBe(false);
    });

    it('enterAnalyze() opens the stage on the listen-live fork', async () => {
      const { deps } = createFakeDeps({ getSecondaryDeviceName: () => 'MOTU M2' });
      const store = createAnalyzeEntryStore(deps);

      await store.getState().enterAnalyze();

      expect(store.getState().analyzeStage).toBe(true);
    });

    it('enterAnalyze() opens the stage on the no-device dialog fork', async () => {
      const { deps } = createFakeDeps({ getSecondaryDeviceName: () => '' });
      const store = createAnalyzeEntryStore(deps);

      await store.getState().enterAnalyze();

      expect(store.getState().analyzeStage).toBe(true);
    });

    it('enterAnalyze() while already listening still ensures the stage is open', async () => {
      const { deps } = createFakeDeps({ getSecondaryDeviceName: () => 'MOTU M2' });
      const store = createAnalyzeEntryStore(deps);
      await store.getState().enterAnalyze();
      store.setState({ analyzeStage: false }); // simulate a tab-switch teardown mid-listen

      await store.getState().enterAnalyze();

      expect(store.getState().analyzeStage).toBe(true);
    });

    it('exitAnalyze() closes the stage without touching an in-progress listen', async () => {
      const { deps, stopSecondaryMeasurement } = createFakeDeps({ getSecondaryDeviceName: () => 'MOTU M2' });
      const store = createAnalyzeEntryStore(deps);
      await store.getState().enterAnalyze();
      expect(store.getState().listening).toBe(true);

      store.getState().exitAnalyze();

      expect(store.getState().analyzeStage).toBe(false);
      expect(store.getState().listening).toBe(true);
      expect(stopSecondaryMeasurement).not.toHaveBeenCalled();
    });

    it('exitAnalyze() closes the stage after a file-derived analysis (listening already stopped)', async () => {
      const { deps } = createFakeDeps({ getSecondaryDeviceName: () => 'MOTU M2' });
      const store = createAnalyzeEntryStore(deps);
      await store.getState().enterAnalyze();
      await store.getState().chooseFile();
      expect(store.getState().listening).toBe(false);
      expect(store.getState().analyzeStage).toBe(true);

      store.getState().exitAnalyze();

      expect(store.getState().analyzeStage).toBe(false);
    });
  });

  describe('showStage() (#1510)', () => {
    it('opens the stage without touching listening or dialogOpen', () => {
      const { deps, startSecondaryMeasurement, chooseAndAnalyzeFile, openSettingsAudio } = createFakeDeps();
      const store = createAnalyzeEntryStore(deps);

      store.getState().showStage();

      expect(store.getState().analyzeStage).toBe(true);
      expect(store.getState().listening).toBe(false);
      expect(store.getState().dialogOpen).toBe(false);
      expect(startSecondaryMeasurement).not.toHaveBeenCalled();
      expect(chooseAndAnalyzeFile).not.toHaveBeenCalled();
      expect(openSettingsAudio).not.toHaveBeenCalled();
    });

    it('is idempotent when the stage is already open', () => {
      const { deps } = createFakeDeps();
      const store = createAnalyzeEntryStore(deps);
      store.getState().showStage();

      store.getState().showStage();

      expect(store.getState().analyzeStage).toBe(true);
    });
  });
});
