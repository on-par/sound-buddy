// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { createAnalyzeEntryStore, type AnalyzeEntryDeps } from './analyzeEntryStore';

function createFakeDeps(overrides: Partial<AnalyzeEntryDeps> = {}) {
  const chooseAndAnalyzeFile = vi.fn(async () => {});
  const getSecondaryDeviceName = vi.fn(() => '');
  const getCadence = vi.fn(() => ({ windowSecs: 3, meterIntervalMs: 100 }));
  const startSecondaryMeasurement = vi.fn(async () => {});
  const stopSecondaryMeasurement = vi.fn(async () => {});
  const analyzeFilePath = vi.fn(async () => {});
  const getSecondaryInputCount = vi.fn(() => 1);
  const getPersistedSecondaryDeviceName = vi.fn(() => '');
  const adoptSecondaryDeviceName = vi.fn();
  const stopRecording = vi.fn(async () => {});
  const deps: AnalyzeEntryDeps = {
    chooseAndAnalyzeFile,
    getSecondaryDeviceName,
    getCadence,
    startSecondaryMeasurement,
    stopSecondaryMeasurement,
    analyzeFilePath,
    getSecondaryInputCount,
    getPersistedSecondaryDeviceName,
    adoptSecondaryDeviceName,
    stopRecording,
    ...overrides,
  };
  return {
    deps, chooseAndAnalyzeFile, getSecondaryDeviceName, getCadence,
    startSecondaryMeasurement, stopSecondaryMeasurement, analyzeFilePath,
    getSecondaryInputCount, getPersistedSecondaryDeviceName, adoptSecondaryDeviceName, stopRecording,
  };
}

describe('createAnalyzeEntryStore (#1468)', () => {
  it('chooseFile() delegates to the injected file chooser', async () => {
    const { deps, chooseAndAnalyzeFile } = createFakeDeps();
    const store = createAnalyzeEntryStore(deps);

    await store.getState().chooseFile();

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

      expect(store.getState().listening).toBe(true);
      expect(startSecondaryMeasurement).toHaveBeenCalledWith({ windowSecs: 5, intervalSecs: 0.2, channel: 0 });
      expect(chooseAndAnalyzeFile).not.toHaveBeenCalled();
    });

    // #1646: no device is no longer a fork — Analyze defaults to Live on the
    // system default input, never a dialog or Settings.
    it('with no secondary device configured: starts listening on the system default input, never the file chooser (#1646)', async () => {
      const { deps, startSecondaryMeasurement, chooseAndAnalyzeFile, adoptSecondaryDeviceName } = createFakeDeps({
        getSecondaryDeviceName: () => '',
        getCadence: () => ({ windowSecs: 5, meterIntervalMs: 200 }),
      });
      const store = createAnalyzeEntryStore(deps);

      await store.getState().enterAnalyze();

      expect(store.getState().listening).toBe(true);
      expect(store.getState().analyzeStage).toBe(true);
      expect(startSecondaryMeasurement).toHaveBeenCalledWith({ windowSecs: 5, intervalSecs: 0.2, channel: 0 });
      expect(adoptSecondaryDeviceName).not.toHaveBeenCalled();
      expect(chooseAndAnalyzeFile).not.toHaveBeenCalled();
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
    });
  });

  it('listenLive() with a configured secondary device starts measurement with the cadence-derived opts', async () => {
    const { deps, startSecondaryMeasurement } = createFakeDeps({
      getSecondaryDeviceName: () => 'MOTU M2',
      getCadence: () => ({ windowSecs: 5, meterIntervalMs: 200 }),
    });
    const store = createAnalyzeEntryStore(deps);

    await store.getState().listenLive();

    expect(startSecondaryMeasurement).toHaveBeenCalledWith({ windowSecs: 5, intervalSecs: 0.2, channel: 0 });
  });

  it('listenLive() with no secondary device configured starts measurement on the system default input (#1646)', async () => {
    const { deps, startSecondaryMeasurement } = createFakeDeps({
      getSecondaryDeviceName: () => '',
      getCadence: () => ({ windowSecs: 5, meterIntervalMs: 200 }),
    });
    const store = createAnalyzeEntryStore(deps);

    await store.getState().listenLive();

    expect(startSecondaryMeasurement).toHaveBeenCalledTimes(1);
    expect(startSecondaryMeasurement).toHaveBeenCalledWith({ windowSecs: 5, intervalSecs: 0.2, channel: 0 });
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

  it('listenLive() with no secondary device configured sets listening true (#1646)', async () => {
    const { deps } = createFakeDeps({ getSecondaryDeviceName: () => '' });
    const store = createAnalyzeEntryStore(deps);

    await store.getState().listenLive();

    expect(store.getState().listening).toBe(true);
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

  // #1636: a recording must never outlive the Analyze listen — stopListening()
  // stops an active recording before it tears down the secondary measurement.
  it('stopListening() stops an active recording before stopping the secondary measurement (#1636)', async () => {
    const callOrder: string[] = [];
    const { deps } = createFakeDeps({
      getSecondaryDeviceName: () => 'MOTU M2',
      stopRecording: vi.fn(async () => { callOrder.push('stopRecording'); }),
      stopSecondaryMeasurement: vi.fn(async () => { callOrder.push('stopSecondaryMeasurement'); }),
    });
    const store = createAnalyzeEntryStore(deps);
    await store.getState().listenLive();

    await store.getState().stopListening();

    expect(callOrder).toEqual(['stopRecording', 'stopSecondaryMeasurement']);
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

    it('enterAnalyze() opens the stage with no device configured (system default input, #1646)', async () => {
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

    // #1636: leaving Analyze (switchMode) must stop an active recording even
    // though the listen itself survives the tab switch (see the test above).
    it('exitAnalyze() stops an active recording (#1636)', async () => {
      const { deps, stopRecording } = createFakeDeps({ getSecondaryDeviceName: () => 'MOTU M2' });
      const store = createAnalyzeEntryStore(deps);
      await store.getState().enterAnalyze();

      store.getState().exitAnalyze();

      expect(stopRecording).toHaveBeenCalledTimes(1);
    });

    // #1646: the system-default-input listen is Analyze-only — Session's room
    // feed/EQ pane read any active secondary stream, and "None (use board
    // channel)" must keep meaning the board there. A configured device's
    // listen still survives the tab switch (the test above).
    it('exitAnalyze() stops a system-default-input listen (no device configured) (#1646)', async () => {
      const { deps, stopSecondaryMeasurement, stopRecording } = createFakeDeps({ getSecondaryDeviceName: () => '' });
      const store = createAnalyzeEntryStore(deps);
      await store.getState().enterAnalyze();
      expect(store.getState().listening).toBe(true);

      store.getState().exitAnalyze();
      await vi.waitFor(() => expect(stopSecondaryMeasurement).toHaveBeenCalledTimes(1));

      expect(store.getState().analyzeStage).toBe(false);
      expect(store.getState().listening).toBe(false);
      expect(stopRecording).toHaveBeenCalledTimes(1);
    });

    it('exitAnalyze() keeps a persisted-device listen running (#1646)', async () => {
      const { deps, stopSecondaryMeasurement } = createFakeDeps({
        getSecondaryDeviceName: () => '',
        getPersistedSecondaryDeviceName: () => 'MOTU M2',
      });
      const store = createAnalyzeEntryStore(deps);
      await store.getState().enterAnalyze();

      store.getState().exitAnalyze();

      expect(store.getState().listening).toBe(true);
      expect(stopSecondaryMeasurement).not.toHaveBeenCalled();
    });

    it('exitAnalyze() with no device and not listening stops nothing but the recording (#1646)', () => {
      const { deps, stopSecondaryMeasurement, stopRecording } = createFakeDeps({ getSecondaryDeviceName: () => '' });
      const store = createAnalyzeEntryStore(deps);

      store.getState().exitAnalyze();

      expect(stopSecondaryMeasurement).not.toHaveBeenCalled();
      expect(stopRecording).toHaveBeenCalledTimes(1);
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
    it('opens the stage without touching listening', () => {
      const { deps, startSecondaryMeasurement, chooseAndAnalyzeFile } = createFakeDeps();
      const store = createAnalyzeEntryStore(deps);

      store.getState().showStage();

      expect(store.getState().analyzeStage).toBe(true);
      expect(store.getState().listening).toBe(false);
      expect(startSecondaryMeasurement).not.toHaveBeenCalled();
      expect(chooseAndAnalyzeFile).not.toHaveBeenCalled();
    });

    it('with no secondary device configured: opens the stage only — no capture of its own (#1578)', () => {
      const { deps, startSecondaryMeasurement, chooseAndAnalyzeFile } = createFakeDeps();
      const store = createAnalyzeEntryStore(deps);

      store.getState().showStage();

      expect(store.getState().analyzeStage).toBe(true);
      expect(store.getState().listening).toBe(false);
      expect(startSecondaryMeasurement).not.toHaveBeenCalled();
      expect(chooseAndAnalyzeFile).not.toHaveBeenCalled();
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
  });

  describe('effective secondary device name (#1604)', () => {
    it('listenLive() with live empty and a persisted name: adopts it before starting', async () => {
      const { deps, adoptSecondaryDeviceName, startSecondaryMeasurement } = createFakeDeps({
        getSecondaryDeviceName: () => '',
        getPersistedSecondaryDeviceName: () => 'MOTU M2',
      });
      const store = createAnalyzeEntryStore(deps);

      await store.getState().listenLive();

      expect(adoptSecondaryDeviceName).toHaveBeenCalledWith('MOTU M2');
      expect(startSecondaryMeasurement).toHaveBeenCalledTimes(1);
      const adoptOrder = adoptSecondaryDeviceName.mock.invocationCallOrder[0];
      const startOrder = startSecondaryMeasurement.mock.invocationCallOrder[0];
      expect(adoptOrder).toBeLessThan(startOrder);
      expect(store.getState().listening).toBe(true);
    });

    it('listenLive() with a live name already set: never adopts, even if a different name is persisted', async () => {
      const { deps, adoptSecondaryDeviceName } = createFakeDeps({
        getSecondaryDeviceName: () => 'MOTU M2',
        getPersistedSecondaryDeviceName: () => 'Some Other Mic',
      });
      const store = createAnalyzeEntryStore(deps);

      await store.getState().listenLive();

      expect(adoptSecondaryDeviceName).not.toHaveBeenCalled();
    });

    it('listenLive() with both live and persisted empty: adopts nothing and starts the system default input (#1646)', async () => {
      const { deps, adoptSecondaryDeviceName, startSecondaryMeasurement } = createFakeDeps({
        getSecondaryDeviceName: () => '',
        getPersistedSecondaryDeviceName: () => '',
      });
      const store = createAnalyzeEntryStore(deps);

      await store.getState().listenLive();

      expect(adoptSecondaryDeviceName).not.toHaveBeenCalled();
      expect(startSecondaryMeasurement).toHaveBeenCalledTimes(1);
      expect(store.getState().listening).toBe(true);
    });

    it('enterAnalyze() with live empty and a persisted name: starts listening directly', async () => {
      const { deps } = createFakeDeps({
        getSecondaryDeviceName: () => '',
        getPersistedSecondaryDeviceName: () => 'MOTU M2',
      });
      const store = createAnalyzeEntryStore(deps);

      await store.getState().enterAnalyze();

      expect(store.getState().listening).toBe(true);
    });

    it('enterAnalyze() with both live and persisted empty: starts listening on the system default input (#1646)', async () => {
      const { deps, startSecondaryMeasurement } = createFakeDeps({
        getSecondaryDeviceName: () => '',
        getPersistedSecondaryDeviceName: () => '',
      });
      const store = createAnalyzeEntryStore(deps);

      await store.getState().enterAnalyze();

      expect(store.getState().listening).toBe(true);
      expect(startSecondaryMeasurement).toHaveBeenCalledTimes(1);
    });
  });

  // #1620: pins listenLive()'s existing contract under the name mode-switch.ts's
  // maybeAutoListenAnalyzeHome() relies on as the cold-boot auto-listen seam —
  // it starts the measurement, with or without a configured device (#1646).
  describe('listenLive() as the cold-boot auto-listen seam (#1620)', () => {
    it('auto-listen: a configured in-memory device starts the measurement', async () => {
      const { deps, startSecondaryMeasurement, adoptSecondaryDeviceName } = createFakeDeps({
        getSecondaryDeviceName: () => 'UMIK-1',
      });
      const store = createAnalyzeEntryStore(deps);

      await store.getState().listenLive();

      expect(startSecondaryMeasurement).toHaveBeenCalledTimes(1);
      expect(store.getState().listening).toBe(true);
      expect(store.getState().analyzeStage).toBe(true);
      expect(adoptSecondaryDeviceName).not.toHaveBeenCalled();
    });

    it('auto-listen: a persisted-only device adopts the name and starts the measurement', async () => {
      const { deps, startSecondaryMeasurement, adoptSecondaryDeviceName } = createFakeDeps({
        getSecondaryDeviceName: () => '',
        getPersistedSecondaryDeviceName: () => 'UMIK-1',
      });
      const store = createAnalyzeEntryStore(deps);

      await store.getState().listenLive();

      expect(adoptSecondaryDeviceName).toHaveBeenCalledWith('UMIK-1');
      expect(startSecondaryMeasurement).toHaveBeenCalledTimes(1);
    });

    it('auto-listen: no device anywhere starts the system default input (#1646)', async () => {
      const { deps, startSecondaryMeasurement } = createFakeDeps();
      const store = createAnalyzeEntryStore(deps);

      await store.getState().listenLive();

      expect(startSecondaryMeasurement).toHaveBeenCalledTimes(1);
      expect(store.getState().listening).toBe(true);
      expect(store.getState().analyzeStage).toBe(true);
    });
  });

  describe('activateLive() — the Analyze Live toggle (#1637)', () => {
    it('in-memory device present: starts the measurement with cadence-derived opts', async () => {
      const { deps, startSecondaryMeasurement } = createFakeDeps({
        getSecondaryDeviceName: () => 'Room Mic',
        getCadence: () => ({ windowSecs: 5, meterIntervalMs: 200 }),
      });
      const store = createAnalyzeEntryStore(deps);

      await store.getState().activateLive();

      expect(startSecondaryMeasurement).toHaveBeenCalledWith({ windowSecs: 5, intervalSecs: 0.2, channel: 0 });
      expect(store.getState().listening).toBe(true);
      expect(store.getState().analyzeStage).toBe(true);
    });

    it('persisted-only device: adopts the name before starting the measurement', async () => {
      const { deps, adoptSecondaryDeviceName, startSecondaryMeasurement } = createFakeDeps({
        getSecondaryDeviceName: () => '',
        getPersistedSecondaryDeviceName: () => 'Room Mic',
      });
      const store = createAnalyzeEntryStore(deps);

      await store.getState().activateLive();

      expect(adoptSecondaryDeviceName).toHaveBeenCalledWith('Room Mic');
      expect(startSecondaryMeasurement).toHaveBeenCalledTimes(1);
      const adoptOrder = adoptSecondaryDeviceName.mock.invocationCallOrder[0];
      const startOrder = startSecondaryMeasurement.mock.invocationCallOrder[0];
      expect(adoptOrder).toBeLessThan(startOrder);
    });

    it('already listening: is a no-op — no start, no stop, listening stays true', async () => {
      const { deps, startSecondaryMeasurement, stopSecondaryMeasurement } = createFakeDeps({
        getSecondaryDeviceName: () => 'Room Mic',
      });
      const store = createAnalyzeEntryStore(deps);
      await store.getState().activateLive();
      expect(store.getState().listening).toBe(true);
      startSecondaryMeasurement.mockClear();
      stopSecondaryMeasurement.mockClear();

      await store.getState().activateLive();

      expect(startSecondaryMeasurement).not.toHaveBeenCalled();
      expect(stopSecondaryMeasurement).not.toHaveBeenCalled();
      expect(store.getState().listening).toBe(true);
    });

    // #1646: the bug this issue locks out — Live with no room mic configured
    // used to bounce to Settings > Audio. It now listens in place on the
    // system default input.
    it('no device anywhere: starts listening in place on the system default input (#1646)', async () => {
      const { deps, startSecondaryMeasurement, adoptSecondaryDeviceName } = createFakeDeps({
        getSecondaryDeviceName: () => '',
        getPersistedSecondaryDeviceName: () => '',
        getCadence: () => ({ windowSecs: 5, meterIntervalMs: 200 }),
      });
      const store = createAnalyzeEntryStore(deps);
      store.getState().showStage();

      await store.getState().activateLive();

      expect(startSecondaryMeasurement).toHaveBeenCalledWith({ windowSecs: 5, intervalSecs: 0.2, channel: 0 });
      expect(adoptSecondaryDeviceName).not.toHaveBeenCalled();
      expect(store.getState().listening).toBe(true);
      expect(store.getState().analyzeStage).toBe(true);
    });
  });

  // #1646: the store has no route to Settings at all — the Settings > Audio
  // bounce (#1485/#1589) is the bug, so its absence is pinned structurally.
  describe('no Settings route (#1646)', () => {
    const src = readFileSync(fileURLToPath(new URL('./analyzeEntryStore.ts', import.meta.url)), 'utf8');

    it('never imports the settings store\'s dialog opener or an openSettingsAudio dep', () => {
      expect(src).not.toMatch(/openDialog\(/);
      expect(src).not.toMatch(/openSettingsAudio/);
    });

    it('carries no pending Settings-bounce state', () => {
      const { deps } = createFakeDeps();
      const state = createAnalyzeEntryStore(deps).getState() as unknown as Record<string, unknown>;
      expect(state).not.toHaveProperty('pendingListenAfterSettings');
      expect(state).not.toHaveProperty('resumePendingListen');
      expect(state).not.toHaveProperty('dialogOpen');
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

  });
});
