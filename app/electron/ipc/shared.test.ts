// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp/sound-buddy-test' },
}));

import { REPO_ROOT, findRepoRoot } from './shared';

describe('findRepoRoot', () => {
  it('walks up from a nested source directory to find the repo containing packages/audio-engine', () => {
    // This test file itself lives well below the repo root — same shape as
    // the real __dirname findRepoRoot resolves at import time (`app/electron/ipc`
    // under Vitest, `app/dist/electron/ipc` in the compiled program).
    const found = findRepoRoot(__dirname);
    expect(fs.existsSync(path.join(found, 'packages', 'audio-engine'))).toBe(true);
  });

  it('falls back to the starting directory when no ancestor has packages/audio-engine', () => {
    const start = path.join(path.parse(__dirname).root, 'definitely-not-a-real-sound-buddy-checkout');
    expect(findRepoRoot(start)).toBe(start);
  });
});

describe('REPO_ROOT', () => {
  it('resolves to the actual repo root regardless of whether this runs from TS source or compiled dist', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'packages', 'audio-engine'))).toBe(true);
    expect(fs.existsSync(path.join(REPO_ROOT, 'app'))).toBe(true);
  });
});
