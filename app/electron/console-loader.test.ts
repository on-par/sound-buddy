// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp/sound-buddy-test' },
}));

import { consoleModuleDir, loadConsoleModule } from './console-loader';
import { bundledResourceDir } from './bundled-cjs-loader';

describe('consoleModuleDir', () => {
  it('delegates to bundledResourceDir("console")', () => {
    expect(consoleModuleDir()).toBe(bundledResourceDir('console'));
  });
});

describe('loadConsoleModule', () => {
  it('loads real callable OSC helpers from the compiled CJS build', () => {
    const mod = loadConsoleModule();
    expect(typeof mod.encodeOscMessage).toBe('function');
    expect(typeof mod.decodeOscMessage).toBe('function');
    expect(typeof mod.parseChannelStrips).toBe('function');
  });

  it('memoizes — returns the same object identity on a second call', () => {
    const first = loadConsoleModule();
    const second = loadConsoleModule();
    expect(second).toBe(first);
  });
});

describe('packaged console runtime imports', () => {
  it('routes runtime console imports through console-loader, not excluded node_modules', () => {
    const appRoot = path.resolve(__dirname, '..');
    const offenders: string[] = [];

    function walk(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['dist', 'release', 'node_modules', 'coverage', 'test-results'].includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;

        const text = fs.readFileSync(full, 'utf8');
        if (/\bimport\s+(?!type\b)[^;]+from\s+['"]@sound-buddy\/console\/dist-cjs/.test(text)) {
          offenders.push(path.relative(appRoot, full));
        }
      }
    }

    walk(path.join(appRoot, 'electron'));
    expect(offenders, `runtime console imports bypass console-loader: ${offenders.join(', ')}`).toEqual([]);
  });
});
