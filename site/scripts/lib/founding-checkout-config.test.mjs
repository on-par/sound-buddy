import { describe, expect, it } from 'vitest';
import { checkFoundingCheckoutConfig, FOUNDING_CHECKOUT_ENV_VAR } from './founding-checkout-config.mjs';
import { PLACEHOLDER_FOUNDING_URL } from './live-parity.mjs';

describe('checkFoundingCheckoutConfig', () => {
  it('passes in waitlist mode (unset) regardless of the URL', () => {
    expect(checkFoundingCheckoutConfig({})).toEqual([]);
  });

  it('passes in waitlist mode (explicit "waitlist") regardless of the URL', () => {
    expect(checkFoundingCheckoutConfig({ PUBLIC_SITE_MODE: 'waitlist' })).toEqual([]);
  });

  it('passes for an unrecognized mode value (same fail-safe rule as resolveSiteMode)', () => {
    expect(checkFoundingCheckoutConfig({ PUBLIC_SITE_MODE: '  garbage ' })).toEqual([]);
  });

  it('flags a missing PUBLIC_FOUNDING_CHECKOUT_URL in live mode', () => {
    const problems = checkFoundingCheckoutConfig({ PUBLIC_SITE_MODE: 'live' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(FOUNDING_CHECKOUT_ENV_VAR);
    expect(problems[0]).toContain('worker/docs/live-provisioning.md §8');
  });

  it('flags an empty-string PUBLIC_FOUNDING_CHECKOUT_URL in live mode', () => {
    const problems = checkFoundingCheckoutConfig({ PUBLIC_SITE_MODE: 'live', PUBLIC_FOUNDING_CHECKOUT_URL: '' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(FOUNDING_CHECKOUT_ENV_VAR);
  });

  it('flags a whitespace-only PUBLIC_FOUNDING_CHECKOUT_URL in live mode', () => {
    const problems = checkFoundingCheckoutConfig({ PUBLIC_SITE_MODE: 'live', PUBLIC_FOUNDING_CHECKOUT_URL: '   ' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(FOUNDING_CHECKOUT_ENV_VAR);
  });

  it('flags the placeholder URL in live mode', () => {
    const problems = checkFoundingCheckoutConfig({
      PUBLIC_SITE_MODE: 'live',
      PUBLIC_FOUNDING_CHECKOUT_URL: PLACEHOLDER_FOUNDING_URL,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].toLowerCase()).toContain('placeholder');
  });

  it('flags an http (non-https) Payment Link', () => {
    const value = 'http://buy.stripe.com/abc';
    const problems = checkFoundingCheckoutConfig({ PUBLIC_SITE_MODE: 'live', PUBLIC_FOUNDING_CHECKOUT_URL: value });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(value);
  });

  it('flags a non-Stripe host', () => {
    const value = 'https://example.com/pay';
    const problems = checkFoundingCheckoutConfig({ PUBLIC_SITE_MODE: 'live', PUBLIC_FOUNDING_CHECKOUT_URL: value });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(value);
  });

  it('flags a URL carrying credentials', () => {
    const value = 'https://user:pw@buy.stripe.com/abc';
    const problems = checkFoundingCheckoutConfig({ PUBLIC_SITE_MODE: 'live', PUBLIC_FOUNDING_CHECKOUT_URL: value });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(value);
  });

  it('flags an unparseable URL', () => {
    const value = 'not a url';
    const problems = checkFoundingCheckoutConfig({ PUBLIC_SITE_MODE: 'live', PUBLIC_FOUNDING_CHECKOUT_URL: value });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(value);
  });

  it('passes for a trimmed real https buy.stripe.com link', () => {
    const problems = checkFoundingCheckoutConfig({
      PUBLIC_SITE_MODE: 'live',
      PUBLIC_FOUNDING_CHECKOUT_URL: ' https://buy.stripe.com/abc123 ',
    });
    expect(problems).toEqual([]);
  });

  it('passes for a test-mode buy.stripe.com link (AC1 + CI need test links to pass)', () => {
    const problems = checkFoundingCheckoutConfig({
      PUBLIC_SITE_MODE: 'live',
      PUBLIC_FOUNDING_CHECKOUT_URL: 'https://buy.stripe.com/test_abc',
    });
    expect(problems).toEqual([]);
  });

  it('treats padded mode (" live ") as live', () => {
    const problems = checkFoundingCheckoutConfig({ PUBLIC_SITE_MODE: ' live ' });
    expect(problems).toHaveLength(1);
  });
});
