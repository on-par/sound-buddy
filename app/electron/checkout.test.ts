import { describe, it, expect } from 'vitest';
import { checkoutUrl } from './checkout';

// The plan → checkout-URL mapping (#58, #1164). Real Stripe Payment Links are
// provisioned per-environment via SOUND_BUDDY_CHECKOUT_*_URL (see
// worker/docs/live-provisioning.md §8) — there is no baked-in default, so
// every test injects its own URL fixture. Since #56 the builder also
// pre-fills the customer email (`prefilled_email`) when one is known — the
// re-upgrade funnel relies on it.

const URLS = {
  SOUND_BUDDY_CHECKOUT_MONTHLY_URL: 'https://test.example/monthly',
  SOUND_BUDDY_CHECKOUT_ANNUAL_URL: 'https://test.example/annual',
  SOUND_BUDDY_CHECKOUT_FOUNDING_URL: 'https://test.example/founding',
};

describe('checkoutUrl', () => {
  it('maps each of the three known plans to its own configured URL', () => {
    const monthly = checkoutUrl('monthly', undefined, URLS);
    const annual = checkoutUrl('annual', undefined, URLS);
    const founding = checkoutUrl('founding', undefined, URLS);
    expect(monthly).toBe(URLS.SOUND_BUDDY_CHECKOUT_MONTHLY_URL);
    expect(annual).toBe(URLS.SOUND_BUDDY_CHECKOUT_ANNUAL_URL);
    expect(founding).toBe(URLS.SOUND_BUDDY_CHECKOUT_FOUNDING_URL);
    expect(new Set([monthly, annual, founding]).size).toBe(3);
  });

  it('normalizes an unknown/undefined plan to monthly', () => {
    const monthly = checkoutUrl('monthly', undefined, URLS);
    expect(checkoutUrl(undefined, undefined, URLS)).toBe(monthly);
    expect(checkoutUrl('bogus', undefined, URLS)).toBe(monthly);
  });

  it('throws an actionable error naming the missing env var when config is absent', () => {
    expect(() => checkoutUrl('monthly', undefined, {})).toThrow(
      /SOUND_BUDDY_CHECKOUT_MONTHLY_URL/,
    );
    expect(() => checkoutUrl('monthly', undefined, {})).toThrow(/live-provisioning\.md/);
    expect(() => checkoutUrl('annual', undefined, {})).toThrow(/SOUND_BUDDY_CHECKOUT_ANNUAL_URL/);
    expect(() => checkoutUrl('annual', undefined, {})).toThrow(/live-provisioning\.md/);
    expect(() => checkoutUrl('founding', undefined, {})).toThrow(
      /SOUND_BUDDY_CHECKOUT_FOUNDING_URL/,
    );
    expect(() => checkoutUrl('founding', undefined, {})).toThrow(/live-provisioning\.md/);
  });

  it('treats a blank/whitespace-only env value as missing', () => {
    expect(() =>
      checkoutUrl('annual', undefined, { SOUND_BUDDY_CHECKOUT_ANNUAL_URL: '   ' }),
    ).toThrow(/SOUND_BUDDY_CHECKOUT_ANNUAL_URL/);
  });

  it('appends prefilled_email when a non-blank email is given', () => {
    expect(checkoutUrl('monthly', 'lapsed@test.local', URLS)).toBe(
      'https://test.example/monthly?prefilled_email=lapsed%40test.local',
    );
    expect(checkoutUrl('annual', 'pro@test.local', URLS)).toBe(
      'https://test.example/annual?prefilled_email=pro%40test.local',
    );
    expect(checkoutUrl('founding', 'founder@test.local', URLS)).toBe(
      'https://test.example/founding?prefilled_email=founder%40test.local',
    );
  });

  it('URL-encodes special characters in the email', () => {
    expect(checkoutUrl('monthly', 'dev+user@example.com', URLS)).toContain(
      'prefilled_email=dev%2Buser%40example.com',
    );
  });

  it('returns the base URL unchanged when the email is undefined', () => {
    expect(checkoutUrl('monthly', undefined, URLS)).toBe(URLS.SOUND_BUDDY_CHECKOUT_MONTHLY_URL);
  });

  it('returns the base URL unchanged for a blank/whitespace-only email', () => {
    expect(checkoutUrl('monthly', '', URLS)).toBe(URLS.SOUND_BUDDY_CHECKOUT_MONTHLY_URL);
    expect(checkoutUrl('monthly', '   ', URLS)).toBe(URLS.SOUND_BUDDY_CHECKOUT_MONTHLY_URL);
  });

  it('appends prefilled_email with & when the base already has a query', () => {
    const env = {
      SOUND_BUDDY_CHECKOUT_MONTHLY_URL: 'https://test.example/monthly?promo=launch',
    };
    expect(checkoutUrl('monthly', 'lapsed@test.local', env)).toBe(
      'https://test.example/monthly?promo=launch&prefilled_email=lapsed%40test.local',
    );
  });

  it('applies pre-fill on top of the configured URL for every plan', () => {
    const env = { SOUND_BUDDY_CHECKOUT_ANNUAL_URL: 'https://test.example/annual' };
    expect(checkoutUrl('annual', 'pro@test.local', env)).toBe(
      'https://test.example/annual?prefilled_email=pro%40test.local',
    );
  });
});
