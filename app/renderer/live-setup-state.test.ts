// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';

// live-setup-state is a plain classic script (window.liveSetupState in the
// browser, module.exports under Node), mirroring onboarding-state.js.
const {
  KEY,
  hasCompletedSetup,
  markSetupComplete,
  shouldShowGuide,
  setupSteps,
  showAdvancedControls,
} = require('./live-setup-state.js') as {
  KEY: string;
  hasCompletedSetup: (storage: unknown) => boolean;
  markSetupComplete: (storage: unknown) => void;
  shouldShowGuide: (storage: unknown) => boolean;
  setupSteps: (view: { deviceReady: boolean; trackCount: number; liveMode: string }) => Array<{
    key: string;
    label: string;
    hint: string;
    done: boolean;
    active: boolean;
  }>;
  showAdvancedControls: (trackCount: number) => boolean;
};

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    _map: map,
  };
}

describe('hasCompletedSetup', () => {
  it('is false for empty storage', () => {
    expect(hasCompletedSetup(fakeStorage())).toBe(false);
  });
  it('is true once the done flag is set', () => {
    expect(hasCompletedSetup(fakeStorage({ [KEY]: '1' }))).toBe(true);
  });
  it('is false for any value other than the exact "1"', () => {
    expect(hasCompletedSetup(fakeStorage({ [KEY]: 'yes' }))).toBe(false);
  });
  it('is false when storage.getItem throws (private mode)', () => {
    const throwing = { getItem: () => { throw new Error('denied'); } };
    expect(hasCompletedSetup(throwing)).toBe(false);
  });
  it('is false for a null/missing storage', () => {
    expect(hasCompletedSetup(null)).toBe(false);
    expect(hasCompletedSetup(undefined)).toBe(false);
  });
  it('is false when getItem is not a function', () => {
    expect(hasCompletedSetup({ getItem: 'nope' })).toBe(false);
  });
});

describe('markSetupComplete', () => {
  it('persists the done flag', () => {
    const s = fakeStorage();
    markSetupComplete(s);
    expect(s._map.get(KEY)).toBe('1');
  });
  it('is idempotent', () => {
    const s = fakeStorage();
    markSetupComplete(s);
    markSetupComplete(s);
    expect(s._map.get(KEY)).toBe('1');
  });
  it('is a no-op (no throw) when storage.setItem throws', () => {
    const throwing = { setItem: () => { throw new Error('denied'); } };
    expect(() => markSetupComplete(throwing)).not.toThrow();
  });
  it('is a no-op (no throw) for a null storage', () => {
    expect(() => markSetupComplete(null)).not.toThrow();
  });
});

describe('shouldShowGuide', () => {
  it('shows when setup has not been completed', () => {
    expect(shouldShowGuide(fakeStorage())).toBe(true);
  });
  it('does not show once setup is marked complete', () => {
    const s = fakeStorage();
    markSetupComplete(s);
    expect(shouldShowGuide(s)).toBe(false);
  });
});

describe('setupSteps', () => {
  it('always returns exactly 3 steps with the expected keys', () => {
    const steps = setupSteps({ deviceReady: false, trackCount: 0, liveMode: 'monitor' });
    expect(steps).toHaveLength(3);
    expect(steps.map((s) => s.key)).toEqual(['device', 'track', 'start']);
  });

  it('with no device and no tracks: step 1 is active, nothing done', () => {
    const steps = setupSteps({ deviceReady: false, trackCount: 0, liveMode: 'monitor' });
    expect(steps.every((s) => !s.done)).toBe(true);
    expect(steps[0].active).toBe(true);
    expect(steps[1].active).toBe(false);
    expect(steps[2].active).toBe(false);
  });

  it('with a device but no tracks: step 1 done, step 2 active', () => {
    const steps = setupSteps({ deviceReady: true, trackCount: 0, liveMode: 'monitor' });
    expect(steps[0].done).toBe(true);
    expect(steps[1].done).toBe(false);
    expect(steps[1].active).toBe(true);
    expect(steps[0].active).toBe(false);
    expect(steps[2].active).toBe(false);
  });

  it('with a device and tracks: steps 1-2 done, step 3 active', () => {
    const steps = setupSteps({ deviceReady: true, trackCount: 2, liveMode: 'monitor' });
    expect(steps[0].done).toBe(true);
    expect(steps[1].done).toBe(true);
    expect(steps[2].done).toBe(false);
    expect(steps[2].active).toBe(true);
  });

  it('step 3 is never done, even when everything else is ready', () => {
    const steps = setupSteps({ deviceReady: true, trackCount: 5, liveMode: 'record' });
    expect(steps[2].done).toBe(false);
  });

  it('labels step 3 for monitor vs record mode', () => {
    const monitor = setupSteps({ deviceReady: true, trackCount: 1, liveMode: 'monitor' });
    const record = setupSteps({ deviceReady: true, trackCount: 1, liveMode: 'record' });
    expect(monitor[2].label).toBe('Start monitoring');
    expect(record[2].label).toBe('Start recording');
  });

  it('has exactly one active step in every combination', () => {
    const combos = [
      { deviceReady: false, trackCount: 0, liveMode: 'monitor' },
      { deviceReady: true, trackCount: 0, liveMode: 'monitor' },
      { deviceReady: true, trackCount: 3, liveMode: 'record' },
      { deviceReady: false, trackCount: 2, liveMode: 'monitor' },
    ];
    for (const view of combos) {
      const steps = setupSteps(view);
      expect(steps.filter((s) => s.active)).toHaveLength(1);
    }
  });
});

describe('showAdvancedControls', () => {
  it('is false with zero tracks', () => expect(showAdvancedControls(0)).toBe(false));
  it('is true with one track', () => expect(showAdvancedControls(1)).toBe(true));
  it('is true with several tracks', () => expect(showAdvancedControls(3)).toBe(true));
});
