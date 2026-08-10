// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import { fileURLToPath } from 'node:url';

// Same packaged-shape electron mock as bundled-cjs-loader.test.ts: mock
// Electron in the packaged shape and point resourcesPath at the real
// scene-inspector package directory (which has no `scene-inspector/` subdir
// on disk — only the packaged .app's extraResources step creates one) so
// sceneInspectorDir() exercises its dev fallback and loadSceneInspector()
// loads the REAL, just-built dist-cjs output from disk.
vi.mock('electron', () => {
  const p = require('node:path') as typeof import('node:path');
  const os = require('node:os') as typeof import('node:os');
  const __filename2 = fileURLToPath(import.meta.url);
  const __dirname2 = p.dirname(__filename2);
  (process as { resourcesPath?: string }).resourcesPath = p.resolve(
    __dirname2,
    '..',
    '..',
    'packages',
    'scene-inspector',
  );
  return {
    app: {
      isPackaged: true,
      getPath: () => os.tmpdir(),
      setName: () => {},
      getName: () => 'sound-buddy-test',
    },
    ipcMain: { handle: () => {} },
    dialog: {},
    BrowserWindow: class {},
    systemPreferences: {},
    shell: {},
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => '',
    },
  };
});

import { sceneInspectorDir, loadSceneInspector } from './scene-inspector-loader';
import { bundledResourceDir } from './bundled-cjs-loader';

describe('sceneInspectorDir', () => {
  it('delegates to bundledResourceDir("scene-inspector")', () => {
    expect(sceneInspectorDir()).toBe(bundledResourceDir('scene-inspector'));
  });
});

describe('loadSceneInspector', () => {
  it('loads real callable parseScene/diffScenes functions from the compiled CJS build', () => {
    const mod = loadSceneInspector();
    expect(typeof mod.parseScene).toBe('function');
    expect(typeof mod.diffScenes).toBe('function');
  });

  it('parseScene from the loaded module parses a real scene header', () => {
    const { parseScene } = loadSceneInspector();
    const scene = parseScene('#4.0# "Sunday AM"');
    expect(scene.name).toBe('Sunday AM');
  });

  it('memoizes — returns the same object identity on a second call', () => {
    const first = loadSceneInspector();
    const second = loadSceneInspector();
    expect(second).toBe(first);
  });
});
