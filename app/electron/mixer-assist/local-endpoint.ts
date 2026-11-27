// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import type { MixerAssistEndpointState } from '../ipc/api';
import { sanitize } from './sanitize';
import type { TimersLike } from './claude-cli';

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const MAX_OCTET = 255;
const LOOPBACK_FIRST_OCTET = 127;
const PRIVATE_A = 10;
const PRIVATE_B_FIRST = 172;
const PRIVATE_B_SECOND_MIN = 16;
const PRIVATE_B_SECOND_MAX = 31;
const PRIVATE_C_FIRST = 192;
const PRIVATE_C_SECOND = 168;
const LOOPBACK_NAMES = new Set(['localhost', '[::1]']);
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const HTTP_OK = 200;
const CHAT_COMPLETIONS_PATH = '/chat/completions';

export const LOCAL_TIMEOUT_MS = 45_000;
export const MAX_LOCAL_RESPONSE_CHARS = 256 * 1024;

export interface FetchInitLike {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
  redirect: 'error';
}

export type FetchLike = (url: string, init: FetchInitLike) => Promise<{ status: number; text(): Promise<string> }>;

export interface LocalRunDeps {
  fetch: FetchLike;
  timers: TimersLike;
}

export type LocalFailure = 'no-endpoint' | 'bad-endpoint' | 'no-model' | 'endpoint-down' | 'endpoint-status' | 'bad-response' | 'overflow' | 'timeout' | 'cancelled';

export type LocalRunResult = { ok: true; text: string } | { ok: false; reason: LocalFailure; detail: string };

export interface LocalRunInput {
  endpoint: string;
  model: string;
  system: string;
  user: string;
  signal: AbortSignal;
}

export function isPrivateOrLoopbackHost(host: string): boolean {
  if (LOOPBACK_NAMES.has(host)) return true;
  const match = IPV4.exec(host);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((o) => o > MAX_OCTET)) return false;
  const [a, b] = octets;
  return (
    a === LOOPBACK_FIRST_OCTET ||
    a === PRIVATE_A ||
    (a === PRIVATE_B_FIRST && b >= PRIVATE_B_SECOND_MIN && b <= PRIVATE_B_SECOND_MAX) ||
    (a === PRIVATE_C_FIRST && b === PRIVATE_C_SECOND)
  );
}

export function checkLocalEndpoint(raw: string): { state: MixerAssistEndpointState; base: string | null } {
  const trimmed = raw.trim();
  if (trimmed === '') return { state: 'unset', base: null };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { state: 'invalid', base: null };
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol) || url.username !== '' || url.password !== '' || !isPrivateOrLoopbackHost(url.hostname)) {
    return { state: 'invalid', base: null };
  }
  return { state: 'ok', base: `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}` };
}

function answerFrom(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { choices?: Array<{ message?: { content?: unknown } }> } | null;
    const content = parsed?.choices?.[0]?.message?.content;
    return typeof content === 'string' && content.trim() !== '' ? content.trim() : null;
  } catch {
    return null;
  }
}

export async function runLocal(deps: LocalRunDeps, input: LocalRunInput): Promise<LocalRunResult> {
  const endpoint = checkLocalEndpoint(input.endpoint);
  if (endpoint.state === 'unset') return { ok: false, reason: 'no-endpoint', detail: '' };
  if (endpoint.base === null) return { ok: false, reason: 'bad-endpoint', detail: '' };
  const model = input.model.trim();
  if (model === '') return { ok: false, reason: 'no-model', detail: '' };
  if (input.signal.aborted) return { ok: false, reason: 'cancelled', detail: '' };

  const controller = new AbortController();
  let stopReason: 'timeout' | 'cancelled' | null = null;
  const onAbort = () => {
    stopReason = 'cancelled';
    controller.abort();
  };
  const timer = deps.timers.setTimeout(() => {
    stopReason = 'timeout';
    controller.abort();
  }, LOCAL_TIMEOUT_MS);
  input.signal.addEventListener('abort', onAbort);
  try {
    const response = await deps.fetch(`${endpoint.base}${CHAT_COMPLETIONS_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user },
        ],
        stream: false,
      }),
      signal: controller.signal,
      redirect: 'error',
    });
    if (response.status !== HTTP_OK) return { ok: false, reason: 'endpoint-status', detail: `HTTP ${response.status}` };
    const body = await response.text();
    if (body.length > MAX_LOCAL_RESPONSE_CHARS) return { ok: false, reason: 'overflow', detail: '' };
    const text = answerFrom(body);
    return text === null ? { ok: false, reason: 'bad-response', detail: '' } : { ok: true, text };
  } catch (err) {
    return { ok: false, reason: stopReason ?? 'endpoint-down', detail: sanitize(err) };
  } finally {
    deps.timers.clearTimeout(timer);
    input.signal.removeEventListener('abort', onAbort);
  }
}
