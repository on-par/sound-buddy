import { describe, it, expect } from 'vitest';
import { checkoutUrl } from './checkout';

// The plan → checkout-URL mapping (#58). Real Stripe Payment Links arrive with
// #56; until then these are placeholders, but the resolution logic (env
// override, safe fallback) is stable and worth locking down. Since #56 the
// builder also pre-fills the customer email (`prefilled_email`) when one is
// known — the re-upgrade funnel relies on it.

describe('checkoutUrl', () => {
  it('maps the two known plans to distinct default links', () => {
    const monthly = checkoutUrl('monthly', undefined, {});
    const annual = checkoutUrl('annual', undefined, {});
    expect(monthly).toMatch(/^https:\/\//);
    expect(annual).toMatch(/^https:\/\//);
    expect(monthly).not.toBe(annual);
  });

  it('falls back to the monthly link for unknown/missing plans (never dead-ends)', () => {
    const monthly = checkoutUrl('monthly', undefined, {});
    expect(checkoutUrl(undefined, undefined, {})).toBe(monthly);
    expect(checkoutUrl('bogus', undefined, {})).toBe(monthly);
  });

  it('honours per-environment URL overrides', () => {
    const env = {
      SOUND_BUDDY_CHECKOUT_MONTHLY_URL: 'https://staging.example/monthly',
      SOUND_BUDDY_CHECKOUT_ANNUAL_URL: 'https://staging.example/annual',
    };
    expect(checkoutUrl('monthly', undefined, env)).toBe('https://staging.example/monthly');
    expect(checkoutUrl('annual', undefined, env)).toBe('https://staging.example/annual');
  });

  it('ignores a blank override and keeps the default', () => {
    const monthlyDefault = checkoutUrl('monthly', undefined, {});
    expect(
      checkoutUrl('monthly', undefined, { SOUND_BUDDY_CHECKOUT_MONTHLY_URL: '   ' }),
    ).toBe(monthlyDefault);
  });

  it('appends prefilled_email when a non-blank email is given', () => {
    expect(checkoutUrl('monthly', 'lapsed@test.local', {})).toBe(
      'https://buy.stripe.com/sound-buddy-pro-monthly?prefilled_email=lapsed%40test.local',
    );
    expect(checkoutUrl('annual', 'pro@test.local', {})).toBe(
      'https://buy.stripe.com/sound-buddy-pro-annual?prefilled_email=pro%40test.local',
    );
  });

  it('URL-encodes special characters in the email', () => {
    expect(checkoutUrl('monthly', 'dev+user@example.com', {})).toContain(
      'prefilled_email=dev%2Buser%40example.com',
    );
  });

  it('returns the base URL unchanged when the email is undefined', () => {
    expect(checkoutUrl('monthly', undefined, {})).toBe(
      'https://buy.stripe.com/sound-buddy-pro-monthly',
    );
  });

  it('returns the base URL unchanged for a blank/whitespace-only email', () => {
    expect(checkoutUrl('monthly', '', {})).toBe('https://buy.stripe.com/sound-buddy-pro-monthly');
    expect(checkoutUrl('monthly', '   ', {})).toBe(
      'https://buy.stripe.com/sound-buddy-pro-monthly',
    );
  });

  it('appends prefilled_email with & when the base already has a query', () => {
    const env = {
      SOUND_BUDDY_CHECKOUT_MONTHLY_URL: 'https://staging.example/monthly?promo=launch',
    };
    expect(checkoutUrl('monthly', 'lapsed@test.local', env)).toBe(
      'https://staging.example/monthly?promo=launch&prefilled_email=lapsed%40test.local',
    );
  });

  it('applies pre-fill on top of the env-override URL', () => {
    const env = {
      SOUND_BUDDY_CHECKOUT_ANNUAL_URL: 'https://staging.example/annual',
    };
    expect(checkoutUrl('annual', 'pro@test.local', env)).toBe(
      'https://staging.example/annual?prefilled_email=pro%40test.local',
    );
  });
});
