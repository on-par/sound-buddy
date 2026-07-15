// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { EventEmitter } from 'events';
import * as http from 'http';
import * as https from 'https';

vi.mock('http', () => ({ request: vi.fn(), get: vi.fn() }));
vi.mock('https', () => ({ request: vi.fn(), get: vi.fn() }));

import { probeOllama } from './ollama-probe';

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

function resetMocks(): void {
  vi.clearAllMocks();
}

beforeEach(resetMocks);

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

    resetMocks();
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
