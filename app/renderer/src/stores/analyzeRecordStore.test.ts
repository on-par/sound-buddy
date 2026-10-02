// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import {
  createAnalyzeRecordStore,
  type AnalyzeRecordDeps,
  RECORD_BOARD_BUSY_ERROR,
  RECORD_NO_DEVICE_ERROR,
  RECORD_START_FAILED_ERROR,
  RECORD_NO_FILE_ERROR,
  RECORD_STOP_FAILED_ERROR,
} from './analyzeRecordStore';
import { recordPayload } from '../analyze-record';

function createFakeDeps(overrides: Partial<AnalyzeRecordDeps> = {}) {
  const startLive = vi.fn(async () => ({ success: true }));
  const stopLive = vi.fn(async () => ({ success: true, sessionDir: '/tmp/sound-buddy-session' }));
  const revealPath = vi.fn(async () => ({ success: true }));
  const resolveDevice = vi.fn(() => '2');
  const getCadence = vi.fn(() => ({ windowSecs: 3, meterIntervalMs: 100 }));
  const isBoardCapturing = vi.fn(() => false);
  const now = vi.fn(() => 5000);
  const deps: AnalyzeRecordDeps = {
    startLive, stopLive, revealPath, resolveDevice, getCadence, isBoardCapturing, now,
    ...overrides,
  };
  return { deps, startLive, stopLive, revealPath, resolveDevice, getCadence, isBoardCapturing, now };
}

describe('createAnalyzeRecordStore (#1636)', () => {
  it('starts idle with no session dir or error', () => {
    const { deps } = createFakeDeps();
    const store = createAnalyzeRecordStore(deps);

    expect(store.getState().phase).toBe('idle');
    expect(store.getState().lastSessionDir).toBeNull();
    expect(store.getState().error).toBeNull();
  });

  describe('start()', () => {
    it('happy path: calls startLive with the record payload and moves to recording', async () => {
      const { deps, startLive, getCadence } = createFakeDeps();
      const store = createAnalyzeRecordStore(deps);

      await store.getState().start(3);

      const cadence = getCadence();
      expect(startLive).toHaveBeenCalledWith(recordPayload('2', 3, cadence));
      expect(store.getState().phase).toBe('recording');
      expect(store.getState().startedAt).toBe(5000);
      expect(store.getState().channel).toBe(3);
    });

    it('is a no-op unless phase is idle', async () => {
      const { deps, startLive } = createFakeDeps();
      const store = createAnalyzeRecordStore(deps);
      store.setState({ phase: 'recording' });

      await store.getState().start(3);

      expect(startLive).not.toHaveBeenCalled();
    });

    it('refuses with BUSY when a Session capture owns the start-live slot', async () => {
      const { deps, startLive } = createFakeDeps({ isBoardCapturing: () => true });
      const store = createAnalyzeRecordStore(deps);

      await store.getState().start(3);

      expect(startLive).not.toHaveBeenCalled();
      expect(store.getState().phase).toBe('idle');
      expect(store.getState().error).toBe(RECORD_BOARD_BUSY_ERROR);
    });

    it('refuses with NO_DEVICE when the room-mic device cannot be resolved', async () => {
      const { deps, startLive } = createFakeDeps({ resolveDevice: () => null });
      const store = createAnalyzeRecordStore(deps);

      await store.getState().start(3);

      expect(startLive).not.toHaveBeenCalled();
      expect(store.getState().phase).toBe('idle');
      expect(store.getState().error).toBe(RECORD_NO_DEVICE_ERROR);
    });

    it('a failed start uses result.error', async () => {
      const { deps } = createFakeDeps({ startLive: vi.fn(async () => ({ success: false, error: 'mic denied' })) });
      const store = createAnalyzeRecordStore(deps);

      await store.getState().start(3);

      expect(store.getState().phase).toBe('idle');
      expect(store.getState().channel).toBeNull();
      expect(store.getState().error).toBe('mic denied');
    });

    it('a failed start with no error message uses the fallback', async () => {
      const { deps } = createFakeDeps({ startLive: vi.fn(async () => ({ success: false })) });
      const store = createAnalyzeRecordStore(deps);

      await store.getState().start(3);

      expect(store.getState().phase).toBe('idle');
      expect(store.getState().error).toBe(RECORD_START_FAILED_ERROR);
    });

    it('a rejected startLive falls back to idle + the fallback error', async () => {
      const { deps } = createFakeDeps({ startLive: vi.fn(async () => { throw new Error('boom'); }) });
      const store = createAnalyzeRecordStore(deps);

      await store.getState().start(3);

      expect(store.getState().phase).toBe('idle');
      expect(store.getState().error).toBe(RECORD_START_FAILED_ERROR);
    });
  });

  describe('stop()', () => {
    async function startedStore(overrides: Partial<AnalyzeRecordDeps> = {}) {
      const fake = createFakeDeps(overrides);
      const store = createAnalyzeRecordStore(fake.deps);
      await store.getState().start(1);
      return { store, ...fake };
    }

    it('is a no-op unless phase is recording', async () => {
      const { deps, stopLive } = createFakeDeps();
      const store = createAnalyzeRecordStore(deps);

      await store.getState().stop();

      expect(stopLive).not.toHaveBeenCalled();
    });

    it('happy path: sets lastSessionDir and returns to idle', async () => {
      const { store, stopLive } = await startedStore();

      await store.getState().stop();

      expect(stopLive).toHaveBeenCalledTimes(1);
      expect(store.getState().phase).toBe('idle');
      expect(store.getState().startedAt).toBeNull();
      expect(store.getState().channel).toBeNull();
      expect(store.getState().lastSessionDir).toBe('/tmp/sound-buddy-session');
      expect(store.getState().error).toBeNull();
    });

    it('a null sessionDir on success returns NO_FILE error', async () => {
      const { store } = await startedStore({ stopLive: vi.fn(async () => ({ success: true, sessionDir: null })) });

      await store.getState().stop();

      expect(store.getState().phase).toBe('idle');
      expect(store.getState().lastSessionDir).toBeNull();
      expect(store.getState().error).toBe(RECORD_NO_FILE_ERROR);
    });

    it('success:false goes back to recording with STOP_FAILED', async () => {
      const { store } = await startedStore({ stopLive: vi.fn(async () => ({ success: false, sessionDir: null })) });

      await store.getState().stop();

      expect(store.getState().phase).toBe('recording');
      expect(store.getState().error).toBe(RECORD_STOP_FAILED_ERROR);
    });

    it('a rejected stopLive goes back to recording with STOP_FAILED (never stuck at stopping)', async () => {
      const { store } = await startedStore({ stopLive: vi.fn(async () => { throw new Error('boom'); }) });

      await store.getState().stop();

      expect(store.getState().phase).toBe('recording');
      expect(store.getState().error).toBe(RECORD_STOP_FAILED_ERROR);
    });
  });

  describe('reveal()', () => {
    it('calls revealPath with lastSessionDir', async () => {
      const { store, revealPath } = await (async () => {
        const fake = createFakeDeps();
        const s = createAnalyzeRecordStore(fake.deps);
        await s.getState().start(1);
        await s.getState().stop();
        return { store: s, ...fake };
      })();

      await store.getState().reveal();

      expect(revealPath).toHaveBeenCalledWith('/tmp/sound-buddy-session');
    });

    it('is a no-op when there is no session dir', async () => {
      const { deps, revealPath } = createFakeDeps();
      const store = createAnalyzeRecordStore(deps);

      await store.getState().reveal();

      expect(revealPath).not.toHaveBeenCalled();
    });
  });
});
