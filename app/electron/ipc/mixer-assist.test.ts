// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const electronState = vi.hoisted(() => ({
  userData: '',
  handles: new Map<string, (...args: unknown[]) => unknown>(),
  quitHooks: [] as Array<() => void>,
  encryptionAvailable: true,
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => electronState.userData,
    on: (event: string, fn: () => void) => {
      if (event === 'will-quit') electronState.quitHooks.push(fn);
    },
  },
  ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => electronState.handles.set(channel, fn) },
  safeStorage: {
    isEncryptionAvailable: () => electronState.encryptionAvailable,
    encryptString: (plain: string) => Buffer.from(plain, 'utf8').map((b) => b ^ 0x33) as Buffer,
    decryptString: (cipher: Buffer) => Buffer.from(cipher.map((b) => b ^ 0x33)).toString('utf8'),
  },
}));

import { createSecretStore, type SafeStorageLike } from '../mixer-assist/secret-store';
import { CLAUDE_KILL_GRACE_MS, CLAUDE_KILL_SETTLE_MS, CLAUDE_TIMEOUT_MS, MAX_STDERR_CHARS, type ChildLike, type SpawnLike } from '../mixer-assist/claude-cli';
import type { FetchLike } from '../mixer-assist/local-endpoint';
import { ANOMALY_COOLDOWN_MS, MAX_ANOMALY_CALLS_PER_WINDOW } from '../mixer-assist/budget';
import type { MixerAssistRequest } from './api';
import { getSettings, updateSettings } from '../settings';
import {
  MIXER_ASSIST_CHANNELS,
  TOKEN_SAVE_MESSAGES,
  createMixerAssistService,
  defaultMixerAssistDeps,
  registerMixerAssistHandlers,
  type MixerAssistIpcDeps,
} from './mixer-assist';

const FAKE_TOKEN = 'fake-token-value-abcdef-0123456789';

function xorSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(plain, 'utf8').map((b) => b ^ 0x77) as Buffer,
    decryptString: (cipher) => Buffer.from(cipher.map((b) => b ^ 0x77)).toString('utf8'),
  };
}

function readTree(root: string): string {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .map((e) => (e.isDirectory() ? readTree(path.join(root, e.name)) : fs.readFileSync(path.join(root, e.name)).toString('latin1')))
    .join('\n');
}

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
  hangs = false;
  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal);
    if (!this.hangs) queueMicrotask(() => this.emit('close', null));
    return true;
  }
  answer(text: string): void {
    this.stdout.emit('data', Buffer.from(text));
    this.emit('close', 0);
  }
  fail(code: number, stderr: string): void {
    this.stderr.emit('data', Buffer.from(stderr));
    this.emit('close', code);
  }
}

interface SpawnCall {
  command: string;
  args: readonly string[];
  env: Record<string, string>;
  cwd: string;
  shell: unknown;
  child: FakeChild;
}

interface FetchCall {
  url: string;
  body: string;
}

const BINARY = '/Users/op/.local/bin/claude';

interface Harness {
  deps: MixerAssistIpcDeps;
  handles: Map<string, (event: unknown, ...args: unknown[]) => unknown>;
  quit: Array<() => void>;
  logs: string[];
  spawns: SpawnCall[];
  fetches: FetchCall[];
  clock: { now: number };
  fetchReply: { current: (call: FetchCall) => Promise<{ status: number; text(): Promise<string> }> };
}

function harness(overrides: Partial<MixerAssistIpcDeps> = {}): Harness {
  const handles = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const quit: Array<() => void> = [];
  const logs: string[] = [];
  const spawns: SpawnCall[] = [];
  const fetches: FetchCall[] = [];
  const clock = { now: 5_000_000 };
  const fetchReply: Harness['fetchReply'] = { current: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:9')) };
  const spawn: SpawnLike = (command, args, options) => {
    const child = new FakeChild();
    spawns.push({ command, args, env: options.env, cwd: options.cwd, shell: options.shell, child });
    return child;
  };
  const fetch: FetchLike = (url, init) => {
    const call = { url, body: init.body };
    fetches.push(call);
    return fetchReply.current(call);
  };
  const deps: MixerAssistIpcDeps = {
    handle: (channel, fn) => handles.set(channel, fn),
    onQuit: (fn) => quit.push(fn),
    getSettings,
    secrets: createSecretStore({ safeStorage: xorSafeStorage(), fs, dir: electronState.userData }),
    log: (m) => logs.push(m),
    spawn,
    fetch,
    env: { PATH: '/usr/bin:/bin', HOME: '/Users/op', ANTHROPIC_API_KEY: 'parent-key' },
    homeDir: '/Users/op',
    isExecutable: (file) => file === BINARY,
    makeTempDir: () => '/tmp/sb-assist-test',
    removeDir: () => undefined,
    timers: { setTimeout: () => 0, clearTimeout: () => undefined },
    now: () => clock.now,
    cloudLogin: false,
    ...overrides,
  };
  return { deps, handles, quit, logs, spawns, fetches, clock, fetchReply };
}

const QUESTION: MixerAssistRequest = {
  trigger: 'question',
  question: 'Why is Vox 1 flagged?',
  channels: [{ channel: 2, name: 'Vox 1', faderDb: -5, levelDbfs: -0.1, gainReductionDb: null, dynamics: null, diagnosis: 'Input is clipping.' }],
};

function anomalyRequest(channel: number, over: Partial<Extract<MixerAssistRequest, { trigger: 'anomaly' }>> = {}): MixerAssistRequest {
  return {
    trigger: 'anomaly',
    issue: { key: `clipping:${channel}`, kind: 'clipping', severity: 'issue', channel, diagnosis: 'Input is clipping.' },
    sermonQuiet: false,
    channels: [],
    ...over,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const UNSETTLED = 'unsettled';
const settledOrNot = <T>(p: Promise<T>) => Promise.race([p, flush().then(() => UNSETTLED)]);
const MIN_FRAGMENT = 8;

function leakedFragments(text: string, token: string): string[] {
  const found: string[] = [];
  for (let i = 0; i + MIN_FRAGMENT <= token.length; i += 1) {
    const fragment = token.slice(i, i + MIN_FRAGMENT);
    if (text.includes(fragment)) found.push(fragment);
  }
  return found;
}

function recordingTimers() {
  const pending: Array<{ fn: () => void; ms: number }> = [];
  return {
    pending,
    timers: { setTimeout: (fn: () => void, ms: number) => pending.push({ fn, ms }), clearTimeout: () => undefined },
    fire(ms: number) {
      const due = pending.filter((p) => p.ms === ms);
      pending.splice(0, pending.length, ...pending.filter((p) => p.ms !== ms));
      for (const t of due) t.fn();
    },
  };
}

beforeEach(() => {
  electronState.userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-mixer-assist-ipc-'));
  electronState.handles.clear();
  electronState.quitHooks.length = 0;
  electronState.encryptionAvailable = true;
});

afterEach(() => {
  fs.rmSync(electronState.userData, { recursive: true, force: true });
});

describe('ipc/mixer-assist registration', () => {
  it('registers exactly the five mixer-assist channels, in order', () => {
    const h = harness();
    registerMixerAssistHandlers(h.deps);
    expect([...h.handles.keys()]).toEqual([...MIXER_ASSIST_CHANNELS]);
    expect(MIXER_ASSIST_CHANNELS).toEqual([
      'get-mixer-assist-status',
      'set-mixer-assist-token',
      'clear-mixer-assist-token',
      'ask-mixer-assist',
      'cancel-mixer-assist',
    ]);
  });

  it('default deps wire Electron ipcMain, settings and safeStorage under userData, and hook app quit once on the first ask', async () => {
    registerMixerAssistHandlers();
    expect([...electronState.handles.keys()]).toEqual([...MIXER_ASSIST_CHANNELS]);
    expect(electronState.quitHooks).toHaveLength(0);
    await electronState.handles.get('ask-mixer-assist')!(null, { trigger: 'question', question: 'hi', channels: [] });
    await electronState.handles.get('ask-mixer-assist')!(null, { trigger: 'question', question: 'hi', channels: [] });
    expect(electronState.quitHooks).toHaveLength(1);
    const saved = (await electronState.handles.get('set-mixer-assist-token')!(null, FAKE_TOKEN)) as { ok: boolean };
    expect(saved.ok).toBe(true);
    expect(readTree(electronState.userData)).not.toContain(FAKE_TOKEN);
    const deps = defaultMixerAssistDeps();
    expect(deps.secrets.read()).toBe(FAKE_TOKEN);
    expect(deps.getSettings().mixerCloudAssistEnabled).toBe(false);
  });
});

describe('token and status IPC', () => {
  it('status starts with both runtimes off, no token, encryption available, nothing in flight', async () => {
    const h = harness();
    registerMixerAssistHandlers(h.deps);
    const status = await h.handles.get('get-mixer-assist-status')!(null);
    expect(status).toMatchObject({
      cloud: { enabled: false, tokenSaved: false, encryptionAvailable: null, lastFailure: null },
      local: { enabled: false, endpoint: 'unset', modelSet: false, lastFailure: null },
      inFlight: false,
    });
  });

  it('status reflects the toggles and the local endpoint and model settings', async () => {
    updateSettings({
      mixerCloudAssistEnabled: true,
      mixerLocalAssistEnabled: true,
      mixerLocalAssistEndpoint: 'http://192.168.1.20:8080/v1',
      mixerLocalAssistModel: 'qwen2.5',
    });
    const service = createMixerAssistService(harness().deps);
    expect(service.status()).toMatchObject({
      cloud: { enabled: true },
      local: { enabled: true, endpoint: 'ok', modelSet: true },
    });
    updateSettings({ mixerLocalAssistEndpoint: 'https://api.example.com/v1' });
    expect(service.status().local.endpoint).toBe('invalid');
  });

  it('a saved token is absent from settings.json, from every IPC result, and from the stored file plaintext', async () => {
    const h = harness();
    registerMixerAssistHandlers(h.deps);
    updateSettings({ mixerCloudAssistEnabled: true });
    const results: unknown[] = [];
    results.push(await h.handles.get('set-mixer-assist-token')!(null, FAKE_TOKEN));
    results.push(await h.handles.get('get-mixer-assist-status')!(null));
    results.push(await h.handles.get('cancel-mixer-assist')!(null));
    expect(JSON.stringify(results)).not.toContain(FAKE_TOKEN);
    expect(results[0]).toMatchObject({ ok: true, status: { cloud: { tokenSaved: true } } });
    expect(fs.readFileSync(path.join(electronState.userData, 'settings.json'), 'utf8')).not.toContain(FAKE_TOKEN);
    expect(readTree(electronState.userData)).not.toContain(FAKE_TOKEN);
    expect(h.deps.secrets.read()).toBe(FAKE_TOKEN);
    expect(h.logs.join('\n')).not.toContain(FAKE_TOKEN);
    const cleared = await h.handles.get('clear-mixer-assist-token')!(null);
    expect(cleared).toMatchObject({ cloud: { tokenSaved: false } });
    expect(h.deps.secrets.read()).toBeNull();
  });

  it('refuses to save when encryption is unavailable, says so, and stores nothing', async () => {
    const h = harness({ secrets: createSecretStore({ safeStorage: xorSafeStorage(false), fs, dir: electronState.userData }) });
    registerMixerAssistHandlers(h.deps);
    const result = await h.handles.get('set-mixer-assist-token')!(null, FAKE_TOKEN);
    expect(result).toMatchObject({ ok: false, reason: 'no-encryption', message: TOKEN_SAVE_MESSAGES['no-encryption'], status: { cloud: { encryptionAvailable: null, tokenSaved: false } } });
    expect(JSON.stringify(result)).not.toContain(FAKE_TOKEN);
    expect(fs.readdirSync(electronState.userData).filter((f) => f !== 'settings.json')).toEqual([]);
  });

  it('rejects a non-string token payload as empty', async () => {
    const h = harness();
    registerMixerAssistHandlers(h.deps);
    expect(await h.handles.get('set-mixer-assist-token')!(null, { token: FAKE_TOKEN })).toMatchObject({ ok: false, reason: 'empty', message: TOKEN_SAVE_MESSAGES.empty });
  });

  it('every token-save message tells the user what to do', () => {
    for (const message of Object.values(TOKEN_SAVE_MESSAGES)) expect(message).toMatch(/then|Paste|Copy/);
  });
});

describe('keychain hygiene', () => {
  function countingSafeStorage() {
    const counts = { probes: 0, encrypts: 0, decrypts: 0 };
    const base = xorSafeStorage();
    const safe: SafeStorageLike = {
      isEncryptionAvailable: () => {
        counts.probes += 1;
        return true;
      },
      encryptString: (p) => {
        counts.encrypts += 1;
        return base.encryptString(p);
      },
      decryptString: (c) => {
        counts.decrypts += 1;
        return base.decryptString(c);
      },
    };
    return { counts, safe };
  }

  it('never touches safeStorage while Cloud is off, or on without a binary or a saved token', async () => {
    const { counts, safe } = countingSafeStorage();
    const h = harness({ secrets: createSecretStore({ safeStorage: safe, fs, dir: electronState.userData }) });
    registerMixerAssistHandlers(h.deps);
    const status = () => h.handles.get('get-mixer-assist-status')!(null) as { cloud: { encryptionAvailable: boolean | null } };
    const ask = () => h.handles.get('ask-mixer-assist')!(null, QUESTION);
    expect(status().cloud.encryptionAvailable).toBeNull();
    await ask();
    updateSettings({ mixerCloudAssistEnabled: true });
    expect(status().cloud.encryptionAvailable).toBeNull();
    expect(await ask()).toMatchObject({ reason: 'no-token' });
    h.deps.isExecutable = () => false;
    fs.writeFileSync(path.join(electronState.userData, 'mixer-assist-token.bin'), Buffer.from('x'));
    expect(status().cloud.encryptionAvailable).toBeNull();
    expect(await ask()).toMatchObject({ reason: 'no-binary' });
    expect(counts).toEqual({ probes: 0, encrypts: 0, decrypts: 0 });
    h.deps.isExecutable = (file) => file === BINARY;
    expect(status().cloud.encryptionAvailable).toBe(true);
    expect(counts.probes).toBe(1);
  });
});

describe('ask-mixer-assist wiring', () => {
  function service(h: Harness) {
    registerMixerAssistHandlers(h.deps);
    return {
      ask: (req: unknown) => h.handles.get('ask-mixer-assist')!(null, req) as Promise<Record<string, unknown>>,
      cancel: () => h.handles.get('cancel-mixer-assist')!(null),
      status: (recheck?: boolean) => h.handles.get('get-mixer-assist-status')!(null, recheck) as Record<string, Record<string, unknown>>,
    };
  }

  function cloudReady(h: Harness) {
    updateSettings({ mixerCloudAssistEnabled: true });
    h.deps.secrets.save(FAKE_TOKEN);
  }

  it('with both toggles off, the spawn and fetch fakes record nothing for questions, anomalies and status reads', async () => {
    const h = harness();
    const s = service(h);
    h.deps.secrets.save(FAKE_TOKEN);
    updateSettings({ mixerLocalAssistEndpoint: 'http://127.0.0.1:9/v1', mixerLocalAssistModel: 'm' });
    expect(await s.ask(QUESTION)).toEqual({ ok: false, trigger: 'question', issueKey: null, reason: 'disabled', attempts: [] });
    expect(await s.ask(anomalyRequest(2))).toMatchObject({ ok: false, trigger: 'anomaly', issueKey: 'clipping:2', reason: 'disabled' });
    s.status();
    s.cancel();
    expect(h.spawns).toEqual([]);
    expect(h.fetches).toEqual([]);
  });

  it('a malformed request records nothing', async () => {
    const h = harness();
    cloudReady(h);
    expect(await service(h).ask({ trigger: 'timer' })).toMatchObject({ ok: false, reason: 'invalid-request' });
    expect(h.spawns).toEqual([]);
  });

  it('Cloud on and healthy: spawns the user binary once with the prompt on stdin and answers labelled cloud', async () => {
    const h = harness();
    cloudReady(h);
    const s = service(h);
    expect(s.status().cloud).toMatchObject({ enabled: true, binaryFound: true, tokenSaved: true });
    const pending = s.ask(QUESTION);
    await flush();
    expect(s.status().inFlight).toBe(true);
    const [call] = h.spawns;
    expect(call.command).toBe(BINARY);
    expect(call.shell).toBe(false);
    expect(call.args).toEqual(['-p', '--output-format', 'text', '--tools', '']);
    expect(Object.keys(call.env).sort()).toEqual(['CLAUDE_CODE_' + 'OAUTH_TOKEN', 'HOME', 'PATH']);
    expect(call.child.stdin.written.join('')).toContain('Operator question: Why is Vox 1 flagged?');
    expect(call.args.join(' ')).not.toContain('Vox');
    call.child.answer('Lower the trim on 02.');
    expect(await pending).toEqual({ ok: true, trigger: 'question', issueKey: null, source: 'cloud', text: 'Lower the trim on 02.', attempts: [] });
    expect(s.status().inFlight).toBe(false);
    expect(h.fetches).toEqual([]);
  });

  it.each([
    ['no binary', (h: Harness) => (h.deps.isExecutable = () => false), 'no-binary'],
    ['no token', (h: Harness) => h.deps.secrets.clear(), 'no-token'],
    [
      'no encryption',
      (h: Harness) => (h.deps.secrets = createSecretStore({ safeStorage: xorSafeStorage(false), fs, dir: electronState.userData })),
      'no-encryption',
    ],
  ])('Cloud on with %s: typed reason, no spawn, rules fallback', async (_label, breakIt, reason) => {
    const h = harness();
    cloudReady(h);
    breakIt(h);
    const s = service(h);
    expect(await s.ask(QUESTION)).toEqual({ ok: false, trigger: 'question', issueKey: null, reason, attempts: [{ source: 'cloud', reason }] });
    expect(h.spawns).toEqual([]);
    expect(s.status().cloud.lastFailure).toBe(reason);
  });

  it('a non-zero exit is logged sanitized and never with the token or child env', async () => {
    const h = harness();
    cloudReady(h);
    const s = service(h);
    const pending = s.ask(QUESTION);
    await flush();
    h.spawns[0].child.fail(1, `bad ${'CLAUDE_CODE_' + 'OAUTH_TOKEN'}=${FAKE_TOKEN}`);
    expect(await pending).toMatchObject({ ok: false, reason: 'exit', attempts: [{ source: 'cloud', reason: 'exit' }] });
    expect(h.logs.join('\n')).toContain('cloud unavailable (exit)');
    expect(h.logs.join('\n')).not.toContain(FAKE_TOKEN);
    expect(h.logs.join('\n')).not.toContain('PATH');
  });

  it('both on: Cloud first, then Local on Cloud failure, answer labelled local', async () => {
    const h = harness();
    cloudReady(h);
    updateSettings({ mixerLocalAssistEnabled: true, mixerLocalAssistEndpoint: 'http://127.0.0.1:8080/v1', mixerLocalAssistModel: 'qwen2.5' });
    h.fetchReply.current = () => Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content: 'Check the preamp gain.' } }] })) });
    const s = service(h);
    const pending = s.ask(QUESTION);
    await flush();
    h.spawns[0].child.fail(2, 'boom');
    expect(await pending).toEqual({ ok: true, trigger: 'question', issueKey: null, source: 'local', text: 'Check the preamp gain.', attempts: [{ source: 'cloud', reason: 'exit' }] });
    expect(h.fetches.map((f) => f.url)).toEqual(['http://127.0.0.1:8080/v1/chat/completions']);
    expect(JSON.parse(h.fetches[0].body).messages[1].content).toContain('Operator question: Why is Vox 1 flagged?');
  });

  it('Local on and endpoint down: typed reason and lastFailure, which clears when the endpoint changes or on recheck', async () => {
    const h = harness();
    updateSettings({ mixerLocalAssistEnabled: true, mixerLocalAssistEndpoint: 'http://127.0.0.1:9/v1', mixerLocalAssistModel: 'm' });
    const s = service(h);
    expect(await s.ask(QUESTION)).toEqual({ ok: false, trigger: 'question', issueKey: null, reason: 'endpoint-down', attempts: [{ source: 'local', reason: 'endpoint-down' }] });
    expect(h.spawns).toEqual([]);
    expect(s.status().local.lastFailure).toBe('endpoint-down');
    updateSettings({ mixerLocalAssistEndpoint: 'http://127.0.0.1:10/v1' });
    expect(s.status().local.lastFailure).toBeNull();
    updateSettings({ mixerLocalAssistEndpoint: 'http://127.0.0.1:9/v1' });
    await s.ask(QUESTION);
    expect(s.status().local.lastFailure).toBe('endpoint-down');
    expect(s.status(true).local.lastFailure).toBeNull();
  });

  it('a later success clears the Cloud lastFailure', async () => {
    const h = harness();
    cloudReady(h);
    const s = service(h);
    const first = s.ask(QUESTION);
    await flush();
    h.spawns[0].child.fail(1, 'x');
    await first;
    expect(s.status().cloud.lastFailure).toBe('exit');
    const second = s.ask(QUESTION);
    await flush();
    h.spawns[1].child.answer('ok');
    await second;
    expect(s.status().cloud.lastFailure).toBeNull();
  });

  it('a question cancels an in-flight anomaly call; a second question while one runs is busy', async () => {
    const h = harness();
    cloudReady(h);
    const s = service(h);
    const anomaly = s.ask(anomalyRequest(2));
    await flush();
    const question = s.ask(QUESTION);
    expect(h.spawns[0].child.signals).toEqual(['SIGTERM']);
    expect(await anomaly).toMatchObject({ ok: false, trigger: 'anomaly', issueKey: 'clipping:2', reason: 'cancelled' });
    await flush();
    expect(await s.ask({ ...QUESTION, question: 'And another?' })).toMatchObject({ ok: false, reason: 'busy', attempts: [] });
    expect(h.spawns).toHaveLength(2);
    h.spawns[1].child.answer('Answer two.');
    expect(await question).toMatchObject({ ok: true, text: 'Answer two.' });
  });

  it('a cancelled Cloud call does not fall through to Local', async () => {
    const h = harness();
    cloudReady(h);
    updateSettings({ mixerLocalAssistEnabled: true, mixerLocalAssistEndpoint: 'http://127.0.0.1:8080/v1', mixerLocalAssistModel: 'm' });
    const s = service(h);
    const pending = s.ask(QUESTION);
    await flush();
    expect(s.cancel()).toEqual({ success: true });
    expect(await pending).toMatchObject({ ok: false, reason: 'cancelled', attempts: [{ source: 'cloud', reason: 'cancelled' }] });
    expect(h.fetches).toEqual([]);
    expect(s.status().cloud.lastFailure).toBeNull();
  });

  it('app quit kills an in-flight child', async () => {
    const h = harness();
    cloudReady(h);
    const s = service(h);
    const pending = s.ask(QUESTION);
    await flush();
    h.quit.forEach((fn) => fn());
    expect(h.spawns[0].child.signals).toEqual(['SIGTERM']);
    expect(await pending).toMatchObject({ reason: 'cancelled' });
  });

  it('anomaly budget: Issue only, Sermon Quiet feedback-risk only, 10-minute cooldown per channel and kind, enforced with the injected clock', async () => {
    const h = harness();
    cloudReady(h);
    const s = service(h);
    expect(await s.ask(anomalyRequest(3, { issue: { key: 'clipping:3', kind: 'clipping', severity: 'check', channel: 3, diagnosis: '' } }))).toMatchObject({ reason: 'not-issue' });
    expect(await s.ask(anomalyRequest(3, { sermonQuiet: true }))).toMatchObject({ reason: 'sermon-quiet' });
    expect(h.spawns).toEqual([]);
    const first = s.ask(anomalyRequest(3));
    await flush();
    h.spawns[0].child.answer('Narration.');
    expect(await first).toMatchObject({ ok: true, trigger: 'anomaly', issueKey: 'clipping:3', text: 'Narration.' });
    h.clock.now += ANOMALY_COOLDOWN_MS - 1;
    expect(await s.ask(anomalyRequest(3))).toMatchObject({ ok: false, reason: 'cooldown' });
    expect(h.spawns).toHaveLength(1);
    h.clock.now += 1;
    void s.ask(anomalyRequest(3));
    await flush();
    expect(h.spawns).toHaveLength(2);
  });

  it('a token straddling the stderr cut at any offset reaches neither the answer nor the log', async () => {
    const h = harness();
    cloudReady(h);
    const s = service(h);
    const answers: unknown[] = [];
    for (let offset = 1; offset < FAKE_TOKEN.length; offset += 1) {
      for (const stderr of [
        'e'.repeat(MAX_STDERR_CHARS - offset) + FAKE_TOKEN + 'e'.repeat(MAX_STDERR_CHARS),
        'e'.repeat(MAX_STDERR_CHARS) + FAKE_TOKEN + 'e'.repeat(MAX_STDERR_CHARS - (FAKE_TOKEN.length - offset)),
      ]) {
        const pending = s.ask(QUESTION);
        await flush();
        h.spawns[h.spawns.length - 1].child.fail(1, stderr);
        answers.push(await pending);
      }
    }
    expect(answers).toHaveLength(2 * (FAKE_TOKEN.length - 1));
    expect(h.logs).toHaveLength(answers.length);
    expect(leakedFragments(JSON.stringify(answers), FAKE_TOKEN)).toEqual([]);
    expect(leakedFragments(h.logs.join('\n'), FAKE_TOKEN)).toEqual([]);
    expect(h.logs.every((line) => line.startsWith('mixer assist: cloud unavailable (exit) e'))).toBe(true);
  });

  it.each([
    ['timeout', (_s: ReturnType<typeof service>, t: ReturnType<typeof recordingTimers>) => t.fire(CLAUDE_TIMEOUT_MS)],
    ['cancelled', (s: ReturnType<typeof service>) => s.cancel()],
  ] as const)('a question whose child never closes after the kill settles as %s, frees the slot and removes its temp dir', async (reason, trigger) => {
    const t = recordingTimers();
    const removed: string[] = [];
    const h = harness({ timers: t.timers, removeDir: (dir) => removed.push(dir) });
    cloudReady(h);
    const s = service(h);
    const hung = s.ask(QUESTION);
    await flush();
    h.spawns[0].child.hangs = true;
    trigger(s, t);
    t.fire(CLAUDE_KILL_GRACE_MS);
    expect(h.spawns[0].child.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(await settledOrNot(hung)).toBe(UNSETTLED);
    t.fire(CLAUDE_KILL_SETTLE_MS);
    expect(await settledOrNot(hung)).toMatchObject({ ok: false, reason, attempts: [{ source: 'cloud', reason }] });
    expect(s.status().inFlight).toBe(false);
    expect(removed).toEqual(['/tmp/sb-assist-test']);
    const next = s.ask({ ...QUESTION, question: 'Next one?' });
    await flush();
    expect(h.spawns).toHaveLength(2);
    h.spawns[1].child.answer('Here is the next answer.');
    expect(await next).toMatchObject({ ok: true, text: 'Here is the next answer.' });
  });

  it('times out through the injected timers', async () => {
    const pending: Array<{ fn: () => void; ms: number }> = [];
    const h = harness({ timers: { setTimeout: (fn, ms) => pending.push({ fn, ms }), clearTimeout: () => undefined } });
    cloudReady(h);
    const s = service(h);
    const answer = s.ask(QUESTION);
    await flush();
    pending.find((t) => t.ms === CLAUDE_TIMEOUT_MS)!.fn();
    expect(await answer).toMatchObject({ ok: false, reason: 'timeout' });
  });
});

describe('flag mixerCloudAssistLogin on: Cloud uses the user\'s own Claude Code login', () => {
  const TOKEN_FILE = 'mixer-assist-token.bin';
  const OAUTH_KEY = 'CLAUDE_CODE_' + 'OAUTH_TOKEN';
  const FAKE_OAT = 'sk-ant-oat01-LOGINfakeLOGINfake4242';
  const LOGIN_ENV = { PATH: '/usr/bin:/bin', HOME: '/Users/op', ANTHROPIC_API_KEY: 'parent-key', ANTHROPIC_AUTH_TOKEN: 'parent-auth', ANTHROPIC_BASE_URL: 'https://proxy.example', [OAUTH_KEY]: 'inherited-not-ours' };

  function strictSafeStorage() {
    const touched: string[] = [];
    const safe: SafeStorageLike = {
      isEncryptionAvailable: () => (touched.push('probe'), true),
      encryptString: (p) => (touched.push('encrypt'), xorSafeStorage().encryptString(p)),
      decryptString: (c) => (touched.push('decrypt'), xorSafeStorage().decryptString(c)),
    };
    return { touched, safe };
  }

  function loginHarness(overrides: Partial<MixerAssistIpcDeps> = {}) {
    const strict = strictSafeStorage();
    const h = harness({ cloudLogin: true, env: LOGIN_ENV, secrets: createSecretStore({ safeStorage: strict.safe, fs, dir: electronState.userData }), ...overrides });
    registerMixerAssistHandlers(h.deps);
    updateSettings({ mixerCloudAssistEnabled: true });
    return {
      ...h,
      touched: strict.touched,
      ask: (req: unknown) => h.handles.get('ask-mixer-assist')!(null, req) as Promise<Record<string, unknown>>,
      status: (recheck?: boolean) => h.handles.get('get-mixer-assist-status')!(null, recheck) as { cloud: Record<string, unknown> },
    };
  }

  function plantOldToken(): string {
    const file = path.join(electronState.userData, TOKEN_FILE);
    fs.writeFileSync(file, xorSafeStorage().encryptString(FAKE_TOKEN));
    return file;
  }

  async function failNextWith(h: ReturnType<typeof loginHarness>, req: unknown, code: number, stderr: string) {
    const pending = h.ask(req);
    await flush();
    h.spawns[h.spawns.length - 1].child.fail(code, stderr);
    return pending;
  }

  it('logged in: spawns the user binary with the safe argv, no oauth variable, stripped keys gone, prompt on stdin, and answers labelled cloud', async () => {
    const h = loginHarness();
    expect(h.status().cloud).toEqual({ enabled: true, binaryFound: true, tokenSaved: false, encryptionAvailable: null, lastFailure: null, auth: 'login', storedToken: false });
    const pending = h.ask(QUESTION);
    await flush();
    const [call] = h.spawns;
    expect(call.command).toBe(BINARY);
    expect(call.shell).toBe(false);
    expect(call.args).toEqual(['-p', '--output-format', 'text', '--tools', '']);
    expect(Object.keys(call.env).sort()).toEqual(['HOME', 'PATH']);
    expect(call.child.stdin.written.join('')).toContain('Operator question: Why is Vox 1 flagged?');
    expect(call.child.stdin.ended).toBe(true);
    call.child.answer('Lower the trim on 02.');
    expect(await pending).toEqual({ ok: true, trigger: 'question', issueKey: null, source: 'cloud', text: 'Lower the trim on 02.', attempts: [] });
    expect(LOGIN_ENV[OAUTH_KEY]).toBe('inherited-not-ours');
    expect(h.touched).toEqual([]);
  });

  it('logged out: a distinct not-signed-in reason, no retry, a redacted log, and lastFailure until recheck', async () => {
    const h = loginHarness();
    const stderr = `Invalid API key · Please run /login ${FAKE_OAT} Bearer fakebearer55 ${OAUTH_KEY}=fakeenv66`;
    expect(await failNextWith(h, QUESTION, 1, stderr)).toEqual({ ok: false, trigger: 'question', issueKey: null, reason: 'not-signed-in', attempts: [{ source: 'cloud', reason: 'not-signed-in' }] });
    expect(h.spawns).toHaveLength(1);
    const logged = h.logs.join('\n');
    expect(logged).toContain('cloud unavailable (not-signed-in)');
    for (const leak of ['sk-ant-', 'LOGINfake', 'fakebearer55', 'fakeenv66', 'PATH=']) expect(logged).not.toContain(leak);
    expect(h.status().cloud.lastFailure).toBe('not-signed-in');
    expect(h.status(true).cloud.lastFailure).toBeNull();
  });

  it('logged out spends neither the 10-minute cooldown nor the hourly cap', async () => {
    const h = loginHarness();
    for (let i = 0; i <= MAX_ANOMALY_CALLS_PER_WINDOW; i += 1) {
      expect(await failNextWith(h, anomalyRequest(3), 1, 'Not logged in · Please run /login')).toMatchObject({ reason: 'not-signed-in' });
    }
    expect(h.spawns).toHaveLength(MAX_ANOMALY_CALLS_PER_WINDOW + 1);
    const ok = h.ask(anomalyRequest(4));
    await flush();
    h.spawns[h.spawns.length - 1].child.answer('Now signed in.');
    expect(await ok).toMatchObject({ ok: true, text: 'Now signed in.' });
  });

  it('claude missing: a distinct no-binary reason, no spawn, and no budget spent', async () => {
    const h = loginHarness({ isExecutable: () => false });
    expect(h.status().cloud).toMatchObject({ binaryFound: false, auth: 'login' });
    for (let i = 0; i <= MAX_ANOMALY_CALLS_PER_WINDOW; i += 1) {
      expect(await h.ask(anomalyRequest(5))).toEqual({ ok: false, trigger: 'anomaly', issueKey: 'clipping:5', reason: 'no-binary', attempts: [{ source: 'cloud', reason: 'no-binary' }] });
    }
    expect(h.spawns).toEqual([]);
    h.deps.isExecutable = (file) => file === BINARY;
    void h.ask(anomalyRequest(5));
    await flush();
    expect(h.spawns).toHaveLength(1);
  });

  it('a non-login failure still spends the anomaly budget, as today', async () => {
    const h = loginHarness();
    expect(await failNextWith(h, anomalyRequest(6), 1, 'Credit balance is too low')).toMatchObject({ reason: 'exit' });
    expect(await h.ask(anomalyRequest(6))).toMatchObject({ ok: false, reason: 'cooldown' });
  });

  it('timeout: the kill and settle still hold and the budget is spent, same as today', async () => {
    const t = recordingTimers();
    const h = loginHarness({ timers: t.timers });
    const hung = h.ask(anomalyRequest(7));
    await flush();
    h.spawns[0].child.hangs = true;
    t.fire(CLAUDE_TIMEOUT_MS);
    t.fire(CLAUDE_KILL_GRACE_MS);
    expect(h.spawns[0].child.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(await settledOrNot(hung)).toBe(UNSETTLED);
    t.fire(CLAUDE_KILL_SETTLE_MS);
    expect(await hung).toMatchObject({ ok: false, reason: 'timeout' });
    expect(await h.ask(anomalyRequest(7))).toMatchObject({ ok: false, reason: 'cooldown' });
  });

  it('fallback chain unchanged: a login failure falls through to Local', async () => {
    const h = loginHarness();
    updateSettings({ mixerLocalAssistEnabled: true, mixerLocalAssistEndpoint: 'http://127.0.0.1:8080/v1', mixerLocalAssistModel: 'qwen2.5' });
    h.fetchReply.current = () => Promise.resolve({ status: 200, text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content: 'Check the preamp gain.' } }] })) });
    expect(await failNextWith(h, QUESTION, 1, 'Not logged in')).toEqual({
      ok: true,
      trigger: 'question',
      issueKey: null,
      source: 'local',
      text: 'Check the preamp gain.',
      attempts: [{ source: 'cloud', reason: 'not-signed-in' }],
    });
  });

  it('an existing token file is reported for the notice but never read, decrypted or injected', async () => {
    const file = plantOldToken();
    const h = loginHarness();
    expect(h.status().cloud).toMatchObject({ storedToken: true, tokenSaved: false, auth: 'login' });
    const pending = h.ask(QUESTION);
    await flush();
    expect(Object.keys(h.spawns[0].env).sort()).toEqual(['HOME', 'PATH']);
    expect(JSON.stringify(h.spawns[0])).not.toContain(FAKE_TOKEN);
    h.spawns[0].child.answer('ok');
    await pending;
    expect(h.touched).toEqual([]);
    expect(fs.existsSync(file)).toBe(true);
  });

  it('saving a token is refused with the flag on and writes nothing', async () => {
    const h = loginHarness();
    const result = await h.handles.get('set-mixer-assist-token')!(null, FAKE_TOKEN);
    expect(result).toMatchObject({ ok: false, reason: 'login-mode', message: TOKEN_SAVE_MESSAGES['login-mode'], status: { cloud: { storedToken: false, auth: 'login' } } });
    expect(JSON.stringify(result)).not.toContain(FAKE_TOKEN);
    expect(fs.readdirSync(electronState.userData).filter((f) => f !== 'settings.json')).toEqual([]);
    expect(h.touched).toEqual([]);
  });

  it('the explicit Remove stored token action deletes the file and the notice goes away', async () => {
    const file = plantOldToken();
    const h = loginHarness();
    expect(h.status().cloud.storedToken).toBe(true);
    const cleared = (await h.handles.get('clear-mixer-assist-token')!(null)) as { cloud: Record<string, unknown> };
    expect(cleared.cloud).toMatchObject({ storedToken: false, auth: 'login' });
    expect(fs.existsSync(file)).toBe(false);
    expect(h.status().cloud.storedToken).toBe(false);
    expect(h.touched).toEqual([]);
  });

  it('flag off with the same token file: the token is still read and injected as before', async () => {
    plantOldToken();
    const h = harness({ secrets: createSecretStore({ safeStorage: xorSafeStorage(), fs, dir: electronState.userData }) });
    registerMixerAssistHandlers(h.deps);
    updateSettings({ mixerCloudAssistEnabled: true });
    const status = h.handles.get('get-mixer-assist-status')!(null) as { cloud: Record<string, unknown> };
    expect(status.cloud).toEqual({ enabled: true, binaryFound: true, tokenSaved: true, encryptionAvailable: true, lastFailure: null });
    const pending = h.handles.get('ask-mixer-assist')!(null, QUESTION) as Promise<unknown>;
    await flush();
    expect(h.spawns[0].env[OAUTH_KEY]).toBe(FAKE_TOKEN);
    h.spawns[0].child.answer('ok');
    expect(await pending).toMatchObject({ ok: true, source: 'cloud' });
  });
});

describe('default deps (no Electron window needed)', () => {
  it('cloudLogin follows only the SOUND_BUDDY_FEATURES env flag', () => {
    vi.stubEnv('SOUND_BUDDY_FEATURES', 'console,mixer');
    expect(defaultMixerAssistDeps().cloudLogin).toBe(false);
    vi.stubEnv('SOUND_BUDDY_FEATURES', 'console,mixer,mixerCloudAssistLogin');
    expect(defaultMixerAssistDeps().cloudLogin).toBe(true);
    vi.unstubAllEnvs();
  });

  it('resolve real executables, make and remove a fresh temp dir, and read the clock', () => {
    const deps = defaultMixerAssistDeps();
    const dir = deps.makeTempDir();
    expect(fs.readdirSync(dir)).toEqual([]);
    const exe = path.join(dir, 'claude');
    fs.writeFileSync(exe, '#!/bin/sh\n', { mode: 0o755 });
    const plain = path.join(dir, 'notes.txt');
    fs.writeFileSync(plain, 'x', { mode: 0o644 });
    expect([deps.isExecutable(exe), deps.isExecutable(plain), deps.isExecutable(dir), deps.isExecutable(path.join(dir, 'missing'))]).toEqual([true, false, false, false]);
    deps.removeDir(dir);
    expect(fs.existsSync(dir)).toBe(false);
    expect(deps.homeDir).toBe(os.homedir());
    expect(Math.abs(deps.now() - Date.now())).toBeLessThan(1000);
    expect(deps.env).toBe(process.env);
    let fired = false;
    const handle = deps.timers.setTimeout(() => (fired = true), 10_000);
    deps.timers.clearTimeout(handle);
    expect(fired).toBe(false);
  });

  it('the lazy secret store clears through to the real file', async () => {
    const deps = defaultMixerAssistDeps();
    deps.secrets.save(FAKE_TOKEN);
    expect(deps.secrets.isSaved()).toBe(true);
    expect(deps.secrets.encryptionAvailable()).toBe(true);
    deps.secrets.clear();
    expect(deps.secrets.isSaved()).toBe(false);
  });

  it('the default spawn runs a real child with shell false and the given cwd and env', async () => {
    const deps = defaultMixerAssistDeps();
    const cwd = deps.makeTempDir();
    const child = deps.spawn('/bin/sh', ['-c', 'printf "%s|%s" "$(basename "$(pwd)")" "$SB_PROBE"'], { cwd, env: { SB_PROBE: 'probe-ok', PATH: '/usr/bin:/bin' }, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk) => (out += String(chunk)));
    const code = await new Promise((resolve) => child.on('close', resolve));
    deps.removeDir(cwd);
    expect(code).toBe(0);
    expect(out).toBe(`${path.basename(cwd)}|probe-ok`);
  });

  it('the default fetch is the built-in fetch (a closed loopback port refuses)', async () => {
    const deps = defaultMixerAssistDeps();
    const controller = new AbortController();
    await expect(
      deps.fetch('http://127.0.0.1:9/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: controller.signal, redirect: 'error' })
    ).rejects.toThrow();
  });
});
