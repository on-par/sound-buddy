// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { EventEmitter } from 'node:events';

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '/tmp/sound-buddy-test' },
}));

import {
  REPO_ROOT,
  findRepoRoot,
  childEnv,
  readNdjsonLines,
  toolBin,
  platformDefaultStorageDir,
  defaultRecordDir,
} from './shared';
import { readNdjsonLines as engineReadNdjsonLines } from '@sound-buddy/audio-engine/dist/ndjson.js';

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

describe('childEnv', () => {
  const LLM_SECRET_VARS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'SOUND_BUDDY_CUSTOM_API_KEY'];

  afterEach(() => {
    for (const v of LLM_SECRET_VARS) delete process.env[v];
  });

  it('strips AI-provider API keys so bundled Python subprocesses never inherit them', () => {
    for (const v of LLM_SECRET_VARS) process.env[v] = 'sk-should-not-leak';
    const env = childEnv();
    for (const v of LLM_SECRET_VARS) expect(env[v]).toBeUndefined();
  });

  it('passes through unrelated env vars unchanged', () => {
    process.env.SOUND_BUDDY_TEST_PASSTHROUGH = 'keep-me';
    expect(childEnv().SOUND_BUDDY_TEST_PASSTHROUGH).toBe('keep-me');
    delete process.env.SOUND_BUDDY_TEST_PASSTHROUGH;
  });
});

describe('toolBin', () => {
  it('falls back to the bare tool name on PATH in dev (unpackaged)', () => {
    expect(toolBin('sox')).toBe('sox');
  });
});

describe('platformDefaultStorageDir', () => {
  it('joins the platform music dir with "Sound Buddy"', () => {
    expect(platformDefaultStorageDir()).toBe(path.join('/tmp/sound-buddy-test', 'Sound Buddy'));
  });
});

describe('defaultRecordDir', () => {
  const settingsFile = () => path.join('/tmp/sound-buddy-test', 'settings.json');

  afterEach(() => {
    fs.rmSync(settingsFile(), { force: true });
  });

  it('falls back to the platform default when no storageDir is configured', () => {
    fs.rmSync(settingsFile(), { force: true });
    expect(defaultRecordDir()).toBe(platformDefaultStorageDir());
  });

  it('uses the configured storageDir override when present', () => {
    fs.mkdirSync('/tmp/sound-buddy-test', { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify({ storageDir: '/tmp/custom-recordings' }));
    expect(defaultRecordDir()).toBe('/tmp/custom-recordings');
  });
});

describe('pythonBin', () => {
  afterEach(() => {
    delete process.env.SOUND_BUDDY_PYTHON;
  });

  it('returns a string interpreter path', async () => {
    vi.resetModules();
    const fresh = await import('./shared');
    expect(typeof fresh.pythonBin()).toBe('string');
    expect(fresh.pythonBin().length).toBeGreaterThan(0);
  });

  it('prefers SOUND_BUDDY_PYTHON when it points at an existing file', async () => {
    const existing = path.join(path.parse(__dirname).root, 'bin', 'sh');
    process.env.SOUND_BUDDY_PYTHON = fs.existsSync(existing) ? existing : __filename;

    vi.resetModules();
    const fresh = await import('./shared');
    expect(fresh.pythonBin()).toBe(process.env.SOUND_BUDDY_PYTHON);
  });

  it('falls back to bare python3 when no candidate exists', async () => {
    process.env.SOUND_BUDDY_PYTHON = '/definitely/not/a/real/path/python3';

    vi.resetModules();
    const fresh = await import('./shared');
    expect(fresh.pythonBin()).toBe('python3');
  });
});

describe('readNdjsonLines', () => {
  const collect = () => {
    const seen: unknown[] = [];
    const em = new EventEmitter();
    readNdjsonLines(em, (d) => seen.push(d));
    return { em, seen };
  };

  it('parses complete newline-terminated lines, including multiple objects per chunk', () => {
    const { em, seen } = collect();
    em.emit('data', Buffer.from('{"a":1}\n{"b":2}\n'));
    expect(seen).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('reassembles a line split across two chunks', () => {
    const { em, seen } = collect();
    em.emit('data', Buffer.from('{"win'));
    em.emit('data', Buffer.from('dow":2}\n'));
    expect(seen).toEqual([{ window: 2 }]);
  });

  it('ignores non-JSON lines', () => {
    const { em, seen } = collect();
    em.emit('data', Buffer.from('garbage\n{"ok":true}\n'));
    expect(seen).toEqual([{ ok: true }]);
  });

  it('skips blank/whitespace-only lines', () => {
    const { em, seen } = collect();
    em.emit('data', Buffer.from('\n   \n{"x":1}\n'));
    expect(seen).toEqual([{ x: 1 }]);
  });

  it('does not deliver a trailing partial line with no newline', () => {
    const { em, seen } = collect();
    em.emit('data', Buffer.from('{"x":1}'));
    expect(seen).toEqual([]);
  });
});

describe('readNdjsonLines drift guard (#279)', () => {
  // The app's copy of readNdjsonLines cannot yet delegate to the engine at
  // runtime (the packaged .app ships zero node_modules — see
  // app/electron/ipc/engine-loader.ts). Until it does, this proves the two
  // hand-maintained copies still behave identically over one fixture chunk
  // sequence covering every documented behavior.
  const CHUNKS = [
    '{"a":1}\n{"b":2}\n',
    '{"win',
    'dow":2}\n',
    '\n   \n',
    'garbage\n',
    '{"x":1}',
  ];
  const EXPECTED = [{ a: 1 }, { b: 2 }, { window: 2 }];

  function run(fn: typeof readNdjsonLines) {
    const seen: unknown[] = [];
    const em = new EventEmitter();
    fn(em, (d) => seen.push(d));
    for (const chunk of CHUNKS) {
      em.emit('data', Buffer.from(chunk));
    }
    return seen;
  }

  it('produces identical results to the audio-engine copy', () => {
    const appResult = run(readNdjsonLines);
    const engineResult = run(engineReadNdjsonLines);

    expect(appResult).toEqual(EXPECTED);
    expect(engineResult).toEqual(EXPECTED);
    expect(appResult).toEqual(engineResult);
  });
});
