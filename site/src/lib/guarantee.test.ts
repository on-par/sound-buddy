import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GUARANTEE_BADGE, GUARANTEE_SENTENCE, GUARANTEE_WINDOW_DAYS, REFUND_PATH } from './guarantee';

const indexAstroPath = fileURLToPath(new URL('../pages/index.astro', import.meta.url));
const refundAstroPath = fileURLToPath(new URL('../pages/refund.astro', import.meta.url));

describe('GUARANTEE_BADGE / GUARANTEE_SENTENCE', () => {
  it('both derive from GUARANTEE_WINDOW_DAYS, so they cannot drift from it', () => {
    expect(GUARANTEE_BADGE).toContain(`${GUARANTEE_WINDOW_DAYS}-day`);
    expect(GUARANTEE_SENTENCE).toContain(`${GUARANTEE_WINDOW_DAYS}-day`);
  });

  it('the badge promises "no questions asked" with an em dash', () => {
    expect(GUARANTEE_BADGE).toContain('no questions asked');
    expect(GUARANTEE_BADGE).toContain('—');
  });

  it('the sentence form ends with a period', () => {
    expect(GUARANTEE_SENTENCE.endsWith('.')).toBe(true);
  });
});

describe('copy-drift guard', () => {
  it('index.astro has no hardcoded refund-window literal — it must go through the constant', () => {
    const source = readFileSync(indexAstroPath, 'utf8');
    expect(source).not.toMatch(/\d+-day money-back/);
    expect(source).toContain("from '../lib/guarantee'");
  });

  it('refund.astro has no hardcoded refund-window literal — it must go through the constant', () => {
    const source = readFileSync(refundAstroPath, 'utf8');
    expect(source).not.toMatch(/\d+-day money-back/);
    expect(source).toContain("from '../lib/guarantee'");
  });
});

describe('REFUND_PATH', () => {
  it('is /refund', () => {
    expect(REFUND_PATH).toBe('/refund');
  });

  it('points at a page that actually exists on disk, so the badge never links to a 404', () => {
    expect(existsSync(refundAstroPath)).toBe(true);
  });
});
