// Single source of truth for the non-workspace install roots the root
// unified coverage run depends on (#338), keyed by the vitest project dir
// that needs them. Consumed by vitest.config.ts (to skip projects whose
// roots aren't installed) and scripts/coverage-deps.mjs (to install them).
//
// A root counts as installed only when npm's completion marker
// (node_modules/.package-lock.json, written at the end of a successful
// install) exists — an interrupted `npm ci` leaves node_modules present
// but broken, and a bare existence check would never self-heal.
import { existsSync } from 'node:fs';

const repoRoot = new URL('..', import.meta.url);

export const PROJECT_INSTALL_ROOTS = {
  // app has two install roots: its own devDeps plus renderer/ (react et
  // al., imported by the renderer unit tests since #304).
  app: ['app', 'app/renderer'],
  worker: ['worker'],
};

export const isInstalled = (dir) =>
  existsSync(new URL(`${dir}/node_modules/.package-lock.json`, repoRoot));
