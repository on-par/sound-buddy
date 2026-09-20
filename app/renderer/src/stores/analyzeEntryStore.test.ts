// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import { createAnalyzeEntryStore, type AnalyzeEntryDeps } from './analyzeEntryStore';

function createFakeDeps(overrides: Partial<AnalyzeEntryDeps> = {}) {
  const chooseAndAnalyzeFile = vi.fn(async () => {});
  const getSecondaryDeviceName = vi.fn(() => '');
  const getCadence = vi.fn(() => ({ windowSecs: 3, meterIntervalMs: 100 }));
  const startSecondaryMeasurement = vi.fn(async () => {});
  const openSettingsAudio = vi.fn();
  const deps: AnalyzeEntryDeps = {
    chooseAndAnalyzeFile,
    getSecondaryDeviceName,
    getCadence,
    startSecondaryMeasurement,
    openSettingsAudio,
    ...overrides,
  };
  return { deps, chooseAndAnalyzeFile, getSecondaryDeviceName, getCadence, startSecondaryMeasurement, openSettingsAudio };
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
});
