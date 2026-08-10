// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Loads the @sound-buddy/scene-inspector module (#264) — the M32R .scn scene
// parser/diff already used by the `buddy` CLI. The package ships as ESM, but
// the app's main process compiles CommonJS (see app/tsconfig.json) and the
// packaged .app ships zero node_modules, so a normal ESM import or a `file:`
// dependency is out. Instead the package gains a second, CJS-only build
// (packages/scene-inspector/dist-cjs — see that package's tsconfig.cjs.json),
// loaded here via loadBundledCjs('scene-inspector'), mirroring
// ./license-policy-loader.ts and ./ipc/engine-loader.ts.

import { bundledResourceDir, loadBundledCjs } from './bundled-cjs-loader';

type SceneInspectorModule = typeof import('../../packages/scene-inspector/dist-cjs/index');

export function sceneInspectorDir(): string {
  return bundledResourceDir('scene-inspector');
}

export function loadSceneInspector(): SceneInspectorModule {
  return loadBundledCjs<SceneInspectorModule>('scene-inspector');
}
