import { describe, it, expect } from 'vitest';

// ideal-profile.js is a plain classic script (window.idealProfile in the browser,
// module.exports under Node) so the custom-curve builder is exercised here
// without a DOM.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GRID_POINTS, customProfileFromCurve } = require('./ideal-profile.js') as {
  GRID_POINTS: number;
  customProfileFromCurve: (
    curve: { db: number[]; freqs?: number[] } | null | undefined,
    label: string,
  ) => { id: string; label: string; description: string; dbOffsets: number[] } | null;
};

// 48-point measured curve shape (mean-subtracted by the builder).
const curve = (fill = 0) => ({ db: Array.from({ length: GRID_POINTS }, (_, i) => fill + (i % 5)) });

describe('customProfileFromCurve', () => {
  it('builds a level-invariant custom profile on the 48-point grid', () => {
    const p = customProfileFromCurve(curve(20), 'Like service.wav');
    expect(p).not.toBeNull();
    expect(p!.id).toBe('__custom');
    expect(p!.label).toBe('Like service.wav');
    expect(p!.dbOffsets).toHaveLength(GRID_POINTS);
    // Every stored offset is finite (safe for the comparator).
    expect(p!.dbOffsets.every((n) => Number.isFinite(n))).toBe(true);
  });

  it('mean-subtracts the shape so absolute level is irrelevant', () => {
    // The same shape shifted by +40 dB must produce identical offsets.
    const a = customProfileFromCurve(curve(0), 'a')!;
    const b = customProfileFromCurve(curve(40), 'b')!;
    expect(b.dbOffsets).toEqual(a.dbOffsets);
    // And the offsets centre around 0 (mean ≈ 0 over the finite bins).
    const mean = a.dbOffsets.reduce((s, n) => s + n, 0) / a.dbOffsets.length;
    expect(Math.abs(mean)).toBeLessThan(0.01);
  });

  it('fills silent (non-finite) bins with 0 so they score neutrally', () => {
    const db = curve(0).db.slice();
    db[10] = -Infinity;
    db[20] = NaN;
    const p = customProfileFromCurve({ db }, 'gappy')!;
    expect(p.dbOffsets[10]).toBe(0);
    expect(p.dbOffsets[20]).toBe(0);
    // The finite bins are still mean-subtracted against the finite mean only.
    expect(p.dbOffsets.every((n) => Number.isFinite(n))).toBe(true);
  });

  it('trims the label and falls back to "Custom" when empty', () => {
    expect(customProfileFromCurve(curve(0), '  hi  ')!.label).toBe('hi');
    expect(customProfileFromCurve(curve(0), '   ')!.label).toBe('Custom');
  });

  it('returns null when there is no usable curve', () => {
    expect(customProfileFromCurve(null, 'x')).toBeNull();
    expect(customProfileFromCurve(undefined, 'x')).toBeNull();
    expect(customProfileFromCurve({ db: [] }, 'x')).toBeNull();
    expect(customProfileFromCurve({ db: [1, 2, 3] }, 'x')).toBeNull(); // wrong grid length
  });

  it('returns null for a near-silent file (no shape to target)', () => {
    const allSilent = { db: Array.from({ length: GRID_POINTS }, () => -Infinity) };
    expect(customProfileFromCurve(allSilent, 'x')).toBeNull();
    const oneFinite = { db: Array.from({ length: GRID_POINTS }, (_, i) => (i === 0 ? 0 : -Infinity)) };
    expect(customProfileFromCurve(oneFinite, 'x')).toBeNull();
  });
});