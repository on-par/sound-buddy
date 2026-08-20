// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// registerIpcHandlers is a thin fan-out: it must call every domain's
// register*Handlers exactly once, and in a fixed order. This test mocks the
// seven ipc/ modules so a dropped handler registration fails loudly instead
// of silently leaving a channel unwired.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerAnalysisHandlers: vi.fn(),
  registerLiveCaptureHandlers: vi.fn(),
  registerMeasurementSourceHandlers: vi.fn(),
  registerPlaybackHandlers: vi.fn(),
  registerLicensingHandlers: vi.fn(),
  registerSettingsHandlers: vi.fn(),
  registerConsoleHandlers: vi.fn(),
}));

vi.mock('./ipc/analysis', () => ({
  registerAnalysisHandlers: mocks.registerAnalysisHandlers,
  runSox: vi.fn(),
  runFfprobe: vi.fn(),
  runSpectrum: vi.fn(),
  runEbur128: vi.fn(),
}));
vi.mock('./ipc/live-capture', () => ({
  registerLiveCaptureHandlers: mocks.registerLiveCaptureHandlers,
  enumerateDevices: vi.fn(),
}));
vi.mock('./ipc/measurement-source', () => ({
  registerMeasurementSourceHandlers: mocks.registerMeasurementSourceHandlers,
}));
vi.mock('./ipc/playback', () => ({
  registerPlaybackHandlers: mocks.registerPlaybackHandlers,
}));
vi.mock('./ipc/licensing', () => ({
  registerLicensingHandlers: mocks.registerLicensingHandlers,
}));
vi.mock('./ipc/settings', () => ({
  registerSettingsHandlers: mocks.registerSettingsHandlers,
}));
vi.mock('./ipc/console', () => ({
  registerConsoleHandlers: mocks.registerConsoleHandlers,
}));

import { registerIpcHandlers } from './ipc';

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe('registerIpcHandlers', () => {
  it('calls every domain register*Handlers exactly once', () => {
    registerIpcHandlers();

    for (const [name, mock] of Object.entries(mocks)) {
      expect(mock, name).toHaveBeenCalledTimes(1);
    }
  });

  it('registers the seven domains in the same order the source lists them', () => {
    const callOrder: string[] = [];
    for (const mock of Object.values(mocks)) {
      mock.mockImplementation(() => callOrder.push(mock.getMockName()));
    }
    // Names make the order assertion readable rather than positional.
    mocks.registerAnalysisHandlers.mockName('registerAnalysisHandlers');
    mocks.registerLiveCaptureHandlers.mockName('registerLiveCaptureHandlers');
    mocks.registerMeasurementSourceHandlers.mockName('registerMeasurementSourceHandlers');
    mocks.registerPlaybackHandlers.mockName('registerPlaybackHandlers');
    mocks.registerLicensingHandlers.mockName('registerLicensingHandlers');
    mocks.registerSettingsHandlers.mockName('registerSettingsHandlers');
    mocks.registerConsoleHandlers.mockName('registerConsoleHandlers');

    registerIpcHandlers();

    expect(callOrder).toEqual([
      'registerAnalysisHandlers',
      'registerLiveCaptureHandlers',
      'registerMeasurementSourceHandlers',
      'registerPlaybackHandlers',
      'registerLicensingHandlers',
      'registerSettingsHandlers',
      'registerConsoleHandlers',
    ]);
  });
});
