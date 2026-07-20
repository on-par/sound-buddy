// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import type { SceneDiff } from '@sound-buddy/shared';
import { topSceneChanges, TOP_SCENE_CHANGES } from './scene-diff-format';

describe('topSceneChanges', () => {
  function change(overrides: Partial<{ path: string; label: string; from: unknown; to: unknown }> = {}) {
    return { path: 'channels[0].mix.on', label: 'Kick — mute', from: true, to: false, ...overrides };
  }

  it('caps the result at TOP_SCENE_CHANGES by default', () => {
    const diff: SceneDiff = {
      changes: Array.from({ length: 5 }, (_, i) => change({ label: `ch${i}` })),
      summary: '5 changes found',
      bySection: { channels: [], dcas: [], main: [] },
    };

    const result = topSceneChanges(diff);

    expect(result).toHaveLength(TOP_SCENE_CHANGES);
    expect(result.map((c) => c.label)).toEqual(['ch0', 'ch1', 'ch2']);
  });

  it('respects a custom limit', () => {
    const diff: SceneDiff = {
      changes: Array.from({ length: 5 }, (_, i) => change({ label: `ch${i}` })),
      summary: '5 changes found',
      bySection: { channels: [], dcas: [], main: [] },
    };

    expect(topSceneChanges(diff, 2)).toHaveLength(2);
  });

  it('formats booleans as on/off', () => {
    const diff: SceneDiff = {
      changes: [change({ from: true, to: false })],
      summary: '1 change found',
      bySection: { channels: [], dcas: [], main: [] },
    };

    expect(topSceneChanges(diff)).toEqual([{ label: 'Kick — mute', from: 'on', to: 'off' }]);
  });

  it('formats numbers to one decimal', () => {
    const diff: SceneDiff = {
      changes: [change({ from: -3, to: 2.456 })],
      summary: '1 change found',
      bySection: { channels: [], dcas: [], main: [] },
    };

    expect(topSceneChanges(diff)).toEqual([{ label: 'Kick — mute', from: '-3.0', to: '2.5' }]);
  });

  it('formats undefined and null as an em dash', () => {
    const diff: SceneDiff = {
      changes: [change({ from: undefined, to: null })],
      summary: '1 change found',
      bySection: { channels: [], dcas: [], main: [] },
    };

    expect(topSceneChanges(diff)).toEqual([{ label: 'Kick — mute', from: '—', to: '—' }]);
  });

  it('falls back to String() for other value types', () => {
    const diff: SceneDiff = {
      changes: [change({ from: 'A', to: 'B' })],
      summary: '1 change found',
      bySection: { channels: [], dcas: [], main: [] },
    };

    expect(topSceneChanges(diff)).toEqual([{ label: 'Kick — mute', from: 'A', to: 'B' }]);
  });
});

describe('constants', () => {
  it('TOP_SCENE_CHANGES is 3', () => {
    expect(TOP_SCENE_CHANGES).toBe(3);
  });
});
