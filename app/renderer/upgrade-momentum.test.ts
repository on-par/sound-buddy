import { describe, it, expect } from 'vitest';

// upgrade-momentum.js is a plain classic script (window.upgradeMomentum in the
// browser, module.exports under Node) so its pure copy/tone/dismissal logic is
// exercised here without a DOM.
const {
  DISMISS_DAYS,
  PLANS,
  ACTIONS,
  TRUST_COPY,
  FIRST_RESULT_REVEAL_MS,
  toneForGrade,
  shouldShowForLicense,
  isDismissed,
  revealDelayMs,
} = require('./upgrade-momentum.js') as {
  DISMISS_DAYS: number;
  PLANS: { plan: string; label: string; primary: boolean }[];
  ACTIONS: { feature: string; title: string; hint: string }[];
  TRUST_COPY: string;
  FIRST_RESULT_REVEAL_MS: number;
  toneForGrade: (grade: string) => { heading: string; sub: string };
  shouldShowForLicense: (state: unknown) => boolean;
  isDismissed: (dismissedAt: number | string | null | undefined, now?: Date) => boolean;
  revealDelayMs: (firstSeenAt: number | string | null | undefined) => number;
};

const NOW = new Date('2026-07-05T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

describe('shouldShowForLicense', () => {
  it('shows for free / no state', () => {
    expect(shouldShowForLicense(null)).toBe(true);
    expect(shouldShowForLicense({ tier: 'free', status: 'none' })).toBe(true);
    expect(shouldShowForLicense({ tier: 'free', status: 'trial-expired' })).toBe(true);
  });

  it('hides for any Pro state (valid, trial, grace)', () => {
    expect(shouldShowForLicense({ tier: 'pro', status: 'valid' })).toBe(false);
    expect(shouldShowForLicense({ tier: 'pro', status: 'trial' })).toBe(false);
    expect(shouldShowForLicense({ tier: 'pro', status: 'grace' })).toBe(false);
  });
});

describe('toneForGrade', () => {
  it('celebrates a strong result (A/B) rather than implying it needs help', () => {
    for (const g of ['A', 'B']) {
      const t = toneForGrade(g);
      expect(t.heading).toMatch(/repeatable/i);
      // Never frames a good mix as broken.
      expect(t.sub).not.toMatch(/improve|fix|problem/i);
    }
  });

  it('frames a weaker result (C/D/F) as building a workflow', () => {
    for (const g of ['C', 'D', 'F']) {
      const t = toneForGrade(g);
      expect(t.heading).toBe('Keep improving');
      expect(t.sub).toMatch(/workflow/i);
    }
  });

  it('always returns non-empty heading and sub', () => {
    for (const g of ['A', 'B', 'C', 'D', 'F', 'unknown']) {
      const t = toneForGrade(g);
      expect(t.heading.length).toBeGreaterThan(0);
      expect(t.sub.length).toBeGreaterThan(0);
    }
  });
});

describe('isDismissed', () => {
  it('is not dismissed when never dismissed', () => {
    expect(isDismissed(null, NOW)).toBe(false);
    expect(isDismissed(undefined, NOW)).toBe(false);
    expect(isDismissed('not-a-number', NOW)).toBe(false);
  });

  it('stays dismissed within the 7-day window', () => {
    const justNow = NOW.getTime();
    expect(isDismissed(justNow, NOW)).toBe(true);
    expect(isDismissed(NOW.getTime() - 6 * DAY_MS, NOW)).toBe(true);
    // Stored as a string (localStorage round-trip) still works.
    expect(isDismissed(String(NOW.getTime() - 1 * DAY_MS), NOW)).toBe(true);
  });

  it('re-appears once the window has passed', () => {
    expect(isDismissed(NOW.getTime() - DISMISS_DAYS * DAY_MS, NOW)).toBe(false);
    expect(isDismissed(NOW.getTime() - (DISMISS_DAYS + 1) * DAY_MS, NOW)).toBe(false);
  });
});

describe('revealDelayMs', () => {
  it('holds the card back when no first-seen timestamp has been recorded (first result)', () => {
    expect(revealDelayMs(null)).toBe(FIRST_RESULT_REVEAL_MS);
    expect(revealDelayMs(undefined)).toBe(FIRST_RESULT_REVEAL_MS);
    expect(revealDelayMs('not-a-number')).toBe(FIRST_RESULT_REVEAL_MS);
  });

  it('reveals immediately once a first-seen timestamp exists', () => {
    expect(revealDelayMs(NOW.getTime())).toBe(0);
    // Stored as a string (localStorage round-trip) still works.
    expect(revealDelayMs(String(NOW.getTime()))).toBe(0);
  });
});

describe('copy constants', () => {
  it('offers exactly the two agreed prices, primary first', () => {
    expect(PLANS.map((p) => p.plan)).toEqual(['monthly', 'annual']);
    expect(PLANS[0].label).toContain('$9/mo');
    expect(PLANS[1].label).toContain('$79/yr');
    expect(PLANS[0].primary).toBe(true);
  });

  it('lists the three locked next-step actions from the wireframe', () => {
    expect(ACTIONS).toHaveLength(3);
    expect(ACTIONS.map((a) => a.title)).toEqual([
      'See what changed week to week',
      'Save this rig as your baseline',
      'Get ongoing coaching during live monitoring',
    ]);
    for (const a of ACTIONS) expect(a.hint.length).toBeGreaterThan(0);
  });

  it('trust copy names both the own-provider and local-Ollama paths', () => {
    expect(TRUST_COPY).toMatch(/own AI provider/i);
    expect(TRUST_COPY).toMatch(/Ollama/i);
  });

  it('the first-result reveal delay is long enough to land, short enough to stay the same moment (#296)', () => {
    expect(FIRST_RESULT_REVEAL_MS).toBeGreaterThanOrEqual(3000);
    expect(FIRST_RESULT_REVEAL_MS).toBeLessThanOrEqual(10000);
  });
});
