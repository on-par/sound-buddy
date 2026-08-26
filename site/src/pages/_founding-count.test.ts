import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const indexSrc = readFileSync(fileURLToPath(new URL('./index.astro', import.meta.url)), 'utf8');

describe('Founding live sold-count display (#1170)', () => {
  it('renders the hidden live-count element in the pricing section', () => {
    expect(indexSrc).toContain('data-founding-remaining');
  });

  it('imports the founding-count lib', () => {
    expect(indexSrc).toContain("from '../lib/founding-count'");
  });

  it('fetches the founding-count endpoint via FOUNDING_COUNT_ENDPOINT', () => {
    expect(indexSrc).toContain('FOUNDING_COUNT_ENDPOINT');
    expect(indexSrc).toContain('fetch(FOUNDING_COUNT_ENDPOINT)');
  });

  it('validates the fetched body and formats it before revealing the element', () => {
    expect(indexSrc).toContain('parseFoundingCount(body)');
    expect(indexSrc).toContain('foundingRemainingLabel(count)');
  });
});
