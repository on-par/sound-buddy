// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Loads the @sound-buddy/scene-inspector module (#264) — the M32R .scn scene
// parser/diff already used by the `buddy` CLI. The package ships as ESM, but
// the app's main process compiles CommonJS (see app/tsconfig.json) and the
// packaged .app ships zero node_modules, so a normal ESM import or a `file:`
// dependency is out. Instead the package gains a second, CJS-only build
// (packages/scene-inspector/dist-cjs — see that package's tsconfig.cjs.json),
// which this module loads at runtime via createRequire from a path resolved
// packaged-vs-dev, mirroring ./license-policy-loader.ts and ./ipc/engine-loader.ts.

import { createRequire } from 'node:module';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { REPO_ROOT } from './ipc/shared';

type SceneInspectorModule = typeof import('../../packages/scene-inspector/dist-cjs/index');

export function sceneInspectorDir(): string {
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, 'scene-inspector');
    if (fs.existsSync(bundled)) return bundled;
  }
  return path.join(REPO_ROOT, 'packages', 'scene-inspector', 'dist-cjs');
}

let cachedModule: SceneInspectorModule | undefined;

export function loadSceneInspector(): SceneInspectorModule {
  if (cachedModule) return cachedModule;

  const dir = sceneInspectorDir();
  const req = createRequire(__filename);
  try {
    cachedModule = req(path.join(dir, 'index.js'));
    return cachedModule as SceneInspectorModule;
  } catch (err) {
    throw new Error(
      `scene-inspector module not found at ${dir} — run \`npm run build\` at the repo root first (builds packages/scene-inspector/dist-cjs)`,
      { cause: err },
    );
  }
}
