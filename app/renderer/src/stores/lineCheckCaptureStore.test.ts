// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import { GRID_FREQS } from '@sound-buddy/audio-engine/dist/profiles/index.js';
import {
  createLineCheckCaptureStore,
  persistLineCheckCapture,
  type LineCheckCaptureDeps,
  type LineCheckPersistDeps,
  type CaptureStripSlice,
} from './lineCheckCaptureStore';
import type { SpectrumCurve } from '../spectrum-display';
import type { IdealCurvesApi } from '../ideal-profiles';
import type { CustomIdealProfile, AppSettings } from '../../../electron/ipc/api';
import type { StripConfig } from '../live-capture-panel';

function createFakeDeps(overrides: Partial<LineCheckCaptureDeps> = {}) {
  let frame: (() => void) | null = null;
  const unsubscribe = vi.fn(() => { frame = null; });
  const subscribeLive = vi.fn((onFrame: () => void) => {
    frame = onFrame;
    return unsubscribe;
  });
  const persist = vi.fn(async (_curve: SpectrumCurve | null, _index: number) => true);
  const deps: LineCheckCaptureDeps = {
    subscribeLive,
    curveAt: vi.fn(() => null),
    persist,
    ...overrides,
  };
  return {
    deps,
    subscribeLive,
    unsubscribe,
    persist,
    tick() { frame?.(); },
  };
}

const CURVE = (db: number): SpectrumCurve => ({ freqs: [1000], db: [db] });

describe('createLineCheckCaptureStore (#1467)', () => {
  it('starts idle', () => {
    const { deps } = createFakeDeps();
    const store = createLineCheckCaptureStore(deps);
    expect(store.getState()).toMatchObject({ capturing: false, status: '' });
  });

  it('start() registers a live-frame subscription and flips to capturing', () => {
    const { deps, subscribeLive } = createFakeDeps();
    const store = createLineCheckCaptureStore(deps);

    store.getState().start(2);

    expect(store.getState().capturing).toBe(true);
    expect(store.getState().status).not.toBe('');
    expect(subscribeLive).toHaveBeenCalledTimes(1);
  });

  it('a second start() call while already capturing is a no-op (does not re-subscribe)', () => {
    const { deps, subscribeLive } = createFakeDeps();
    const store = createLineCheckCaptureStore(deps);

    store.getState().start(2);
    store.getState().start(3);

    expect(subscribeLive).toHaveBeenCalledTimes(1);
  });

  it('stop() while not capturing is a no-op — persist is never called', async () => {
    const { deps, persist } = createFakeDeps();
    const store = createLineCheckCaptureStore(deps);

    await store.getState().stop();

    expect(persist).not.toHaveBeenCalled();
  });

  it('buffers one curve per live-frame tick via curveAt(index), then averages and persists on stop', async () => {
    const curveAt = vi.fn()
      .mockReturnValueOnce(CURVE(-20))
      .mockReturnValueOnce(CURVE(-10));
    const { deps, tick, persist } = createFakeDeps({ curveAt });
    const store = createLineCheckCaptureStore(deps);

    store.getState().start(4);
    tick();
    tick();
    await store.getState().stop();

    expect(curveAt).toHaveBeenCalledWith(4);
    expect(persist).toHaveBeenCalledTimes(1);
    const [curve, index] = persist.mock.calls[0];
    expect(index).toBe(4);
    expect(curve!.db[0]).toBeCloseTo(-12.5964, 3);
  });

  it('ticks where curveAt returns null are skipped, not treated as silence', async () => {
    const curveAt = vi.fn()
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(CURVE(-6))
      .mockReturnValueOnce(null);
    const { deps, tick, persist } = createFakeDeps({ curveAt });
    const store = createLineCheckCaptureStore(deps);

    store.getState().start(1);
    tick();
    tick();
    tick();
    await store.getState().stop();

    const [curve] = persist.mock.calls[0];
    expect(curve!.db[0]).toBeCloseTo(-6, 6);
  });

  it('unsubscribes from the live-frame hook on stop so ticks after stop are never buffered', async () => {
    const curveAt = vi.fn(() => CURVE(-6));
    const { deps, tick, unsubscribe } = createFakeDeps({ curveAt });
    const store = createLineCheckCaptureStore(deps);

    store.getState().start(1);
    tick();
    await store.getState().stop();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    const callsBeforeExtraTick = curveAt.mock.calls.length;
    tick();
    expect(curveAt.mock.calls.length).toBe(callsBeforeExtraTick);
  });

  it('passes a null curve to persist when no tick produced a usable sample', async () => {
    const { deps, tick, persist } = createFakeDeps();
    const store = createLineCheckCaptureStore(deps);

    store.getState().start(0);
    tick();
    await store.getState().stop();

    const [curve, index] = persist.mock.calls[0];
    expect(curve).toBeNull();
    expect(index).toBe(0);
  });

  it('resets to idle status on a successful persist, and flags failure on an unsuccessful one', async () => {
    const { deps: okDeps } = createFakeDeps({ persist: vi.fn(async () => true) });
    const okStore = createLineCheckCaptureStore(okDeps);
    okStore.getState().start(0);
    await okStore.getState().stop();
    expect(okStore.getState().capturing).toBe(false);
    expect(okStore.getState().status.toLowerCase()).toContain('saved');

    const { deps: failDeps } = createFakeDeps({ persist: vi.fn(async () => false) });
    const failStore = createLineCheckCaptureStore(failDeps);
    failStore.getState().start(0);
    await failStore.getState().stop();
    expect(failStore.getState().capturing).toBe(false);
    expect(failStore.getState().status.toLowerCase()).toContain('fail');
  });

  it('starting a second capture after a stop clears the previous sample buffer', async () => {
    const curveAt = vi.fn()
      .mockReturnValueOnce(CURVE(-20)) // first capture, first tick
      .mockReturnValueOnce(CURVE(-40)); // second capture, first tick
    const { deps, tick, persist } = createFakeDeps({ curveAt });
    const store = createLineCheckCaptureStore(deps);

    store.getState().start(0);
    tick();
    await store.getState().stop();

    store.getState().start(1);
    tick();
    await store.getState().stop();

    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist.mock.calls[1][0]!.db[0]).toBeCloseTo(-40, 6);
    expect(persist.mock.calls[1][1]).toBe(1);
  });
});

const curves = require('../../ideal-curves.js') as IdealCurvesApi;

const CAPTURE_CURVE = { freqs: GRID_FREQS, db: GRID_FREQS.map((_, i) => (i % 2 === 0 ? -18 : -24)) };

function createPersistDeps(overrides: Partial<LineCheckPersistDeps> = {}) {
  let customProfiles: CustomIdealProfile[] = [];
  let overridesMap: Record<string, Record<string, string>> = {};
  const writtenSettings: AppSettings[] = [];
  const liveCapture: CaptureStripSlice = {
    channelConfig: [{ kind: 'mono', a: 0, b: 1, label: 'Kick' } as StripConfig],
    lastLiveChannels: null,
    selectedDevice: '0',
    devices: [{ index: 0, name: 'Scarlett 18i20', channels: 8, default_sr: 48000 }],
  };
  const deps: LineCheckPersistDeps = {
    liveCapture,
    armState: { stripToken: (strip) => `${strip.a}` },
    rigReconcile: { resolveStripLabel: (strip) => (strip && strip.label) || 'Ch' },
    instrumentProfiles: { recordOverride: require('../../instrument-profiles.js').recordOverride },
    getCurves: () => curves,
    getCustomProfiles: () => customProfiles,
    getOverrides: () => overridesMap,
    writeSettings: vi.fn(async (patch) => {
      customProfiles = (patch.customIdealProfiles as CustomIdealProfile[]) ?? customProfiles;
      overridesMap = (patch.inputInstrumentProfiles as Record<string, Record<string, string>>) ?? overridesMap;
      const settings = { customIdealProfiles: customProfiles, inputInstrumentProfiles: overridesMap } as AppSettings;
      writtenSettings.push(settings);
      return settings;
    }),
    onSettingsWritten: vi.fn(),
    ...overrides,
  };
  return { deps, getCustomProfiles: () => customProfiles, getOverrides: () => overridesMap, writtenSettings };
}

describe('persistLineCheckCapture (#1467)', () => {
  it('returns false and never writes settings when there is no strip configured at index', async () => {
    const { deps } = createPersistDeps({ liveCapture: { channelConfig: [], lastLiveChannels: null, selectedDevice: '', devices: [] } });

    const ok = await persistLineCheckCapture(CAPTURE_CURVE, 0, deps);

    expect(ok).toBe(false);
    expect(deps.writeSettings).not.toHaveBeenCalled();
  });

  it('persists a CustomIdealProfile keyed by the resolved device name + strip token', async () => {
    const { deps, getCustomProfiles, getOverrides } = createPersistDeps();

    const ok = await persistLineCheckCapture(CAPTURE_CURVE, 0, deps);

    expect(ok).toBe(true);
    expect(getCustomProfiles()).toHaveLength(1);
    expect(getOverrides()).toEqual({ 'Scarlett 18i20': { '0': expect.stringMatching(/^custom:/) } });
  });

  it('re-hydrates settings via onSettingsWritten with the write result, so a later read never sees a stale settings snapshot', async () => {
    const { deps, writtenSettings } = createPersistDeps();

    await persistLineCheckCapture(CAPTURE_CURVE, 0, deps);

    expect(deps.onSettingsWritten).toHaveBeenCalledWith(writtenSettings[0]);
  });

  it('returns false and skips the write for an unusable (null) curve', async () => {
    const { deps } = createPersistDeps();

    const ok = await persistLineCheckCapture(null, 0, deps);

    expect(ok).toBe(false);
    expect(deps.writeSettings).not.toHaveBeenCalled();
  });

  it('resolves the label through the live channel at index when lastLiveChannels is populated', async () => {
    const resolveStripLabel = vi.fn(() => 'Resolved Label');
    const { deps } = createPersistDeps({
      liveCapture: {
        channelConfig: [{ kind: 'mono', a: 0, b: 1, label: 'Kick' } as StripConfig],
        lastLiveChannels: [{ index: 0, name: 'Live Kick', rms: -20, peak: -10, clipping: false }] as never,
        selectedDevice: '0',
        devices: [{ index: 0, name: 'Scarlett 18i20', channels: 8, default_sr: 48000 }],
      },
      rigReconcile: { resolveStripLabel },
    });

    await persistLineCheckCapture(CAPTURE_CURVE, 0, deps);

    expect(resolveStripLabel).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Kick' }),
      expect.objectContaining({ name: 'Live Kick' }),
      0,
    );
  });

  it('resolves the live channel to null (not undefined) when lastLiveChannels has no entry at index', async () => {
    const resolveStripLabel = vi.fn(() => 'Resolved Label');
    const { deps } = createPersistDeps({
      liveCapture: {
        channelConfig: [{ kind: 'mono', a: 0, b: 1, label: 'Kick' } as StripConfig],
        lastLiveChannels: [] as never,
        selectedDevice: '0',
        devices: [{ index: 0, name: 'Scarlett 18i20', channels: 8, default_sr: 48000 }],
      },
      rigReconcile: { resolveStripLabel },
    });

    await persistLineCheckCapture(CAPTURE_CURVE, 0, deps);

    expect(resolveStripLabel).toHaveBeenCalledWith(expect.objectContaining({ label: 'Kick' }), null, 0);
  });
});
