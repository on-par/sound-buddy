// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { getSoundBuddy, useElectron, ElectronContext } from './useElectron';
import { createMockSoundBuddy } from './mock-sound-buddy';

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('getSoundBuddy', () => {
  it('throws when the Electron preload bridge is unavailable', () => {
    (globalThis as { window?: unknown }).window = {};
    expect(() => getSoundBuddy()).toThrow(/bridge unavailable/i);
  });

  it('returns the stubbed api when window.soundBuddy is set', () => {
    const mock = createMockSoundBuddy();
    (globalThis as { window?: unknown }).window = { soundBuddy: mock.api };
    expect(getSoundBuddy()).toBe(mock.api);
  });
});

describe('useElectron', () => {
  it('resolves the api from context and lets a component call it', () => {
    const mock = createMockSoundBuddy();

    function Probe() {
      const api = useElectron();
      api.analyzeFile({ filePath: '/x.wav' });
      return null;
    }

    renderToString(
      createElement(ElectronContext.Provider, { value: mock.api }, createElement(Probe))
    );

    expect(mock.calls).toContainEqual({ method: 'analyzeFile', args: [{ filePath: '/x.wav' }] });
  });
});
