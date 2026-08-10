// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Single implementation of "load a CJS module that ships in a packaged .app's
// Contents/Resources" — collapses the hand-copied packaged-vs-dev directory
// resolution, per-module require caching, and actionable rebuild error that
// used to be duplicated across ipc/engine-loader.ts, license-policy-loader.ts,
// and scene-inspector-loader.ts (#745). Every Contents/Resources subdirectory
// name and its dev-mode fallback lives in resource-layout.json, consumed here
// and by build/afterPack.js and ipc/shared.ts.

import { createRequire } from 'node:module';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { REPO_ROOT, APP_ROOT } from './ipc/shared';
import RESOURCE_LAYOUT from './resource-layout.json';

export type ResourceName = keyof typeof RESOURCE_LAYOUT;

export function bundledResourceDir(resourceName: ResourceName): string {
  const entry = RESOURCE_LAYOUT[resourceName];
  // c8 ignore start -- packaged-app path resolution; vitest always runs unpackaged.
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, entry.resourcesSubdir);
    if (fs.existsSync(bundled)) return bundled;
  }
  // c8 ignore stop
  if (!entry.devDir || !entry.devDirBase) {
    // bin/lib/python have no dev-mode fallback (afterPack.js populates them
    // only inside a packaged build); callers resolve those themselves
    // (toolBin/pythonBin's own PATH/venv search), never through this helper.
    throw new Error(
      `bundledResourceDir: "${resourceName}" has no dev-mode fallback and no bundled Resources/${entry.resourcesSubdir} directory was found`,
    );
  }
  const base = entry.devDirBase === 'appRoot' ? APP_ROOT : REPO_ROOT;
  return path.join(base, entry.devDir);
}

const cache = new Map<string, unknown>();

// Loaded lazily (first call), not at module top, so unrelated app tests that
// merely import a loader don't crash when dist-cjs is stale/missing.
export function loadBundledCjs<T>(resourceName: ResourceName, entryRelPath = 'index.js'): T {
  const cacheKey = `${resourceName}:${entryRelPath}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached as T;

  const dir = bundledResourceDir(resourceName);
  const entry = RESOURCE_LAYOUT[resourceName];
  const req = createRequire(__filename);
  try {
    const mod = req(path.join(dir, entryRelPath)) as T;
    cache.set(cacheKey, mod);
    return mod;
  } catch (err) {
    throw new Error(
      `${resourceName} not found at ${dir} — run \`npm run build\` at the repo root first (builds ${entry.devDir ?? dir})`,
      { cause: err },
    );
  }
}
