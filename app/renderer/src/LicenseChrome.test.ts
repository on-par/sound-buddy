// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import {
  badge,
  trialDaysLeft,
  trialBadgeText,
  trialNudge,
  isInRefreshWindow,
  trialDismissed,
  dismissTrial,
  trialBannerView,
  LicenseBadgeButton,
  LicenseBanner,
  TrialBanner,
} from './LicenseChrome';
import type { LicenseState } from '../../electron/ipc/api';

const NOW = new Date('2026-08-06T12:00:00Z');

function fakeStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
  };
}

describe('badge', () => {
  it('reads FREE for null/free state', () => {
    expect(badge(null)).toEqual({ label: 'FREE', pro: false, grace: false, trial: false });
    expect(badge({ tier: 'free', status: 'none' })).toEqual({ label: 'FREE', pro: false, grace: false, trial: false });
  });

  it('reads PRO for a valid Pro license', () => {
    expect(badge({ tier: 'pro', status: 'valid' })).toEqual({ label: 'PRO', pro: true, grace: false, trial: false });
  });

  it('reads PRO · GRACE while in grace', () => {
    expect(badge({ tier: 'pro', status: 'grace' })).toEqual({ label: 'PRO · GRACE', pro: true, grace: true, trial: false });
  });

  it('reads PRO · TRIAL while trialing', () => {
    expect(badge({ tier: 'pro', status: 'trial' })).toEqual({ label: 'PRO · TRIAL', pro: true, grace: false, trial: true });
  });
});

describe('trialDaysLeft / trialBadgeText', () => {
  it('is null outside an active trial', () => {
    expect(trialDaysLeft({ tier: 'free', status: 'none' }, NOW)).toBeNull();
    expect(trialBadgeText({ tier: 'free', status: 'none' }, NOW)).toBeNull();
  });

  it('ceils to whole days, minimum 1', () => {
    const state: LicenseState = { tier: 'pro', status: 'trial', trialEndsAt: new Date(NOW.getTime() + 30 * 60 * 1000).toISOString() };
    expect(trialDaysLeft(state, NOW)).toBe(1);
    expect(trialBadgeText(state, NOW)).toBe('Pro trial — 1 day left');
  });

  it('pluralizes for more than one day', () => {
    const state: LicenseState = { tier: 'pro', status: 'trial', trialEndsAt: new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString() };
    expect(trialBadgeText(state, NOW)).toBe('Pro trial — 3 days left');
  });

  it('is null once the trial has ended', () => {
    const state: LicenseState = { tier: 'pro', status: 'trial', trialEndsAt: new Date(NOW.getTime() - 1000).toISOString() };
    expect(trialDaysLeft(state, NOW)).toBeNull();
  });
});

describe('trialNudge', () => {
  function trialState(daysLeft: number): LicenseState {
    return { tier: 'pro', status: 'trial', trialEndsAt: new Date(NOW.getTime() + daysLeft * 24 * 60 * 60 * 1000).toISOString() };
  }

  it('is null outside a trial', () => {
    expect(trialNudge({ tier: 'free', status: 'none' }, NOW)).toBeNull();
  });

  it('is null before day 3', () => {
    expect(trialNudge(trialState(13), NOW)).toBeNull();
  });

  it('fires day3 between elapsed days 3-10', () => {
    expect(trialNudge(trialState(11), NOW)).toEqual({ milestone: 'day3', text: 'Enjoying Pro? Start your subscription to keep it.' });
  });

  it('fires day11 from elapsed day 11 on', () => {
    expect(trialNudge(trialState(3), NOW)).toEqual({ milestone: 'day11', text: 'Enjoying Pro? Start your subscription to keep it.' });
  });
});

describe('isInRefreshWindow', () => {
  it('is false for a non-subscription license', () => {
    expect(isInRefreshWindow({ tier: 'pro', status: 'valid', kind: 'lifetime' }, NOW)).toBe(false);
  });

  it('is true while already in grace', () => {
    expect(isInRefreshWindow({ tier: 'pro', status: 'grace', kind: 'subscription' }, NOW)).toBe(true);
  });

  it('is false for a subscription that is neither valid nor in grace', () => {
    expect(isInRefreshWindow({ tier: 'pro', status: 'invalid', kind: 'subscription' }, NOW)).toBe(false);
  });

  it('is true when a valid subscription expires within the grace window', () => {
    const state: LicenseState = { tier: 'pro', status: 'valid', kind: 'subscription', expiresAt: new Date(NOW.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString() };
    expect(isInRefreshWindow(state, NOW)).toBe(true);
  });

  it('is false when a valid subscription expires well outside the window', () => {
    const state: LicenseState = { tier: 'pro', status: 'valid', kind: 'subscription', expiresAt: new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString() };
    expect(isInRefreshWindow(state, NOW)).toBe(false);
  });

  it('is false for an unparseable expiresAt', () => {
    const state: LicenseState = { tier: 'pro', status: 'valid', kind: 'subscription', expiresAt: 'not-a-date' };
    expect(isInRefreshWindow(state, NOW)).toBe(false);
  });
});

describe('trialDismissed / dismissTrial', () => {
  it('round-trips a dismissal', () => {
    const storage = fakeStorage();
    expect(trialDismissed(storage, 'day3')).toBe(false);
    dismissTrial(storage, 'day3');
    expect(trialDismissed(storage, 'day3')).toBe(true);
  });

  it('swallows a throwing storage (private mode)', () => {
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(trialDismissed(throwing, 'day3')).toBe(false);
    expect(() => dismissTrial(throwing, 'day3')).not.toThrow();
  });
});

describe('trialBannerView', () => {
  it('surfaces the nudge message/milestone while trialing', () => {
    const state: LicenseState = { tier: 'pro', status: 'trial', trialEndsAt: new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString() };
    expect(trialBannerView(state, NOW)).toEqual({ message: 'Enjoying Pro? Start your subscription to keep it.', dismissId: 'day11' });
  });

  it('is empty while trialing with no nudge due', () => {
    const state: LicenseState = { tier: 'pro', status: 'trial', trialEndsAt: new Date(NOW.getTime() + 13 * 24 * 60 * 60 * 1000).toISOString() };
    expect(trialBannerView(state, NOW)).toEqual({ message: null, dismissId: null });
  });

  it('shows the fixed expired message once the trial ends', () => {
    const view = trialBannerView({ tier: 'free', status: 'trial-expired' }, NOW);
    expect(view.dismissId).toBe('expired');
    expect(view.message).toContain('14-day Pro trial has ended');
  });

  it('is empty outside a trial/trial-expired state', () => {
    expect(trialBannerView({ tier: 'pro', status: 'valid' }, NOW)).toEqual({ message: null, dismissId: null });
    expect(trialBannerView(null, NOW)).toEqual({ message: null, dismissId: null });
  });
});

describe('LicenseBadgeButton', () => {
  it('shows the free label with no pro/grace/trial classes', () => {
    const html = renderToString(createElement(LicenseBadgeButton, { badge: badge(null), trialText: null, onOpen: () => {} }));
    expect(html).toContain('>FREE<');
    expect(html).toMatch(/id="license-badge" title="License — click to manage" class=""/);
  });

  it('shows the trial countdown text over the badge label', () => {
    const html = renderToString(createElement(LicenseBadgeButton, {
      badge: badge({ tier: 'pro', status: 'trial' }), trialText: 'Pro trial — 3 days left', onOpen: () => {},
    }));
    expect(html).toContain('Pro trial — 3 days left');
    expect(html).toContain('class="pro trial"');
  });
});

describe('LicenseBanner', () => {
  it('renders hidden with an empty message class when not shown', () => {
    const html = renderToString(createElement(LicenseBanner, { shown: false, text: null, onManage: () => {}, onDismiss: () => {} }));
    expect(html).toMatch(/id="license-banner" role="status" class=""/);
  });

  it('renders the grace text and "show" class when shown', () => {
    const html = renderToString(createElement(LicenseBanner, { shown: true, text: 'Your license has expired…', onManage: () => {}, onDismiss: () => {} }));
    expect(html).toMatch(/id="license-banner" role="status" class="show"/);
    expect(html).toContain('Your license has expired…');
  });
});

describe('TrialBanner', () => {
  it('renders hidden with no message', () => {
    const html = renderToString(createElement(TrialBanner, {
      shown: false, view: { message: null, dismissId: null }, onStart: () => {}, onDismiss: () => {},
    }));
    expect(html).toMatch(/id="trial-banner" role="status" class=""/);
  });

  it('renders the nudge text and dismiss-id when shown', () => {
    const html = renderToString(createElement(TrialBanner, {
      shown: true, view: { message: 'Enjoying Pro?', dismissId: 'day3' }, onStart: () => {}, onDismiss: () => {},
    }));
    expect(html).toMatch(/id="trial-banner" role="status" class="show" data-dismiss-id="day3"/);
    expect(html).toContain('Enjoying Pro?');
  });
});
