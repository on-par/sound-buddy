// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import type { Scene, SceneDiff } from '@sound-buddy/shared';
import { computeSceneDiff, topSceneChanges, SCENE_FILE_EXTENSION, TOP_SCENE_CHANGES } from './scene-diff';

function makeScene(overrides: Partial<Scene> = {}): Scene {
  return { name: 'Sunday AM', version: '4.0', channels: [], dcas: [], ...overrides };
}

function fakeDeps(overrides: Partial<{
  readFile(path: string): string;
  fileExists(path: string): boolean;
  parseScene(content: string): Scene;
  diffScenes(a: Scene, b: Scene): SceneDiff;
}> = {}) {
  return {
    readFile: vi.fn((p: string) => `contents of ${p}`),
    fileExists: vi.fn(() => true),
    parseScene: vi.fn((content: string) => makeScene({ name: content })),
    diffScenes: vi.fn(
      (): SceneDiff => ({
        changes: [{ path: 'channels[0].mix.on', label: 'Kick — mute', from: true, to: false }],
        summary: '1 change found',
        bySection: { channels: [], dcas: [], main: [] },
      }),
    ),
    ...overrides,
  };
}

describe('computeSceneDiff', () => {
  it('returns ok:true with the diff and scene names on the happy path', () => {
    const deps = fakeDeps();

    const result = computeSceneDiff('/scenes/before.scn', '/scenes/after.scn', deps);

    expect(result).toEqual({
      ok: true,
      diff: {
        changes: [{ path: 'channels[0].mix.on', label: 'Kick — mute', from: true, to: false }],
        summary: '1 change found',
        bySection: { channels: [], dcas: [], main: [] },
      },
      nameA: 'contents of /scenes/before.scn',
      nameB: 'contents of /scenes/after.scn',
    });
    expect(deps.diffScenes).toHaveBeenCalledWith(
      makeScene({ name: 'contents of /scenes/before.scn' }),
      makeScene({ name: 'contents of /scenes/after.scn' }),
    );
  });

  it('rejects a non-.scn extension and names the offending file', () => {
    const deps = fakeDeps();

    const result = computeSceneDiff('/scenes/before.txt', '/scenes/after.scn', deps);

    expect(result).toEqual({
      ok: false,
      error: "before.txt isn't a scene file. Drop a .scn file exported from your M32R console.",
    });
    expect(deps.fileExists).not.toHaveBeenCalled();
  });

  it('rejects a non-.scn second file even when the first is valid', () => {
    const deps = fakeDeps();

    const result = computeSceneDiff('/scenes/before.scn', '/scenes/after.txt', deps);

    expect(result).toEqual({
      ok: false,
      error: "after.txt isn't a scene file. Drop a .scn file exported from your M32R console.",
    });
  });

  it('falls back to the full path when basename extraction yields an empty string (e.g. a path ending in a separator)', () => {
    const deps = fakeDeps();

    const result = computeSceneDiff('/scenes/', '/scenes/after.scn', deps);

    expect(result).toEqual({
      ok: false,
      error: "/scenes/ isn't a scene file. Drop a .scn file exported from your M32R console.",
    });
  });

  it('accepts a .SCN extension case-insensitively', () => {
    const deps = fakeDeps();

    const result = computeSceneDiff('/scenes/before.SCN', '/scenes/after.scn', deps);

    expect(result.ok).toBe(true);
  });

  it('reports a missing file with an actionable message', () => {
    const deps = fakeDeps({ fileExists: vi.fn((p: string) => p !== '/scenes/before.scn') });

    const result = computeSceneDiff('/scenes/before.scn', '/scenes/after.scn', deps);

    expect(result).toEqual({
      ok: false,
      error: "Couldn't find before.scn. Move the file somewhere Sound Buddy can read it and drop it again.",
    });
  });

  it('reports a readFile failure with an actionable message', () => {
    const deps = fakeDeps({
      readFile: vi.fn((p: string) => {
        if (p === '/scenes/after.scn') throw new Error('EACCES');
        return 'contents';
      }),
    });

    const result = computeSceneDiff('/scenes/before.scn', '/scenes/after.scn', deps);

    expect(result).toEqual({
      ok: false,
      error: "Couldn't read after.scn. Check the file isn't open in another program and try again.",
    });
  });

  it('absorbs a parseScene ParseError-style throw into an actionable message, not the raw thrown text', () => {
    const deps = fakeDeps({
      parseScene: vi.fn((content: string) => {
        if (content.includes('after')) throw new Error('not a valid M32R scene file');
        return makeScene();
      }),
    });

    const result = computeSceneDiff('/scenes/before.scn', '/scenes/after.scn', deps);

    expect(result).toEqual({
      ok: false,
      error:
        "after.scn isn't a valid M32R scene file. Export a fresh scene from the console (Setup → Scenes → Export) and try again.",
    });
  });

  it('absorbs the empty-file TypeError from the package into the same actionable message — regression guard', () => {
    const deps = fakeDeps({
      parseScene: vi.fn((content: string) => {
        if (content === '') throw new TypeError("Cannot read properties of undefined (reading 'match')");
        return makeScene();
      }),
      readFile: vi.fn((p: string) => (p === '/scenes/before.scn' ? '' : 'contents')),
    });

    const result = computeSceneDiff('/scenes/before.scn', '/scenes/after.scn', deps);

    expect(result).toEqual({
      ok: false,
      error:
        "before.scn isn't a valid M32R scene file. Export a fresh scene from the console (Setup → Scenes → Export) and try again.",
    });
  });
});

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
  it('SCENE_FILE_EXTENSION is .scn', () => {
    expect(SCENE_FILE_EXTENSION).toBe('.scn');
  });

  it('TOP_SCENE_CHANGES is 3', () => {
    expect(TOP_SCENE_CHANGES).toBe(3);
  });
});
