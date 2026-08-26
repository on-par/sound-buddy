import { describe, expect, it } from 'vitest';
import {
  FOUNDING_COUNT_ENDPOINT,
  foundingRemainingLabel,
  parseFoundingCount,
} from './founding-count';

describe('FOUNDING_COUNT_ENDPOINT', () => {
  it('points at the Worker founding-count route', () => {
    expect(FOUNDING_COUNT_ENDPOINT).toBe('/api/stripe/founding-count');
  });
});

describe('parseFoundingCount', () => {
  it('returns the parsed object for a valid body', () => {
    expect(parseFoundingCount({ sold: 142, cap: 300, remaining: 158 })).toEqual({
      sold: 142,
      cap: 300,
      remaining: 158,
    });
  });

  it('returns null for a non-object body', () => {
    expect(parseFoundingCount(null)).toBeNull();
    expect(parseFoundingCount('142')).toBeNull();
    expect(parseFoundingCount(142)).toBeNull();
    expect(parseFoundingCount(undefined)).toBeNull();
  });

  it('returns null when a field is missing', () => {
    expect(parseFoundingCount({ sold: 1, cap: 300 })).toBeNull();
  });

  it('returns null when a field is non-numeric', () => {
    expect(parseFoundingCount({ sold: '1', cap: 300, remaining: 299 })).toBeNull();
  });

  it('returns null when a field is NaN', () => {
    expect(parseFoundingCount({ sold: Number.NaN, cap: 300, remaining: 299 })).toBeNull();
  });
});

describe('foundingRemainingLabel', () => {
  it('renders the remaining count when licenses are left', () => {
    expect(foundingRemainingLabel({ sold: 142, cap: 300, remaining: 158 })).toBe(
      '158 of 300 founding licenses remaining.',
    );
  });

  it('renders a sold-out line when remaining is 0', () => {
    expect(foundingRemainingLabel({ sold: 300, cap: 300, remaining: 0 })).toBe(
      'Founding is sold out — all 300 licenses claimed.',
    );
  });
});
