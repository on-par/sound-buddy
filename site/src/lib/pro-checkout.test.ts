import { describe, expect, it } from 'vitest';
import { monthlyCheckoutUrl, annualCheckoutUrl, PLACEHOLDER_PRO_MONTHLY_URL, PLACEHOLDER_PRO_ANNUAL_URL } from './pro-checkout';
describe('Pro checkout URLs', () => {
  it('falls back for missing or blank values', () => {
    expect(monthlyCheckoutUrl({})).toBe(PLACEHOLDER_PRO_MONTHLY_URL);
    expect(annualCheckoutUrl({ PUBLIC_PRO_ANNUAL_CHECKOUT_URL: ' ' })).toBe(PLACEHOLDER_PRO_ANNUAL_URL);
  });
  it('uses trimmed configured links', () => {
    expect(monthlyCheckoutUrl({ PUBLIC_PRO_MONTHLY_CHECKOUT_URL: ' https://buy.stripe.com/test_monthly ' })).toBe('https://buy.stripe.com/test_monthly');
    expect(annualCheckoutUrl({ PUBLIC_PRO_ANNUAL_CHECKOUT_URL: ' https://buy.stripe.com/test_annual ' })).toBe('https://buy.stripe.com/test_annual');
  });
});
