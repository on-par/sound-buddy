import { describe, expect, it } from 'vitest';
import {
  LEGAL_PAGE_PATHS,
  collectAnchorHrefs,
  checkWaitlistHomeInvariants,
  checkLiveHomeInvariants,
  checkLegalPageInvariants,
} from './site-mode-invariants.mjs';

describe('collectAnchorHrefs', () => {
  it('extracts multiple hrefs from anchor tags', () => {
    const html = `<a href="/terms">Terms</a><a class="x" href="/privacy">Privacy</a>`;
    expect(collectAnchorHrefs(html)).toEqual(['/terms', '/privacy']);
  });

  it('returns an empty array for HTML with no anchors', () => {
    expect(collectAnchorHrefs('<div>no links here</div>')).toEqual([]);
  });
});

describe('checkWaitlistHomeInvariants', () => {
  const okHtml = `
    <nav>
      <a href="/terms">Terms</a>
      <a href="/privacy">Privacy</a>
      <a href="mailto:support@soundbuddy.online">Support</a>
    </nav>
  `;

  it('passes on a fixture with /terms + /privacy and no download/pricing', () => {
    expect(checkWaitlistHomeInvariants(okHtml)).toEqual([]);
  });

  it('flags an href="/download"', () => {
    const html = `${okHtml}<a href="/download">Download</a>`;
    const problems = checkWaitlistHomeInvariants(html);
    expect(problems.some((p) => p.includes('/download'))).toBe(true);
  });

  it('flags an href="/download/mac" (prefix case)', () => {
    const html = `${okHtml}<a href="/download/mac">Download for Mac</a>`;
    const problems = checkWaitlistHomeInvariants(html);
    expect(problems.some((p) => p.includes('/download/mac'))).toBe(true);
  });

  it('flags an href="#pricing"', () => {
    const html = `${okHtml}<a href="#pricing">Pricing</a>`;
    const problems = checkWaitlistHomeInvariants(html);
    expect(problems.some((p) => p.includes('#pricing'))).toBe(true);
  });

  it('flags an href="/#pricing"', () => {
    const html = `${okHtml}<a href="/#pricing">Pricing</a>`;
    const problems = checkWaitlistHomeInvariants(html);
    expect(problems.some((p) => p.includes('/#pricing'))).toBe(true);
  });

  it('flags a missing /terms link', () => {
    const html = `<a href="/privacy">Privacy</a>`;
    const problems = checkWaitlistHomeInvariants(html);
    expect(problems.some((p) => p.includes('/terms'))).toBe(true);
  });

  it('flags a missing /privacy link', () => {
    const html = `<a href="/terms">Terms</a>`;
    const problems = checkWaitlistHomeInvariants(html);
    expect(problems.some((p) => p.includes('/privacy'))).toBe(true);
  });
});

describe('checkLiveHomeInvariants', () => {
  const okHtml = `
    <nav>
      <a href="/download">Download</a>
      <a href="#pricing">Pricing</a>
      <a href="/terms">Terms</a>
      <a href="/privacy">Privacy</a>
    </nav>
  `;

  it('passes on a fixture containing all four required hrefs', () => {
    expect(checkLiveHomeInvariants(okHtml)).toEqual([]);
  });

  it('flags a missing /download href', () => {
    const html = `<a href="#pricing">Pricing</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a>`;
    const problems = checkLiveHomeInvariants(html);
    expect(problems.some((p) => p.includes('/download'))).toBe(true);
  });

  it('flags a missing #pricing href', () => {
    const html = `<a href="/download">Download</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a>`;
    const problems = checkLiveHomeInvariants(html);
    expect(problems.some((p) => p.includes('#pricing'))).toBe(true);
  });

  it('flags a missing /terms href', () => {
    const html = `<a href="/download">Download</a><a href="#pricing">Pricing</a><a href="/privacy">Privacy</a>`;
    const problems = checkLiveHomeInvariants(html);
    expect(problems.some((p) => p.includes('/terms'))).toBe(true);
  });

  it('flags a missing /privacy href', () => {
    const html = `<a href="/download">Download</a><a href="#pricing">Pricing</a><a href="/terms">Terms</a>`;
    const problems = checkLiveHomeInvariants(html);
    expect(problems.some((p) => p.includes('/privacy'))).toBe(true);
  });
});

describe('checkLegalPageInvariants', () => {
  const okHtml = `
    <nav>
      <a href="/terms">Terms of Service</a>
      <a href="/privacy">Privacy Policy</a>
      <a href="/refund">Refund Policy</a>
    </nav>
  `;

  it('passes on a fixture linking all three legal paths', () => {
    expect(checkLegalPageInvariants(okHtml, '/terms')).toEqual([]);
  });

  it('flags a missing legal path, naming the pathname it is missing from', () => {
    const html = `<a href="/terms">Terms of Service</a><a href="/privacy">Privacy Policy</a>`;
    const problems = checkLegalPageInvariants(html, '/privacy');
    expect(problems.some((p) => p.includes('/refund') && p.includes('/privacy'))).toBe(true);
  });

  it('flags a /download href', () => {
    const html = `${okHtml}<a href="/download">Download</a>`;
    const problems = checkLegalPageInvariants(html, '/terms');
    expect(problems.some((p) => p.includes('/download'))).toBe(true);
  });

  it('flags a #pricing href', () => {
    const html = `${okHtml}<a href="#pricing">Pricing</a>`;
    const problems = checkLegalPageInvariants(html, '/terms');
    expect(problems.some((p) => p.includes('#pricing'))).toBe(true);
  });
});

describe('LEGAL_PAGE_PATHS', () => {
  it('lists the three legal pages', () => {
    expect(LEGAL_PAGE_PATHS).toEqual(['/terms', '/privacy', '/refund']);
  });
});
