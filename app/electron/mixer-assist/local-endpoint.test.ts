// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import {
  LOCAL_TIMEOUT_MS,
  MAX_LOCAL_RESPONSE_CHARS,
  checkLocalEndpoint,
  isPrivateOrLoopbackHost,
  runLocal,
  type FetchLike,
  type LocalRunDeps,
} from './local-endpoint';

describe('checkLocalEndpoint', () => {
  it.each([
    ['http://127.0.0.1:11434/v1', 'http://127.0.0.1:11434/v1'],
    ['http://localhost:8080/v1/', 'http://localhost:8080/v1'],
    ['http://[::1]:8080', 'http://[::1]:8080'],
    ['https://10.1.2.3/v1', 'https://10.1.2.3/v1'],
    ['http://172.16.0.9:1234/v1', 'http://172.16.0.9:1234/v1'],
    ['http://172.31.255.1/v1', 'http://172.31.255.1/v1'],
    ['http://192.168.1.20:8080/v1', 'http://192.168.1.20:8080/v1'],
    ['http://127.8.9.10', 'http://127.8.9.10'],
  ])('accepts the loopback or RFC 1918 URL %s', (input, base) => {
    expect(checkLocalEndpoint(input)).toEqual({ state: 'ok', base });
  });

  it.each([
    'https://api.example.com/v1',
    'http://8.8.8.8/v1',
    'http://172.32.0.1/v1',
    'http://172.15.0.1/v1',
    'http://192.169.1.1/v1',
    'http://11.0.0.1/v1',
    'ftp://127.0.0.1/v1',
    'file:///tmp/socket',
    'not a url',
    'http://localhost.example.com/v1',
    'http://user:pw@127.0.0.1/v1',
    'http://[2001:db8::1]/v1',
    'http://0.0.0.0/v1',
  ])('rejects %s', (input) => {
    expect(checkLocalEndpoint(input)).toEqual({ state: 'invalid', base: null });
  });

  it('reports a blank endpoint as unset', () => {
    expect(checkLocalEndpoint('   ')).toEqual({ state: 'unset', base: null });
  });

  it('drops a query or fragment from the base', () => {
    expect(checkLocalEndpoint('http://127.0.0.1:8080/v1?x=1#y')).toEqual({ state: 'ok', base: 'http://127.0.0.1:8080/v1' });
  });
});

describe('isPrivateOrLoopbackHost', () => {
  it('accepts only loopback names and private IPv4 ranges', () => {
    expect(['localhost', '127.0.0.1', '[::1]', '10.0.0.1', '172.20.1.1', '192.168.0.1'].map(isPrivateOrLoopbackHost)).toEqual([true, true, true, true, true, true]);
    expect(['example.com', '1.1.1.1', '256.1.1.1', '10.0.0', '192.168.1.300'].map(isPrivateOrLoopbackHost)).toEqual([false, false, false, false, false]);
  });
});

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  redirect: string;
  signal: AbortSignal;
}

function fakeTimers() {
  const pending = new Map<number, () => void>();
  let id = 0;
  return {
    pending,
    setTimeout: (fn: () => void, ms: number) => {
      id += 1;
      pending.set(id, fn);
      expect(ms).toBe(LOCAL_TIMEOUT_MS);
      return id;
    },
    clearTimeout: (h: unknown) => {
      pending.delete(h as number);
    },
    fireAll() {
      for (const [k, fn] of [...pending]) {
        pending.delete(k);
        fn();
      }
    },
  };
}

function setup(respond: (call: FetchCall) => Promise<{ status: number; text(): Promise<string> }>) {
  const calls: FetchCall[] = [];
  const timers = fakeTimers();
  const fetch: FetchLike = (url, init) => {
    const call = { url, method: init.method, headers: init.headers, body: JSON.parse(init.body), redirect: init.redirect, signal: init.signal };
    calls.push(call);
    return respond(call);
  };
  const deps: LocalRunDeps = { fetch, timers };
  return { calls, timers, deps };
}

const reply = (status: number, body: unknown) => Promise.resolve({ status, text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)) });

function input(over: Partial<Parameters<typeof runLocal>[1]> = {}) {
  return { endpoint: 'http://127.0.0.1:8080/v1/', model: 'qwen2.5', system: 'Be brief.', user: 'Why is 02 clipping?', signal: new AbortController().signal, ...over };
}

describe('runLocal with an injected fetch', () => {
  it('POSTs <endpoint>/chat/completions with model, messages and stream false, JSON content type only, no auth, redirects refused', async () => {
    const s = setup(() => reply(200, { choices: [{ message: { content: '  Lower the trim on 02.  ' } }] }));
    expect(await runLocal(s.deps, input())).toEqual({ ok: true, text: 'Lower the trim on 02.' });
    expect(s.calls).toHaveLength(1);
    const [call] = s.calls;
    expect(call.url).toBe('http://127.0.0.1:8080/v1/chat/completions');
    expect(call.method).toBe('POST');
    expect(call.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(call.redirect).toBe('error');
    expect(call.body).toEqual({
      model: 'qwen2.5',
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Why is 02 clipping?' },
      ],
      stream: false,
    });
    expect(s.timers.pending.size).toBe(0);
  });

  it.each([
    ['', 'no-endpoint'],
    ['https://api.example.com/v1', 'bad-endpoint'],
  ])('endpoint %p never fetches and returns %s', async (endpoint, reason) => {
    const s = setup(() => reply(200, {}));
    expect(await runLocal(s.deps, input({ endpoint }))).toMatchObject({ ok: false, reason });
    expect(s.calls).toEqual([]);
  });

  it('a blank model never fetches', async () => {
    const s = setup(() => reply(200, {}));
    expect(await runLocal(s.deps, input({ model: '  ' }))).toMatchObject({ ok: false, reason: 'no-model' });
    expect(s.calls).toEqual([]);
  });

  it('a non-200 answer is endpoint-status', async () => {
    const s = setup(() => reply(404, 'not found'));
    expect(await runLocal(s.deps, input())).toMatchObject({ ok: false, reason: 'endpoint-status', detail: 'HTTP 404' });
  });

  it.each([
    ['not json', 'bad-response'],
    [{ choices: [] }, 'bad-response'],
    [{ choices: [{ message: { content: '   ' } }] }, 'bad-response'],
    [{ choices: [{ message: { content: 42 } }] }, 'bad-response'],
    [null, 'bad-response'],
  ])('a malformed body %p is %s', async (body, reason) => {
    const s = setup(() => reply(200, body));
    expect(await runLocal(s.deps, input())).toMatchObject({ ok: false, reason });
  });

  it('an oversized body is overflow', async () => {
    const s = setup(() => reply(200, 'x'.repeat(MAX_LOCAL_RESPONSE_CHARS + 1)));
    expect(await runLocal(s.deps, input())).toMatchObject({ ok: false, reason: 'overflow' });
  });

  it('a refused connection is endpoint-down with a sanitized detail', async () => {
    const s = setup(() => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:9 Bearer leaked')));
    const result = await runLocal(s.deps, input());
    expect(result).toMatchObject({ ok: false, reason: 'endpoint-down' });
    expect(JSON.stringify(result)).not.toContain('leaked');
    expect(s.timers.pending.size).toBe(0);
  });

  function hanging(call: FetchCall) {
    return new Promise<never>((_resolve, reject) => call.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  }

  it('times out through the AbortController', async () => {
    const s = setup(hanging);
    const done = runLocal(s.deps, input());
    s.timers.fireAll();
    expect(await done).toMatchObject({ ok: false, reason: 'timeout' });
    expect(s.calls[0].signal.aborted).toBe(true);
  });

  it('cancel aborts the request', async () => {
    const s = setup(hanging);
    const controller = new AbortController();
    const done = runLocal(s.deps, input({ signal: controller.signal }));
    controller.abort();
    expect(await done).toMatchObject({ ok: false, reason: 'cancelled' });
    expect(s.timers.pending.size).toBe(0);
  });

  it('an already-cancelled request never fetches', async () => {
    const s = setup(() => reply(200, {}));
    const controller = new AbortController();
    controller.abort();
    expect(await runLocal(s.deps, input({ signal: controller.signal }))).toMatchObject({ ok: false, reason: 'cancelled' });
    expect(s.calls).toEqual([]);
  });
});
