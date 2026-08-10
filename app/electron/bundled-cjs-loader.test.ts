// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

// Same packaged-shape electron mock as scene-inspector-loader.test.ts /
// ipc/engine-loader.test.ts: mock Electron in the packaged shape and point
// resourcesPath at the real scene-inspector package directory (which has no
// `scene-inspector/` subdir on disk — only the packaged .app's extraResources
// step creates one) so bundledResourceDir('scene-inspector') exercises its
// dev fallback and loadBundledCjs('scene-inspector') loads the REAL,
// just-built dist-cjs output from disk — reused here as the concrete fixture
// since it's the smallest of the three real dist-cjs builds.
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
import { bundledResourceDir, loadBundledCjs } from './bundled-cjs-loader';
import { REPO_ROOT, APP_ROOT } from './ipc/shared';

describe('bundledResourceDir', () => {
  it('falls back to the dist-cjs build when the mocked packaged resourcesPath has no scene-inspector/ subdir', () => {
    expect(bundledResourceDir('scene-inspector')).toBe(
      path.join(REPO_ROOT, 'packages', 'scene-inspector', 'dist-cjs'),
    );
  });

  it('prefers the bundled subdir when the mocked packaged resourcesPath has one — the real production return path', () => {
    const fakeResourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-bundled-cjs-loader-bundled-'));
    fs.mkdirSync(path.join(fakeResourcesPath, 'scene-inspector'));
    const original = process.resourcesPath;
    (process as { resourcesPath?: string }).resourcesPath = fakeResourcesPath;
    try {
      expect(bundledResourceDir('scene-inspector')).toBe(path.join(fakeResourcesPath, 'scene-inspector'));
    } finally {
      (process as { resourcesPath?: string }).resourcesPath = original;
    }
  });

  it('never checks resourcesPath when unpackaged — always the dev fallback, even if a bundled dir happens to exist', () => {
    const fakeResourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-bundled-cjs-loader-dev-'));
    fs.mkdirSync(path.join(fakeResourcesPath, 'scene-inspector'));
    const originalResourcesPath = process.resourcesPath;
    const originalIsPackaged = app.isPackaged;
    (process as { resourcesPath?: string }).resourcesPath = fakeResourcesPath;
    (app as { isPackaged: boolean }).isPackaged = false;
    try {
      expect(bundledResourceDir('scene-inspector')).toBe(
        path.join(REPO_ROOT, 'packages', 'scene-inspector', 'dist-cjs'),
      );
    } finally {
      (process as { resourcesPath?: string }).resourcesPath = originalResourcesPath;
      (app as { isPackaged: boolean }).isPackaged = originalIsPackaged;
    }
  });

  it('throws for a resource with no dev-mode fallback (e.g. "bin") when unpackaged', () => {
    const originalIsPackaged = app.isPackaged;
    (app as { isPackaged: boolean }).isPackaged = false;
    try {
      expect(() => bundledResourceDir('bin')).toThrow(
        /"bin" has no dev-mode fallback and no bundled Resources\/bin directory was found/,
      );
    } finally {
      (app as { isPackaged: boolean }).isPackaged = originalIsPackaged;
    }
  });

  it('resolves an appRoot-based dev dir (e.g. "assets") against APP_ROOT rather than REPO_ROOT', () => {
    const originalIsPackaged = app.isPackaged;
    (app as { isPackaged: boolean }).isPackaged = false;
    try {
      expect(bundledResourceDir('assets')).toBe(path.join(APP_ROOT, 'assets'));
    } finally {
      (app as { isPackaged: boolean }).isPackaged = originalIsPackaged;
    }
  });
});

describe('loadBundledCjs', () => {
  // Must run before any successful loadBundledCjs('scene-inspector') call
  // below — a success memoizes into the module-level cache, and a cache hit
  // would short-circuit this test before it ever re-resolves the (now-broken)
  // resource dir.
  it('throws an actionable rebuild error when the resolved dir has no index.js (e.g. a stale or missing dist-cjs build)', () => {
    const fakeResourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-bundled-cjs-loader-missing-'));
    fs.mkdirSync(path.join(fakeResourcesPath, 'scene-inspector'));
    const original = process.resourcesPath;
    (process as { resourcesPath?: string }).resourcesPath = fakeResourcesPath;
    try {
      expect(() => loadBundledCjs('scene-inspector')).toThrow(/scene-inspector not found at .*npm run build/);
    } finally {
      (process as { resourcesPath?: string }).resourcesPath = original;
    }
  });

  it('loads real callable parseScene/diffScenes functions from the compiled CJS build', () => {
    const mod = loadBundledCjs<typeof import('../../packages/scene-inspector/dist-cjs/index')>('scene-inspector');
    expect(typeof mod.parseScene).toBe('function');
    expect(typeof mod.diffScenes).toBe('function');
  });

  it('memoizes — returns the same object identity on a second call with the same (resourceName, entryRelPath)', () => {
    const first = loadBundledCjs('scene-inspector');
    const second = loadBundledCjs('scene-inspector');
    expect(second).toBe(first);
  });

  it('falls back to the resolved dir (not devDir) in the rebuild error for a resource with no dev-mode devDir (e.g. a packaged "bin" with no index.js)', () => {
    const originalIsPackaged = app.isPackaged;
    (app as { isPackaged: boolean }).isPackaged = true;
    const fakeResourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-bundled-cjs-loader-bin-'));
    fs.mkdirSync(path.join(fakeResourcesPath, 'bin'));
    const original = process.resourcesPath;
    (process as { resourcesPath?: string }).resourcesPath = fakeResourcesPath;
    try {
      const binDir = path.join(fakeResourcesPath, 'bin');
      let thrown: unknown;
      try {
        loadBundledCjs('bin');
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toContain(`bin not found at ${binDir}`);
      expect((thrown as Error).message).toContain(`builds ${binDir}`);
    } finally {
      (process as { resourcesPath?: string }).resourcesPath = original;
      (app as { isPackaged: boolean }).isPackaged = originalIsPackaged;
    }
  });
});
