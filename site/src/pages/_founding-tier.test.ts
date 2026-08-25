import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_FOUNDING_URL, foundingCheckoutUrl } from '../lib/founding-urgency';

const indexSrc = readFileSync(fileURLToPath(new URL('./index.astro', import.meta.url)), 'utf8');

const foundingBlockStart = indexSrc.indexOf("name: 'Founding Lifetime'");
if (foundingBlockStart === -1) {
  throw new Error('Founding Lifetime tier not found in index.astro');
}
const foundingBlock = indexSrc.slice(foundingBlockStart, indexSrc.indexOf('},', foundingBlockStart));

describe('Founding tier renders (#1168 AC1)', () => {
  it('renders the Founding Lifetime tier', () => {
    expect(indexSrc).toContain("name: 'Founding Lifetime'");
  });

  it('prices the Founding tier at $199', () => {
    expect(foundingBlock).toContain("price: '$199'");
  });

  it('carries limited-run 300-cap copy', () => {
    expect(indexSrc).toContain('300');
    expect(indexSrc).toContain('Limited founding run');
  });

  it('carries the static founding-cap copy', () => {
    expect(indexSrc).toContain('founding licenses');
    expect(indexSrc).toContain('then Founding closes');
  });
});

describe('Founding tier links to checkout (#1168 AC2)', () => {
  it('binds the CTA to the resolved founding checkout URL', () => {
    expect(foundingBlock).toContain('ctaHref: FOUNDING_URL');
  });

  it('derives FOUNDING_URL from foundingCheckoutUrl(process.env)', () => {
    expect(indexSrc).toContain('const FOUNDING_URL = foundingCheckoutUrl(process.env)');
  });

  it('targets the founding Payment Link placeholder when unconfigured', () => {
    expect(foundingCheckoutUrl({})).toBe(PLACEHOLDER_FOUNDING_URL);
  });

  it('targets the configured founding Payment Link when overridden', () => {
    expect(
      foundingCheckoutUrl({ PUBLIC_FOUNDING_CHECKOUT_URL: 'https://buy.stripe.com/live-founding' }),
    ).toBe('https://buy.stripe.com/live-founding');
  });
});
