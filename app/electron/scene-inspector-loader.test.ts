// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

// Same packaged-shape electron mock as ipc/engine-loader.test.ts: mock
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

import { app } from 'electron';
import { sceneInspectorDir, loadSceneInspector } from './scene-inspector-loader';
import { REPO_ROOT } from './ipc/shared';

describe('sceneInspectorDir', () => {
  it('falls back to the dist-cjs build when the mocked packaged resourcesPath has no scene-inspector/ subdir', () => {
    expect(sceneInspectorDir()).toBe(path.join(REPO_ROOT, 'packages', 'scene-inspector', 'dist-cjs'));
  });

  it('prefers the bundled scene-inspector/ subdir when the packaged resourcesPath has one — the real production return path', () => {
    const fakeResourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-scene-inspector-loader-bundled-'));
    fs.mkdirSync(path.join(fakeResourcesPath, 'scene-inspector'));
    const original = process.resourcesPath;
    (process as { resourcesPath?: string }).resourcesPath = fakeResourcesPath;
    try {
      expect(sceneInspectorDir()).toBe(path.join(fakeResourcesPath, 'scene-inspector'));
    } finally {
      (process as { resourcesPath?: string }).resourcesPath = original;
    }
  });

  it('never checks resourcesPath when unpackaged — always the dist-cjs dev fallback, even if a bundled scene-inspector/ dir happens to exist', () => {
    const fakeResourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-scene-inspector-loader-dev-'));
    fs.mkdirSync(path.join(fakeResourcesPath, 'scene-inspector'));
    const originalResourcesPath = process.resourcesPath;
    const originalIsPackaged = app.isPackaged;
    (process as { resourcesPath?: string }).resourcesPath = fakeResourcesPath;
    (app as { isPackaged: boolean }).isPackaged = false;
    try {
      expect(sceneInspectorDir()).toBe(path.join(REPO_ROOT, 'packages', 'scene-inspector', 'dist-cjs'));
    } finally {
      (process as { resourcesPath?: string }).resourcesPath = originalResourcesPath;
      (app as { isPackaged: boolean }).isPackaged = originalIsPackaged;
    }
  });
});

describe('loadSceneInspector', () => {
  // Must run before any successful loadSceneInspector() call below — a
  // success memoizes into the module-level cache, and a cache hit would
  // short-circuit this test before it ever re-resolves the (now-broken) dir.
  it('throws an actionable rebuild error when the resolved dir has no index.js (e.g. a stale or missing dist-cjs build)', () => {
    const fakeResourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-scene-inspector-loader-missing-'));
    fs.mkdirSync(path.join(fakeResourcesPath, 'scene-inspector'));
    const original = process.resourcesPath;
    (process as { resourcesPath?: string }).resourcesPath = fakeResourcesPath;
    try {
      expect(() => loadSceneInspector()).toThrow(/scene-inspector module not found at .*npm run build/);
    } finally {
      (process as { resourcesPath?: string }).resourcesPath = original;
    }
  });

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
