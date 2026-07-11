import { describe, it, expect, vi } from 'vitest';

vi.useFakeTimers();
vi.setSystemTime(new Date('2026-07-08T12:00:00Z'));

// ideal-curves is a plain classic script (window.idealCurves / module.exports).
const curves = require('./ideal-curves.js') as {
  normalizeProfiles: (raw: unknown, freqs: number[]) => CustomProfile[];
  bandOffsetsFromProfile: (profile: CustomProfile, freqs: number[]) => number[];
  profileFromBands: (bands: number[], freqs: number[], meta: Partial<CustomProfile>) => CustomProfile;
  profileFromMeasuredCurve: (
    curve: { freqs: number[]; db: number[] },
    freqs: number[],
    meta: Partial<CustomProfile>,
  ) => CustomProfile | null;
  upsertProfile: (profiles: CustomProfile[], profile: CustomProfile) => CustomProfile[];
  deleteProfile: (profiles: CustomProfile[], id: string) => CustomProfile[];
};

type CustomProfile = {
  id: string;
  label: string;
  description: string;
  freqs: number[];
  dbOffsets: number[];
  source?: 'manual' | 'analysis';
  createdAt?: string;
  updatedAt?: string;
};

const freqs = Array.from({ length: 48 }, (_, i) => 20 * Math.pow(1000, i / 47));

describe('ideal curve helpers', () => {
  it('builds a 48-point custom profile from seven band offsets', () => {
    const profile = curves.profileFromBands([-3, -1, 0, 2, 3, 1, -2], freqs, {
      label: 'Room target',
    });

    expect(profile.label).toBe('Room target');
    expect(profile.dbOffsets).toHaveLength(48);
    expect(profile.freqs).toEqual(freqs);
    expect(profile.source).toBe('manual');
    expect(Math.min(...profile.dbOffsets)).toBeGreaterThanOrEqual(-3);
    expect(Math.max(...profile.dbOffsets)).toBeLessThanOrEqual(3);
  });

  it('captures a measured analysis curve as a level-invariant target shape', () => {
    const db = freqs.map((_, i) => -36 + i / 4);
    const profile = curves.profileFromMeasuredCurve({ freqs, db }, freqs, { label: 'Measured' })!;

    expect(profile.source).toBe('analysis');
    expect(profile.dbOffsets).toHaveLength(48);
    const mean = profile.dbOffsets.reduce((a, b) => a + b, 0) / profile.dbOffsets.length;
    expect(mean).toBeCloseTo(0, 1);
  });

  it('normalizes persisted profiles and drops malformed rows', () => {
    const good = curves.profileFromBands([0, 1, 2, 3, 4, 5, 6], freqs, { label: 'Good', id: 'good' });
    const normalized = curves.normalizeProfiles([good, { label: 'bad', dbOffsets: [1] }, null], freqs);
    expect(normalized.map((p) => p.id)).toEqual(['good']);
  });

  it('upserts and deletes profiles immutably', () => {
    const a = curves.profileFromBands([0], freqs, { id: 'a', label: 'A' });
    const b = curves.profileFromBands([1], freqs, { id: 'b', label: 'B' });
    const list = curves.upsertProfile([a], b);
    expect(list.map((p) => p.id)).toEqual(['a', 'b']);
    expect(curves.deleteProfile(list, 'custom:a').map((p) => p.id)).toEqual(['b']);
  });
});
