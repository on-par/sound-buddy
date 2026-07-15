// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Guards TD-002 (#396): the app is a declared package consumer of
// @sound-buddy/audio-engine via a `file:` dependency, not a path-hack coupling.
// Checks the dependency is declared in both app/ and app/renderer/ (each has
// its own install root) and that no deep ../../../packages/audio-engine
// relative import specifiers remain in app source.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

describe('app/ declares @sound-buddy/audio-engine as a real dependency', () => {
  it('app/package.json declares the engine via file: dependency', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
    expect(pkg.dependencies['@sound-buddy/audio-engine']).toBe('file:../packages/audio-engine');
  });

  it('app/renderer/package.json declares the engine via file: dependency', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'renderer', 'package.json'), 'utf8'));
    expect(pkg.dependencies['@sound-buddy/audio-engine']).toBe('file:../../packages/audio-engine');
  });

  it('no deep relative imports of packages/audio-engine remain in app source', () => {
    const SKIP_DIRS = new Set([
      'node_modules',
      'dist',
      'dist-cjs',
      'release',
      '.build-cache',
      'coverage',
      'test-results',
    ]);
    const DEEP_IMPORT = /from\s+['"](?:\.\.\/)+packages\/audio-engine|import\(['"](?:\.\.\/)+packages\/audio-engine/;

    function collectSourceFiles(dir: string, exts: RegExp): string[] {
      const out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          out.push(...collectSourceFiles(full, exts));
        } else if (exts.test(entry.name)) {
          out.push(full);
        }
      }
      return out;
    }

    const files = [
      ...collectSourceFiles(path.join(appRoot, 'electron'), /\.ts$/),
      ...collectSourceFiles(path.join(appRoot, 'renderer'), /\.(ts|tsx|js)$/),
    ];

    const offenders = files.filter((file) => DEEP_IMPORT.test(fs.readFileSync(file, 'utf8')));
    expect(offenders, `deep relative audio-engine imports remain: ${offenders.join(', ')}`).toEqual([]);
  });
});
