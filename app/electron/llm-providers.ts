// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure provider metadata for the hosted (API-key) LLM path — no Electron, no
// I/O, so the request-shaping and stream-parsing logic is unit-testable.
//
// Three wire dialects cover every hosted provider we support:
//   • 'openai-sse'    — POST /v1/chat/completions, SSE `data:` lines, deltas at
//                       choices[0].delta.content. Used by OpenAI and by any
//                       OpenAI-compatible "custom" endpoint (LM Studio, vLLM,
//                       OpenRouter, …).
//   • 'anthropic-sse' — POST /v1/messages, SSE events, deltas at
//                       content_block_delta → delta.text.
//   • 'google-sse'    — POST :streamGenerateContent?alt=sse, deltas at
//                       candidates[0].content.parts[].text.

export type HostedProviderId = 'openai' | 'anthropic' | 'google' | 'custom';

export type StreamKind = 'openai-sse' | 'anthropic-sse' | 'google-sse';

export interface HttpRequestSpec {
  url: string;
  headers: Record<string, string>;
  method: 'GET' | 'POST';
  body?: string;
}

interface ProviderMeta {
  label: string;
  /** Where the user creates a key — shown in provider-specific auth errors. */
  keyUrl: string;
  defaultBaseUrl: string;
  /** Placeholder model shown in the UI; never silently used as a real default. */
  modelHint: string;
  kind: StreamKind;
}

export const HOSTED_PROVIDERS: Record<HostedProviderId, ProviderMeta> = {
  openai: {
    label: 'OpenAI',
    keyUrl: 'https://platform.openai.com/api-keys',
    defaultBaseUrl: 'https://api.openai.com',
    modelHint: 'gpt-4o-mini',
    kind: 'openai-sse',
  },
  anthropic: {
    label: 'Anthropic',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    defaultBaseUrl: 'https://api.anthropic.com',
    modelHint: 'claude-sonnet-4-6',
    kind: 'anthropic-sse',
  },
  google: {
    label: 'Google',
    keyUrl: 'https://aistudio.google.com/apikey',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    modelHint: 'gemini-2.0-flash',
    kind: 'google-sse',
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    keyUrl: '',
    defaultBaseUrl: '',
    modelHint: 'model-name',
    kind: 'openai-sse',
  },
};

export function isHostedProvider(p: string | undefined): p is HostedProviderId {
  return p === 'openai' || p === 'anthropic' || p === 'google' || p === 'custom';
}

/**
 * Normalize a user-typed endpoint ("localhost:11434", "box:80/") to a URL with
 * an explicit scheme. Without one, `new URL('localhost:11434')` parses
 * "localhost:" as the *protocol* and connects to the wrong place entirely.
 */
export function normalizeHostUrl(host: string): string {
  const trimmed = host.trim().replace(/\/+$/, '');
  if (!trimmed) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

// Only the "custom" provider honors a base-URL override — a stale apiBaseUrl
// left in llm.json (e.g. after switching custom → OpenAI) must never receive
// a known provider's key.
function baseFor(provider: HostedProviderId, baseUrl?: string): string {
  const base = (provider === 'custom' ? baseUrl || '' : HOSTED_PROVIDERS[provider].defaultBaseUrl)
    .replace(/\/+$/, '');
  if (!base) throw new Error('custom provider requires a base URL');
  return base;
}

/**
 * A cheap authenticated request that proves the key works — the "Test
 * connection" button. Model-listing endpoints are free on every provider.
 */
export function buildModelsRequest(
  provider: HostedProviderId,
  apiKey: string,
  baseUrl?: string,
): HttpRequestSpec {
  const base = baseFor(provider, baseUrl);
  switch (provider) {
    case 'anthropic':
      return {
        url: `${base}/v1/models`,
        method: 'GET',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      };
    case 'google':
      return {
        url: `${base}/v1beta/models?key=${encodeURIComponent(apiKey)}`,
        method: 'GET',
        headers: {},
      };
    default: // openai + custom (OpenAI-compatible)
      return {
        url: `${base}/v1/models`,
        method: 'GET',
        headers: { authorization: `Bearer ${apiKey}` },
      };
  }
}

/** The streaming chat request for the narrative itself. */
export function buildChatRequest(
  provider: HostedProviderId,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  baseUrl?: string,
): HttpRequestSpec & { kind: StreamKind } {
  const base = baseFor(provider, baseUrl);
  const kind = HOSTED_PROVIDERS[provider].kind;
  switch (kind) {
    case 'anthropic-sse':
      return {
        kind,
        url: `${base}/v1/messages`,
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 2048,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
          stream: true,
        }),
      };
    case 'google-sse':
      return {
        kind,
        url: `${base}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        }),
      };
    default: // openai-sse
      return {
        kind,
        url: `${base}/v1/chat/completions`,
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          stream: true,
        }),
      };
  }
}

/**
 * Extract the text delta from one parsed SSE `data:` JSON payload, or null when
 * the event carries no text (pings, role headers, stop events, …).
 */
export function extractDelta(kind: StreamKind, data: unknown): string | null {
  if (data == null || typeof data !== 'object') return null;
  // Every provider's SSE payload shape differs and is checked defensively
  // below (optional chaining + typeof guards) rather than modeled — `any`
  // is the pragmatic type for an untyped, provider-varying JSON blob.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as Record<string, any>;
  switch (kind) {
    case 'anthropic-sse': {
      if (d.type === 'content_block_delta' && typeof d.delta?.text === 'string') return d.delta.text;
      return null;
    }
    case 'google-sse': {
      const parts = d.candidates?.[0]?.content?.parts;
      if (!Array.isArray(parts)) return null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = parts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('');
      return text || null;
    }
    default: {
      const delta = d.choices?.[0]?.delta?.content;
      return typeof delta === 'string' && delta ? delta : null;
    }
  }
}

/**
 * Extract an in-stream error from one parsed SSE payload, or null when the
 * event isn't an error. Providers can fail AFTER the 200 (Anthropic
 * `overloaded_error`, OpenAI-compatible `{error:{…}}` objects) — a stream that
 * ends on one of these must not be reported as a successful narrative.
 */
export function extractStreamError(kind: StreamKind, data: unknown): string | null {
  if (data == null || typeof data !== 'object') return null;
  // Same untyped, provider-varying SSE payload as extractDelta() above.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as Record<string, any>;
  if (kind === 'anthropic-sse') {
    if (d.type === 'error') return d.error?.message || d.error?.type || 'provider error';
    return null;
  }
  // openai-sse + google-sse both surface `{ error: {...} }` payloads.
  if (d.error) {
    if (typeof d.error === 'string') return d.error;
    return d.error.message || d.error.status || 'provider error';
  }
  return null;
}

/**
 * Extract an error message from a provider's non-2xx JSON body, falling back to
 * a provider-specific "check your key" hint for auth failures. Every provider
 * wraps errors differently; all of them bury a human-readable `message`.
 */
export function friendlyHttpError(
  provider: HostedProviderId,
  status: number,
  body: string,
): string {
  let message = '';
  try {
    // Non-2xx bodies are untyped JSON that varies per provider (see above).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = JSON.parse(body) as Record<string, any>;
    message =
      parsed.error?.message || parsed.message || (typeof parsed.error === 'string' ? parsed.error : '');
  } catch {
    // non-JSON body — fall through to the status-based message
  }
  if (status === 401 || status === 403) {
    const keyUrl = HOSTED_PROVIDERS[provider].keyUrl;
    const hint = keyUrl ? ` — check your key at ${keyUrl}` : ' — check your API key';
    return `${message || `Authentication failed (HTTP ${status})`}${hint}`;
  }
  return message || `HTTP ${status}`;
}

/**
 * Incremental SSE parser: feed raw chunks, get each `data:` payload string back
 * via the callback (without the `data:` prefix). Handles multi-line buffering
 * and the OpenAI `[DONE]` sentinel (swallowed, never emitted).
 */
export function createSseParser(onData: (payload: string) => void): {
  feed: (chunk: string) => void;
  flush: () => void;
} {
  let buffer = '';
  const consume = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    onData(payload);
  };
  return {
    feed(chunk: string) {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) consume(line);
    },
    flush() {
      if (buffer) consume(buffer);
      buffer = '';
    },
  };
}
