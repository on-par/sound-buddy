// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUDE_KILL_GRACE_MS, CLAUDE_KILL_SETTLE_MS, CLAUDE_TIMEOUT_MS, runClaude, type ClaudeRunDeps } from './claude-cli';

const STUB = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'claude');
const FAKE_TOKEN = 'stub-run-fake-token-no-secret';
const FAST_TIMEOUT_MS = 300;
const ROOMY_TIMEOUT_MS = 5_000;
const FAST_GRACE_MS = 300;
const FAST_SETTLE_MS = 300;
const TEST_TIMEOUT_MS = 10_000;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function realDeps(timeoutMs: number) {
  const pids: number[] = [];
  const dirs: string[] = [];
  const deps: ClaudeRunDeps = {
    spawn: (command, args, options) => {
      const child = spawn(command, args, options);
      pids.push(child.pid ?? -1);
      return child;
    },
    makeTempDir: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-claude-stub-'));
      dirs.push(dir);
      return dir;
    },
    removeDir: (dir) => fs.rmSync(dir, { recursive: true, force: true }),
    timers: {
      setTimeout: (fn, ms) => setTimeout(fn, ms === CLAUDE_TIMEOUT_MS ? timeoutMs : ms === CLAUDE_KILL_GRACE_MS ? FAST_GRACE_MS : ms === CLAUDE_KILL_SETTLE_MS ? FAST_SETTLE_MS : ms),
      clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
    },
  };
  return { deps, pids, dirs };
}

function run(mode: string, signal = new AbortController().signal, timeoutMs = ROOMY_TIMEOUT_MS, token: string | null = FAKE_TOKEN, extraEnv: Record<string, string> = {}) {
  const r = realDeps(timeoutMs);
  const done = runClaude(r.deps, {
    binary: STUB,
    token,
    prompt: 'Channel 02 Vox 1 is clipping. What should I check first?',
    env: { PATH: '/usr/bin:/bin', SB_STUB_MODE: mode, ...extraEnv },
    model: null,
    signal,
  });
  return { ...r, done };
}

describe('runClaude against a real stub child named claude', () => {
  it('delivers the prompt on stdin, sees five argv entries, runs in a fresh temp cwd that is removed afterwards', async () => {
    const r = run('echo');
    const result = await r.done;
    expect(result.ok).toBe(true);
    const text = result.ok ? result.text : '';
    expect(text).toContain('Channel 02 Vox 1 is clipping. What should I check first?');
    expect(text).toContain('args=5');
    expect(text).toContain(`cwd=${path.basename(r.dirs[0])}`);
    expect(fs.existsSync(r.dirs[0])).toBe(false);
  }, TEST_TIMEOUT_MS);

  it('a non-zero exit code becomes the exit reason and its stderr is sanitized', async () => {
    const result = await run('exit').done;
    expect(result).toMatchObject({ ok: false, reason: 'exit' });
    expect(result.ok === false && result.detail).toContain('stub refused token [redacted]');
    expect(JSON.stringify(result)).not.toContain(FAKE_TOKEN);
  }, TEST_TIMEOUT_MS);

  it('cancel kills the real child', async () => {
    const controller = new AbortController();
    const r = run('slow', controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(isAlive(r.pids[0])).toBe(true);
    controller.abort();
    expect(await r.done).toMatchObject({ ok: false, reason: 'cancelled' });
    expect(isAlive(r.pids[0])).toBe(false);
  }, TEST_TIMEOUT_MS);

  it('a child that ignores SIGTERM is SIGKILLed after the grace period on timeout', async () => {
    const r = run('stubborn', new AbortController().signal, FAST_TIMEOUT_MS);
    expect(await r.done).toMatchObject({ ok: false, reason: 'timeout' });
    expect(isAlive(r.pids[0])).toBe(false);
    expect(fs.existsSync(r.dirs[0])).toBe(false);
  }, TEST_TIMEOUT_MS);

  it('an endless stdout stream is killed at the cap', async () => {
    const r = run('flood');
    expect(await r.done).toMatchObject({ ok: false, reason: 'overflow' });
    expect(isAlive(r.pids[0])).toBe(false);
  }, TEST_TIMEOUT_MS);

  it('a background grandchild that keeps stdout and stderr open past the kill cannot hang the run', async () => {
    const r = run('orphan', new AbortController().signal, FAST_TIMEOUT_MS);
    const result = await r.done;
    const grandchild = Number(/grandchild=(\d+)/.exec(result.ok ? '' : result.detail)?.[1]);
    try {
      expect(result).toMatchObject({ ok: false, reason: 'timeout' });
      expect(isAlive(r.pids[0])).toBe(false);
      expect(isAlive(grandchild)).toBe(true);
      expect(fs.existsSync(r.dirs[0])).toBe(false);
    } finally {
      if (grandchild > 0 && isAlive(grandchild)) process.kill(grandchild, 'SIGKILL');
    }
  }, TEST_TIMEOUT_MS);
});

describe('runClaude login path (no token) against the real stub child', () => {
  const INHERITED = { ['CLAUDE_CODE_' + 'OAUTH_TOKEN']: 'inherited-not-ours', ANTHROPIC_API_KEY: 'parent-key', HOME: '/Users/op' };

  it('the child sees no oauth variable and no Anthropic key, only the ordinary env', async () => {
    const result = await run('env', new AbortController().signal, ROOMY_TIMEOUT_MS, null, INHERITED).done;
    expect(result).toEqual({ ok: true, text: 'oauth= anthropic= home=set' });
  }, TEST_TIMEOUT_MS);

  it('a logged-out claude exits non-zero and becomes not-signed-in with a redacted detail', async () => {
    const result = await run('logged-out', new AbortController().signal, ROOMY_TIMEOUT_MS, null).done;
    expect(result).toEqual({ ok: false, reason: 'not-signed-in', detail: 'auth probe failed [redacted]\n' });
    expect(JSON.stringify(result)).not.toContain('stubFAKE');
  }, TEST_TIMEOUT_MS);

  it('a child that ignores SIGTERM is still SIGKILLed after the grace period', async () => {
    const r = run('stubborn', new AbortController().signal, FAST_TIMEOUT_MS, null);
    expect(await r.done).toMatchObject({ ok: false, reason: 'timeout' });
    expect(isAlive(r.pids[0])).toBe(false);
    expect(fs.existsSync(r.dirs[0])).toBe(false);
  }, TEST_TIMEOUT_MS);
});
