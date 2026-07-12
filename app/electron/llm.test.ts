// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { EventEmitter } from 'events';
import * as http from 'http';
import * as https from 'https';
import { spawn } from 'child_process';
import { isAiEnabled } from './settings';
import { getApiKey, getLlmConfig } from './llm-config';

vi.mock('http', () => ({ request: vi.fn(), get: vi.fn() }));
vi.mock('https', () => ({ request: vi.fn(), get: vi.fn() }));
vi.mock('child_process', () => ({ spawn: vi.fn() }));
vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp/sb-llm-test') } }));
vi.mock('./settings', () => ({ isAiEnabled: vi.fn() }));
vi.mock('./llm-config', () => ({
  DEFAULT_OLLAMA_HOST: 'http://localhost:11434',
  getApiKey: vi.fn(),
  getLlmConfig: vi.fn(),
}));

import { streamNarrative, probeOllama, testHostedProvider } from './llm';

interface FakeReq extends EventEmitter {
  write: Mock;
  end: Mock;
  destroy: Mock;
}

function makeReq(): FakeReq {
  const req = new EventEmitter() as FakeReq;
  req.write = vi.fn();
  req.destroy = vi.fn((err?: Error) => {
    if (err) req.emit('error', err);
  });
  req.end = vi.fn();
  return req;
}

function makeRes(statusCode = 200): EventEmitter & { statusCode: number } {
  const res = new EventEmitter() as EventEmitter & { statusCode: number };
  res.statusCode = statusCode;
  return res;
}

/**
 * Prime a transport module (`http`/`https`) so that `transport.request(...)`
 * returns a fake req; when the code under test calls `req.end()`, the
 * response callback fires with a fake res and `script` runs to emit
 * data/end/error events on req/res.
 */
function prime(
  transport: typeof http | typeof https,
  script: (req: FakeReq, res: EventEmitter & { statusCode: number }) => void,
  statusCode = 200,
): { req: FakeReq; opts: () => http.RequestOptions } {
  const req = makeReq();
  const res = makeRes(statusCode);
  vi.mocked(transport.request).mockImplementation(((
    opts: unknown,
    cb?: (r: unknown) => void,
  ) => {
    req.end.mockImplementation(() => {
      if (cb) cb(res);
      script(req, res);
    });
    return req;
  }) as typeof transport.request);
  return { req, opts: () => vi.mocked(transport.request).mock.calls[0][0] as http.RequestOptions };
}

/** Prime a transport for a pure request-error scenario — no response ever arrives. */
function primeError(
  transport: typeof http | typeof https,
  err: NodeJS.ErrnoException,
): { req: FakeReq; opts: () => http.RequestOptions } {
  const req = makeReq();
  vi.mocked(transport.request).mockImplementation(((
    _opts: unknown,
    _cb?: (r: unknown) => void,
  ) => {
    req.end.mockImplementation(() => {
      req.emit('error', err);
    });
    return req;
  }) as typeof transport.request);
  return { req, opts: () => vi.mocked(transport.request).mock.calls[0][0] as http.RequestOptions };
}

interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
}

function makeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isAiEnabled).mockReturnValue(true);
});

describe('streamNarrative gating', () => {
  it('resolves disabled when AI is off, without touching any transport', async () => {
    vi.mocked(isAiEnabled).mockReturnValue(false);
    const deltas: string[] = [];
    const outcome = await streamNarrative((t) => deltas.push(t), 'sys', 'msg');
    expect(outcome).toEqual({ ok: false, reason: 'disabled' });
    expect(http.request).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('resolves no-provider when AI is enabled but nothing is configured', async () => {
    vi.mocked(getLlmConfig).mockReturnValue({});
    const outcome = await streamNarrative(() => {}, 'sys', 'msg');
    expect(outcome).toEqual({ ok: false, reason: 'no-provider' });
  });
});

describe('streamNarrative — ollama', () => {
  beforeEach(() => {
    vi.mocked(getLlmConfig).mockReturnValue({
      provider: 'ollama',
      model: 'llama3.2',
      ollamaHost: 'http://localhost:11434',
    });
  });

  it('streams NDJSON deltas split across chunk boundaries and forwards the prompt', async () => {
    const { req, opts } = prime(http, (r, res) => {
      res.emit('data', Buffer.from('{"message":{"content":"Hel"}}\n{"message":{"con'));
      res.emit('data', Buffer.from('tent":"lo"}}\n{"done":true}'));
      res.emit('end');
    });
    const deltas: string[] = [];
    const outcome = await streamNarrative((t) => deltas.push(t), 'system prompt', 'user message');
    expect(outcome).toEqual({ ok: true, provider: 'ollama', model: 'llama3.2' });
    expect(deltas).toEqual(['Hel', 'lo']);
    expect(opts()).toMatchObject({ hostname: 'localhost', port: '11434', path: '/api/chat', method: 'POST' });
    expect(req.write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(req.write.mock.calls[0][0] as string)).toEqual({
      model: 'llama3.2',
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'user message' },
      ],
      stream: true,
    });
  });

  it('defaults model to llama3.2 and host to DEFAULT_OLLAMA_HOST when unset', async () => {
    vi.mocked(getLlmConfig).mockReturnValue({ provider: 'ollama' });
    const { req, opts } = prime(http, (r, res) => {
      res.emit('end');
    });
    await streamNarrative(() => {}, 'sys', 'msg');
    expect(opts()).toMatchObject({ hostname: 'localhost', port: '11434' });
    expect(JSON.parse(req.write.mock.calls[0][0] as string)).toMatchObject({ model: 'llama3.2' });
  });

  it('uses https transport and port 443 for an https ollama host', async () => {
    vi.mocked(getLlmConfig).mockReturnValue({
      provider: 'ollama',
      model: 'llama3.2',
      ollamaHost: 'https://box.local',
    });
    const { opts } = prime(https, (r, res) => {
      res.emit('end');
    });
    await streamNarrative(() => {}, 'sys', 'msg');
    expect(https.request).toHaveBeenCalled();
    expect(http.request).not.toHaveBeenCalled();
    expect(opts()).toMatchObject({ hostname: 'box.local', port: 443 });
  });

  it('reports a friendly message on ECONNREFUSED, without a response', async () => {
    primeError(http, Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), { code: 'ECONNREFUSED' }));
    const outcome = await streamNarrative(() => {}, 'sys', 'msg');
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain('Ollama not reachable at http://localhost:11434');
    expect(outcome.reason).toContain('ollama pull llama3.2');
  });

  it('surfaces the raw error message for non-ECONNREFUSED request errors', async () => {
    primeError(http, Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
    const outcome = await streamNarrative(() => {}, 'sys', 'msg');
    expect(outcome).toEqual({ ok: false, reason: 'socket hang up' });
  });

  it('settles on an in-stream error line, and a later content line does not flip the outcome', async () => {
    prime(http, (r, res) => {
      res.emit('data', Buffer.from("{\"error\":\"model 'x' not found\"}\n"));
      res.emit('data', Buffer.from('{"message":{"content":"after error"}}\n'));
      res.emit('end');
    });
    const deltas: string[] = [];
    const outcome = await streamNarrative((t) => deltas.push(t), 'sys', 'msg');
    expect(outcome).toEqual({ ok: false, reason: "model 'x' not found" });
  });

  it('ignores malformed JSON lines', async () => {
    prime(http, (r, res) => {
      res.emit('data', Buffer.from('not json\n{"message":{"content":"ok"}}\n'));
      res.emit('end');
    });
    const deltas: string[] = [];
    const outcome = await streamNarrative((t) => deltas.push(t), 'sys', 'msg');
    expect(outcome).toEqual({ ok: true, provider: 'ollama', model: 'llama3.2' });
    expect(deltas).toEqual(['ok']);
  });

  it('resolves an invalid host without ever calling http.request', async () => {
    vi.mocked(getLlmConfig).mockReturnValue({ provider: 'ollama', model: 'llama3.2', ollamaHost: ':::' });
    const outcome = await streamNarrative(() => {}, 'sys', 'msg');
    expect(outcome).toEqual({ ok: false, reason: 'Invalid Ollama endpoint: :::' });
    expect(http.request).not.toHaveBeenCalled();
  });

  it('settles on a response stream error event after some data', async () => {
    prime(http, (r, res) => {
      res.emit('data', Buffer.from('{"message":{"content":"partial"}}\n'));
      res.emit('error', new Error('stream broke'));
    });
    const deltas: string[] = [];
    const outcome = await streamNarrative((t) => deltas.push(t), 'sys', 'msg');
    expect(outcome).toEqual({ ok: false, reason: 'stream broke' });
    expect(deltas).toEqual(['partial']);
  });
});

describe('streamNarrative — hosted', () => {
  beforeEach(() => {
    vi.mocked(getLlmConfig).mockReturnValue({ provider: 'openai', model: 'gpt-4o-mini' });
    vi.mocked(getApiKey).mockReturnValue('sk-test');
  });

  it('streams an OpenAI SSE response and shapes the request correctly', async () => {
    const { req, opts } = prime(https, (r, res) => {
      res.emit(
        'data',
        Buffer.from(
          'data: {"choices":[{"delta":{"content":"Hi "}}]}\n\ndata: {"choices":[{"delta":{"content":"there"}}]}\n\ndata: [DONE]\n\n',
        ),
      );
      res.emit('end');
    });
    const deltas: string[] = [];
    const outcome = await streamNarrative((t) => deltas.push(t), 'system prompt', 'user message');
    expect(outcome).toEqual({ ok: true, provider: 'openai', model: 'gpt-4o-mini' });
    expect(deltas).toEqual(['Hi ', 'there']);
    const o = opts();
    expect(o.hostname).toBe('api.openai.com');
    expect(o.path).toBe('/v1/chat/completions');
    expect((o.headers as Record<string, unknown>).authorization).toBe('Bearer sk-test');
    expect(typeof (o.headers as Record<string, unknown>)['content-length']).toBe('number');
    const body = JSON.parse(req.write.mock.calls[0][0] as string);
    expect(body).toMatchObject({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'user message' },
      ],
      stream: true,
    });
  });

  it('streams an Anthropic SSE response and shapes the request correctly', async () => {
    vi.mocked(getLlmConfig).mockReturnValue({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
    const { opts } = prime(https, (r, res) => {
      res.emit('data', Buffer.from('data: {"type":"content_block_delta","delta":{"text":"Mix"}}\n\n'));
      res.emit('end');
    });
    const deltas: string[] = [];
    const outcome = await streamNarrative((t) => deltas.push(t), 'sys', 'msg');
    expect(outcome).toEqual({ ok: true, provider: 'anthropic', model: 'claude-sonnet-4-6' });
    expect(deltas).toEqual(['Mix']);
    const o = opts();
    expect(o.hostname).toBe('api.anthropic.com');
    expect(o.path).toBe('/v1/messages');
    expect((o.headers as Record<string, unknown>)['x-api-key']).toBe('sk-test');
    expect((o.headers as Record<string, unknown>)['anthropic-version']).toBe('2023-06-01');
  });

  it('streams a Google SSE response with the key in the query string', async () => {
    vi.mocked(getLlmConfig).mockReturnValue({ provider: 'google', model: 'gemini-2.0-flash' });
    const { opts } = prime(https, (r, res) => {
      res.emit(
        'data',
        Buffer.from('data: {"candidates":[{"content":{"parts":[{"text":"EQ"}]}}]}\n\n'),
      );
      res.emit('end');
    });
    const deltas: string[] = [];
    const outcome = await streamNarrative((t) => deltas.push(t), 'sys', 'msg');
    expect(outcome).toEqual({ ok: true, provider: 'google', model: 'gemini-2.0-flash' });
    expect(deltas).toEqual(['EQ']);
    const o = opts();
    expect(o.path).toContain(':streamGenerateContent');
    expect(o.path).toContain('alt=sse');
    expect(o.path).toContain('key=sk-test');
  });

  it('reports a friendly 401 auth error with the key hint', async () => {
    prime(
      https,
      (r, res) => {
        res.emit('data', Buffer.from('{"error":{"message":"Incorrect API key"}}'));
        res.emit('end');
      },
      401,
    );
    const outcome = await streamNarrative(() => {}, 'sys', 'msg');
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toContain('Incorrect API key');
    expect(outcome.reason).toContain('platform.openai.com/api-keys');
  });

  it('reports the message body on a 429', async () => {
    prime(
      https,
      (r, res) => {
        res.emit('data', Buffer.from('{"error":{"message":"Rate limit exceeded"}}'));
        res.emit('end');
      },
      429,
    );
    const outcome = await streamNarrative(() => {}, 'sys', 'msg');
    expect(outcome).toEqual({ ok: false, reason: 'Rate limit exceeded' });
  });

  it('falls back to an HTTP status message for a non-JSON non-2xx body', async () => {
    prime(
      https,
      (r, res) => {
        res.emit('data', Buffer.from('oops'));
        res.emit('end');
      },
      500,
    );
    const outcome = await streamNarrative(() => {}, 'sys', 'msg');
    expect(outcome).toEqual({ ok: false, reason: 'HTTP 500' });
  });

  it('resolves on a request error event', async () => {
    primeError(https, new Error('DNS lookup failed'));
    const outcome = await streamNarrative(() => {}, 'sys', 'msg');
    expect(outcome).toEqual({ ok: false, reason: 'DNS lookup failed' });
  });

  it('resolves and destroys the request on a timeout', async () => {
    const req = makeReq();
    vi.mocked(https.request).mockImplementation(((_opts: unknown, _cb?: (r: unknown) => void) => req) as typeof https.request);
    const p = streamNarrative(() => {}, 'sys', 'msg');
    req.emit('timeout');
    const outcome = await p;
    expect(outcome).toEqual({ ok: false, reason: 'openai stopped responding (no data for 60s)' });
    expect(req.destroy).toHaveBeenCalled();
  });

  it('settles on a mid-stream error payload after a 200 and destroys the request', async () => {
    const { req } = prime(https, (r, res) => {
      res.emit('data', Buffer.from('data: {"error":{"message":"overloaded"}}\n\n'));
    });
    const outcome = await streamNarrative(() => {}, 'sys', 'msg');
    expect(outcome).toEqual({ ok: false, reason: 'overloaded' });
    expect(req.destroy).toHaveBeenCalled();
  });

  it('reports no model configured when a hosted provider has a key but no model, without making a request', async () => {
    vi.mocked(getLlmConfig).mockReturnValue({ provider: 'openai' });
    const outcome = await streamNarrative(() => {}, 'sys', 'msg');
    expect(outcome).toEqual({ ok: false, reason: 'No model configured — pick one in AI settings.' });
    expect(https.request).not.toHaveBeenCalled();
    expect(http.request).not.toHaveBeenCalled();
  });

  it('resolves a custom provider with no base URL via the buildChatRequest throw path', async () => {
    vi.mocked(getLlmConfig).mockReturnValue({ provider: 'custom', model: 'm' });
    const outcome = await streamNarrative(() => {}, 'sys', 'msg');
    expect(outcome).toEqual({ ok: false, reason: 'custom provider requires a base URL' });
    expect(https.request).not.toHaveBeenCalled();
    expect(http.request).not.toHaveBeenCalled();
  });

  it('routes a custom provider with a base URL over plain http', async () => {
    vi.mocked(getLlmConfig).mockReturnValue({
      provider: 'custom',
      model: 'm',
      apiBaseUrl: 'http://localhost:1234',
    });
    const { opts } = prime(http, (r, res) => {
      res.emit('end');
    });
    await streamNarrative(() => {}, 'sys', 'msg');
    expect(http.request).toHaveBeenCalled();
    const o = opts();
    expect(o.hostname).toBe('localhost');
    expect(o.path).toBe('/v1/chat/completions');
  });
});

describe('streamNarrative — provider selection → pi', () => {
  it('falls through to pi when a hosted provider has no key, with default pi binary', async () => {
    vi.mocked(getLlmConfig).mockReturnValue({ provider: 'openai' });
    vi.mocked(getApiKey).mockReturnValue(undefined);
    const child = makeChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const deltas: string[] = [];
    const p = streamNarrative((t) => deltas.push(t), 'sys', 'msg');
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());

    expect(spawn).toHaveBeenCalledWith(
      'pi',
      expect.arrayContaining(['--provider', 'openai']),
      expect.anything(),
    );
    child.stdout.emit('data', Buffer.from('text'));
    child.emit('close', 0);
    const outcome = await p;
    expect(outcome).toEqual({ ok: true, provider: 'openai', model: undefined });
    expect(deltas).toEqual(['text']);
  });

  it('spawns a custom pi binary with model args and the userData cwd', async () => {
    vi.mocked(getLlmConfig).mockReturnValue({ provider: 'copilot', model: 'gpt-5', piBin: '/opt/pi' });
    const child = makeChild();
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);

    const p = streamNarrative(() => {}, 'system', 'user message here');
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());

    const [bin, args, opts] = vi.mocked(spawn).mock.calls[0];
    expect(bin).toBe('/opt/pi');
    expect(args).toContain('--model');
    expect((args as string[])[(args as string[]).indexOf('--model') + 1]).toBe('gpt-5');
    expect((args as string[])[(args as string[]).length - 1]).toBe('user message here');
    expect(opts).toEqual({ stdio: ['ignore', 'pipe', 'pipe'], cwd: '/tmp/sb-llm-test' });

    child.emit('close', 0);
    await p;
  });

  it('reports the missing key without spawning, for both google and custom', async () => {
    vi.mocked(getApiKey).mockReturnValue(undefined);

    vi.mocked(getLlmConfig).mockReturnValue({ provider: 'google', model: 'm' });
    const outcomeGoogle = await streamNarrative(() => {}, 'sys', 'msg');
    expect(outcomeGoogle.ok).toBe(false);
    expect(outcomeGoogle.reason).toContain('No API key saved for google');

    vi.mocked(getLlmConfig).mockReturnValue({ provider: 'custom', model: 'm' });
    const outcomeCustom = await streamNarrative(() => {}, 'sys', 'msg');
    expect(outcomeCustom.ok).toBe(false);
    expect(outcomeCustom.reason).toContain('No API key saved for custom');

    expect(spawn).not.toHaveBeenCalled();
  });

  it('reports pi-not-found on ENOENT, and a generic failure for other spawn errors', async () => {
    vi.mocked(getLlmConfig).mockReturnValue({ provider: 'copilot' });
    const child1 = makeChild();
    vi.mocked(spawn).mockReturnValue(child1 as unknown as ReturnType<typeof spawn>);
    const p1 = streamNarrative(() => {}, 'sys', 'msg');
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    child1.emit('error', Object.assign(new Error('spawn pi ENOENT'), { code: 'ENOENT' }));
    const outcome1 = await p1;
    expect(outcome1.ok).toBe(false);
    expect(outcome1.reason).toMatch(/^pi not found/);

    vi.clearAllMocks();
    vi.mocked(isAiEnabled).mockReturnValue(true);
    vi.mocked(getLlmConfig).mockReturnValue({ provider: 'copilot' });
    const child2 = makeChild();
    vi.mocked(spawn).mockReturnValue(child2 as unknown as ReturnType<typeof spawn>);
    const p2 = streamNarrative(() => {}, 'sys', 'msg');
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    child2.emit('error', Object.assign(new Error('boom'), { code: 'EACCES' }));
    const outcome2 = await p2;
    expect(outcome2.ok).toBe(false);
    expect(outcome2.reason).toMatch(/^failed to run/);
  });

  it('reports trimmed stderr on a nonzero close, and a generic message when stderr is empty', async () => {
    vi.mocked(getLlmConfig).mockReturnValue({ provider: 'copilot' });
    const child1 = makeChild();
    vi.mocked(spawn).mockReturnValue(child1 as unknown as ReturnType<typeof spawn>);
    const p1 = streamNarrative(() => {}, 'sys', 'msg');
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    child1.stderr.emit('data', Buffer.from('  something broke  \n'));
    child1.emit('close', 3);
    const outcome1 = await p1;
    expect(outcome1).toEqual({ ok: false, reason: 'something broke' });

    vi.clearAllMocks();
    vi.mocked(isAiEnabled).mockReturnValue(true);
    vi.mocked(getLlmConfig).mockReturnValue({ provider: 'copilot' });
    const child2 = makeChild();
    vi.mocked(spawn).mockReturnValue(child2 as unknown as ReturnType<typeof spawn>);
    const p2 = streamNarrative(() => {}, 'sys', 'msg');
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    child2.emit('close', 3);
    const outcome2 = await p2;
    expect(outcome2).toEqual({ ok: false, reason: 'pi exited with code 3' });
  });

  it('resolves failed to spawn when spawn throws synchronously', async () => {
    vi.mocked(getLlmConfig).mockReturnValue({ provider: 'copilot' });
    vi.mocked(spawn).mockImplementation(() => {
      throw new Error('EMFILE');
    });
    const outcome = await streamNarrative(() => {}, 'sys', 'msg');
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toMatch(/^failed to spawn/);
  });
});

describe('probeOllama', () => {
  it('lists non-empty model names on a happy GET /api/tags', async () => {
    const { opts } = prime(http, (r, res) => {
      res.emit('data', Buffer.from('{"models":[{"name":"llama3.2"},{"name":""},{}]}'));
      res.emit('end');
    });
    const result = await probeOllama();
    expect(result).toEqual({ ok: true, models: ['llama3.2'] });
    const o = opts();
    expect(o.method).toBe('GET');
    expect(o.path).toBe('/api/tags');
    expect(o.hostname).toBe('localhost');
    expect(o.port).toBe('11434');
  });

  it('normalizes a custom bare host:port argument', async () => {
    const { opts } = prime(http, (r, res) => {
      res.emit('data', Buffer.from('{"models":[]}'));
      res.emit('end');
    });
    await probeOllama('box:9999');
    const o = opts();
    expect(o.hostname).toBe('box');
    expect(o.port).toBe('9999');
  });

  it('reports a friendly message on a non-200 status', async () => {
    prime(
      http,
      (r, res) => {
        res.emit('end');
      },
      500,
    );
    const result = await probeOllama();
    expect(result).toEqual({ ok: false, reason: 'Ollama answered HTTP 500 at http://localhost:11434' });
  });

  it('reports not-running for ECONNREFUSED and ENOTFOUND', async () => {
    primeError(http, Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    const result1 = await probeOllama();
    expect(result1).toEqual({ ok: false, reason: 'not-running' });

    vi.clearAllMocks();
    vi.mocked(isAiEnabled).mockReturnValue(true);
    primeError(http, Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }));
    const result2 = await probeOllama();
    expect(result2).toEqual({ ok: false, reason: 'not-running' });
  });

  it('resolves with the JSON.parse error message for a non-JSON 200 body', async () => {
    prime(http, (r, res) => {
      res.emit('data', Buffer.from('<html>'));
      res.emit('end');
    });
    const result = await probeOllama();
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('reports the destroy-triggered error message on a timeout', async () => {
    const req = makeReq();
    vi.mocked(http.request).mockImplementation(((_opts: unknown, _cb?: (r: unknown) => void) => req) as typeof http.request);
    const p = probeOllama();
    req.emit('timeout');
    const result = await p;
    expect(result).toEqual({ ok: false, reason: 'connection timed out' });
  });
});

describe('testHostedProvider', () => {
  it('rejects an unknown provider without any key lookup or request', async () => {
    const result = await testHostedProvider({ provider: 'copilot' });
    expect(result).toEqual({ ok: false, reason: 'unknown provider: copilot' });
    expect(getApiKey).not.toHaveBeenCalled();
    expect(http.request).not.toHaveBeenCalled();
    expect(https.request).not.toHaveBeenCalled();
  });

  it('reports paste-a-key when no explicit key and no stored key', async () => {
    vi.mocked(getApiKey).mockReturnValue(undefined);
    const result = await testHostedProvider({ provider: 'openai' });
    expect(result).toEqual({ ok: false, reason: 'Paste an API key first.' });
  });

  it('uses the trimmed explicit key over the stored one', async () => {
    const { opts } = prime(https, (r, res) => {
      res.emit('data', Buffer.from('{}'));
      res.emit('end');
    });
    const result = await testHostedProvider({ provider: 'openai', apiKey: ' sk-x ' });
    expect(result).toEqual({ ok: true });
    const o = opts();
    expect(o.path).toBe('/v1/models');
    expect(o.method).toBe('GET');
    expect((o.headers as Record<string, unknown>).authorization).toBe('Bearer sk-x');
    expect(getApiKey).not.toHaveBeenCalled();
  });

  it('falls back to the stored key when the explicit key is blank', async () => {
    vi.mocked(getApiKey).mockReturnValue('sk-stored');
    const { opts } = prime(https, (r, res) => {
      res.emit('data', Buffer.from('{}'));
      res.emit('end');
    });
    const result = await testHostedProvider({ provider: 'anthropic', apiKey: '  ' });
    expect(result).toEqual({ ok: true });
    expect((opts().headers as Record<string, unknown>)['x-api-key']).toBe('sk-stored');
  });

  it('reports the check-your-key hint on a 401', async () => {
    prime(
      https,
      (r, res) => {
        res.emit('data', Buffer.from('{"error":{"message":"bad key"}}'));
        res.emit('end');
      },
      401,
    );
    const result = await testHostedProvider({ provider: 'openai', apiKey: 'sk-x' });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('check your key at');
  });

  it('resolves the buildModelsRequest throw for a custom provider with no base URL', async () => {
    const result = await testHostedProvider({ provider: 'custom', apiKey: 'k' });
    expect(result).toEqual({ ok: false, reason: 'custom provider requires a base URL' });
  });

  it('resolves the network error message when the request errors', async () => {
    primeError(https, new Error('network down'));
    const result = await testHostedProvider({ provider: 'openai', apiKey: 'sk-x' });
    expect(result).toEqual({ ok: false, reason: 'network down' });
  });
});
