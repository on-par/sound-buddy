import { describe, it, expect } from 'vitest';

// rig-kind is a plain classic script (window.rigKind in the browser,
// module.exports under Node) so it can be exercised here without a DOM.
const { switchKind } = require('./rig-kind.js') as {
  switchKind: (
    strip: { kind: string; a: number; b: number; label?: string; armed?: boolean } | null,
    kind: string,
    maxChannels: number,
  ) => { kind: string; a: number; b: number; label?: string; armed?: boolean };
};

describe('switchKind — mono → stereo', () => {
  it('defaults b to a+1 when b is unset', () => {
    const out = switchKind({ kind: 'mono', a: 2, b: undefined as unknown as number }, 'stereo', 8);
    expect(out).toEqual({ kind: 'stereo', a: 2, b: 3 });
  });

  it('defaults b to a+1 when b === a', () => {
    const out = switchKind({ kind: 'mono', a: 2, b: 2 }, 'stereo', 8);
    expect(out).toEqual({ kind: 'stereo', a: 2, b: 3 });
  });

  it('preserves an already-distinct b', () => {
    const out = switchKind({ kind: 'mono', a: 2, b: 5 }, 'stereo', 8);
    expect(out).toEqual({ kind: 'stereo', a: 2, b: 5 });
  });

  it('clamps the defaulted b to the last device channel', () => {
    // 8 channels → indices 0..7; a on the last channel has nowhere to go.
    const out = switchKind({ kind: 'mono', a: 7, b: 7 }, 'stereo', 8);
    expect(out).toEqual({ kind: 'stereo', a: 7, b: 7 });
  });

  it('preserves label and armed', () => {
    const out = switchKind({ kind: 'mono', a: 0, b: 0, label: 'Kick', armed: true }, 'stereo', 8);
    expect(out).toEqual({ kind: 'stereo', a: 0, b: 1, label: 'Kick', armed: true });
  });
});

describe('switchKind — stereo → mono', () => {
  it('keeps a and leaves b untouched', () => {
    const out = switchKind({ kind: 'stereo', a: 2, b: 3 }, 'mono', 8);
    expect(out).toEqual({ kind: 'mono', a: 2, b: 3 });
  });

  it('clamps an out-of-range a to the last device channel', () => {
    const out = switchKind({ kind: 'stereo', a: 9, b: 10 }, 'mono', 8);
    expect(out).toEqual({ kind: 'mono', a: 7, b: 10 });
  });

  it('preserves label and armed', () => {
    const out = switchKind({ kind: 'stereo', a: 1, b: 2, label: 'OH', armed: false }, 'mono', 8);
    expect(out).toEqual({ kind: 'mono', a: 1, b: 2, label: 'OH', armed: false });
  });
});

describe('switchKind — general', () => {
  it('returns a fresh object; the input strip is not mutated', () => {
    const strip = { kind: 'mono', a: 0, b: 0 };
    const out = switchKind(strip, 'stereo', 8);
    expect(out).not.toBe(strip);
    expect(strip).toEqual({ kind: 'mono', a: 0, b: 0 });
  });

  it('defaults missing/non-finite a to channel 0', () => {
    const out = switchKind({ kind: 'mono', a: NaN as unknown as number, b: 0 }, 'stereo', 8);
    expect(out).toEqual({ kind: 'stereo', a: 0, b: 1 });
  });

  it('tolerates a null strip, defaulting to channel 0', () => {
    expect(switchKind(null, 'mono', 8)).toEqual({ kind: 'mono', a: 0, b: 0 });
    expect(switchKind(null, 'stereo', 8)).toEqual({ kind: 'stereo', a: 0, b: 1 });
  });

  it('falls back to a single valid channel when the device count is 0/NaN', () => {
    const out = switchKind({ kind: 'mono', a: 0, b: 0 }, 'stereo', 0);
    expect(out).toEqual({ kind: 'stereo', a: 0, b: 0 });
  });
});
