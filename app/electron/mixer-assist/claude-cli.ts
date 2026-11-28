// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import * as path from 'path';
import { redact, sanitize } from './sanitize';

export const CLAUDE_TIMEOUT_MS = 45_000;
export const CLAUDE_KILL_GRACE_MS = 2_000;
export const CLAUDE_KILL_SETTLE_MS = 1_000;
export const MAX_STDOUT_BYTES = 64 * 1024;
export const MAX_STDERR_CHARS = 8 * 1024;
export const PINNED_CLAUDE_MODEL: string | null = null;
export const CLAUDE_BINARY_NAME = 'claude';
export const CLAUDE_FALLBACK_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'] as const;
export const HOME_FALLBACK_DIR = path.join('.local', 'bin');
export const STRIPPED_ENV_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL'] as const;
const OAUTH_ENV_KEY = 'CLAUDE_CODE_OAUTH_TOKEN';
const EMPTY_ANSWER_DETAIL = 'Claude Code returned an empty answer.';
export const LOGIN_FAILURE_PATTERNS: readonly RegExp[] = [
  /\bnot\s+(?:logged|signed)\s+in\b/i,
  /\bplease\s+run\s+\/login\b/i,
  /\binvalid\s+api\s+key\b/i,
  /\boauth\s+token\s+(?:has\s+)?(?:expired|been\s+revoked)\b/i,
  /\bauthentication_error\b/,
  /\bAPI\s+Error:\s*401\b/i,
];

export interface ChildLike {
  stdin: { write(data: string): unknown; end(): unknown; on(event: 'error', listener: (err: Error) => void): unknown };
  stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown };
  stderr: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown };
  on(event: 'close', listener: (code: number | null) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  kill(signal: NodeJS.Signals): boolean;
}

export interface SpawnOptionsLike {
  cwd: string;
  env: Record<string, string>;
  shell: false;
  stdio: ['pipe', 'pipe', 'pipe'];
}

export type SpawnLike = (command: string, args: readonly string[], options: SpawnOptionsLike) => ChildLike;

export interface TimersLike {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ClaudeRunDeps {
  spawn: SpawnLike;
  makeTempDir(): string;
  removeDir(dir: string): void;
  timers: TimersLike;
}

export type ClaudeFailure = 'exit' | 'not-signed-in' | 'timeout' | 'overflow' | 'spawn-error' | 'cancelled';

export type ClaudeRunResult = { ok: true; text: string } | { ok: false; reason: ClaudeFailure; detail: string };

export interface ClaudeRunInput {
  binary: string;
  token: string | null;
  prompt: string;
  env: Readonly<Record<string, string | undefined>>;
  model: string | null;
  signal: AbortSignal;
}

export function resolveClaudeBinary(input: {
  settingPath: string;
  pathEnv: string | undefined;
  homeDir: string;
  isExecutable(file: string): boolean;
}): string | null {
  if (input.settingPath !== '') return input.isExecutable(input.settingPath) ? input.settingPath : null;
  const searchDirs = [
    ...(input.pathEnv ?? '').split(':').filter((d) => d !== ''),
    path.join(input.homeDir, HOME_FALLBACK_DIR),
    ...CLAUDE_FALLBACK_DIRS,
  ];
  for (const dir of searchDirs) {
    const candidate = path.join(dir, CLAUDE_BINARY_NAME);
    if (input.isExecutable(candidate)) return candidate;
  }
  return null;
}

export function claudeArgs(model: string | null): string[] {
  const args = ['-p', '--output-format', 'text', '--tools', ''];
  return model === null ? args : [...args, '--model', model];
}

export function isLoginFailure(text: string): boolean {
  return LOGIN_FAILURE_PATTERNS.some((pattern) => pattern.test(text));
}

export function claudeChildEnv(parent: Readonly<Record<string, string | undefined>>, token: string | null): Record<string, string> {
  const stripped = new Set<string>(token === null ? [...STRIPPED_ENV_KEYS, OAUTH_ENV_KEY] : STRIPPED_ENV_KEYS);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(parent)) {
    if (value !== undefined && !stripped.has(key)) env[key] = value;
  }
  if (token !== null) env[OAUTH_ENV_KEY] = token;
  return env;
}

function withoutTrailingSecretHead(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets.map((s) => s.trim())) {
    for (let k = Math.min(secret.length - 1, out.length); k > 0; k -= 1) {
      if (out.endsWith(secret.slice(0, k))) {
        out = out.slice(0, out.length - k);
        break;
      }
    }
  }
  return out;
}

export function runClaude(deps: ClaudeRunDeps, input: ClaudeRunInput): Promise<ClaudeRunResult> {
  if (input.signal.aborted) return Promise.resolve({ ok: false, reason: 'cancelled', detail: '' });
  const cwd = deps.makeTempDir();
  const secrets = input.token === null ? [] : [input.token];
  return new Promise((resolve) => {
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = '';
    let failure: ClaudeFailure | null = null;
    let settled = false;
    let timeoutTimer: unknown = null;
    let killTimer: unknown = null;
    let settleTimer: unknown = null;

    const finish = (result: ClaudeRunResult) => {
      if (settled) return;
      settled = true;
      deps.timers.clearTimeout(timeoutTimer);
      deps.timers.clearTimeout(killTimer);
      deps.timers.clearTimeout(settleTimer);
      input.signal.removeEventListener('abort', onAbort);
      deps.removeDir(cwd);
      resolve(result);
    };

    let child: ChildLike;
    try {
      child = deps.spawn(input.binary, claudeArgs(input.model), {
        cwd,
        env: claudeChildEnv(input.env, input.token),
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      finish({ ok: false, reason: 'spawn-error', detail: sanitize(err, secrets) });
      return;
    }

    const fail = (reason: ClaudeFailure, source = stderr) =>
      finish({ ok: false, reason, detail: sanitize(withoutTrailingSecretHead(source, secrets), secrets) });
    const stop = (reason: ClaudeFailure) => {
      if (failure !== null) return;
      failure = reason;
      child.kill('SIGTERM');
      killTimer = deps.timers.setTimeout(() => {
        child.kill('SIGKILL');
        settleTimer = deps.timers.setTimeout(() => fail(reason), CLAUDE_KILL_SETTLE_MS);
      }, CLAUDE_KILL_GRACE_MS);
    };
    function onAbort() {
      stop('cancelled');
    }

    timeoutTimer = deps.timers.setTimeout(() => stop('timeout'), CLAUDE_TIMEOUT_MS);
    input.signal.addEventListener('abort', onAbort);

    child.stdout.on('data', (chunk) => {
      if (failure !== null) return;
      const bytes = Buffer.from(chunk);
      stdoutBytes += bytes.length;
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        stop('overflow');
        return;
      }
      stdout.push(bytes);
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < MAX_STDERR_CHARS) stderr = `${stderr}${String(chunk)}`.slice(0, MAX_STDERR_CHARS);
    });
    child.stdin.on('error', () => undefined);
    child.on('error', (err) => finish({ ok: false, reason: 'spawn-error', detail: sanitize(err, secrets) }));
    child.on('close', (code) => {
      if (failure !== null) {
        fail(failure);
        return;
      }
      const output = Buffer.concat(stdout).toString('utf8');
      if (code !== 0) {
        if (input.token === null && isLoginFailure(redact(`${stderr}\n${output}`))) fail('not-signed-in', stderr.trim() === '' ? output : stderr);
        else fail('exit');
        return;
      }
      const text = output.trim();
      finish(text === '' ? { ok: false, reason: 'exit', detail: EMPTY_ANSWER_DETAIL } : { ok: true, text });
    });

    child.stdin.write(input.prompt);
    child.stdin.end();
  });
}
