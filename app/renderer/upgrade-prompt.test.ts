import { describe, it, expect } from 'vitest';

// upgrade-prompt.js is a plain classic script (window.upgradePrompt in the
// browser, module.exports under Node) so its pure plan/trial-status logic is
// exercised here without a DOM.
const {
  UPGRADE_CTA_PLAN,
  UPGRADE_CTA_LABEL,
  DAY_MS,
  trialDaysLeft,
  planStatusView,
} = require('./upgrade-prompt.js') as {
  UPGRADE_CTA_PLAN: string;
  UPGRADE_CTA_LABEL: string;
  DAY_MS: number;
  trialDaysLeft: (state: { status?: string; trialEndsAt?: string } | null, now?: Date) => number | null;
  planStatusView: (
    state: { tier?: string; status?: string; kind?: string; expiresAt?: string; trialEndsAt?: string } | null,
    now?: Date
  ) => { label: string; isPro: boolean; showUpgrade: boolean; trialDaysLeft: number | null };
};

const NOW = new Date('2026-08-06T12:00:00Z');

describe('copy constants', () => {
  it('UPGRADE_CTA_PLAN is a valid checkout plan', () => {
    expect(['monthly', 'annual']).toContain(UPGRADE_CTA_PLAN);
    expect(UPGRADE_CTA_PLAN).toBe('monthly');
  });

  it('UPGRADE_CTA_LABEL is the CTA button copy', () => {
    expect(UPGRADE_CTA_LABEL).toBe('Upgrade to Pro');
  });

  it('DAY_MS is one day in milliseconds', () => {
    expect(DAY_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe('trialDaysLeft', () => {
  it('is null for a non-trial state', () => {
    expect(trialDaysLeft(null, NOW)).toBeNull();
    expect(trialDaysLeft({ status: 'none' }, NOW)).toBeNull();
    expect(trialDaysLeft({ status: 'valid' }, NOW)).toBeNull();
  });

  it('is null when trialEndsAt is missing, blank, or unparseable', () => {
    expect(trialDaysLeft({ status: 'trial' }, NOW)).toBeNull();
    expect(trialDaysLeft({ status: 'trial', trialEndsAt: '' }, NOW)).toBeNull();
    expect(trialDaysLeft({ status: 'trial', trialEndsAt: 'not-a-date' }, NOW)).toBeNull();
  });

  it('is null once trialEndsAt is in the past', () => {
    expect(trialDaysLeft({ status: 'trial', trialEndsAt: '2026-08-01T12:00:00Z' }, NOW)).toBeNull();
  });

  it('ceils to whole days with a floor of 1 while the trial is active', () => {
    expect(trialDaysLeft({ status: 'trial', trialEndsAt: '2026-08-16T12:00:00Z' }, NOW)).toBe(10);
    // Less than a day left still floors to 1.
    expect(trialDaysLeft({ status: 'trial', trialEndsAt: '2026-08-06T13:00:00Z' }, NOW)).toBe(1);
  });

  it('defaults now to the current time when omitted', () => {
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(trialDaysLeft({ status: 'trial', trialEndsAt: future })).toBeGreaterThanOrEqual(4);
  });
});

describe('planStatusView', () => {
  it('null state -> Free plan, not Pro, shows upgrade', () => {
    const view = planStatusView(null, NOW);
    expect(view).toEqual({ label: 'Free plan', isPro: false, showUpgrade: true, trialDaysLeft: null });
  });

  it('status "none" -> Free plan, shows upgrade', () => {
    const view = planStatusView({ tier: 'free', status: 'none' }, NOW);
    expect(view).toEqual({ label: 'Free plan', isPro: false, showUpgrade: true, trialDaysLeft: null });
  });

  it('status "trial" -> Pro trial countdown, isPro, shows upgrade', () => {
    const view = planStatusView({ tier: 'pro', status: 'trial', trialEndsAt: '2026-08-16T12:00:00Z' }, NOW);
    expect(view).toEqual({ label: 'Pro trial — 10 days left', isPro: true, showUpgrade: true, trialDaysLeft: 10 });
  });

  it('status "trial" with exactly 1 day left uses the singular label', () => {
    const view = planStatusView({ tier: 'pro', status: 'trial', trialEndsAt: '2026-08-06T13:00:00Z' }, NOW);
    expect(view.label).toBe('Pro trial — 1 day left');
    expect(view.trialDaysLeft).toBe(1);
  });

  it('status "trial" with no parseable trialEndsAt falls back to plain label', () => {
    const view = planStatusView({ tier: 'pro', status: 'trial' }, NOW);
    expect(view.label).toBe('Pro trial');
    expect(view.trialDaysLeft).toBeNull();
    expect(view.isPro).toBe(true);
    expect(view.showUpgrade).toBe(true);
  });

  it('status "trial-expired" -> Trial ended, shows upgrade', () => {
    const view = planStatusView({ tier: 'free', status: 'trial-expired' }, NOW);
    expect(view).toEqual({ label: 'Trial ended — Free plan', isPro: false, showUpgrade: true, trialDaysLeft: null });
  });

  it('status "valid" subscription -> Pro active, hides upgrade', () => {
    const view = planStatusView({ tier: 'pro', status: 'valid', kind: 'subscription' }, NOW);
    expect(view).toEqual({ label: 'Pro — active', isPro: true, showUpgrade: false, trialDaysLeft: null });
  });

  it('status "valid" lifetime -> Pro lifetime license, hides upgrade', () => {
    const view = planStatusView({ tier: 'pro', status: 'valid', kind: 'lifetime' }, NOW);
    expect(view).toEqual({ label: 'Pro — lifetime license', isPro: true, showUpgrade: false, trialDaysLeft: null });
  });

  it('status "grace" -> Pro grace period, shows upgrade', () => {
    const view = planStatusView({ tier: 'pro', status: 'grace' }, NOW);
    expect(view).toEqual({ label: 'Pro — grace period', isPro: true, showUpgrade: true, trialDaysLeft: null });
  });

  it('status "expired" -> Free plan (license expired), shows upgrade', () => {
    const view = planStatusView({ tier: 'free', status: 'expired' }, NOW);
    expect(view).toEqual({ label: 'Free plan (license expired)', isPro: false, showUpgrade: true, trialDaysLeft: null });
  });

  it('status "invalid" -> Free plan, shows upgrade', () => {
    const view = planStatusView({ tier: 'free', status: 'invalid' }, NOW);
    expect(view).toEqual({ label: 'Free plan', isPro: false, showUpgrade: true, trialDaysLeft: null });
  });
});
