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
  const analyzeFilePath = vi.fn(async () => {});
  const getSecondaryInputCount = vi.fn(() => 1);
  const deps: AnalyzeEntryDeps = {
    chooseAndAnalyzeFile,
    getSecondaryDeviceName,
    getCadence,
    startSecondaryMeasurement,
    stopSecondaryMeasurement,
    openSettingsAudio,
    analyzeFilePath,
    getSecondaryInputCount,
    ...overrides,
  };
  return {
    deps, chooseAndAnalyzeFile, getSecondaryDeviceName, getCadence,
    startSecondaryMeasurement, stopSecondaryMeasurement, openSettingsAudio, analyzeFilePath,
    getSecondaryInputCount,
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
      expect(startSecondaryMeasurement).toHaveBeenCalledWith({ windowSecs: 5, intervalSecs: 0.2, channel: 0 });
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
    expect(startSecondaryMeasurement).toHaveBeenCalledWith({ windowSecs: 5, intervalSecs: 0.2, channel: 0 });
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

  describe('listenChannel / selectListenChannel (#1524)', () => {
    it('starts with listenChannel 0', () => {
      const { deps } = createFakeDeps();
      const store = createAnalyzeEntryStore(deps);

      expect(store.getState().listenChannel).toBe(0);
    });

    it('while listening, selectListenChannel(3) stops then restarts with the new channel, in order', async () => {
      const { deps, stopSecondaryMeasurement, startSecondaryMeasurement } = createFakeDeps({
        getSecondaryDeviceName: () => 'MOTU M2',
        getSecondaryInputCount: () => 8,
      });
      const store = createAnalyzeEntryStore(deps);
      await store.getState().listenLive();
      startSecondaryMeasurement.mockClear();

      await store.getState().selectListenChannel(3);

      expect(store.getState().listenChannel).toBe(3);
      expect(store.getState().listening).toBe(true);
      expect(stopSecondaryMeasurement).toHaveBeenCalledTimes(1);
      expect(startSecondaryMeasurement).toHaveBeenCalledTimes(1);
      expect(startSecondaryMeasurement).toHaveBeenCalledWith({ windowSecs: 3, intervalSecs: 0.1, channel: 3 });
      const stopOrder = stopSecondaryMeasurement.mock.invocationCallOrder[0];
      const startOrder = startSecondaryMeasurement.mock.invocationCallOrder[0];
      expect(stopOrder).toBeLessThan(startOrder);
    });

    it('switching N -> M always stops before the next start, and the last start carries M (AC2)', async () => {
      const { deps, stopSecondaryMeasurement, startSecondaryMeasurement } = createFakeDeps({
        getSecondaryDeviceName: () => 'MOTU M2',
        getSecondaryInputCount: () => 8,
      });
      const store = createAnalyzeEntryStore(deps);
      await store.getState().listenLive();
      startSecondaryMeasurement.mockClear();
      stopSecondaryMeasurement.mockClear();

      await store.getState().selectListenChannel(2);
      await store.getState().selectListenChannel(5);

      expect(stopSecondaryMeasurement).toHaveBeenCalledTimes(2);
      expect(startSecondaryMeasurement).toHaveBeenCalledTimes(2);
      expect(startSecondaryMeasurement).toHaveBeenLastCalledWith({ windowSecs: 3, intervalSecs: 0.1, channel: 5 });
      expect(store.getState().listenChannel).toBe(5);
    });

    it('selecting the same channel is a no-op (no stop, no start)', async () => {
      const { deps, stopSecondaryMeasurement, startSecondaryMeasurement } = createFakeDeps({
        getSecondaryDeviceName: () => 'MOTU M2',
        getSecondaryInputCount: () => 8,
      });
      const store = createAnalyzeEntryStore(deps);
      await store.getState().listenLive();
      startSecondaryMeasurement.mockClear();
      stopSecondaryMeasurement.mockClear();

      await store.getState().selectListenChannel(0);

      expect(stopSecondaryMeasurement).not.toHaveBeenCalled();
      expect(startSecondaryMeasurement).not.toHaveBeenCalled();
      expect(store.getState().listenChannel).toBe(0);
    });

    it('while not listening, only records listenChannel — starts and stops nothing', async () => {
      const { deps, stopSecondaryMeasurement, startSecondaryMeasurement } = createFakeDeps();
      const store = createAnalyzeEntryStore(deps);

      await store.getState().selectListenChannel(4);

      expect(store.getState().listenChannel).toBe(4);
      expect(stopSecondaryMeasurement).not.toHaveBeenCalled();
      expect(startSecondaryMeasurement).not.toHaveBeenCalled();
    });

    it('a subsequent listenLive() starts on the channel recorded while not listening', async () => {
      const { deps, startSecondaryMeasurement } = createFakeDeps({
        getSecondaryDeviceName: () => 'MOTU M2',
        getSecondaryInputCount: () => 8,
      });
      const store = createAnalyzeEntryStore(deps);
      await store.getState().selectListenChannel(4);

      await store.getState().listenLive();

      expect(startSecondaryMeasurement).toHaveBeenCalledWith({ windowSecs: 3, intervalSecs: 0.1, channel: 4 });
    });

    it.each([-1, 1.5, NaN])('ignores an invalid channel (%s)', async (invalid) => {
      const { deps, stopSecondaryMeasurement, startSecondaryMeasurement } = createFakeDeps({
        getSecondaryDeviceName: () => 'MOTU M2',
        getSecondaryInputCount: () => 8,
      });
      const store = createAnalyzeEntryStore(deps);
      await store.getState().listenLive();
      startSecondaryMeasurement.mockClear();
      stopSecondaryMeasurement.mockClear();

      await store.getState().selectListenChannel(invalid);

      expect(store.getState().listenChannel).toBe(0);
      expect(stopSecondaryMeasurement).not.toHaveBeenCalled();
      expect(startSecondaryMeasurement).not.toHaveBeenCalled();
    });

    it('listenLive clamps a stale listenChannel to inputCount - 1', async () => {
      const { deps, startSecondaryMeasurement } = createFakeDeps({
        getSecondaryDeviceName: () => 'MOTU M2',
        getSecondaryInputCount: () => 2,
      });
      const store = createAnalyzeEntryStore(deps);
      store.setState({ listenChannel: 5 });

      await store.getState().listenLive();

      expect(store.getState().listenChannel).toBe(1);
      expect(startSecondaryMeasurement).toHaveBeenCalledWith({ windowSecs: 3, intervalSecs: 0.1, channel: 1 });
    });
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

  describe('switchToFile() (#1522)', () => {
    it('while listening: stops the measurement and sets listening false, calling neither file action', async () => {
      const { deps, stopSecondaryMeasurement, chooseAndAnalyzeFile, analyzeFilePath } = createFakeDeps({
        getSecondaryDeviceName: () => 'MOTU M2',
      });
      const store = createAnalyzeEntryStore(deps);
      await store.getState().listenLive();
      expect(store.getState().listening).toBe(true);

      await store.getState().switchToFile();

      expect(store.getState().listening).toBe(false);
      expect(stopSecondaryMeasurement).toHaveBeenCalledTimes(1);
      expect(chooseAndAnalyzeFile).not.toHaveBeenCalled();
      expect(analyzeFilePath).not.toHaveBeenCalled();
    });

    it('while not listening: is a no-op for stopSecondaryMeasurement', async () => {
      const { deps, stopSecondaryMeasurement } = createFakeDeps();
      const store = createAnalyzeEntryStore(deps);

      await store.getState().switchToFile();

      expect(stopSecondaryMeasurement).not.toHaveBeenCalled();
    });

    it('closes the dialog', async () => {
      const { deps } = createFakeDeps();
      const store = createAnalyzeEntryStore(deps);
      store.getState().open();

      await store.getState().switchToFile();

      expect(store.getState().dialogOpen).toBe(false);
    });
  });

  describe('analyzeDroppedFile() (#1522)', () => {
    it('while listening: stops the measurement before analyzing the dropped path, in order', async () => {
      const { deps, stopSecondaryMeasurement, analyzeFilePath } = createFakeDeps({
        getSecondaryDeviceName: () => 'MOTU M2',
      });
      const store = createAnalyzeEntryStore(deps);
      await store.getState().listenLive();
      expect(store.getState().listening).toBe(true);

      await store.getState().analyzeDroppedFile('/x.wav');

      expect(store.getState().listening).toBe(false);
      expect(stopSecondaryMeasurement).toHaveBeenCalledTimes(1);
      expect(analyzeFilePath).toHaveBeenCalledWith('/x.wav');
      const stopOrder = stopSecondaryMeasurement.mock.invocationCallOrder[0];
      const analyzeOrder = analyzeFilePath.mock.invocationCallOrder[0];
      expect(stopOrder).toBeLessThan(analyzeOrder);
    });

    it('while idle: calls only analyzeFilePath and opens the stage', async () => {
      const { deps, stopSecondaryMeasurement, analyzeFilePath } = createFakeDeps();
      const store = createAnalyzeEntryStore(deps);

      await store.getState().analyzeDroppedFile('/x.wav');

      expect(stopSecondaryMeasurement).not.toHaveBeenCalled();
      expect(analyzeFilePath).toHaveBeenCalledWith('/x.wav');
      expect(store.getState().analyzeStage).toBe(true);
    });

    it('closes the dialog', async () => {
      const { deps } = createFakeDeps();
      const store = createAnalyzeEntryStore(deps);
      store.getState().open();

      await store.getState().analyzeDroppedFile('/x.wav');

      expect(store.getState().dialogOpen).toBe(false);
    });
  });
});
