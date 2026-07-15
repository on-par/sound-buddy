// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Loads the @sound-buddy/license-policy module (TD-006, #400) — the single
// source of the SB1 codec, `kind` rules, and grace-window math shared with
// worker/src/license-sign.ts. The policy package ships as ESM, but the app's
// main process compiles CommonJS (see app/tsconfig.json) and the packaged
// .app ships zero node_modules, so a normal ESM import or a `file:`
// dependency is out. Instead the package gains a second, CJS-only build
// (packages/license-policy/dist-cjs — see that package's tsconfig.cjs.json),
// which this module loads at runtime via createRequire from a path resolved
// packaged-vs-dev, mirroring ./ipc/engine-loader.ts.

import { createRequire } from 'node:module';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { REPO_ROOT } from './ipc/shared';

type Policy = typeof import('../../packages/license-policy/dist-cjs/index');

function licensePolicyDir(): string {
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, 'license-policy');
    if (fs.existsSync(bundled)) return bundled;
  }
  return path.join(REPO_ROOT, 'packages', 'license-policy', 'dist-cjs');
}

let cachedPolicy: Policy | undefined;

/**
 * Load @sound-buddy/license-policy's CJS build. Loaded eagerly at
 * `license.ts` module scope (NOT lazily like engine-loader) because
 * `license.ts` re-exports `GRACE_DAYS`/`DAY_MS` as static values consumed by
 * license-refresh.ts and tests.
 */
export function loadLicensePolicy(): Policy {
  if (cachedPolicy) return cachedPolicy;

  const dir = licensePolicyDir();
  const req = createRequire(__filename);
  try {
    cachedPolicy = req(path.join(dir, 'index.js'));
    return cachedPolicy as Policy;
  } catch (err) {
    throw new Error(
      `license-policy not found at ${dir} — run \`npm run build\` at the repo root first (builds packages/license-policy/dist-cjs)`,
      { cause: err },
    );
  }
}
