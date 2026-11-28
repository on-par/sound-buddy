// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  CLAUDE_KILL_GRACE_MS,
  CLAUDE_KILL_SETTLE_MS,
  CLAUDE_TIMEOUT_MS,
  LOGIN_FAILURE_PATTERNS,
  MAX_STDERR_CHARS,
  MAX_STDOUT_BYTES,
  claudeArgs,
  claudeChildEnv,
  isLoginFailure,
  resolveClaudeBinary,
  runClaude,
  type ChildLike,
  type ClaudeRunDeps,
  type SpawnLike,
} from './claude-cli';

const FAKE_TOKEN = 'fake-cli-token-not-real-42';
const ENV_NAME = 'CLAUDE_CODE_' + 'OAUTH_TOKEN';
const SKIP_PERMISSIONS = '--dangerously-' + 'skip-permissions';

class FakeStream extends EventEmitter {
  written: string[] = [];
  ended = false;
  write(data: string): void {
    this.written.push(data);
  }
  end(): void {
    this.ended = true;
  }
}

class FakeChild extends EventEmitter implements ChildLike {
  stdin = new FakeStream();
  stdout = new FakeStream();
  stderr = new FakeStream();
  signals: string[] = [];
  closeOnSignal: string | null = 'SIGTERM';
  closes = true;
  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal);
    if (this.closes && (signal === this.closeOnSignal || signal === 'SIGKILL')) queueMicrotask(() => this.emit('close', null, signal));
    return true;
  }
}

interface Recorded {
  command: string;
  args: readonly string[];
  cwd: string;
  env: Record<string, string | undefined>;
  shell: unknown;
}

function fakeTimers() {
  let nextId = 1;
  const pending = new Map<number, { fn: () => void; ms: number }>();
  return {
    pending,
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextId++;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id: unknown) => {
      pending.delete(id as number);
    },
    fire(ms: number) {
      for (const [id, t] of [...pending]) {
        if (t.ms === ms) {
          pending.delete(id);
          t.fn();
        }
      }
    },
  };
}

function setup(child = new FakeChild()) {
  const recorded: Recorded[] = [];
  const made: string[] = [];
  const removed: string[] = [];
  const timers = fakeTimers();
  const spawn: SpawnLike = (command, args, options) => {
    recorded.push({ command, args, cwd: options.cwd, env: options.env, shell: options.shell });
    return child;
  };
  const deps: ClaudeRunDeps = {
    spawn,
    makeTempDir: () => {
      const dir = `/tmp/sb-claude-${made.length}`;
      made.push(dir);
      return dir;
    },
    removeDir: (dir) => removed.push(dir),
    timers,
  };
  return { child, recorded, made, removed, timers, deps };
}

const PARENT_ENV = {
  PATH: '/usr/bin:/bin',
  HOME: '/Users/op',
  ANTHROPIC_API_KEY: 'parent-api-key',
  ANTHROPIC_AUTH_TOKEN: 'parent-auth',
  ANTHROPIC_BASE_URL: 'https://proxy.example',
};

function input(signal = new AbortController().signal) {
  return { binary: '/opt/homebrew/bin/claude', token: FAKE_TOKEN, prompt: 'Why is 02 Vox 1 clipping?', env: PARENT_ENV, model: null, signal };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const UNSETTLED = 'unsettled';
const settledOrNot = <T>(p: Promise<T>) => Promise.race([p, tick().then(() => UNSETTLED)]);
const MIN_FRAGMENT = 8;
const STDERR_CHUNK = 1000;

function leakedFragments(text: string, token: string): string[] {
  const found: string[] = [];
  for (let i = 0; i + MIN_FRAGMENT <= token.length; i += 1) {
    const fragment = token.slice(i, i + MIN_FRAGMENT);
    if (text.includes(fragment)) found.push(fragment);
  }
  return found;
}

function straddlingStderr(token: string, offset: number): string[] {
  return [
    'e'.repeat(MAX_STDERR_CHARS - offset) + token + 'e'.repeat(MAX_STDERR_CHARS),
    'e'.repeat(MAX_STDERR_CHARS) + token + 'e'.repeat(MAX_STDERR_CHARS - (token.length - offset)),
  ];
}

function emitInChunks(stream: FakeStream, text: string): void {
  for (let i = 0; i < text.length; i += STDERR_CHUNK) stream.emit('data', Buffer.from(text.slice(i, i + STDERR_CHUNK)));
}

async function failWithStderr(stderr: string, token = FAKE_TOKEN) {
  const s = setup();
  const done = runClaude(s.deps, { ...input(), token });
  emitInChunks(s.child.stderr, stderr);
  s.child.emit('close', 1, null);
  return done;
}

describe('resolveClaudeBinary', () => {
  const exists = (paths: string[]) => (p: string) => paths.includes(p);

  it('uses the Settings path when it is set and executable, ignoring PATH', () => {
    expect(resolveClaudeBinary({ settingPath: '/custom/claude', pathEnv: '/usr/local/bin', homeDir: '/Users/op', isExecutable: exists(['/custom/claude', '/usr/local/bin/claude']) })).toBe('/custom/claude');
  });

  it('reports no binary when the Settings path is set but missing, without falling back', () => {
    expect(resolveClaudeBinary({ settingPath: '/missing/claude', pathEnv: '/usr/local/bin', homeDir: '/Users/op', isExecutable: exists(['/usr/local/bin/claude']) })).toBeNull();
  });

  it('searches PATH in order when no Settings path is set', () => {
    expect(resolveClaudeBinary({ settingPath: '', pathEnv: '/a::/b:/c', homeDir: '/Users/op', isExecutable: exists(['/b/claude', '/c/claude']) })).toBe('/b/claude');
  });

  it('falls back to ~/.local/bin, /opt/homebrew/bin, then /usr/local/bin for a Finder-launched app', () => {
    const home = '/Users/op';
    expect(resolveClaudeBinary({ settingPath: '', pathEnv: undefined, homeDir: home, isExecutable: exists(['/usr/local/bin/claude', '/opt/homebrew/bin/claude', `${home}/.local/bin/claude`]) })).toBe(`${home}/.local/bin/claude`);
    expect(resolveClaudeBinary({ settingPath: '', pathEnv: '/usr/bin:/bin', homeDir: home, isExecutable: exists(['/usr/local/bin/claude', '/opt/homebrew/bin/claude']) })).toBe('/opt/homebrew/bin/claude');
    expect(resolveClaudeBinary({ settingPath: '', pathEnv: '/usr/bin:/bin', homeDir: home, isExecutable: exists(['/usr/local/bin/claude']) })).toBe('/usr/local/bin/claude');
    expect(resolveClaudeBinary({ settingPath: '', pathEnv: '/usr/bin:/bin', homeDir: home, isExecutable: exists([]) })).toBeNull();
  });
});

describe('claudeArgs', () => {
  it('is print mode with text output and an empty tool set, never a permission bypass', () => {
    const args = claudeArgs(null);
    expect(args).toEqual(['-p', '--output-format', 'text', '--tools', '']);
    expect(args.join(' ')).not.toMatch(/permission|bypass|auto/);
    expect(args).not.toContain(SKIP_PERMISSIONS);
  });

  it('adds --model only when a pinned model is set', () => {
    expect(claudeArgs('claude-sonnet-pinned')).toEqual(['-p', '--output-format', 'text', '--tools', '', '--model', 'claude-sonnet-pinned']);
  });
});

describe('claudeChildEnv', () => {
  it('drops the Anthropic key, auth token and base URL, adds the oauth token, and never mutates the parent', () => {
    const parent = { ...PARENT_ENV };
    const env = claudeChildEnv(parent, FAKE_TOKEN);
    expect(Object.keys(env).sort()).toEqual(['HOME', 'PATH', ENV_NAME].sort());
    expect(env[ENV_NAME]).toBe(FAKE_TOKEN);
    expect(parent).toEqual(PARENT_ENV);
  });

  it('drops undefined parent values', () => {
    expect(claudeChildEnv({ A: undefined, B: 'b' }, FAKE_TOKEN)).toEqual({ B: 'b', [ENV_NAME]: FAKE_TOKEN });
  });
});

describe('runClaude with an injected spawn', () => {
  it('spawns the binary with shell false, the fixed argv, a fresh temp cwd and the stripped env; the prompt goes only to stdin', async () => {
    const s = setup();
    const done = runClaude(s.deps, input());
    s.child.stdout.emit('data', Buffer.from('Turn the gain '));
    s.child.stdout.emit('data', Buffer.from('down a little.\n'));
    s.child.emit('close', 0, null);
    expect(await done).toEqual({ ok: true, text: 'Turn the gain down a little.' });
    const [call] = s.recorded;
    expect(call.command).toBe('/opt/homebrew/bin/claude');
    expect(call.shell).toBe(false);
    expect(call.args).toEqual(['-p', '--output-format', 'text', '--tools', '']);
    expect(call.args.join(' ')).not.toContain(FAKE_TOKEN);
    expect(call.args.join(' ')).not.toContain('clipping');
    expect(call.cwd).toBe(s.made[0]);
    expect(Object.keys(call.env).sort()).toEqual(['HOME', 'PATH', ENV_NAME].sort());
    expect(s.child.stdin.written).toEqual(['Why is 02 Vox 1 clipping?']);
    expect(s.child.stdin.ended).toBe(true);
    expect(s.removed).toEqual(s.made);
    expect(s.timers.pending.size).toBe(0);
  });

  it('a non-zero exit returns a sanitized exit reason', async () => {
    const s = setup();
    const done = runClaude(s.deps, input());
    s.child.stderr.emit('data', Buffer.from(`Invalid ${ENV_NAME}=${FAKE_TOKEN} and Bearer abc sk-ant-xyz`));
    s.child.emit('close', 1, null);
    const result = await done;
    expect(result).toMatchObject({ ok: false, reason: 'exit' });
    expect(JSON.stringify(result)).not.toContain(FAKE_TOKEN);
    expect(JSON.stringify(result)).not.toContain('sk-ant-xyz');
    expect(JSON.stringify(result)).not.toContain('abc');
    expect(s.removed).toEqual(s.made);
  });

  it('an empty answer on a zero exit is treated as a failed run', async () => {
    const s = setup();
    const done = runClaude(s.deps, input());
    s.child.stdout.emit('data', '   \n');
    s.child.emit('close', 0, null);
    expect(await done).toMatchObject({ ok: false, reason: 'exit' });
  });

  it('times out at 45 s with SIGTERM, then SIGKILL after the grace period when the child ignores SIGTERM', async () => {
    const child = new FakeChild();
    child.closeOnSignal = null;
    const s = setup(child);
    const done = runClaude(s.deps, input());
    expect([...s.timers.pending.values()].map((t) => t.ms)).toEqual([CLAUDE_TIMEOUT_MS]);
    s.timers.fire(CLAUDE_TIMEOUT_MS);
    expect(child.signals).toEqual(['SIGTERM']);
    s.timers.fire(CLAUDE_KILL_GRACE_MS);
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(await done).toMatchObject({ ok: false, reason: 'timeout' });
    expect(s.removed).toEqual(s.made);
    expect(s.timers.pending.size).toBe(0);
  });

  it('a child that exits on SIGTERM never gets SIGKILL', async () => {
    const s = setup();
    const done = runClaude(s.deps, input());
    s.timers.fire(CLAUDE_TIMEOUT_MS);
    expect(await done).toMatchObject({ ok: false, reason: 'timeout' });
    expect(s.child.signals).toEqual(['SIGTERM']);
    expect(s.timers.pending.size).toBe(0);
  });

  it('cancel kills the child and resolves as cancelled', async () => {
    const s = setup();
    const controller = new AbortController();
    const done = runClaude(s.deps, input(controller.signal));
    controller.abort();
    expect(await done).toMatchObject({ ok: false, reason: 'cancelled' });
    expect(s.child.signals).toEqual(['SIGTERM']);
  });

  it('a timeout after a cancel does not signal twice', async () => {
    const child = new FakeChild();
    child.closeOnSignal = null;
    const s = setup(child);
    const controller = new AbortController();
    const done = runClaude(s.deps, input(controller.signal));
    controller.abort();
    s.timers.fire(CLAUDE_TIMEOUT_MS);
    expect(child.signals).toEqual(['SIGTERM']);
    s.timers.fire(CLAUDE_KILL_GRACE_MS);
    expect(await done).toMatchObject({ ok: false, reason: 'cancelled' });
  });

  it('an already-aborted signal never spawns', async () => {
    const s = setup();
    const controller = new AbortController();
    controller.abort();
    expect(await runClaude(s.deps, input(controller.signal))).toMatchObject({ ok: false, reason: 'cancelled' });
    expect(s.recorded).toEqual([]);
    expect(s.made).toEqual([]);
  });

  it('kills the child when stdout overflows the cap', async () => {
    const s = setup();
    const done = runClaude(s.deps, input());
    s.child.stdout.emit('data', Buffer.alloc(MAX_STDOUT_BYTES, 'a'));
    expect(s.child.signals).toEqual([]);
    s.child.stdout.emit('data', Buffer.from('b'));
    expect(s.child.signals).toEqual(['SIGTERM']);
    s.child.stdout.emit('data', Buffer.from('more after kill'));
    expect(await done).toMatchObject({ ok: false, reason: 'overflow' });
  });

  it('a spawn error event resolves as spawn-error with a sanitized detail', async () => {
    const s = setup();
    const done = runClaude(s.deps, input());
    s.child.emit('error', new Error(`spawn EACCES ${FAKE_TOKEN}`));
    s.child.emit('close', null, null);
    const result = await done;
    expect(result).toMatchObject({ ok: false, reason: 'spawn-error' });
    expect(JSON.stringify(result)).not.toContain(FAKE_TOKEN);
    expect(s.removed).toEqual(s.made);
  });

  it('a synchronous spawn throw resolves as spawn-error and removes the temp dir', async () => {
    const s = setup();
    s.deps.spawn = () => {
      throw new Error('ENOENT');
    };
    expect(await runClaude(s.deps, input())).toMatchObject({ ok: false, reason: 'spawn-error', detail: 'Error: ENOENT' });
    expect(s.removed).toEqual(s.made);
  });

  it('stderr is capped and a stdin pipe error is swallowed', async () => {
    const s = setup();
    const done = runClaude(s.deps, input());
    s.child.stdin.emit('error', new Error('EPIPE'));
    s.child.stderr.emit('data', 'e'.repeat(100_000));
    s.child.emit('close', 2, null);
    const result = await done;
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.detail.length).toBeLessThan(500);
    await tick();
  });
});

describe('runClaude stderr redaction window', () => {
  it('a token straddling the stderr cut at any offset leaves no 8-char fragment in the detail', async () => {
    for (let offset = 1; offset < FAKE_TOKEN.length; offset += 1) {
      for (const stderr of straddlingStderr(FAKE_TOKEN, offset)) {
        expect(stderr.length).toBeGreaterThan(MAX_STDERR_CHARS);
        const result = await failWithStderr(stderr);
        expect(result).toMatchObject({ ok: false, reason: 'exit' });
        expect(leakedFragments(result.ok ? '' : result.detail, FAKE_TOKEN)).toEqual([]);
      }
    }
  });

  it('a long token repeated past the cut, which redaction shrinks below the sanitize cap, leaves no fragment', async () => {
    const longToken = Array.from({ length: 500 }, (_, i) => `k${(i * 7919).toString(36)}`).join('');
    const repeats = Math.ceil((2 * MAX_STDERR_CHARS) / longToken.length);
    for (const lead of [0, 1, MIN_FRAGMENT - 1, 100, longToken.length - 1]) {
      const result = await failWithStderr('e'.repeat(lead) + longToken.repeat(repeats), longToken);
      expect(result).toMatchObject({ ok: false, reason: 'exit' });
      expect(leakedFragments(result.ok ? '' : result.detail, longToken)).toEqual([]);
    }
  });

  it('keeps the start of stderr, where a short error is readable', async () => {
    const result = await failWithStderr(`Error: not logged in. ${'x'.repeat(MAX_STDERR_CHARS * 2)}`);
    expect(result.ok === false && result.detail.startsWith('Error: not logged in.')).toBe(true);
  });
});

describe('runClaude settles after SIGKILL even when close never fires', () => {
  it.each([
    ['timeout', (s: ReturnType<typeof setup>) => s.timers.fire(CLAUDE_TIMEOUT_MS)],
    ['cancelled', (_s: ReturnType<typeof setup>, controller: AbortController) => controller.abort()],
  ] as const)('a child that never closes resolves as %s with its stderr, removes the temp dir and clears every timer', async (reason, trigger) => {
    const child = new FakeChild();
    child.closes = false;
    const s = setup(child);
    const controller = new AbortController();
    const done = runClaude(s.deps, input(controller.signal));
    child.stderr.emit('data', Buffer.from('a grandchild still holds the pipes'));
    trigger(s, controller);
    s.timers.fire(CLAUDE_KILL_GRACE_MS);
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(await settledOrNot(done)).toBe(UNSETTLED);
    s.timers.fire(CLAUDE_KILL_SETTLE_MS);
    expect(await settledOrNot(done)).toEqual({ ok: false, reason, detail: 'a grandchild still holds the pipes' });
    expect(s.removed).toEqual(s.made);
    expect(s.timers.pending.size).toBe(0);
    child.emit('close', null, 'SIGKILL');
    controller.abort();
    await tick();
    expect(s.removed).toEqual(s.made);
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);
  });
});

const LOGIN_PARENT_ENV = { ...PARENT_ENV, [ENV_NAME]: 'inherited-shell-value-not-ours' };
const FAKE_OAT = 'sk-ant-oat01-FAKEfakeFAKEfake0123';
const LOGIN_FAILURE_SAMPLES = [
  'Not logged in · Please run /login',
  'Invalid API key · Please run /login',
  'OAuth token has expired. Please obtain a new token or refresh your existing token.',
  'OAuth token has been revoked',
  'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
  'Error: You are not signed in.',
];
const OTHER_FAILURE_SAMPLES = [
  'Error: connect ECONNREFUSED 127.0.0.1:443',
  'Credit balance is too low',
  'API Error: 500 {"type":"error","error":{"type":"api_error","message":"Internal server error"}}',
  'API Error: 529 Overloaded',
  'Rate limit reached',
];

function loginInput(signal = new AbortController().signal) {
  return { ...input(signal), token: null, env: LOGIN_PARENT_ENV };
}

describe('login failure patterns', () => {
  it('every named pattern matches at least one known Claude Code login failure, and every sample is matched', () => {
    for (const pattern of LOGIN_FAILURE_PATTERNS) expect(LOGIN_FAILURE_SAMPLES.some((sample) => pattern.test(sample))).toBe(true);
    expect(LOGIN_FAILURE_SAMPLES.filter((sample) => !isLoginFailure(sample))).toEqual([]);
  });

  it('ordinary failures (network, credit, server, overload, rate limit) are not login failures', () => {
    expect(OTHER_FAILURE_SAMPLES.filter((sample) => isLoginFailure(sample))).toEqual([]);
  });
});

describe('claudeChildEnv on the login path (no token)', () => {
  it('sets no oauth variable at all, drops an inherited one and the three Anthropic keys, and never mutates the parent', () => {
    const parent = { ...LOGIN_PARENT_ENV };
    const env = claudeChildEnv(parent, null);
    expect(Object.keys(env).sort()).toEqual(['HOME', 'PATH']);
    expect(ENV_NAME in env).toBe(false);
    expect(parent).toEqual(LOGIN_PARENT_ENV);
  });
});

describe('runClaude on the login path (no token)', () => {
  it('logged in: same safe argv, stripped env with no oauth key, prompt only on stdin, answer returned', async () => {
    const s = setup();
    const done = runClaude(s.deps, loginInput());
    s.child.stdout.emit('data', Buffer.from('Pull 02 down two dB.\n'));
    s.child.emit('close', 0, null);
    expect(await done).toEqual({ ok: true, text: 'Pull 02 down two dB.' });
    const [call] = s.recorded;
    expect(call.shell).toBe(false);
    expect(call.args).toEqual(['-p', '--output-format', 'text', '--tools', '']);
    expect(Object.keys(call.env).sort()).toEqual(['HOME', 'PATH']);
    expect(call.cwd).toBe(s.made[0]);
    expect(s.child.stdin.written).toEqual(['Why is 02 Vox 1 clipping?']);
    expect(s.child.stdin.ended).toBe(true);
    expect(s.removed).toEqual(s.made);
    expect(s.timers.pending.size).toBe(0);
  });

  it.each(LOGIN_FAILURE_SAMPLES)('logged out on stderr (%s): not-signed-in, with a redacted detail', async (sample) => {
    const s = setup();
    const done = runClaude(s.deps, loginInput());
    s.child.stderr.emit('data', Buffer.from(`${sample} ${FAKE_OAT} Bearer fakebearer99 ${ENV_NAME}=fakeenv77`));
    s.child.emit('close', 1, null);
    const result = await done;
    expect(result).toMatchObject({ ok: false, reason: 'not-signed-in' });
    const detail = result.ok ? '' : result.detail;
    for (const leak of ['sk-ant-', 'FAKEfake', 'fakebearer99', 'fakeenv77']) expect(detail).not.toContain(leak);
    expect(s.removed).toEqual(s.made);
  });

  it('logged out with the message on stdout only: still not-signed-in, detail taken from stdout and redacted', async () => {
    const s = setup();
    const done = runClaude(s.deps, loginInput());
    s.child.stdout.emit('data', Buffer.from(`Invalid API key · Please run /login ${FAKE_OAT}`));
    s.child.emit('close', 1, null);
    expect(await done).toEqual({ ok: false, reason: 'not-signed-in', detail: 'Invalid API key · Please run /login [redacted]' });
  });

  it('a login message buried past the sanitize cap is still classified', async () => {
    const s = setup();
    const done = runClaude(s.deps, loginInput());
    s.child.stderr.emit('data', Buffer.from(`${'w'.repeat(MAX_STDERR_CHARS / 2)} Not logged in · Please run /login`));
    s.child.emit('close', 1, null);
    expect(await done).toMatchObject({ ok: false, reason: 'not-signed-in' });
  });

  it('a non-login failure stays a plain exit, and a zero exit is never reclassified', async () => {
    const s = setup();
    const done = runClaude(s.deps, loginInput());
    s.child.stderr.emit('data', Buffer.from('Credit balance is too low'));
    s.child.emit('close', 1, null);
    expect(await done).toEqual({ ok: false, reason: 'exit', detail: 'Credit balance is too low' });
    const z = setup();
    const answered = runClaude(z.deps, loginInput());
    z.child.stdout.emit('data', Buffer.from('If the desk says not logged in, check the network.'));
    z.child.emit('close', 0, null);
    expect(await answered).toEqual({ ok: true, text: 'If the desk says not logged in, check the network.' });
  });

  it('the token path never classifies a login failure: it stays exit, exactly as before', async () => {
    const s = setup();
    const done = runClaude(s.deps, input());
    s.child.stderr.emit('data', Buffer.from('Invalid API key · Please run /login'));
    s.child.emit('close', 1, null);
    expect(await done).toEqual({ ok: false, reason: 'exit', detail: 'Invalid API key · Please run /login' });
  });

  it('timeout on the login path keeps the SIGTERM, 2 s SIGKILL grace and 1 s settle', async () => {
    const child = new FakeChild();
    child.closes = false;
    const s = setup(child);
    const done = runClaude(s.deps, loginInput());
    s.timers.fire(CLAUDE_TIMEOUT_MS);
    expect(child.signals).toEqual(['SIGTERM']);
    s.timers.fire(CLAUDE_KILL_GRACE_MS);
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(await settledOrNot(done)).toBe(UNSETTLED);
    s.timers.fire(CLAUDE_KILL_SETTLE_MS);
    expect(await settledOrNot(done)).toEqual({ ok: false, reason: 'timeout', detail: '' });
    expect(s.removed).toEqual(s.made);
  });
});
