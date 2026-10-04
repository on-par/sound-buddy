// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import {
  createRecordTakeStore,
  RECORD_TAKE_START_FAILED_ERROR,
  RECORD_TAKE_STOP_FAILED_ERROR,
  RECORD_TAKE_NO_FILE_ERROR,
  type RecordTakeDeps,
} from './recordTakeStore';
import { RECORD_MEASUREMENT_NOT_FOUND_ERROR } from '../record-take';

const BOARD = { index: 3, name: 'X32 USB', channels: 32, default_sr: 48000 };
const ROOM = { index: 5, name: 'UMIK-1', channels: 1, default_sr: 48000 };
const TAKE = '/Music/Sound Buddy/sound-buddy-20261004-101500-000';
const MAIN_WAV = `${TAKE}/main/01-main.wav`;
const ROOM_WAV = `${TAKE}/measurement/01-measurement.wav`;

function makeDeps(overrides: Partial<RecordTakeDeps> = {}): RecordTakeDeps {
  return {
    startRecordTake: vi.fn().mockResolvedValue({ success: true }),
    stopRecordTake: vi.fn().mockResolvedValue({ success: true, takeDir: TAKE, files: { main: MAIN_WAV, measurement: ROOM_WAV } }),
    revealPath: vi.fn().mockResolvedValue({ success: true }),
    getSources: () => ({ devices: [BOARD, ROOM], selectedDevice: '3', measurementDeviceName: 'UMIK-1' }),
    getCadence: () => ({ windowSecs: 5, meterIntervalMs: 100 }),
    getRecordDir: () => '',
    now: () => 1_000,
    ...overrides,
  };
}

describe('recordTakeStore.start (#1648)', () => {
  it('starts a Main + Measurement take from the configured devices and enters recording', async () => {
    const deps = makeDeps({ getRecordDir: () => '/chosen' });
    const store = createRecordTakeStore(deps);
    store.getState().setMainChannels('16-17');

    await store.getState().start();

    expect(deps.startRecordTake).toHaveBeenCalledWith({
      main: { device: '3', channels: '16-17' },
      measurement: { device: '5', channels: '0' },
      windowSecs: 5,
      intervalSecs: 0.1,
      recordDir: '/chosen',
    });
    expect(store.getState()).toMatchObject({
      phase: 'recording',
      startedAt: 1_000,
      error: null,
      sources: { main: 'X32 USB · Ch 17–18 (stereo)', measurement: 'UMIK-1 · Ch 1 (mono)' },
    });
  });

  it('omits an unset record folder so main applies its default', async () => {
    const deps = makeDeps();
    await createRecordTakeStore(deps).getState().start();
    expect(vi.mocked(deps.startRecordTake).mock.calls[0][0].recordDir).toBeUndefined();
  });

  it('refuses with the actionable device error, without calling main, when a source is missing', async () => {
    const deps = makeDeps({ getSources: () => ({ devices: [BOARD], selectedDevice: '3', measurementDeviceName: 'UMIK-1' }) });
    const store = createRecordTakeStore(deps);

    await store.getState().start();

    expect(deps.startRecordTake).not.toHaveBeenCalled();
    expect(store.getState()).toMatchObject({ phase: 'idle', error: RECORD_MEASUREMENT_NOT_FOUND_ERROR });
  });

  it('surfaces main\'s error and returns to idle when start fails', async () => {
    const store = createRecordTakeStore(makeDeps({ startRecordTake: vi.fn().mockResolvedValue({ success: false, error: 'Mic denied' }) }));

    await store.getState().start();

    expect(store.getState()).toMatchObject({ phase: 'idle', error: 'Mic denied', sources: null });
  });

  it('falls back to a generic actionable error when start fails silently or throws', async () => {
    const silent = createRecordTakeStore(makeDeps({ startRecordTake: vi.fn().mockResolvedValue({ success: false }) }));
    await silent.getState().start();
    expect(silent.getState().error).toBe(RECORD_TAKE_START_FAILED_ERROR);

    const thrown = createRecordTakeStore(makeDeps({ startRecordTake: vi.fn().mockRejectedValue(new Error('ipc')) }));
    await thrown.getState().start();
    expect(thrown.getState()).toMatchObject({ phase: 'idle', error: RECORD_TAKE_START_FAILED_ERROR });
  });

  it('clears the previous take and error when a new take starts', async () => {
    const store = createRecordTakeStore(makeDeps());
    store.setState({ lastTake: { dir: '/old', files: { main: null, measurement: null } }, error: 'old' });

    await store.getState().start();

    expect(store.getState()).toMatchObject({ lastTake: null, error: null });
  });

  it('ignores a press while not idle', async () => {
    const deps = makeDeps();
    const store = createRecordTakeStore(deps);
    store.setState({ phase: 'recording' });

    await store.getState().start();

    expect(deps.startRecordTake).not.toHaveBeenCalled();
  });
});

describe('recordTakeStore.stop (#1648)', () => {
  it('stops and keeps the saved take with both files', async () => {
    const deps = makeDeps();
    const store = createRecordTakeStore(deps);
    await store.getState().start();

    await store.getState().stop();

    expect(deps.stopRecordTake).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({
      phase: 'idle',
      startedAt: null,
      lastTake: { dir: TAKE, files: { main: MAIN_WAV, measurement: ROOM_WAV } },
      error: null,
    });
  });

  it('keeps a partial take but names the source that wrote nothing', async () => {
    const store = createRecordTakeStore(makeDeps({
      stopRecordTake: vi.fn().mockResolvedValue({ success: true, takeDir: TAKE, files: { main: MAIN_WAV, measurement: null } }),
    }));
    await store.getState().start();

    await store.getState().stop();

    expect(store.getState().lastTake).toEqual({ dir: TAKE, files: { main: MAIN_WAV, measurement: null } });
    expect(store.getState().error).toMatch(/^Measurement input wrote no audio — .*Settings ▸ Audio/);
  });

  it('names Main when only Measurement was saved', async () => {
    const store = createRecordTakeStore(makeDeps({
      stopRecordTake: vi.fn().mockResolvedValue({ success: true, takeDir: TAKE, files: { main: null, measurement: ROOM_WAV } }),
    }));
    await store.getState().start();

    await store.getState().stop();

    expect(store.getState().error).toMatch(/^Main input wrote no audio — /);
  });

  it('reports a take with no files at all', async () => {
    const store = createRecordTakeStore(makeDeps({
      stopRecordTake: vi.fn().mockResolvedValue({ success: true, takeDir: null, files: { main: null, measurement: null } }),
    }));
    await store.getState().start();

    await store.getState().stop();

    expect(store.getState()).toMatchObject({ phase: 'idle', lastTake: null, error: RECORD_TAKE_NO_FILE_ERROR });
  });

  it('stays recording with an actionable error when stop fails or throws', async () => {
    const failed = createRecordTakeStore(makeDeps({ stopRecordTake: vi.fn().mockResolvedValue({ success: false, takeDir: null, files: { main: null, measurement: null } }) }));
    await failed.getState().start();
    await failed.getState().stop();
    expect(failed.getState()).toMatchObject({ phase: 'recording', error: RECORD_TAKE_STOP_FAILED_ERROR });

    const thrown = createRecordTakeStore(makeDeps({ stopRecordTake: vi.fn().mockRejectedValue(new Error('ipc')) }));
    await thrown.getState().start();
    await thrown.getState().stop();
    expect(thrown.getState()).toMatchObject({ phase: 'recording', error: RECORD_TAKE_STOP_FAILED_ERROR });
  });

  it('ignores stop while not recording', async () => {
    const deps = makeDeps();
    await createRecordTakeStore(deps).getState().stop();
    expect(deps.stopRecordTake).not.toHaveBeenCalled();
  });
});

describe('recordTakeStore.reveal / channel choices (#1648)', () => {
  it('reveals the saved take folder', async () => {
    const deps = makeDeps();
    const store = createRecordTakeStore(deps);
    store.setState({ lastTake: { dir: TAKE, files: { main: MAIN_WAV, measurement: ROOM_WAV } } });

    await store.getState().reveal();

    expect(deps.revealPath).toHaveBeenCalledWith(TAKE);
  });

  it('does nothing to reveal without a take', async () => {
    const deps = makeDeps();
    await createRecordTakeStore(deps).getState().reveal();
    expect(deps.revealPath).not.toHaveBeenCalled();
  });

  it('remembers the per-source channel choices', () => {
    const store = createRecordTakeStore(makeDeps());
    store.getState().setMainChannels('2-3');
    store.getState().setMeasurementChannels('1');
    expect(store.getState()).toMatchObject({ mainChannels: '2-3', measurementChannels: '1' });
  });
});
