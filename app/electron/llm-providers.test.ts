import { describe, it, expect } from 'vitest';
import {
  buildModelsRequest,
  buildChatRequest,
  extractDelta,
  friendlyHttpError,
  createSseParser,
  isHostedProvider,
} from './llm-providers';

describe('isHostedProvider', () => {
  it('accepts exactly the four hosted ids', () => {
    expect(isHostedProvider('openai')).toBe(true);
    expect(isHostedProvider('anthropic')).toBe(true);
    expect(isHostedProvider('google')).toBe(true);
    expect(isHostedProvider('custom')).toBe(true);
    expect(isHostedProvider('ollama')).toBe(false);
    expect(isHostedProvider('copilot')).toBe(false);
    expect(isHostedProvider(undefined)).toBe(false);
  });
});

describe('buildModelsRequest', () => {
  it('shapes the OpenAI request with a Bearer header', () => {
    const spec = buildModelsRequest('openai', 'sk-live');
    expect(spec.url).toBe('https://api.openai.com/v1/models');
    expect(spec.headers.authorization).toBe('Bearer sk-live');
  });

  it('shapes the Anthropic request with x-api-key + version header', () => {
    const spec = buildModelsRequest('anthropic', 'sk-ant');
    expect(spec.url).toBe('https://api.anthropic.com/v1/models');
    expect(spec.headers['x-api-key']).toBe('sk-ant');
    expect(spec.headers['anthropic-version']).toBeTruthy();
  });

  it('puts the Google key in the query string, URL-encoded', () => {
    const spec = buildModelsRequest('google', 'k/ey');
    expect(spec.url).toBe('https://generativelanguage.googleapis.com/v1beta/models?key=k%2Fey');
    expect(spec.headers).toEqual({});
  });

  it('uses the custom base URL (trailing slash stripped) for custom providers', () => {
    const spec = buildModelsRequest('custom', 'k', 'http://localhost:1234/');
    expect(spec.url).toBe('http://localhost:1234/v1/models');
  });

  it('throws when custom has no base URL', () => {
    expect(() => buildModelsRequest('custom', 'k')).toThrow(/base URL/);
  });
});

describe('buildChatRequest', () => {
  it('OpenAI: system prompt travels as a system message, stream on', () => {
    const spec = buildChatRequest('openai', 'k', 'gpt-4o-mini', 'SYS', 'USER');
    expect(spec.kind).toBe('openai-sse');
    const body = JSON.parse(spec.body!);
    expect(body.stream).toBe(true);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'SYS' });
  });

  it('Anthropic: system prompt travels as top-level `system`', () => {
    const spec = buildChatRequest('anthropic', 'k', 'claude-sonnet-4-6', 'SYS', 'USER');
    expect(spec.kind).toBe('anthropic-sse');
    const body = JSON.parse(spec.body!);
    expect(body.system).toBe('SYS');
    expect(body.messages).toEqual([{ role: 'user', content: 'USER' }]);
  });

  it('Google: model is URL-encoded into the path with alt=sse', () => {
    const spec = buildChatRequest('google', 'k', 'gemini-2.0-flash', 'SYS', 'USER');
    expect(spec.kind).toBe('google-sse');
    expect(spec.url).toContain('/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse');
  });

  it('custom uses the OpenAI dialect against the given base', () => {
    const spec = buildChatRequest('custom', 'k', 'local-model', 'SYS', 'USER', 'http://localhost:1234');
    expect(spec.kind).toBe('openai-sse');
    expect(spec.url).toBe('http://localhost:1234/v1/chat/completions');
  });
});

describe('extractDelta', () => {
  it('openai-sse: reads choices[0].delta.content, ignores empty/absent deltas', () => {
    expect(extractDelta('openai-sse', { choices: [{ delta: { content: 'hi' } }] })).toBe('hi');
    expect(extractDelta('openai-sse', { choices: [{ delta: {} }] })).toBeNull();
    expect(extractDelta('openai-sse', {})).toBeNull();
  });

  it('anthropic-sse: reads content_block_delta text only', () => {
    expect(extractDelta('anthropic-sse', { type: 'content_block_delta', delta: { text: 'hi' } })).toBe('hi');
    expect(extractDelta('anthropic-sse', { type: 'message_start' })).toBeNull();
  });

  it('google-sse: joins candidate parts', () => {
    expect(
      extractDelta('google-sse', { candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] }),
    ).toBe('ab');
    expect(extractDelta('google-sse', { candidates: [{}] })).toBeNull();
  });

  it('tolerates junk without throwing', () => {
    expect(extractDelta('openai-sse', null)).toBeNull();
    expect(extractDelta('anthropic-sse', 'string')).toBeNull();
  });
});

describe('friendlyHttpError', () => {
  it('surfaces the provider message and appends a key hint on 401', () => {
    const msg = friendlyHttpError('openai', 401, JSON.stringify({ error: { message: 'Invalid key' } }));
    expect(msg).toContain('Invalid key');
    expect(msg).toContain('platform.openai.com');
  });

  it('falls back to a status line for a non-JSON body', () => {
    expect(friendlyHttpError('anthropic', 500, '<html>oops</html>')).toBe('HTTP 500');
  });

  it('gives the generic key hint for custom (no key console URL)', () => {
    expect(friendlyHttpError('custom', 403, '{}')).toContain('check your API key');
  });
});

describe('createSseParser', () => {
  it('emits each data: payload once across arbitrary chunk boundaries', () => {
    const got: string[] = [];
    const p = createSseParser((s) => got.push(s));
    p.feed('data: {"a"');
    p.feed(':1}\ndata: {"b":2}\n\nda');
    p.feed('ta: {"c":3}\n');
    p.flush();
    expect(got).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  it('swallows [DONE], event: lines, and blank lines', () => {
    const got: string[] = [];
    const p = createSseParser((s) => got.push(s));
    p.feed('event: message_start\ndata: {"x":1}\n\ndata: [DONE]\n');
    p.flush();
    expect(got).toEqual(['{"x":1}']);
  });

  it('flush() drains an unterminated final line', () => {
    const got: string[] = [];
    const p = createSseParser((s) => got.push(s));
    p.feed('data: {"tail":true}');
    expect(got).toEqual([]);
    p.flush();
    expect(got).toEqual(['{"tail":true}']);
  });
});
