// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import {
  LIVE_FRAME_PROBE_HOOK_KEY,
  LIVE_FRAME_PROBE_MAX_SAMPLES,
  percentileMs,
  formatLiveFrameProbeSummary,
  createLiveFrameProbeModel,
  createLiveFrameProbeTestHook,
  installLiveFrameProbeTestHook,
} from './live-frame-probe';

function fakeClock(...values: number[]): () => number {
  const queue = [...values];
  return () => {
    const next = queue.shift();
    if (next === undefined) throw new Error('fakeClock exhausted — add more values');
    return next;
  };
}

describe('percentileMs', () => {
  it('returns null for an empty sample set', () => {
    expect(percentileMs([], 50)).toBeNull();
  });

  it('returns the single value for a one-sample set regardless of percentile', () => {
    expect(percentileMs([7], 50)).toBe(7);
    expect(percentileMs([7], 95)).toBe(7);
  });

  it('computes p50 as the interpolated midpoint of a sorted set', () => {
    expect(percentileMs([1, 2, 3, 4, 5], 50)).toBe(3);
  });

  it('computes p95 with linear interpolation between ranked samples', () => {
    expect(percentileMs([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBeCloseTo(9.55, 5);
  });

  it('is order-independent — an unsorted input yields the same result as its sorted form', () => {
    expect(percentileMs([5, 1, 4, 2, 3], 50)).toBe(percentileMs([1, 2, 3, 4, 5], 50));
  });
});

describe('formatLiveFrameProbeSummary', () => {
  it('reports disabled without sample numbers', () => {
    const text = formatLiveFrameProbeSummary({ enabled: false, sampleCount: 0, p50Ms: null, p95Ms: null, boardRebuildCount: 0 });
    expect(text).toBe('live frame probe: disabled');
  });

  it('reports enabled-but-empty distinctly from a populated summary', () => {
    const text = formatLiveFrameProbeSummary({ enabled: true, sampleCount: 0, p50Ms: null, p95Ms: null, boardRebuildCount: 0 });
    expect(text).toBe('live frame probe: enabled, no samples yet');
  });

  it('formats p50/p95/sample count/rebuild count to two decimal places', () => {
    const text = formatLiveFrameProbeSummary({ enabled: true, sampleCount: 42, p50Ms: 1.2345, p95Ms: 6.789, boardRebuildCount: 3 });
    expect(text).toBe('live frame probe: p50=1.23ms p95=6.79ms samples=42 boardRebuilds=3');
  });
});

describe('createLiveFrameProbeModel', () => {
  it('defaults its clock to performance.now() when no deps are supplied', () => {
    const model = createLiveFrameProbeModel();
    model.start();

    model.endTick(model.beginTick());

    const summary = model.summary();
    expect(summary.sampleCount).toBe(1);
    expect(summary.p50Ms).toBeGreaterThanOrEqual(0);
  });

  it('is disabled at creation — beginTick is a no-op and retains no samples', () => {
    const model = createLiveFrameProbeModel({ now: fakeClock() });
    expect(model.isEnabled()).toBe(false);
    expect(model.beginTick()).toBeNull();
    expect(model.summary()).toEqual({ enabled: false, sampleCount: 0, p50Ms: null, p95Ms: null, boardRebuildCount: 0 });
  });

  it('start() enables the probe and endTick records a duration sample from the injected clock', () => {
    const model = createLiveFrameProbeModel({ now: fakeClock(100, 104.5) });
    model.start();

    const started = model.beginTick();
    model.endTick(started);

    const summary = model.summary();
    expect(summary.enabled).toBe(true);
    expect(summary.sampleCount).toBe(1);
    expect(summary.p50Ms).toBeCloseTo(4.5, 5);
    expect(summary.p95Ms).toBeCloseTo(4.5, 5);
  });

  it('endTick(null) — the shape an early-returning caller produces — records nothing', () => {
    const model = createLiveFrameProbeModel({ now: fakeClock(100) });
    model.start();

    model.endTick(null);

    expect(model.summary().sampleCount).toBe(0);
  });

  it('stop() disables further sampling but leaves the prior summary readable', () => {
    const model = createLiveFrameProbeModel({ now: fakeClock(0, 2) });
    model.start();
    model.endTick(model.beginTick());

    model.stop();

    expect(model.isEnabled()).toBe(false);
    expect(model.summary()).toMatchObject({ enabled: false, sampleCount: 1 });
    expect(model.beginTick()).toBeNull();
  });

  it('start() resets samples and the board-rebuild count from a previous run', () => {
    const model = createLiveFrameProbeModel({ now: fakeClock(0, 1, 0, 1) });
    model.start();
    model.endTick(model.beginTick());
    model.noteBoardHtml('<div>a</div>');
    model.noteBoardHtml('<div>b</div>');
    model.stop();

    model.start();

    expect(model.summary()).toMatchObject({ sampleCount: 0, boardRebuildCount: 0 });
  });

  it('computes p50 and p95 from repeated applyLiveTick-shaped samples', () => {
    const durations = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const clockValues: number[] = [];
    for (const d of durations) { clockValues.push(0, d); }
    const model = createLiveFrameProbeModel({ now: fakeClock(...clockValues) });
    model.start();

    for (let i = 0; i < durations.length; i++) model.endTick(model.beginTick());

    const summary = model.summary();
    expect(summary.sampleCount).toBe(10);
    expect(summary.p50Ms).toBeCloseTo(percentileMs(durations, 50)!, 5);
    expect(summary.p95Ms).toBeCloseTo(percentileMs(durations, 95)!, 5);
  });

  it('caps the ring buffer at maxSamples, dropping the oldest sample first', () => {
    const clockValues: number[] = [];
    for (let i = 1; i <= 3; i++) clockValues.push(0, i);
    const model = createLiveFrameProbeModel({ now: fakeClock(...clockValues), maxSamples: 2 });
    model.start();

    for (let i = 0; i < 3; i++) model.endTick(model.beginTick());

    const summary = model.summary();
    expect(summary.sampleCount).toBe(2);
    expect(summary.p50Ms).toBeCloseTo(2.5, 5);
  });

  it('defaults the ring buffer cap to LIVE_FRAME_PROBE_MAX_SAMPLES when maxSamples is omitted', () => {
    let tick = 0;
    const model = createLiveFrameProbeModel({ now: () => tick++ });
    model.start();

    for (let i = 0; i < LIVE_FRAME_PROBE_MAX_SAMPLES + 5; i++) model.endTick(model.beginTick());

    expect(model.summary().sampleCount).toBe(LIVE_FRAME_PROBE_MAX_SAMPLES);
  });

  it('noteBoardHtml is a no-op while disabled', () => {
    const model = createLiveFrameProbeModel({ now: fakeClock() });
    model.noteBoardHtml('<div>a</div>');
    model.noteBoardHtml('<div>b</div>');
    expect(model.summary().boardRebuildCount).toBe(0);
  });

  it('noteBoardHtml counts a changed markup string as a rebuild, and an unchanged one as a no-op', () => {
    const model = createLiveFrameProbeModel({ now: fakeClock() });
    model.start();

    model.noteBoardHtml('<div>a</div>');
    expect(model.summary().boardRebuildCount).toBe(0);

    model.noteBoardHtml('<div>a</div>');
    expect(model.summary().boardRebuildCount).toBe(0);

    model.noteBoardHtml('<div>b</div>');
    expect(model.summary().boardRebuildCount).toBe(1);

    model.noteBoardHtml('<div>c</div>');
    expect(model.summary().boardRebuildCount).toBe(2);
  });
});

describe('createLiveFrameProbeTestHook', () => {
  it('start/stop/summary delegate to the underlying model', () => {
    const model = createLiveFrameProbeModel({ now: fakeClock(0, 5) });
    const hook = createLiveFrameProbeTestHook(model);

    hook.start();
    model.endTick(model.beginTick());
    const summary = hook.summary();

    expect(summary).toEqual(model.summary());
    expect(summary.sampleCount).toBe(1);

    hook.stop();
    expect(model.isEnabled()).toBe(false);
  });
});

describe('installLiveFrameProbeTestHook', () => {
  it('when disabled, leaves the key absent and returns null', () => {
    const target: Record<string, unknown> = {};

    const result = installLiveFrameProbeTestHook(target, false);

    expect(result).toBeNull();
    expect(LIVE_FRAME_PROBE_HOOK_KEY in target).toBe(false);
  });

  it('when disabled, removes a previously installed hook', () => {
    const target: Record<string, unknown> = {};
    installLiveFrameProbeTestHook(target, true);

    installLiveFrameProbeTestHook(target, false);

    expect(LIVE_FRAME_PROBE_HOOK_KEY in target).toBe(false);
  });

  it('when enabled, installs a working hook against the passed model, structured-clone-safe', () => {
    const target: Record<string, unknown> = {};
    const model = createLiveFrameProbeModel({ now: fakeClock(0, 3) });

    const uninstall = installLiveFrameProbeTestHook(target, true, model);
    const hook = target[LIVE_FRAME_PROBE_HOOK_KEY] as { start(): void; summary(): unknown };
    hook.start();
    model.endTick(model.beginTick());

    expect(() => JSON.stringify(hook.summary())).not.toThrow();
    expect(hook.summary()).toEqual(model.summary());

    uninstall?.();
    expect(LIVE_FRAME_PROBE_HOOK_KEY in target).toBe(false);
  });
});
