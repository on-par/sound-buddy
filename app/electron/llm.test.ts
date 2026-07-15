// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isAiEnabled } from './settings';
import { getLlmConfig } from './llm-config';

vi.mock('./settings', () => ({ isAiEnabled: vi.fn() }));
vi.mock('./llm-config', () => ({
  getLlmConfig: vi.fn(),
  HOSTED_PROVIDER_IDS: new Set(['openai', 'anthropic', 'google', 'custom']),
}));
vi.mock('./narrative-port', () => ({ getNarrativePort: vi.fn() }));

import { getNarrativePort } from './narrative-port';
import { streamNarrative } from './llm';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isAiEnabled).mockReturnValue(true);
});

describe('streamNarrative gating', () => {
  it('resolves disabled without loading a port when AI is off', async () => {
    vi.mocked(isAiEnabled).mockReturnValue(false);
    const result = await streamNarrative(vi.fn(), 'sys', 'user');
    expect(result).toEqual({ ok: false, reason: 'disabled' });
    expect(getNarrativePort).not.toHaveBeenCalled();
  });

  it('resolves no-provider without loading a port when nothing is configured', async () => {
    vi.mocked(getLlmConfig).mockReturnValue({});
    const result = await streamNarrative(vi.fn(), 'sys', 'user');
    expect(result).toEqual({ ok: false, reason: 'no-provider' });
    expect(getNarrativePort).not.toHaveBeenCalled();
  });

  it('rejects a hosted provider with no model configured, without loading a port', async () => {
    vi.mocked(getLlmConfig).mockReturnValue({ provider: 'openai' });
    const result = await streamNarrative(vi.fn(), 'sys', 'user');
    expect(result).toEqual({
      ok: false,
      reason: 'No model configured — pick one in AI settings.',
    });
    expect(getNarrativePort).not.toHaveBeenCalled();
  });

  it('does not require a model for ollama', async () => {
    vi.mocked(getLlmConfig).mockReturnValue({ provider: 'ollama' });
    const port = { streamNarrative: vi.fn().mockResolvedValue({ ok: true, provider: 'ollama', model: 'llama3.2' }) };
    vi.mocked(getNarrativePort).mockResolvedValue({ port } as never);
    const result = await streamNarrative(vi.fn(), 'sys', 'user');
    expect(result).toEqual({ ok: true, provider: 'ollama', model: 'llama3.2' });
  });

  it('does not require a model for a pi pass-through provider', async () => {
    vi.mocked(getLlmConfig).mockReturnValue({ provider: 'github-copilot' });
    const port = { streamNarrative: vi.fn().mockResolvedValue({ ok: true, provider: 'github-copilot', model: 'default' }) };
    vi.mocked(getNarrativePort).mockResolvedValue({ port } as never);
    const result = await streamNarrative(vi.fn(), 'sys', 'user');
    expect(result).toEqual({ ok: true, provider: 'github-copilot', model: 'default' });
  });
});

describe('streamNarrative delegation', () => {
  it('delegates to the port and returns its result verbatim on success', async () => {
    vi.mocked(getLlmConfig).mockReturnValue({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
    const onDelta = vi.fn();
    const portStream = vi.fn().mockResolvedValue({ ok: true, provider: 'anthropic', model: 'claude-sonnet-4-6' });
    vi.mocked(getNarrativePort).mockResolvedValue({ port: { streamNarrative: portStream } } as never);

    const result = await streamNarrative(onDelta, 'sys', 'user');

    expect(portStream).toHaveBeenCalledWith('sys', 'user', onDelta);
    expect(result).toEqual({ ok: true, provider: 'anthropic', model: 'claude-sonnet-4-6' });
  });

  it('resolves the port stream failure verbatim (never throws)', async () => {
    vi.mocked(getLlmConfig).mockReturnValue({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
    const portStream = vi.fn().mockResolvedValue({ ok: false, reason: 'provider overloaded' });
    vi.mocked(getNarrativePort).mockResolvedValue({ port: { streamNarrative: portStream } } as never);

    const result = await streamNarrative(vi.fn(), 'sys', 'user');

    expect(result).toEqual({ ok: false, reason: 'provider overloaded' });
  });

  it('resolves the port-load error when the adapter fails to load', async () => {
    vi.mocked(getLlmConfig).mockReturnValue({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
    vi.mocked(getNarrativePort).mockResolvedValue({ error: 'AI engine failed to load: boom.' } as never);

    const result = await streamNarrative(vi.fn(), 'sys', 'user');

    expect(result).toEqual({ ok: false, reason: 'AI engine failed to load: boom.' });
  });
});
