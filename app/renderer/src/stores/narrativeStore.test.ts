// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createNarrativeStore, useNarrativeStore } from './narrativeStore';
import { createMockSoundBuddy } from '../mock-sound-buddy';

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useNarrativeStore.setState({
    narrativeText: '',
    isStreaming: false,
    streamError: null,
    provider: null,
    model: null,
    suppressDeltas: false,
  });
});

describe('createNarrativeStore', () => {
  it('starts with a fresh, idle state', () => {
    const mock = createMockSoundBuddy();
    const store = createNarrativeStore(() => mock.api);

    expect(store.getState().narrativeText).toBe('');
    expect(store.getState().isStreaming).toBe(false);
    expect(store.getState().streamError).toBeNull();
    expect(store.getState().provider).toBeNull();
    expect(store.getState().model).toBeNull();
  });

  it('runs the full streaming lifecycle', async () => {
    const mock = createMockSoundBuddy({
      getLlmConfig: async () => ({
        provider: 'anthropic',
        model: 'claude',
        ollamaHost: '',
        apiBaseUrl: '',
        hasApiKey: true,
        apiKeyProvider: 'anthropic',
      }),
      triggerLlmAnalysis: async (data) => {
        mock.calls.push({ method: 'triggerLlmAnalysis', args: [data] });
        return undefined;
      },
    });
    const store = createNarrativeStore(() => mock.api);
    store.getState().bindIpcEvents();

    const payload = { mode: 'file', analysis: {} };
    await store.getState().startNarrative(payload);

    expect(store.getState().isStreaming).toBe(true);
    expect(store.getState().provider).toBe('anthropic');
    expect(store.getState().model).toBe('claude');
    expect(mock.calls).toContainEqual({ method: 'triggerLlmAnalysis', args: [payload] });

    mock.emit('onLlmDelta', 'Hello ');
    mock.emit('onLlmDelta', 'world');
    expect(store.getState().narrativeText).toBe('Hello world');

    mock.emit('onLlmDone');
    expect(store.getState().isStreaming).toBe(false);
    expect(store.getState().narrativeText).toBe('Hello world');
  });

  it('treats a second startNarrative call while streaming as a no-op', async () => {
    const mock = createMockSoundBuddy({
      triggerLlmAnalysis: async (data) => {
        mock.calls.push({ method: 'triggerLlmAnalysis', args: [data] });
        return undefined;
      },
    });
    const store = createNarrativeStore(() => mock.api);

    await store.getState().startNarrative({ mode: 'file', analysis: {} });
    await store.getState().startNarrative({ mode: 'file', analysis: {} });

    expect(mock.calls.filter((c) => c.method === 'triggerLlmAnalysis')).toHaveLength(1);
  });

  it('stops accumulation after cancelNarrative mid-stream', async () => {
    const mock = createMockSoundBuddy();
    const store = createNarrativeStore(() => mock.api);
    store.getState().bindIpcEvents();

    await store.getState().startNarrative({ mode: 'file', analysis: {} });
    mock.emit('onLlmDelta', 'partial');
    expect(store.getState().narrativeText).toBe('partial');

    store.getState().cancelNarrative();
    expect(store.getState().isStreaming).toBe(false);
    expect(store.getState().narrativeText).toBe('partial');

    mock.emit('onLlmDelta', 'late');
    expect(store.getState().narrativeText).toBe('partial');
  });

  it('clears stale text and error when a new run starts', async () => {
    const mock = createMockSoundBuddy();
    const store = createNarrativeStore(() => mock.api);

    store.setState({ narrativeText: 'old text', streamError: 'old error' });

    await store.getState().startNarrative({ mode: 'file', analysis: {} });

    expect(store.getState().narrativeText).toBe('');
    expect(store.getState().streamError).toBeNull();
  });

  it('captures a rejected triggerLlmAnalysis promise as an error', async () => {
    const mock = createMockSoundBuddy({
      triggerLlmAnalysis: () => Promise.reject(new Error('llm exploded')),
    });
    const store = createNarrativeStore(() => mock.api);

    await store.getState().startNarrative({ mode: 'file', analysis: {} });

    expect(store.getState().isStreaming).toBe(false);
    expect(store.getState().streamError).toBe('llm exploded');
  });

  it('captures a rejected triggerLlmAnalysis promise that is not an Error instance', async () => {
    const mock = createMockSoundBuddy({
      triggerLlmAnalysis: () => Promise.reject('llm exploded'),
    });
    const store = createNarrativeStore(() => mock.api);

    await store.getState().startNarrative({ mode: 'file', analysis: {} });

    expect(store.getState().isStreaming).toBe(false);
    expect(store.getState().streamError).toBe('llm exploded');
  });

  it('an unsolicited delta while idle starts an implicit stream and renders (#423)', () => {
    const mock = createMockSoundBuddy();
    const store = createNarrativeStore(() => mock.api);
    store.getState().bindIpcEvents();

    expect(store.getState().isStreaming).toBe(false);
    mock.emit('onLlmDelta', 'Auto-triggered ');
    expect(store.getState().isStreaming).toBe(true);
    expect(store.getState().narrativeText).toBe('Auto-triggered ');

    mock.emit('onLlmDelta', 'analysis');
    expect(store.getState().narrativeText).toBe('Auto-triggered analysis');

    mock.emit('onLlmDone');
    expect(store.getState().isStreaming).toBe(false);
  });

  it('cancelNarrative suppresses the in-flight run\'s unsolicited deltas until onLlmDone', async () => {
    const mock = createMockSoundBuddy();
    const store = createNarrativeStore(() => mock.api);
    store.getState().bindIpcEvents();

    await store.getState().startNarrative({ mode: 'file', analysis: {} });
    mock.emit('onLlmDelta', 'partial');
    store.getState().cancelNarrative();
    expect(store.getState().isStreaming).toBe(false);

    // A late delta from the cancelled run must not restart an implicit
    // stream while suppressed.
    mock.emit('onLlmDelta', 'late');
    expect(store.getState().isStreaming).toBe(false);
    expect(store.getState().narrativeText).toBe('partial');

    // Once the cancelled run's onLlmDone lands, suppression clears — the
    // NEXT unsolicited delta (e.g. an auto-triggered live re-analysis) is
    // free to start a fresh implicit stream.
    mock.emit('onLlmDone');
    mock.emit('onLlmDelta', 'fresh');
    expect(store.getState().isStreaming).toBe(true);
    expect(store.getState().narrativeText).toBe('fresh');
  });

  it('binds the default hook to the window preload bridge', async () => {
    const mock = createMockSoundBuddy({
      triggerLlmAnalysis: async (data) => {
        mock.calls.push({ method: 'triggerLlmAnalysis', args: [data] });
        return undefined;
      },
    });
    (globalThis as { window?: unknown }).window = { soundBuddy: mock.api };

    await useNarrativeStore.getState().startNarrative({ mode: 'file', analysis: {} });

    expect(mock.calls).toContainEqual({
      method: 'triggerLlmAnalysis',
      args: [{ mode: 'file', analysis: {} }],
    });
  });
});
