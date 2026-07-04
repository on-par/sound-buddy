// LLM narrative provider for the optional "AI Engineer" panel.
//
// Two backends, chosen by the configured provider:
//
//   • "ollama"  → direct HTTP to a local Ollama server (POST /api/chat). Fully
//     offline, no account, no external CLI. Works inside Electron's bundled Node
//     (plain http, no undici). This is the recommended path for a no-cloud machine.
//
//   • a hosted provider WITH a stored API key ("openai", "anthropic", "google",
//     "custom") → direct HTTPS streaming to the provider's own API (#76). No
//     extra install — paste a key in AI settings and it just works.
//
//   • anything else ("copilot", a hosted provider with no key, …) → the pi CLI
//     (@earendil-works/pi-coding-agent), which lets users power the narrative with
//     their OWN subscription via `pi` + /login (creds in ~/.pi/agent/auth.json,
//     auto-refreshed). pi runs as a SUBPROCESS because it needs Node >=22.19 /
//     undici v8 and can't load inside Electron 31 (Node 20).
//
// Config comes from env vars (handy in dev) or llm.json in the app's user-data
// dir — owned by llm-config.ts, edited through the AI settings screen (#76):
//   { "provider": "ollama", "model": "llama3.2" }
//   { "provider": "anthropic", "model": "claude-sonnet-4-6", "apiKeyEnc": "…" }

import { spawn } from 'child_process';
import * as http from 'http';
import * as https from 'https';
import { app } from 'electron';
import { isAiEnabled } from './settings';
import { DEFAULT_OLLAMA_HOST, getApiKey, getLlmConfig } from './llm-config';
import {
  buildChatRequest,
  buildModelsRequest,
  createSseParser,
  extractDelta,
  friendlyHttpError,
  isHostedProvider,
  type HostedProviderId,
  type HttpRequestSpec,
} from './llm-providers';

export interface NarrativeOutcome {
  ok: boolean;
  provider?: string;
  model?: string;
  /**
   * 'disabled' when AI is turned off in settings (default), 'no-provider' when
   * AI is enabled but nothing is configured; otherwise an error string.
   */
  reason?: string;
}

export async function streamNarrative(
  onDelta: (text: string) => void,
  systemPrompt: string,
  userMessage: string,
): Promise<NarrativeOutcome> {
  // Master AI switch (off by default). Keeps every provider path wired in but
  // short-circuits before any subprocess/network call when AI is disabled.
  if (!isAiEnabled()) return { ok: false, reason: 'disabled' };

  const cfg = getLlmConfig();
  if (!cfg.provider) return { ok: false, reason: 'no-provider' };

  if (cfg.provider === 'ollama') {
    return streamOllama(
      onDelta,
      systemPrompt,
      userMessage,
      cfg.model || 'llama3.2',
      cfg.ollamaHost || DEFAULT_OLLAMA_HOST,
    );
  }

  // Hosted provider with a pasted key → talk to the provider directly. Without
  // a key (e.g. a pre-#76 config, or "copilot"), fall through to pi.
  if (isHostedProvider(cfg.provider)) {
    const apiKey = getApiKey();
    if (apiKey) {
      if (!cfg.model) {
        return { ok: false, reason: 'No model configured — pick one in AI settings.' };
      }
      return streamHosted(onDelta, systemPrompt, userMessage, cfg.provider, apiKey, cfg.model, cfg.apiBaseUrl);
    }
  }

  return streamPi(onDelta, systemPrompt, userMessage, cfg.provider, cfg.model, cfg.piBin || 'pi');
}

// ─── Ollama (direct HTTP, offline) ──────────────────────────────────────────────
// Mirrors packages/audio-engine/src/engineer.ts:analyzeWithOllama — NDJSON stream
// from /api/chat, one JSON object per line: { message: { content }, done }.
function streamOllama(
  onDelta: (text: string) => void,
  systemPrompt: string,
  userMessage: string,
  model: string,
  host: string,
): Promise<NarrativeOutcome> {
  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    stream: true,
  });
  const url = new URL('/api/chat', host);
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise<NarrativeOutcome>((resolve) => {
    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      },
      (res) => {
        let buffer = '';
        let settled = false;
        const consume = (line: string): void => {
          const trimmed = line.trim();
          if (!trimmed) return;
          try {
            const json = JSON.parse(trimmed) as {
              message?: { content?: string };
              done?: boolean;
              error?: string;
            };
            if (json.error && !settled) {
              settled = true;
              resolve({ ok: false, reason: json.error });
              return;
            }
            if (json.message?.content) onDelta(json.message.content);
          } catch {
            // ignore malformed lines
          }
        };
        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) consume(line);
        });
        res.on('end', () => {
          if (buffer) consume(buffer);
          if (!settled) resolve({ ok: true, provider: 'ollama', model });
        });
        res.on('error', (err: Error) => {
          if (!settled) { settled = true; resolve({ ok: false, reason: err.message }); }
        });
      },
    );
    req.on('error', (err: NodeJS.ErrnoException) => {
      resolve({
        ok: false,
        reason: err.code === 'ECONNREFUSED'
          ? `Ollama not reachable at ${host} — start it with \`ollama serve\` (or install a model with \`ollama pull ${model}\`)`
          : err.message,
      });
    });
    req.write(body);
    req.end();
  });
}

// ─── pi CLI (subscriptions / API keys) ─────────────────────────────────────────
function streamPi(
  onDelta: (text: string) => void,
  systemPrompt: string,
  userMessage: string,
  provider: string,
  model: string | undefined,
  piBin: string,
): Promise<NarrativeOutcome> {
  const args = [
    '--print',
    '--no-tools',
    '--no-session',
    '--mode', 'text',
    '--provider', provider,
    '--system-prompt', systemPrompt,
  ];
  if (model) args.push('--model', model);
  args.push(userMessage);

  return new Promise<NarrativeOutcome>((resolve) => {
    let child;
    try {
      child = spawn(piBin, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd: app.getPath('userData') });
    } catch (err) {
      resolve({ ok: false, reason: `failed to spawn ${piBin}: ${String(err)}` });
      return;
    }
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => onDelta(chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', (err: NodeJS.ErrnoException) => {
      resolve({
        ok: false,
        reason: err.code === 'ENOENT'
          ? 'pi not found — install it (npm i -g @earendil-works/pi-coding-agent, needs Node 22+) and run `pi` then /login'
          : `failed to run ${piBin}: ${err.message}`,
      });
    });
    child.on('close', (code) => {
      if (code === 0) resolve({ ok: true, provider, model });
      else resolve({ ok: false, reason: stderr.trim() || `pi exited with code ${code}` });
    });
  });
}

// ─── Hosted providers (direct HTTPS, #76) ──────────────────────────────────────

function transportFor(url: URL): typeof http | typeof https {
  return url.protocol === 'https:' ? https : http;
}

/**
 * Stream a chat request straight to a hosted provider using the pasted key.
 * All three wire dialects (OpenAI / Anthropic / Google) are SSE `data:` lines;
 * llm-providers.ts owns the per-provider request shape and delta extraction.
 */
function streamHosted(
  onDelta: (text: string) => void,
  systemPrompt: string,
  userMessage: string,
  provider: HostedProviderId,
  apiKey: string,
  model: string,
  apiBaseUrl?: string,
): Promise<NarrativeOutcome> {
  let spec: ReturnType<typeof buildChatRequest>;
  try {
    spec = buildChatRequest(provider, apiKey, model, systemPrompt, userMessage, apiBaseUrl);
  } catch (err) {
    return Promise.resolve({ ok: false, reason: String(err instanceof Error ? err.message : err) });
  }
  const url = new URL(spec.url);

  return new Promise<NarrativeOutcome>((resolve) => {
    const req = transportFor(url).request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: spec.method,
        headers: { ...spec.headers, 'content-length': Buffer.byteLength(spec.body || '') },
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status < 200 || status >= 300) {
          let body = '';
          res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          res.on('end', () => resolve({ ok: false, reason: friendlyHttpError(provider, status, body) }));
          return;
        }
        const parser = createSseParser((payload) => {
          try {
            const delta = extractDelta(spec.kind, JSON.parse(payload));
            if (delta) onDelta(delta);
          } catch {
            // ignore malformed SSE payloads
          }
        });
        res.on('data', (chunk: Buffer) => parser.feed(chunk.toString()));
        res.on('end', () => {
          parser.flush();
          resolve({ ok: true, provider, model });
        });
        res.on('error', (err: Error) => resolve({ ok: false, reason: err.message }));
      },
    );
    req.on('error', (err: Error) => resolve({ ok: false, reason: err.message }));
    if (spec.body) req.write(spec.body);
    req.end();
  });
}

// ─── Settings-screen probes (#76) ──────────────────────────────────────────────

export interface ProbeResult {
  ok: boolean;
  /** Model names, when the probe yields them (Ollama tags, provider lists). */
  models?: string[];
  reason?: string;
}

const PROBE_TIMEOUT_MS = 10_000;

/** Minimal one-shot HTTP request for probes/tests (no streaming). */
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
  const base = (host?.trim() || DEFAULT_OLLAMA_HOST).replace(/\/+$/, '');
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

/**
 * "Test connection" for a hosted provider: hit its free model-list endpoint
 * with the supplied key (or the stored one when the field was left untouched).
 */
export async function testHostedProvider(opts: {
  provider: string;
  apiKey?: string;
  apiBaseUrl?: string;
}): Promise<ProbeResult> {
  if (!isHostedProvider(opts.provider)) {
    return { ok: false, reason: `unknown provider: ${opts.provider}` };
  }
  const apiKey = opts.apiKey?.trim() || getApiKey();
  if (!apiKey) return { ok: false, reason: 'Paste an API key first.' };

  let spec: HttpRequestSpec;
  try {
    spec = buildModelsRequest(opts.provider, apiKey, opts.apiBaseUrl?.trim() || undefined);
  } catch (err) {
    return { ok: false, reason: String(err instanceof Error ? err.message : err) };
  }
  try {
    const { status, body } = await probeRequest(spec);
    if (status < 200 || status >= 300) {
      return { ok: false, reason: friendlyHttpError(opts.provider, status, body) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as Error).message || String(err) };
  }
}
