// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Local-network model *discovery* for the AI settings screen's Ollama tab
// (#76) — is Ollama running at this host, and which models does it have?
// GET /api/tags, not /api/chat: this is NOT narrative streaming (that flows
// through narrative-port.ts's Pi bridge) and NOT hosted-provider code.

import * as http from 'http';
import * as https from 'https';
import { DEFAULT_OLLAMA_HOST, normalizeHostUrl } from './llm-config';

export interface ProbeResult {
  ok: boolean;
  /** Model names, when the probe yields them (Ollama tags). */
  models?: string[];
  reason?: string;
}

const PROBE_TIMEOUT_MS = 10_000;

interface HttpRequestSpec {
  url: string;
  headers: Record<string, string>;
  method: 'GET' | 'POST';
  body?: string;
}

function transportFor(url: URL): typeof http | typeof https {
  return url.protocol === 'https:' ? https : http;
}

/** Minimal one-shot HTTP request for the probe (no streaming). */
function probeRequest(spec: HttpRequestSpec): Promise<{ status: number; body: string }> {
  const url = new URL(spec.url);
  return new Promise((resolve, reject) => {
    const req = transportFor(url).request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: spec.method,
        headers: spec.body
          ? { ...spec.headers, 'content-length': Buffer.byteLength(spec.body) }
          : spec.headers,
        timeout: PROBE_TIMEOUT_MS,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => resolve({ status: res.statusCode || 0, body }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('connection timed out')));
    req.on('error', reject);
    if (spec.body) req.write(spec.body);
    req.end();
  });
}

/**
 * Is Ollama running at `host`, and which models does it have? GET /api/tags —
 * the settings screen calls this on open (auto-detect) and on "Test connection".
 */
export async function probeOllama(host?: string): Promise<ProbeResult> {
  const base = normalizeHostUrl(host || '') || DEFAULT_OLLAMA_HOST;
  try {
    const { status, body } = await probeRequest({ url: `${base}/api/tags`, method: 'GET', headers: {} });
    if (status !== 200) return { ok: false, reason: `Ollama answered HTTP ${status} at ${base}` };
    const parsed = JSON.parse(body) as { models?: Array<{ name?: string }> };
    const models = (parsed.models || []).map((m) => m.name || '').filter(Boolean);
    return { ok: true, models };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return {
      ok: false,
      reason: e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND'
        ? `not-running`
        : e.message || String(err),
    };
  }
}
