import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { packagedCheckoutUrl, writePackagedCheckoutConfig } from './packaged-checkout';

const resources: string[] = [];
afterEach(() => resources.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));

describe('packaged checkout', () => {
  it('tells the customer how to recover when packaged configuration cannot be read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-checkout-'));
    resources.push(dir);
    expect(() => packagedCheckoutUrl(dir, 'monthly')).toThrow(/download the latest Sound Buddy/i);
  });

  it.each([
    'not-a-url',
    'http://buy.stripe.com/monthly-fixture',
    'https://example.com/monthly-fixture',
    'https://buy.stripe.com/test_monthly-fixture',
    'https://user:password@buy.stripe.com/monthly-fixture',
  ])('rejects an unsafe or test-mode release URL before writing any configuration: %s', badUrl => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-checkout-'));
    resources.push(dir);
    expect(() => writePackagedCheckoutConfig(dir, {
      SOUND_BUDDY_CHECKOUT_MONTHLY_URL: badUrl,
      SOUND_BUDDY_CHECKOUT_ANNUAL_URL: 'https://buy.stripe.com/annual-fixture',
      SOUND_BUDDY_CHECKOUT_FOUNDING_URL: 'https://buy.stripe.com/founding-fixture',
    })).toThrow(/live Stripe Payment Link/);
    expect(existsSync(join(dir, 'checkout-urls.json'))).toBe(false);
  });

  it('opens each packaged plan without customer environment variables and stores no secrets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-checkout-'));
    resources.push(dir);
    writePackagedCheckoutConfig(dir, {
      SOUND_BUDDY_CHECKOUT_MONTHLY_URL: 'https://buy.stripe.com/monthly-fixture',
      SOUND_BUDDY_CHECKOUT_ANNUAL_URL: 'https://buy.stripe.com/annual-fixture',
      SOUND_BUDDY_CHECKOUT_FOUNDING_URL: 'https://buy.stripe.com/founding-fixture',
      STRIPE_SECRET_KEY: 'secret-must-not-be-packaged',
    });

    for (const plan of ['monthly', 'annual', 'founding']) {
      expect(packagedCheckoutUrl(dir, plan)).toBe(`https://buy.stripe.com/${plan}-fixture`);
    }
    expect(packagedCheckoutUrl(dir, 'annual', 'owner@example.com')).toBe(
      'https://buy.stripe.com/annual-fixture?prefilled_email=owner%40example.com',
    );
    const saved = readFileSync(join(dir, 'checkout-urls.json'), 'utf8');
    expect(saved).not.toContain('STRIPE_SECRET_KEY');
    expect(saved).not.toContain('secret-must-not-be-packaged');
  });
});
