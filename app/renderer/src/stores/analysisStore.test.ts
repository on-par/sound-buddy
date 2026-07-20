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
    status: 'idle',
    analysisProgress: null,
    analysisError: null,
    selectedFilePath: null,
    historySummary: null,
    liveSource: null,
    prevSummary: null,
    lastSavedSummaryFile: null,
  });
});

describe('createAnalysisStore', () => {
  it('starts with a fresh, idle state', () => {
    const mock = createMockSoundBuddy();
    const store = createAnalysisStore(() => mock.api);

    expect(store.getState().currentAnalysis).toBeNull();
    expect(store.getState().isAnalyzing).toBe(false);
    expect(store.getState().status).toBe('idle');
    expect(store.getState().analysisProgress).toBeNull();
    expect(store.getState().analysisError).toBeNull();
    expect(store.getState().selectedFilePath).toBeNull();
    expect(store.getState().historySummary).toBeNull();
    expect(store.getState().liveSource).toBeNull();
    expect(store.getState().prevSummary).toBeNull();
    expect(store.getState().lastSavedSummaryFile).toBeNull();
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
    expect(store.getState().status).toBe('analyzing');

    await pending;

    expect(store.getState().currentAnalysis).toEqual({ score: 42 });
    expect(store.getState().isAnalyzing).toBe(false);
    expect(store.getState().status).toBe('done');
    expect(store.getState().analysisError).toBeNull();
    expect(mock.calls).toContainEqual({
      method: 'analyzeFile',
      args: [{ filePath: '/path/to/file.wav' }],
    });
  });

  it('a successful startAnalysis clears a stale history summary', async () => {
    const mock = createMockSoundBuddy({
      analyzeFile: async () => ({ success: true, data: { score: 1 } }),
    });
    const store = createAnalysisStore(() => mock.api);
    store.setState({ historySummary: { sourceFilename: 'old.wav' } });

    await store.getState().startAnalysis('/path/to/file.wav');

    expect(store.getState().historySummary).toBeNull();
  });

  it('surfaces the failure envelope error message', async () => {
    const mock = createMockSoundBuddy({
      analyzeFile: async () => ({ success: false, error: 'sox exploded' }),
    });
    const store = createAnalysisStore(() => mock.api);

    await store.getState().startAnalysis('/path/to/file.wav');

    expect(store.getState().isAnalyzing).toBe(false);
    expect(store.getState().status).toBe('error');
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
    expect(store.getState().status).toBe('cancelled');
    expect(store.getState().analysisError).toBeNull();
  });

  it('captures a rejected IPC promise as an error', async () => {
    const mock = createMockSoundBuddy({
      analyzeFile: () => Promise.reject(new Error('spawn failed')),
    });
    const store = createAnalysisStore(() => mock.api);

    await store.getState().startAnalysis('/path/to/file.wav');

    expect(store.getState().isAnalyzing).toBe(false);
    expect(store.getState().status).toBe('error');
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

  it('selectFile sets the selected file path', () => {
    const mock = createMockSoundBuddy();
    const store = createAnalysisStore(() => mock.api);

    store.getState().selectFile('/path/to/file.wav');

    expect(store.getState().selectedFilePath).toBe('/path/to/file.wav');
  });

  it('clearAnalysis nulls the analysis + selected file and resets status to idle', () => {
    const mock = createMockSoundBuddy();
    const store = createAnalysisStore(() => mock.api);
    store.setState({
      currentAnalysis: { score: 1 },
      selectedFilePath: '/path/to/file.wav',
      status: 'done',
    });

    store.getState().clearAnalysis();

    expect(store.getState().currentAnalysis).toBeNull();
    expect(store.getState().selectedFilePath).toBeNull();
    expect(store.getState().status).toBe('idle');
  });

  it('clearAnalysis also resets prevSummary to null (#259)', () => {
    const mock = createMockSoundBuddy();
    const store = createAnalysisStore(() => mock.api);
    store.setState({ prevSummary: { score: 83, gradeLetter: 'B' } });

    store.getState().clearAnalysis();

    expect(store.getState().prevSummary).toBeNull();
  });

  it('clearAnalysis leaves historySummary/liveSource untouched (callers clear those separately)', () => {
    const mock = createMockSoundBuddy();
    const store = createAnalysisStore(() => mock.api);
    store.setState({ historySummary: { sourceFilename: 'x.wav' }, liveSource: { filename: 'live' } });

    store.getState().clearAnalysis();

    expect(store.getState().historySummary).toEqual({ sourceFilename: 'x.wav' });
    expect(store.getState().liveSource).toEqual({ filename: 'live' });
  });

  it('setHistorySummary stores a Recent Services record', () => {
    const mock = createMockSoundBuddy();
    const store = createAnalysisStore(() => mock.api);

    store.getState().setHistorySummary({ sourceFilename: 'sermon.wav' });
    expect(store.getState().historySummary).toEqual({ sourceFilename: 'sermon.wav' });

    store.getState().setHistorySummary(null);
    expect(store.getState().historySummary).toBeNull();
  });

  it('setHistorySummary resets lastSavedSummaryFile — the note field is add-at-save-time only (#267)', () => {
    const mock = createMockSoundBuddy();
    const store = createAnalysisStore(() => mock.api);
    store.setState({ lastSavedSummaryFile: 'x.json' });

    store.getState().setHistorySummary({ sourceFilename: 'sermon.wav' });

    expect(store.getState().lastSavedSummaryFile).toBeNull();
  });

  it('clearAnalysis also resets lastSavedSummaryFile (#267)', () => {
    const mock = createMockSoundBuddy();
    const store = createAnalysisStore(() => mock.api);
    store.setState({ lastSavedSummaryFile: 'x.json' });

    store.getState().clearAnalysis();

    expect(store.getState().lastSavedSummaryFile).toBeNull();
  });

  it('setLastSavedSummaryFile stores/clears the just-written record basename (#267)', () => {
    const mock = createMockSoundBuddy();
    const store = createAnalysisStore(() => mock.api);

    store.getState().setLastSavedSummaryFile('2026-07-20T18-00-00-000Z-a1b2c3d4.json');
    expect(store.getState().lastSavedSummaryFile).toBe('2026-07-20T18-00-00-000Z-a1b2c3d4.json');

    store.getState().setLastSavedSummaryFile(null);
    expect(store.getState().lastSavedSummaryFile).toBeNull();
  });

  it('setLiveSource stores the resolved live-capture report-card source', () => {
    const mock = createMockSoundBuddy();
    const store = createAnalysisStore(() => mock.api);

    store.getState().setLiveSource({ filename: 'Live capture — Main (window #1)' });
    expect(store.getState().liveSource).toEqual({ filename: 'Live capture — Main (window #1)' });

    store.getState().setLiveSource(null);
    expect(store.getState().liveSource).toBeNull();
  });

  it('setPrevSummary stores the previous persisted summary for the "vs. last time" delta (#259)', () => {
    const mock = createMockSoundBuddy();
    const store = createAnalysisStore(() => mock.api);

    store.getState().setPrevSummary({ score: 83, gradeLetter: 'B' });
    expect(store.getState().prevSummary).toEqual({ score: 83, gradeLetter: 'B' });

    store.getState().setPrevSummary(null);
    expect(store.getState().prevSummary).toBeNull();
  });

  describe('setAnalysisFromEvent', () => {
    it('sets currentAnalysis and clears a stale history summary for a stats event', () => {
      const mock = createMockSoundBuddy();
      const store = createAnalysisStore(() => mock.api);
      store.setState({ historySummary: { sourceFilename: 'old.wav' } });

      store.getState().setAnalysisFromEvent({ type: 'stats', data: { score: 5 } });

      expect(store.getState().currentAnalysis).toEqual({ score: 5 });
      expect(store.getState().historySummary).toBeNull();
    });

    it.each([
      ['a non-stats type', { type: 'other', data: { score: 5 } }],
      ['a stats event with no data', { type: 'stats', data: null }],
      ['null', null],
    ])('ignores %s', (_label, evt) => {
      const mock = createMockSoundBuddy();
      const store = createAnalysisStore(() => mock.api);
      store.setState({ currentAnalysis: { score: 1 } });

      store.getState().setAnalysisFromEvent(evt);

      expect(store.getState().currentAnalysis).toEqual({ score: 1 });
    });
  });
});
