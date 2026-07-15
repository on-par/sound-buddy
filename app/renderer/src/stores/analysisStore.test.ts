// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, afterEach } from 'vitest';
import { createAnalysisStore, useAnalysisStore } from './analysisStore';
import { createMockSoundBuddy } from '../mock-sound-buddy';

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  useAnalysisStore.setState({
    currentAnalysis: null,
    isAnalyzing: false,
    analysisProgress: null,
    analysisError: null,
  });
});

describe('createAnalysisStore', () => {
  it('starts with a fresh, idle state', () => {
    const mock = createMockSoundBuddy();
    const store = createAnalysisStore(() => mock.api);

    expect(store.getState().currentAnalysis).toBeNull();
    expect(store.getState().isAnalyzing).toBe(false);
    expect(store.getState().analysisProgress).toBeNull();
    expect(store.getState().analysisError).toBeNull();
  });

  it('runs the startAnalysis lifecycle to completion', async () => {
    const mock = createMockSoundBuddy({
      analyzeFile: async (opts) => {
        mock.calls.push({ method: 'analyzeFile', args: [opts] });
        return { success: true, data: { score: 42 } };
      },
    });
    const store = createAnalysisStore(() => mock.api);

    const pending = store.getState().startAnalysis('/path/to/file.wav');
    expect(store.getState().isAnalyzing).toBe(true);

    await pending;

    expect(store.getState().currentAnalysis).toEqual({ score: 42 });
    expect(store.getState().isAnalyzing).toBe(false);
    expect(store.getState().analysisError).toBeNull();
    expect(mock.calls).toContainEqual({
      method: 'analyzeFile',
      args: [{ filePath: '/path/to/file.wav' }],
    });
  });

  it('surfaces the failure envelope error message', async () => {
    const mock = createMockSoundBuddy({
      analyzeFile: async () => ({ success: false, error: 'sox exploded' }),
    });
    const store = createAnalysisStore(() => mock.api);

    await store.getState().startAnalysis('/path/to/file.wav');

    expect(store.getState().isAnalyzing).toBe(false);
    expect(store.getState().analysisError).toBe('sox exploded');
    expect(store.getState().currentAnalysis).toBeNull();
  });

  it('falls back to an actionable message when the failure envelope has no error string', async () => {
    const mock = createMockSoundBuddy({
      analyzeFile: async () => ({ success: false }),
    });
    const store = createAnalysisStore(() => mock.api);

    await store.getState().startAnalysis('/path/to/file.wav');

    expect(store.getState().isAnalyzing).toBe(false);
    expect(store.getState().analysisError).toMatch(/try again/i);
  });

  it('treats a cancelled envelope as not an error', async () => {
    const mock = createMockSoundBuddy({
      analyzeFile: async () => ({ success: false, cancelled: true }),
    });
    const store = createAnalysisStore(() => mock.api);

    await store.getState().startAnalysis('/path/to/file.wav');

    expect(store.getState().isAnalyzing).toBe(false);
    expect(store.getState().analysisError).toBeNull();
  });

  it('captures a rejected IPC promise as an error', async () => {
    const mock = createMockSoundBuddy({
      analyzeFile: () => Promise.reject(new Error('spawn failed')),
    });
    const store = createAnalysisStore(() => mock.api);

    await store.getState().startAnalysis('/path/to/file.wav');

    expect(store.getState().isAnalyzing).toBe(false);
    expect(store.getState().analysisError).toContain('spawn failed');
  });

  it('captures a rejected IPC promise that is not an Error instance', async () => {
    const mock = createMockSoundBuddy({
      analyzeFile: () => Promise.reject('spawn failed'),
    });
    const store = createAnalysisStore(() => mock.api);

    await store.getState().startAnalysis('/path/to/file.wav');

    expect(store.getState().isAnalyzing).toBe(false);
    expect(store.getState().analysisError).toBe('spawn failed');
  });

  it('clears stale progress/error state when a new run starts', () => {
    const mock = createMockSoundBuddy({
      analyzeFile: () => new Promise(() => {}),
    });
    const store = createAnalysisStore(() => mock.api);

    store.setState({ analysisError: 'old error', analysisProgress: { status: 'running' } });

    store.getState().startAnalysis('/path/to/file.wav');

    expect(store.getState().analysisError).toBeNull();
    expect(store.getState().analysisProgress).toBeNull();
  });

  it('delegates cancelAnalysis to the api', async () => {
    const mock = createMockSoundBuddy();
    const store = createAnalysisStore(() => mock.api);

    await store.getState().cancelAnalysis();

    expect(mock.calls).toContainEqual({ method: 'cancelAnalysis', args: [] });
  });

  it('binds progress and result IPC events', () => {
    const mock = createMockSoundBuddy();
    const store = createAnalysisStore(() => mock.api);
    store.setState({ isAnalyzing: true });

    store.getState().bindIpcEvents();

    mock.emit('onAnalysisProgress', { status: 'running', stage: 'spectrum' });
    expect(store.getState().analysisProgress).toEqual({ status: 'running', stage: 'spectrum' });

    mock.emit('onAnalysisResult', { grade: 'A' });
    expect(store.getState().currentAnalysis).toEqual({ grade: 'A' });
    expect(store.getState().isAnalyzing).toBe(false);
  });

  it('binds the default hook to the window preload bridge', async () => {
    const mock = createMockSoundBuddy({
      analyzeFile: async (opts) => {
        mock.calls.push({ method: 'analyzeFile', args: [opts] });
        return { success: true, data: { score: 1 } };
      },
    });
    (globalThis as { window?: unknown }).window = { soundBuddy: mock.api };

    await useAnalysisStore.getState().startAnalysis('/path/to/file.wav');

    expect(mock.calls).toContainEqual({
      method: 'analyzeFile',
      args: [{ filePath: '/path/to/file.wav' }],
    });
  });
});
