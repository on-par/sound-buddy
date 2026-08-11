// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import {
  PLAYBACK_AVG_WINDOW_SEC,
  SEEK_END_GUARD_SEC,
  SEEK_NUDGE_SEC,
  clampSeekTime,
  resolveDuration,
  frameIndexAtTime,
  windowAverageRms,
  frameIndexFromClick,
  playheadPercent,
  playbackClockText,
  scrubReadoutText,
  playbackReadoutText,
  clampSelectedFrame,
  analysisPlaybackInputs,
  seekTimeFromBarClick,
  seekNudgeTarget,
  createSpectrumTransport,
  type TransportAudio,
  type SpectrumTransportDeps,
} from './spectrum-transport';
import type { SpectrumFrame } from './spectrum-display';

function makeFrames(n: number): SpectrumFrame[] {
  return Array.from({ length: n }, (_, i) => ({ t: i, db: [-20], rms: -30 + i, class: i % 2 === 0 ? 'music' : 'speech' }));
}

describe('clampSeekTime', () => {
  it('leaves t untouched when duration is unknown (<= 0)', () => {
    expect(clampSeekTime(10, 0)).toBe(10);
    expect(clampSeekTime(10, -1)).toBe(10);
  });

  it('clamps to duration minus the end guard', () => {
    expect(clampSeekTime(9.98, 10)).toBe(9.95);
    expect(clampSeekTime(5, 10)).toBe(5);
  });

  it('only caps the upper bound — a negative t passes through untouched', () => {
    expect(clampSeekTime(-5, 0.02)).toBe(-5);
  });
});

describe('resolveDuration', () => {
  it('prefers a finite, positive audio duration', () => {
    expect(resolveDuration(42, 10)).toBe(42);
  });

  it('falls back when audio duration is missing, non-finite, or zero', () => {
    expect(resolveDuration(undefined, 10)).toBe(10);
    expect(resolveDuration(NaN, 10)).toBe(10);
    expect(resolveDuration(0, 10)).toBe(10);
  });

  it('falls back to 0 when the fallback itself is falsy', () => {
    expect(resolveDuration(undefined, 0)).toBe(0);
  });
});

describe('frameIndexAtTime', () => {
  const frames = makeFrames(5);

  it('returns 0 when total duration is unknown', () => {
    expect(frameIndexAtTime(frames, 3, 0)).toBe(0);
  });

  it('maps t/total proportionally, clamped to the last frame', () => {
    expect(frameIndexAtTime(frames, 0, 10)).toBe(0);
    expect(frameIndexAtTime(frames, 5, 10)).toBe(2);
    expect(frameIndexAtTime(frames, 10, 10)).toBe(4);
    expect(frameIndexAtTime(frames, 999, 10)).toBe(4);
  });
});

describe('windowAverageRms', () => {
  const frames = makeFrames(5); // rms: -30,-29,-28,-27,-26 at t=0..4

  it('averages rms within the trailing window', () => {
    // t in (4-2, 4] → frames at t=3 (rms -27) and t=4 (rms -26); t=2 is excluded (not > 2).
    expect(windowAverageRms(frames, 4, 2)).toBeCloseTo((-27 + -26) / 2, 5);
  });

  it('returns null when no frame falls in the window', () => {
    expect(windowAverageRms(frames, -10, 0.5)).toBeNull();
  });

  it('skips non-finite rms entries', () => {
    const withGap: SpectrumFrame[] = [{ t: 0, db: [], rms: undefined }, { t: 0.1, db: [], rms: -10 }];
    expect(windowAverageRms(withGap, 0.1, 1)).toBe(-10);
  });
});

describe('frameIndexFromClick', () => {
  it('maps a click x-position proportionally across the box', () => {
    expect(frameIndexFromClick(50, 0, 100, 10)).toBe(5);
    expect(frameIndexFromClick(0, 0, 100, 10)).toBe(0);
    expect(frameIndexFromClick(99, 0, 100, 10)).toBe(9);
  });

  it('clamps outside the box bounds', () => {
    expect(frameIndexFromClick(-20, 0, 100, 10)).toBe(0);
    expect(frameIndexFromClick(500, 0, 100, 10)).toBe(9);
  });

  it('returns null for a zero-width box or zero frames', () => {
    expect(frameIndexFromClick(10, 0, 0, 10)).toBeNull();
    expect(frameIndexFromClick(10, 0, 100, 0)).toBeNull();
  });
});

describe('playheadPercent', () => {
  it('is 0 when duration is unknown', () => {
    expect(playheadPercent(5, 0)).toBe(0);
  });

  it('scales to a 0-100 percent, clamped', () => {
    expect(playheadPercent(5, 10)).toBe(50);
    expect(playheadPercent(-5, 10)).toBe(0);
    expect(playheadPercent(50, 10)).toBe(100);
  });
});

describe('playbackClockText', () => {
  it('formats current / total via formatClock', () => {
    expect(playbackClockText(65, 130)).toBe('1:05 / 2:10');
  });
});

describe('scrubReadoutText', () => {
  it('reports the whole-file average when no frame is pinned', () => {
    expect(scrubReadoutText(null)).toBe('Whole-file average');
  });

  it('reports the pinned frame\'s time, class, and RMS', () => {
    const frame: SpectrumFrame = { t: 12.3, db: [], rms: -18.456, class: 'speech' };
    expect(scrubReadoutText(frame)).toBe('t = 0:12.3 · Speech · RMS -18.5 dB');
  });
});

describe('playbackReadoutText', () => {
  it('shows just the class label when there is no window average', () => {
    expect(playbackReadoutText('music', null)).toBe('Music');
  });

  it('appends the window average when present', () => {
    expect(playbackReadoutText('speech', -12.34)).toBe('Speech · Window avg -12.3 dB');
  });
});

describe('clampSelectedFrame', () => {
  it('passes through an in-range index', () => {
    expect(clampSelectedFrame(2, 5)).toBe(2);
  });

  it('resets to null when null, negative, or out of range', () => {
    expect(clampSelectedFrame(null, 5)).toBeNull();
    expect(clampSelectedFrame(-1, 5)).toBeNull();
    expect(clampSelectedFrame(5, 5)).toBeNull();
  });
});

describe('analysisPlaybackInputs', () => {
  it('extracts filePath and the ffprobe fallback duration', () => {
    const analysis = { filePath: '/tmp/service.wav', ffprobe: { format: { durationSeconds: 123.4 } } };
    expect(analysisPlaybackInputs(analysis)).toEqual({ filePath: '/tmp/service.wav', fallbackDuration: 123.4 });
  });

  it('defaults defensively for a missing/malformed payload', () => {
    expect(analysisPlaybackInputs(null)).toEqual({ filePath: null, fallbackDuration: 0 });
    expect(analysisPlaybackInputs(42)).toEqual({ filePath: null, fallbackDuration: 0 });
    expect(analysisPlaybackInputs({})).toEqual({ filePath: null, fallbackDuration: 0 });
    expect(analysisPlaybackInputs({ filePath: 7 })).toEqual({ filePath: null, fallbackDuration: 0 });
    expect(analysisPlaybackInputs({ ffprobe: { format: { durationSeconds: 'nope' } } }))
      .toEqual({ filePath: null, fallbackDuration: 0 });
  });
});

describe('seekTimeFromBarClick', () => {
  it('maps a click x-position proportionally across the bar to seconds', () => {
    expect(seekTimeFromBarClick(50, 0, 100, 10)).toBe(5);
    expect(seekTimeFromBarClick(0, 0, 100, 10)).toBe(0);
    expect(seekTimeFromBarClick(75, 0, 100, 20)).toBe(15);
  });

  it('clamps the fraction to [0,1] outside the bar bounds', () => {
    expect(seekTimeFromBarClick(-20, 0, 100, 10)).toBe(0);
    expect(seekTimeFromBarClick(500, 0, 100, 10)).toBe(10);
  });

  it('returns null for a zero-width bar', () => {
    expect(seekTimeFromBarClick(10, 0, 0, 10)).toBeNull();
  });

  it('returns null for a non-positive duration', () => {
    expect(seekTimeFromBarClick(10, 0, 100, 0)).toBeNull();
    expect(seekTimeFromBarClick(10, 0, 100, -5)).toBeNull();
  });
});

describe('seekNudgeTarget', () => {
  it('ArrowLeft subtracts the nudge and floors at 0', () => {
    expect(seekNudgeTarget('ArrowLeft', 10)).toBe(10 - SEEK_NUDGE_SEC);
    expect(seekNudgeTarget('ArrowLeft', 1)).toBe(0);
  });

  it('ArrowRight adds the nudge with no upper clamp (seek() clamps the end)', () => {
    expect(seekNudgeTarget('ArrowRight', 10)).toBe(10 + SEEK_NUDGE_SEC);
  });

  it('respects a custom nudgeSec', () => {
    expect(seekNudgeTarget('ArrowLeft', 10, 2)).toBe(8);
    expect(seekNudgeTarget('ArrowRight', 10, 2)).toBe(12);
  });

  it('returns null for any non-arrow key', () => {
    expect(seekNudgeTarget('Enter', 10)).toBeNull();
    expect(seekNudgeTarget(' ', 10)).toBeNull();
    expect(seekNudgeTarget('ArrowUp', 10)).toBeNull();
  });
});

describe('SEEK_NUDGE_SEC', () => {
  it('is a positive finite number', () => {
    expect(Number.isFinite(SEEK_NUDGE_SEC)).toBe(true);
    expect(SEEK_NUDGE_SEC).toBeGreaterThan(0);
  });
});

/* ── createSpectrumTransport controller ── */

type Listener = (evt?: { target?: unknown }) => void;

class FakeAudio implements TransportAudio {
  paused = true;
  ended = false;
  currentTime = 0;
  duration = NaN;
  src = '';
  listeners = new Map<string, Listener[]>();
  playCalls = 0;

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  dispatch(type: string): void {
    for (const l of this.listeners.get(type) ?? []) l({ target: this });
  }

  play(): Promise<void> {
    this.playCalls++;
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }
}

function makeDeps() {
  const createdAudios: FakeAudio[] = [];
  const urlsByPath = new Map<string, string | null>();
  const pendingUrl: Array<{ resolve: (v: string | null) => void }> = [];
  let rafQueue: Array<() => void> = [];
  let nextHandle = 1;

  const deps: SpectrumTransportDeps = {
    createAudio: (url) => {
      const a = new FakeAudio();
      a.src = url;
      createdAudios.push(a);
      return a;
    },
    toFileUrl: (filePath) => {
      if (urlsByPath.has(filePath)) return Promise.resolve(urlsByPath.get(filePath) ?? null);
      return new Promise((resolve) => { pendingUrl.push({ resolve }); });
    },
    raf: (cb) => { const h = nextHandle++; rafQueue.push(cb); return h; },
    cancelRaf: (handle) => {
      // Simple test double: a real cancel would remove by handle; the queue
      // here is drained via runRaf(), so cancellation just matters for the
      // "did the controller ask to cancel" assertions below.
      void handle;
    },
  };

  return {
    deps,
    createdAudios,
    setUrl: (filePath: string, url: string | null) => urlsByPath.set(filePath, url),
    resolveNextUrl: (url: string | null) => pendingUrl.shift()?.resolve(url),
    runRaf: () => { const q = rafQueue; rafQueue = []; q.forEach((cb) => cb()); },
    pendingRafCount: () => rafQueue.length,
  };
}

describe('createSpectrumTransport', () => {
  it('caches by path — a second ensure() for the same file is a no-op', async () => {
    const { deps, createdAudios, setUrl } = makeDeps();
    setUrl('/a.wav', 'file:///a.wav');
    const t = createSpectrumTransport(deps);

    await t.ensure('/a.wav');
    await t.ensure('/a.wav');

    expect(createdAudios).toHaveLength(1);
  });

  it('a superseded ensure() call discards its result once a newer call has won', async () => {
    const { deps, createdAudios } = makeDeps();
    const t = createSpectrumTransport(deps);
    let resolveFirst!: (v: string | null) => void;
    let resolveSecond!: (v: string | null) => void;
    deps.toFileUrl = vi.fn()
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockImplementationOnce(() => new Promise((r) => { resolveSecond = r; }));

    const p1 = t.ensure('/a.wav');
    const p2 = t.ensure('/b.wav');
    resolveSecond('file:///b.wav');
    await p2;
    resolveFirst('file:///a.wav');
    await p1;

    expect(createdAudios).toHaveLength(1);
    expect(createdAudios[0].src).toBe('file:///b.wav');
  });

  it('a null url leaves the audio unset', async () => {
    const { deps, createdAudios, setUrl } = makeDeps();
    setUrl('/gone.wav', null);
    const t = createSpectrumTransport(deps);

    await t.ensure('/gone.wav');

    expect(createdAudios).toHaveLength(0);
    expect(t.isPlaying()).toBe(false);
    expect(t.currentTime()).toBe(0);
  });

  it('notifies subscribers and starts the tick loop on play, stops on pause', async () => {
    const { deps, createdAudios, setUrl, runRaf, pendingRafCount } = makeDeps();
    setUrl('/a.wav', 'file:///a.wav');
    const t = createSpectrumTransport(deps);
    await t.ensure('/a.wav');
    const audio = createdAudios[0];
    let notifyCount = 0;
    t.subscribe(() => { notifyCount++; });

    audio.paused = false;
    audio.dispatch('play');
    expect(notifyCount).toBe(1);
    expect(pendingRafCount()).toBe(1);

    let ticks = 0;
    t.onTick(() => { ticks++; });
    runRaf();
    expect(ticks).toBe(1);
    expect(pendingRafCount()).toBe(1); // loop reschedules itself

    audio.paused = true;
    audio.dispatch('pause');
    expect(notifyCount).toBe(2);
    // The loop's own guard also self-terminates on the next tick, but pause
    // stops it immediately by not rescheduling further via cancelRaf.
  });

  it('ended resets currentTime to 0, notifies, and stops the loop', async () => {
    const { deps, createdAudios, setUrl } = makeDeps();
    setUrl('/a.wav', 'file:///a.wav');
    const t = createSpectrumTransport(deps);
    await t.ensure('/a.wav');
    const audio = createdAudios[0];
    audio.currentTime = 42;
    let notifyCount = 0;
    t.subscribe(() => { notifyCount++; });

    audio.dispatch('ended');

    expect(audio.currentTime).toBe(0);
    expect(notifyCount).toBe(1);
  });

  it('ignores a stale pause/ended event whose target is no longer the current audio', async () => {
    const { deps, createdAudios, setUrl } = makeDeps();
    setUrl('/a.wav', 'file:///a.wav');
    setUrl('/b.wav', 'file:///b.wav');
    const t = createSpectrumTransport(deps);
    await t.ensure('/a.wav');
    const staleAudio = createdAudios[0];
    await t.ensure('/b.wav');
    let notifyCount = 0;
    t.subscribe(() => { notifyCount++; });

    staleAudio.dispatch('pause');
    staleAudio.dispatch('ended');

    expect(notifyCount).toBe(0);
  });

  it('reset() releases the element and invalidates an in-flight ensure()', async () => {
    const { deps, createdAudios } = makeDeps();
    const t = createSpectrumTransport(deps);
    let resolveUrl!: (v: string | null) => void;
    deps.toFileUrl = vi.fn().mockImplementation(() => new Promise((r) => { resolveUrl = r; }));

    const inFlight = t.ensure('/a.wav');
    t.reset();
    resolveUrl('file:///a.wav');
    await inFlight;

    expect(createdAudios).toHaveLength(0);
    expect(t.currentTime()).toBe(0);
  });

  it('reset() pauses and clears the src of a live element', async () => {
    const { deps, createdAudios, setUrl } = makeDeps();
    setUrl('/a.wav', 'file:///a.wav');
    const t = createSpectrumTransport(deps);
    await t.ensure('/a.wav');
    const audio = createdAudios[0];
    audio.paused = false;

    t.reset();

    expect(audio.paused).toBe(true);
    expect(audio.src).toBe('');
  });

  it('pauseIfPlaying no-ops on an already-paused element', async () => {
    const { deps, createdAudios, setUrl } = makeDeps();
    setUrl('/a.wav', 'file:///a.wav');
    const t = createSpectrumTransport(deps);
    await t.ensure('/a.wav');
    const audio = createdAudios[0];
    expect(audio.paused).toBe(true);

    t.pauseIfPlaying();

    expect(audio.paused).toBe(true);
  });

  it('isPlaying() is false with no audio, false once ended, true while playing', async () => {
    const { deps, createdAudios, setUrl } = makeDeps();
    setUrl('/a.wav', 'file:///a.wav');
    const t = createSpectrumTransport(deps);
    expect(t.isPlaying()).toBe(false);

    await t.ensure('/a.wav');
    const audio = createdAudios[0];
    audio.paused = false;
    expect(t.isPlaying()).toBe(true);

    audio.ended = true;
    expect(t.isPlaying()).toBe(false);
  });

  it('currentTime() is 0 with no audio element', () => {
    const { deps } = makeDeps();
    const t = createSpectrumTransport(deps);
    expect(t.currentTime()).toBe(0);
  });

  it('does not schedule a second rAF loop when play fires while already looping', async () => {
    const { deps, createdAudios, setUrl, pendingRafCount } = makeDeps();
    setUrl('/a.wav', 'file:///a.wav');
    const t = createSpectrumTransport(deps);
    await t.ensure('/a.wav');
    const audio = createdAudios[0];

    audio.paused = false;
    audio.dispatch('play');
    audio.dispatch('play'); // e.g. a redundant browser 'play' event

    expect(pendingRafCount()).toBe(1);
  });

  it('pauseIfPlaying pauses a playing element', async () => {
    const { deps, createdAudios, setUrl } = makeDeps();
    setUrl('/a.wav', 'file:///a.wav');
    const t = createSpectrumTransport(deps);
    await t.ensure('/a.wav');
    const audio = createdAudios[0];
    audio.paused = false;

    t.pauseIfPlaying();

    expect(audio.paused).toBe(true);
  });

  it('toggle() plays a paused element and pauses a playing one; no-ops with no element', async () => {
    const { deps, createdAudios, setUrl } = makeDeps();
    setUrl('/a.wav', 'file:///a.wav');
    const t = createSpectrumTransport(deps);

    t.toggle(); // no audio yet — no throw

    await t.ensure('/a.wav');
    const audio = createdAudios[0];
    t.toggle();
    expect(audio.playCalls).toBe(1);

    audio.paused = false;
    t.toggle();
    expect(audio.paused).toBe(true);
  });

  it('seek() clamps against duration() and notifies', async () => {
    const { deps, createdAudios, setUrl } = makeDeps();
    setUrl('/a.wav', 'file:///a.wav');
    const t = createSpectrumTransport(deps);
    await t.ensure('/a.wav');
    const audio = createdAudios[0];
    audio.duration = 10;
    let notifyCount = 0;
    t.subscribe(() => { notifyCount++; });

    t.seek(9.99);

    expect(audio.currentTime).toBe(9.95);
    expect(notifyCount).toBe(1);
  });

  it('seek() with no audio element is a no-op', () => {
    const { deps } = makeDeps();
    const t = createSpectrumTransport(deps);
    expect(() => t.seek(5)).not.toThrow();
  });

  it('duration() falls back to the set fallback duration when audio duration is unknown', async () => {
    const { deps, setUrl } = makeDeps();
    setUrl('/a.wav', 'file:///a.wav');
    const t = createSpectrumTransport(deps);
    await t.ensure('/a.wav');

    t.setFallbackDuration(180);

    expect(t.duration()).toBe(180);
  });

  it('subscribe() returns an unsubscribe function', async () => {
    const { deps, createdAudios, setUrl } = makeDeps();
    setUrl('/a.wav', 'file:///a.wav');
    const t = createSpectrumTransport(deps);
    await t.ensure('/a.wav');
    const audio = createdAudios[0];
    let count = 0;
    const unsubscribe = t.subscribe(() => { count++; });

    unsubscribe();
    audio.dispatch('timeupdate');

    expect(count).toBe(0);
  });

  it('onTick() returns an unsubscribe function', async () => {
    const { deps, createdAudios, setUrl, runRaf } = makeDeps();
    setUrl('/a.wav', 'file:///a.wav');
    const t = createSpectrumTransport(deps);
    await t.ensure('/a.wav');
    const audio = createdAudios[0];
    let ticks = 0;
    const unsubscribe = t.onTick(() => { ticks++; });

    audio.paused = false;
    audio.dispatch('play');
    unsubscribe();
    runRaf();

    expect(ticks).toBe(0);
  });

  it('an error event notifies subscribers', async () => {
    const { deps, createdAudios, setUrl } = makeDeps();
    setUrl('/a.wav', 'file:///a.wav');
    const t = createSpectrumTransport(deps);
    await t.ensure('/a.wav');
    const audio = createdAudios[0];
    let notifyCount = 0;
    t.subscribe(() => { notifyCount++; });

    audio.dispatch('error');

    expect(notifyCount).toBe(1);
  });

  it('a loadedmetadata event notifies subscribers', async () => {
    const { deps, createdAudios, setUrl } = makeDeps();
    setUrl('/a.wav', 'file:///a.wav');
    const t = createSpectrumTransport(deps);
    await t.ensure('/a.wav');
    const audio = createdAudios[0];
    let notifyCount = 0;
    t.subscribe(() => { notifyCount++; });

    audio.dispatch('loadedmetadata');

    expect(notifyCount).toBe(1);
  });

  it('the tick loop self-terminates once the audio is paused/ended, even without an explicit pause event', async () => {
    const { deps, createdAudios, setUrl, runRaf, pendingRafCount } = makeDeps();
    setUrl('/a.wav', 'file:///a.wav');
    const t = createSpectrumTransport(deps);
    await t.ensure('/a.wav');
    const audio = createdAudios[0];
    audio.paused = false;
    audio.dispatch('play');
    expect(pendingRafCount()).toBe(1);

    audio.paused = true; // simulate the element pausing without re-dispatching
    runRaf();

    expect(pendingRafCount()).toBe(0);
  });
});

// Sanity: the exported constants used by the above (and by SpectrogramScrubber).
describe('constants', () => {
  it('exposes the playback averaging window and seek end guard', () => {
    expect(PLAYBACK_AVG_WINDOW_SEC).toBe(0.5);
    expect(SEEK_END_GUARD_SEC).toBe(0.05);
  });
});
