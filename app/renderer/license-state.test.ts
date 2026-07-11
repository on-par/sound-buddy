import { describe, it, expect } from 'vitest';

// The helpers are a plain classic script (window.licenseState in the browser,
// module.exports under Node) so they can be exercised here without a DOM.
const { PRO_FEATURES, TRIAL_DAYS, isEntitled, badge, graceDaysLeft, graceBannerText, trialDaysLeft, trialBadgeText, trialNudge } =
  require('./license-state.js') as {
    PRO_FEATURES: string[];
    TRIAL_DAYS: number;
    isEntitled: (state: unknown, feature: string) => boolean;
    badge: (state: unknown) => { label: string; pro: boolean; grace: boolean; trial: boolean };
    graceDaysLeft: (state: unknown, now?: Date) => number | null;
    graceBannerText: (state: unknown, now?: Date) => string | null;
    trialDaysLeft: (state: unknown, now?: Date) => number | null;
    trialBadgeText: (state: unknown, now?: Date) => string | null;
    trialNudge: (state: unknown, now?: Date) => { milestone: string; text: string } | null;
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
    expect(badge(null)).toEqual({ label: 'FREE', pro: false, grace: false, trial: false });
    expect(badge({ tier: 'free', status: 'expired' })).toEqual({ label: 'FREE', pro: false, grace: false, trial: false });
    expect(badge({ tier: 'free', status: 'trial-expired' })).toEqual({ label: 'FREE', pro: false, grace: false, trial: false });
  });

  it('PRO for valid, PRO · GRACE while in grace, PRO · TRIAL while trialing', () => {
    expect(badge({ tier: 'pro', status: 'valid' })).toEqual({ label: 'PRO', pro: true, grace: false, trial: false });
    expect(badge({ tier: 'pro', status: 'grace' })).toEqual({ label: 'PRO · GRACE', pro: true, grace: true, trial: false });
    expect(badge({ tier: 'pro', status: 'trial' })).toEqual({ label: 'PRO · TRIAL', pro: true, grace: false, trial: true });
  });
});

describe('trial helpers (#61)', () => {
  const trialState = (daysLeft: number) => ({
    tier: 'pro',
    status: 'trial',
    trialEndsAt: new Date(NOW.getTime() + daysLeft * DAY_MS).toISOString(),
  });

  it('counts whole trial days remaining (ceiling, min 1)', () => {
    expect(trialDaysLeft(trialState(14), NOW)).toBe(14);
    expect(trialDaysLeft(trialState(2.5), NOW)).toBe(3);
    expect(trialDaysLeft(trialState(0.2), NOW)).toBe(1);
    expect(trialDaysLeft(trialState(-1), NOW)).toBeNull();
    expect(trialDaysLeft({ tier: 'pro', status: 'valid' }, NOW)).toBeNull();
    expect(trialDaysLeft({ status: 'trial', trialEndsAt: 'nonsense' }, NOW)).toBeNull();
  });

  it('badge text pluralizes and only shows during the trial', () => {
    expect(trialBadgeText(trialState(14), NOW)).toBe('Pro trial — 14 days left');
    expect(trialBadgeText(trialState(0.5), NOW)).toBe('Pro trial — 1 day left');
    expect(trialBadgeText({ tier: 'pro', status: 'valid' }, NOW)).toBeNull();
    expect(trialBadgeText({ tier: 'free', status: 'trial-expired' }, NOW)).toBeNull();
  });

  it('nudges at day 3 and day 11, quiet before and between milestones', () => {
    // Fresh (day 0) and day 2: no nudge yet.
    expect(trialNudge(trialState(TRIAL_DAYS), NOW)).toBeNull();
    expect(trialNudge(trialState(TRIAL_DAYS - 2), NOW)).toBeNull();
    // Day 3 through day 10: the first ("day3") nudge.
    expect(trialNudge(trialState(TRIAL_DAYS - 3), NOW)).toMatchObject({ milestone: 'day3' });
    expect(trialNudge(trialState(4), NOW)).toMatchObject({ milestone: 'day3' });
    // Day 11 onward: the second ("day11") nudge.
    expect(trialNudge(trialState(3), NOW)).toMatchObject({ milestone: 'day11' });
    expect(trialNudge(trialState(1), NOW)).toMatchObject({ milestone: 'day11' });
    // Not during a trial: nothing.
    expect(trialNudge({ tier: 'free', status: 'trial-expired' }, NOW)).toBeNull();
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
