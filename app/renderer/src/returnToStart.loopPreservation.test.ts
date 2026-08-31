// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Composition test for #1318: proves soundcheckStore.returnToStart() — on both
// the stopped and the playing (seekTo(0)) path — never touches the shared
// sessionLoopRegion model or the `looping` flag, and that the loop brace
// paints identically before and after. Wires the REAL createSoundcheckStore,
// createLoopRegionModel and createDawShellRuntime, same composition-test shape
// as scrub-seek-selection.test.ts (#1305).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSoundcheckStore, type SoundcheckApi } from './stores/soundcheckStore';
import { createMockSoundBuddy } from './mock-sound-buddy';
import { createLoopRegionModel } from './loopBrace.render';
import { createDawShellRuntime, dawPlayheadX, type DawShellRuntimeDeps } from './daw-shell-runtime';
import { promoteSelectionToLoop } from './loopFromSelection';
import type { SessionManifest } from './soundcheck-panel';

const playbackRouting = require('../playback-routing.js');

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { playbackRouting };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

const MANIFEST: SessionManifest = { tracks: [{ kind: 'mono', label: 'Vocal' }] };

function makeStore(overrides: Partial<Parameters<typeof createMockSoundBuddy>[0]> = {}) {
  const mock = createMockSoundBuddy(overrides);
  const store = createSoundcheckStore(() => mock.api as unknown as SoundcheckApi);
  return { store, mock };
}

function fakeBraceSegment() {
  return { style: { left: '', width: '', display: '' } as Record<string, string> };
}

// Minimal test double for the runtime's DOM deps — only `.daw-loop-brace`
// segments and `clientWidth` matter for the brace-paint assertions here.
function runtimeFor(loopRegion: ReturnType<typeof createLoopRegionModel>, segments: ReturnType<typeof fakeBraceSegment>[]) {
  const shell = {
    clientWidth: 400,
    querySelector: () => null,
    querySelectorAll: (sel: string) => (sel === '.daw-loop-brace' ? segments : []),
  };
  const deps = {
    doc: { querySelector: () => shell as unknown as Element } as unknown as Pick<Document, 'querySelector'>,
    now: () => 0,
    raf: (cb: () => void) => { void cb; return 1; },
    cancelRaf: () => {},
    subscribeLiveEvent: () => {},
    getCaptureState: () => ({ isCapturing: false, liveMode: 'monitor' as const }),
    dawPlayheadState: require('../daw-playhead-state.js'),
    dawWaveformState: require('../daw-waveform-state.js'),
    loopRegion,
  } as unknown as DawShellRuntimeDeps;
  return createDawShellRuntime(deps);
}

describe('return-to-start preserves the loop range (#1318)', () => {
  it('leaves the loop range untouched and fires no listener on a stopped take', async () => {
    const { store } = makeStore();
    const loopRegion = createLoopRegionModel();
    loopRegion.setRegion(12, 20);
    const listener = vi.fn();
    loopRegion.subscribe(listener);

    store.setState({
      manifest: MANIFEST,
      playing: false,
      lastElapsedTick: { elapsed: 37, duration: 60 },
      looping: true,
    });

    await store.getState().returnToStart();

    expect(store.getState().lastElapsedTick).toEqual({ elapsed: 0, duration: 60 });
    expect(loopRegion.getRegion()).toEqual({ startSecs: 12, endSecs: 20 });
    expect(listener).not.toHaveBeenCalled();
  });

  it('leaves `looping` untouched on a stopped take, both when on and when off', async () => {
    const { store: storeOn } = makeStore();
    storeOn.setState({ manifest: MANIFEST, playing: false, lastElapsedTick: { elapsed: 5, duration: 60 }, looping: true });
    await storeOn.getState().returnToStart();
    expect(storeOn.getState().looping).toBe(true);

    const { store: storeOff } = makeStore();
    storeOff.setState({ manifest: MANIFEST, playing: false, lastElapsedTick: { elapsed: 5, duration: 60 }, looping: false });
    await storeOff.getState().returnToStart();
    expect(storeOff.getState().looping).toBe(false);
  });

  it('leaves the loop range and `looping` untouched on the playing (seekTo restart) path', async () => {
    const { store, mock } = makeStore({
      startPlayback: async (opts) => {
        mock.calls.push({ method: 'startPlayback', args: [opts] });
        return { success: true };
      },
    });
    const loopRegion = createLoopRegionModel();
    loopRegion.setRegion(12, 20);
    const listener = vi.fn();
    loopRegion.subscribe(listener);

    store.setState({
      manifest: MANIFEST,
      sessionDir: '/tmp/s',
      routes: [[0]],
      playing: true,
      looping: true,
      lastElapsedTick: { elapsed: 37, duration: 60 },
    });

    await store.getState().returnToStart();

    expect(mock.calls).toContainEqual({ method: 'startPlayback', args: [{ sessionDir: '/tmp/s', route: '0:0', startOffsetSecs: 0 }] });
    expect(store.getState().looping).toBe(true);
    expect(loopRegion.getRegion()).toEqual({ startSecs: 12, endSecs: 20 });
    expect(listener).not.toHaveBeenCalled();
  });

  it('is a no-op that leaves the range and `looping` alone with no session loaded', async () => {
    const { store } = makeStore();
    const loopRegion = createLoopRegionModel();
    loopRegion.setRegion(12, 20);
    const listener = vi.fn();
    loopRegion.subscribe(listener);

    store.setState({ manifest: null, looping: true });

    await store.getState().returnToStart();

    expect(loopRegion.getRegion()).toEqual({ startSecs: 12, endSecs: 20 });
    expect(store.getState().looping).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it('paints the identical loop brace before and after a return-to-start (AC-2, pixel level)', async () => {
    const { store } = makeStore();
    const loopRegion = createLoopRegionModel();
    loopRegion.setRegion(12, 20);
    const segments = [fakeBraceSegment()];
    const rt = runtimeFor(loopRegion, segments);

    store.setState({ manifest: MANIFEST, playing: false, lastElapsedTick: { elapsed: 37, duration: 60 }, looping: true });

    rt.renderLoopBrace();
    const before = { ...segments[0].style };

    await store.getState().returnToStart();

    rt.renderLoopBrace();
    const after = { ...segments[0].style };

    expect(after).toEqual(before);

    const expectedLeft = dawPlayheadX(12 * 1000, 400);
    const expectedWidth = dawPlayheadX(20 * 1000, 400) - expectedLeft;
    expect(before).toEqual({ left: `${expectedLeft}px`, width: `${expectedWidth}px`, display: '' });
  });

  it('preserves a range promoted from a time selection (#1317) across a return-to-start', async () => {
    const { store } = makeStore();
    const loopRegion = createLoopRegionModel();
    promoteSelectionToLoop(loopRegion, { startSecs: 30, endSecs: 40 }, { available: true, looping: false });

    store.setState({ manifest: MANIFEST, playing: false, lastElapsedTick: { elapsed: 5, duration: 60 }, looping: true });

    await store.getState().returnToStart();

    expect(loopRegion.getRegion()).toEqual({ startSecs: 30, endSecs: 40 });
  });
});
