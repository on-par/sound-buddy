// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { app, ipcMain, safeStorage } from 'electron';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getSettings } from '../settings';
import { logWarn } from '../logger';
import { createSecretStore, type SecretStore } from '../mixer-assist/secret-store';
import { checkLocalEndpoint, runLocal, type FetchLike } from '../mixer-assist/local-endpoint';
import { PINNED_CLAUDE_MODEL, resolveClaudeBinary, runClaude, type SpawnLike, type TimersLike } from '../mixer-assist/claude-cli';
import { EMPTY_BUDGET, beginCall, decideCall, endCall, type BudgetRequest, type BudgetState } from '../mixer-assist/budget';
import { buildPrompt, capAnswer, parseAssistRequest } from '../mixer-assist/prompt';
import type {
  AppSettings,
  MixerAssistAnswer,
  MixerAssistAttempt,
  MixerAssistReason,
  MixerAssistRequest,
  MixerAssistSource,
  MixerAssistStatusDto,
  OperationResult,
  SetMixerAssistTokenResult,
} from './api';

export const MIXER_ASSIST_CHANNELS = [
  'get-mixer-assist-status',
  'set-mixer-assist-token',
  'clear-mixer-assist-token',
  'ask-mixer-assist',
  'cancel-mixer-assist',
] as const;

const TEMP_DIR_PREFIX = 'sound-buddy-assist-';

type TokenSaveFailure = Extract<SetMixerAssistTokenResult, { ok: false }>['reason'];

export const TOKEN_SAVE_MESSAGES: Record<TokenSaveFailure, string> = {
  empty: 'Paste your Claude Code token, then choose Save.',
  'too-long': 'That is longer than any Claude Code token. Copy it again from `claude setup-token`, then paste it.',
  'no-encryption': "This Mac can't encrypt the token right now, so it was not saved. Unlock your login keychain, then try again.",
  'write-failed': "Couldn't write the token file. Check that Sound Buddy can write to its Application Support folder, then try again.",
};

export interface MixerAssistIpcDeps {
  handle(channel: string, fn: (event: unknown, ...args: unknown[]) => unknown): void;
  onQuit(fn: () => void): void;
  getSettings(): AppSettings;
  secrets: SecretStore;
  log(message: string): void;
  spawn: SpawnLike;
  fetch: FetchLike;
  env: Readonly<Record<string, string | undefined>>;
  homeDir: string;
  isExecutable(file: string): boolean;
  makeTempDir(): string;
  removeDir(dir: string): void;
  timers: TimersLike;
  now(): number;
}

export interface MixerAssistService {
  status(recheck?: unknown): MixerAssistStatusDto;
  saveToken(token: unknown): SetMixerAssistTokenResult;
  clearToken(): MixerAssistStatusDto;
  ask(request: unknown): Promise<MixerAssistAnswer>;
  cancel(): OperationResult;
  shutdown(): void;
}

type RunOutcome = { ok: true; text: string } | { ok: false; reason: MixerAssistReason; detail: string };

interface FailureMark {
  reason: MixerAssistReason;
  signature: string;
}

function budgetRequestOf(request: MixerAssistRequest): BudgetRequest {
  if (request.trigger === 'question') return { trigger: 'question' };
  return { trigger: 'anomaly', kind: request.issue.kind, channel: request.issue.channel, severity: request.issue.severity, sermonQuiet: request.sermonQuiet };
}

export function createMixerAssistService(deps: MixerAssistIpcDeps): MixerAssistService {
  let budget: BudgetState = EMPTY_BUDGET;
  let nextId = 1;
  let current: { id: number; controller: AbortController } | null = null;
  const failures: Partial<Record<MixerAssistSource, FailureMark>> = {};

  function signature(source: MixerAssistSource, settings: AppSettings): string {
    return source === 'cloud'
      ? JSON.stringify([settings.mixerCloudAssistEnabled, settings.mixerCloudAssistBinaryPath, deps.secrets.isSaved()])
      : JSON.stringify([settings.mixerLocalAssistEnabled, settings.mixerLocalAssistEndpoint, settings.mixerLocalAssistModel]);
  }

  function lastFailure(source: MixerAssistSource, settings: AppSettings): MixerAssistReason | null {
    const mark = failures[source];
    return mark !== undefined && mark.signature === signature(source, settings) ? mark.reason : null;
  }

  function findBinary(settings: AppSettings): string | null {
    return resolveClaudeBinary({
      settingPath: settings.mixerCloudAssistBinaryPath,
      pathEnv: deps.env.PATH,
      homeDir: deps.homeDir,
      isExecutable: deps.isExecutable,
    });
  }

  function status(recheck: unknown = false): MixerAssistStatusDto {
    if (recheck === true) {
      delete failures.cloud;
      delete failures.local;
    }
    const settings = deps.getSettings();
    const binaryFound = findBinary(settings) !== null;
    const tokenSaved = deps.secrets.isSaved();
    const probe = settings.mixerCloudAssistEnabled && binaryFound && tokenSaved;
    return {
      cloud: {
        enabled: settings.mixerCloudAssistEnabled,
        binaryFound,
        tokenSaved,
        encryptionAvailable: probe ? deps.secrets.encryptionAvailable() : null,
        lastFailure: lastFailure('cloud', settings),
      },
      local: {
        enabled: settings.mixerLocalAssistEnabled,
        endpoint: checkLocalEndpoint(settings.mixerLocalAssistEndpoint).state,
        modelSet: settings.mixerLocalAssistModel !== '',
        lastFailure: lastFailure('local', settings),
      },
      inFlight: current !== null,
    };
  }

  async function runCloud(settings: AppSettings, request: MixerAssistRequest, signal: AbortSignal): Promise<RunOutcome> {
    const binary = findBinary(settings);
    if (binary === null) return { ok: false, reason: 'no-binary', detail: '' };
    if (!deps.secrets.isSaved()) return { ok: false, reason: 'no-token', detail: '' };
    if (!deps.secrets.encryptionAvailable()) return { ok: false, reason: 'no-encryption', detail: '' };
    const token = deps.secrets.read();
    if (token === null) return { ok: false, reason: 'no-token', detail: '' };
    return runClaude(deps, { binary, token, prompt: buildPrompt(request).combined, env: deps.env, model: PINNED_CLAUDE_MODEL, signal });
  }

  function runLocalAssist(settings: AppSettings, request: MixerAssistRequest, signal: AbortSignal): Promise<RunOutcome> {
    const prompt = buildPrompt(request);
    return runLocal(deps, {
      endpoint: settings.mixerLocalAssistEndpoint,
      model: settings.mixerLocalAssistModel,
      system: prompt.system,
      user: prompt.user,
      signal,
    });
  }

  async function runChain(request: MixerAssistRequest, settings: AppSettings, signal: AbortSignal): Promise<MixerAssistAnswer> {
    const issueKey = request.trigger === 'anomaly' ? request.issue.key : null;
    const attempts: MixerAssistAttempt[] = [];
    const chain: Array<[MixerAssistSource, boolean, () => Promise<RunOutcome>]> = [
      ['cloud', settings.mixerCloudAssistEnabled, () => runCloud(settings, request, signal)],
      ['local', settings.mixerLocalAssistEnabled, () => runLocalAssist(settings, request, signal)],
    ];
    for (const [source, enabled, run] of chain) {
      if (!enabled) continue;
      const outcome = await run();
      if (outcome.ok) {
        delete failures[source];
        return { ok: true, trigger: request.trigger, issueKey, source, text: capAnswer(outcome.text), attempts };
      }
      attempts.push({ source, reason: outcome.reason });
      deps.log(`mixer assist: ${source} unavailable (${outcome.reason})${outcome.detail === '' ? '' : ` ${outcome.detail}`}`);
      if (outcome.reason === 'cancelled') break;
      failures[source] = { reason: outcome.reason, signature: signature(source, settings) };
    }
    return { ok: false, trigger: request.trigger, issueKey, reason: attempts[attempts.length - 1].reason, attempts };
  }

  async function ask(raw: unknown): Promise<MixerAssistAnswer> {
    const request = parseAssistRequest(raw);
    if (request === null) return { ok: false, trigger: 'question', issueKey: null, reason: 'invalid-request', attempts: [] };
    const issueKey = request.trigger === 'anomaly' ? request.issue.key : null;
    const settings = deps.getSettings();
    if (!settings.mixerCloudAssistEnabled && !settings.mixerLocalAssistEnabled) {
      return { ok: false, trigger: request.trigger, issueKey, reason: 'disabled', attempts: [] };
    }
    const budgetRequest = budgetRequestOf(request);
    const now = deps.now();
    const decision = decideCall(budget, budgetRequest, now);
    if (!decision.run) return { ok: false, trigger: request.trigger, issueKey, reason: decision.reason, attempts: [] };
    if (decision.preempt !== null && current !== null) current.controller.abort();
    const id = nextId++;
    const controller = new AbortController();
    current = { id, controller };
    budget = beginCall(budget, budgetRequest, id, now);
    try {
      return await runChain(request, settings, controller.signal);
    } finally {
      budget = endCall(budget, id);
      if (current?.id === id) current = null;
    }
  }

  function abortCurrent(): void {
    current?.controller.abort();
  }

  return {
    status,
    saveToken(token) {
      const outcome = deps.secrets.save(typeof token === 'string' ? token : '');
      if (outcome.ok) return { ok: true, status: status() };
      deps.log(`mixer assist: token not saved (${outcome.reason})`);
      return { ok: false, reason: outcome.reason, message: TOKEN_SAVE_MESSAGES[outcome.reason], status: status() };
    },
    clearToken() {
      deps.secrets.clear();
      return status();
    },
    ask,
    cancel() {
      abortCurrent();
      return { success: true };
    },
    shutdown: abortCurrent,
  };
}

function lazySecretStore(make: () => SecretStore): SecretStore {
  let store: SecretStore | null = null;
  const get = () => (store ??= make());
  return {
    save: (token) => get().save(token),
    clear: () => get().clear(),
    isSaved: () => get().isSaved(),
    read: () => get().read(),
    encryptionAvailable: () => get().encryptionAvailable(),
  };
}

function isExecutableFile(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

export function defaultMixerAssistDeps(): MixerAssistIpcDeps {
  return {
    handle: (channel, fn) => ipcMain.handle(channel, fn),
    onQuit: (fn) => app.on('will-quit', fn),
    getSettings,
    secrets: lazySecretStore(() => createSecretStore({ safeStorage, fs, dir: app.getPath('userData') })),
    log: logWarn,
    spawn: (command, args, options) => spawn(command, args, options),
    fetch: (url, init) => fetch(url, init),
    env: process.env,
    homeDir: os.homedir(),
    isExecutable: isExecutableFile,
    makeTempDir: () => fs.mkdtempSync(path.join(os.tmpdir(), TEMP_DIR_PREFIX)),
    removeDir: (dir) => fs.rmSync(dir, { recursive: true, force: true }),
    timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout) },
    now: () => Date.now(),
  };
}

export function registerMixerAssistHandlers(deps: MixerAssistIpcDeps = defaultMixerAssistDeps()): void {
  const service = createMixerAssistService(deps);
  deps.handle('get-mixer-assist-status', (_event, recheck) => service.status(recheck));
  deps.handle('set-mixer-assist-token', (_event, token) => service.saveToken(token));
  deps.handle('clear-mixer-assist-token', () => service.clearToken());
  let quitWired = false;
  deps.handle('ask-mixer-assist', (_event, request) => {
    if (!quitWired) {
      quitWired = true;
      deps.onQuit(() => service.shutdown());
    }
    return service.ask(request);
  });
  deps.handle('cancel-mixer-assist', () => service.cancel());
}
