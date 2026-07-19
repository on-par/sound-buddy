import { describe, it, expect } from 'vitest';

// daw-playhead-state is a plain classic script (window.dawPlayheadState / module.exports).
const { start, stop, isAdvancing, elapsedMs, formatElapsed, offsetPx } = require('./daw-playhead-state.js') as {
  start: (nowMs: number) => { startedAtMs: number; stoppedAtMs: number | null };
  stop: (
    state: { startedAtMs: number; stoppedAtMs: number | null } | null,
    nowMs: number
  ) => { startedAtMs: number; stoppedAtMs: number | null } | null;
  isAdvancing: (state: { startedAtMs: number; stoppedAtMs: number | null } | null) => boolean;
  elapsedMs: (state: { startedAtMs: number; stoppedAtMs: number | null } | null, nowMs: number) => number;
  formatElapsed: (ms: number) => string;
  offsetPx: (elapsedMsVal: number, pxPerSecond: number, maxPx: number) => number;
};

describe('start', () => {
  it('elapsedMs is 0 immediately after starting', () => {
    expect(elapsedMs(start(1000), 1000)).toBe(0);
  });

  it('isAdvancing is true right after starting', () => {
    expect(isAdvancing(start(1000))).toBe(true);
  });
});

describe('advancing', () => {
  it('elapsedMs grows with the wall clock while advancing', () => {
    expect(elapsedMs(start(1000), 61500)).toBe(60500);
  });
});

describe('stop', () => {
  it('freezes elapsed time at the stop point', () => {
    const s = stop(start(1000), 4000);
    expect(elapsedMs(s, 999999)).toBe(3000);
    expect(isAdvancing(s)).toBe(false);
  });

  it('is null-safe: stopping a null state returns null', () => {
    expect(stop(null, 500)).toBeNull();
  });

  it('stopping an already-stopped state keeps the original stoppedAtMs', () => {
    const s = stop(stop(start(0), 100), 500);
    expect(elapsedMs(s, 999999)).toBe(100);
  });
});

describe('reset', () => {
  it('a fresh start after a stopped capture resets elapsed to 0', () => {
    const stopped = stop(start(0), 100);
    const restarted = start(5000);
    expect(elapsedMs(restarted, 5000)).toBe(0);
    expect(stopped).not.toBe(restarted);
  });
});

describe('null state', () => {
  it('elapsedMs is 0 for a null state', () => {
    expect(elapsedMs(null, 123)).toBe(0);
  });

  it('isAdvancing is false for a null state', () => {
    expect(isAdvancing(null)).toBe(false);
  });
});

describe('clock skew', () => {
  it('elapsedMs is clamped to 0, never negative', () => {
    expect(elapsedMs(start(2000), 1000)).toBe(0);
  });
});

describe('formatElapsed', () => {
  it('0 -> 0:00', () => { expect(formatElapsed(0)).toBe('0:00'); });
  it('999 -> 0:00', () => { expect(formatElapsed(999)).toBe('0:00'); });
  it('1000 -> 0:01', () => { expect(formatElapsed(1000)).toBe('0:01'); });
  it('65000 -> 1:05', () => { expect(formatElapsed(65000)).toBe('1:05'); });
  it('600000 -> 10:00', () => { expect(formatElapsed(600000)).toBe('10:00'); });
  it('-5 -> 0:00', () => { expect(formatElapsed(-5)).toBe('0:00'); });
  it('NaN -> 0:00', () => { expect(formatElapsed(NaN)).toBe('0:00'); });
  it('Infinity -> 0:00', () => { expect(formatElapsed(Infinity)).toBe('0:00'); });
});

describe('offsetPx', () => {
  it('0 elapsed -> 0px', () => { expect(offsetPx(0, 8, 400)).toBe(0); });
  it('5000ms at 8px/s -> 40px', () => { expect(offsetPx(5000, 8, 400)).toBe(40); });
  it('clamps at maxPx', () => { expect(offsetPx(999999, 8, 400)).toBe(400); });
  it('clamps negative elapsed to 0', () => { expect(offsetPx(-500, 8, 400)).toBe(0); });
});
