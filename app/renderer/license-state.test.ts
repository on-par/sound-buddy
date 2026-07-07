import { describe, it, expect } from 'vitest';

// The helpers are a plain classic script (window.licenseState in the browser,
// module.exports under Node) so they can be exercised here without a DOM.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PRO_FEATURES, isEntitled, badge, graceDaysLeft, graceBannerText } = require('./license-state.js') as {
  PRO_FEATURES: string[];
  isEntitled: (state: unknown, feature: string) => boolean;
  badge: (state: unknown) => { label: string; pro: boolean; grace: boolean };
  graceDaysLeft: (state: unknown, now?: Date) => number | null;
  graceBannerText: (state: unknown, now?: Date) => string | null;
};

const NOW = new Date('2026-07-05T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

describe('isEntitled', () => {
  it('locks every pro feature without a pro state', () => {
    for (const f of PRO_FEATURES) {
      expect(isEntitled(null, f)).toBe(false);
      expect(isEntitled({ tier: 'free', status: 'expired' }, f)).toBe(false);
    }
  });

  it('unlocks pro features for tier "pro" (valid or grace)', () => {
    for (const f of PRO_FEATURES) {
      expect(isEntitled({ tier: 'pro', status: 'valid' }, f)).toBe(true);
      expect(isEntitled({ tier: 'pro', status: 'grace' }, f)).toBe(true);
    }
  });

  it('non-pro features (the report card) are always entitled', () => {
    expect(isEntitled(null, 'report-card')).toBe(true);
    expect(isEntitled({ tier: 'free', status: 'none' }, 'anything-else')).toBe(true);
  });
});

describe('badge', () => {
  it('FREE for null/free states', () => {
    expect(badge(null)).toEqual({ label: 'FREE', pro: false, grace: false });
    expect(badge({ tier: 'free', status: 'expired' })).toEqual({ label: 'FREE', pro: false, grace: false });
  });

  it('PRO for valid, PRO · GRACE while in grace', () => {
    expect(badge({ tier: 'pro', status: 'valid' })).toEqual({ label: 'PRO', pro: true, grace: false });
    expect(badge({ tier: 'pro', status: 'grace' })).toEqual({ label: 'PRO · GRACE', pro: true, grace: true });
  });
});

describe('grace helpers', () => {
  const graceState = (daysLeft: number) => ({
    tier: 'pro',
    status: 'grace',
    graceEndsAt: new Date(NOW.getTime() + daysLeft * DAY_MS).toISOString(),
  });

  it('counts whole days remaining (ceiling)', () => {
    expect(graceDaysLeft(graceState(3), NOW)).toBe(3);
    expect(graceDaysLeft(graceState(2.5), NOW)).toBe(3);
    // Under a day still reads as 1 day, never 0.
    expect(graceDaysLeft(graceState(0.2), NOW)).toBe(1);
  });

  it('returns null when not in grace or the deadline is malformed/past', () => {
    expect(graceDaysLeft(null, NOW)).toBeNull();
    expect(graceDaysLeft({ tier: 'pro', status: 'valid' }, NOW)).toBeNull();
    expect(graceDaysLeft({ status: 'grace', graceEndsAt: 'nonsense' }, NOW)).toBeNull();
    expect(graceDaysLeft(graceState(-1), NOW)).toBeNull();
  });

  it('banner copy pluralizes and only shows during grace', () => {
    expect(graceBannerText(graceState(3), NOW)).toContain('3 more days');
    expect(graceBannerText(graceState(0.5), NOW)).toContain('1 more day');
    expect(graceBannerText({ tier: 'pro', status: 'valid' }, NOW)).toBeNull();
    expect(graceBannerText(null, NOW)).toBeNull();
  });
});
