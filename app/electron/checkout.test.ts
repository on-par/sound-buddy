import { describe, it, expect } from 'vitest';
import { checkoutUrl } from './checkout';

// The plan → checkout-URL mapping (#58). Real Stripe Payment Links arrive with
// #56; until then these are placeholders, but the resolution logic (env
// override, safe fallback) is stable and worth locking down.

describe('checkoutUrl', () => {
  it('maps the two known plans to distinct default links', () => {
    const monthly = checkoutUrl('monthly', {});
    const annual = checkoutUrl('annual', {});
    expect(monthly).toMatch(/^https:\/\//);
    expect(annual).toMatch(/^https:\/\//);
    expect(monthly).not.toBe(annual);
  });

  it('falls back to the monthly link for unknown/missing plans (never dead-ends)', () => {
    const monthly = checkoutUrl('monthly', {});
    expect(checkoutUrl(undefined, {})).toBe(monthly);
    expect(checkoutUrl('bogus', {})).toBe(monthly);
  });

  it('honours per-environment URL overrides', () => {
    const env = {
      SOUND_BUDDY_CHECKOUT_MONTHLY_URL: 'https://staging.example/monthly',
      SOUND_BUDDY_CHECKOUT_ANNUAL_URL: 'https://staging.example/annual',
    };
    expect(checkoutUrl('monthly', env)).toBe('https://staging.example/monthly');
    expect(checkoutUrl('annual', env)).toBe('https://staging.example/annual');
  });

  it('ignores a blank override and keeps the default', () => {
    const monthlyDefault = checkoutUrl('monthly', {});
    expect(checkoutUrl('monthly', { SOUND_BUDDY_CHECKOUT_MONTHLY_URL: '   ' })).toBe(monthlyDefault);
  });
});
