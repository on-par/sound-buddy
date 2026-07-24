import { describe, expect, it } from 'vitest';
import {
  WAITLIST_LEAK_MARKERS,
  PLACEHOLDER_FOUNDING_URL,
  compareLiveHomeToGolden,
  checkLiveHomeLeakMarkers,
  checkLiveHomeStructure,
} from './live-parity.mjs';

describe('compareLiveHomeToGolden', () => {
  it('returns no problems when the built HTML matches the golden byte-for-byte', () => {
    const html = '<html><body>same</body></html>';
    expect(compareLiveHomeToGolden(html, html)).toEqual([]);
  });

  it('flags a difference with the first-diff index and an excerpt of both strings', () => {
    const golden = '<div>aaaaaaaaaa BEFORE bbbbbbbbbb</div>';
    const built = '<div>aaaaaaaaaa AFTER  bbbbbbbbbb</div>';
    const diffIdx = [...golden].findIndex((ch, i) => ch !== built[i]);
    const problems = compareLiveHomeToGolden(built, golden);

    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.includes(String(diffIdx)))).toBe(true);
    expect(problems.some((p) => p.includes('AFTER'))).toBe(true);
    expect(problems.some((p) => p.includes('BEFORE'))).toBe(true);
  });

  it('does not suggest regenerating the golden as the default fix', () => {
    const problems = compareLiveHomeToGolden('<div>built</div>', '<div>golden</div>');
    expect(problems.some((p) => /undo/i.test(p))).toBe(true);
    expect(problems.every((p) => !/^regenerate the golden/i.test(p.trim()))).toBe(true);
  });

  it('reports a length difference when the built HTML is longer than the golden', () => {
    const problems = compareLiveHomeToGolden('<div>built-longer</div>', '<div>g</div>');
    expect(problems.some((p) => /length/i.test(p))).toBe(true);
  });

  it('flags the empty-vs-nonempty case', () => {
    const problems = compareLiveHomeToGolden('', '<div>golden</div>');
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.includes('0'))).toBe(true);
  });

  it('ignores a footer copyright year that differs across a calendar-year rollover', () => {
    const golden = '<p class="footer-meta mono">© 2026 <a href="https://onpardev.com" rel="noopener">On PAR Dev</a> · Built for worship teams</p>';
    const built = '<p class="footer-meta mono">© 2027 <a href="https://onpardev.com" rel="noopener">On PAR Dev</a> · Built for worship teams</p>';
    expect(compareLiveHomeToGolden(built, golden)).toEqual([]);
  });

  it('still flags a real content difference elsewhere even when the footer year also differs', () => {
    const golden = '<p class="footer-meta mono">© 2026 <a href="https://onpardev.com" rel="noopener">On PAR Dev</a> · Built for worship teams</p><h1>Old copy</h1>';
    const built = '<p class="footer-meta mono">© 2027 <a href="https://onpardev.com" rel="noopener">On PAR Dev</a> · Built for worship teams</p><h1>New copy</h1>';
    const problems = compareLiveHomeToGolden(built, golden);
    expect(problems.length).toBeGreaterThan(0);
  });
});

describe('checkLiveHomeLeakMarkers', () => {
  const cleanLiveHtml = `
    <html><body>
      <span class="eyebrow">For church FOH volunteers &amp; worship engineers</span>
      <h1>Get a clear answer from last Sunday's mix.</h1>
      <section id="pricing"><h3>Founding Lifetime</h3></section>
      <footer class="site-footer"></footer>
    </body></html>
  `;

  it('returns no problems for clean live-like HTML', () => {
    expect(checkLiveHomeLeakMarkers(cleanLiveHtml)).toEqual([]);
  });

  it.each(WAITLIST_LEAK_MARKERS)('flags the leak marker "%s" when present', (marker) => {
    const html = `${cleanLiveHtml}${marker}`;
    const problems = checkLiveHomeLeakMarkers(html);
    expect(problems.some((p) => p.includes(marker))).toBe(true);
  });

  it('flags each of several markers present at once, one problem per marker', () => {
    const html = `${cleanLiveHtml}<div data-waitlist-form data-waitlist-status>Join the waitlist</div>`;
    const problems = checkLiveHomeLeakMarkers(html);
    expect(problems.some((p) => p.includes('data-waitlist-form'))).toBe(true);
    expect(problems.some((p) => p.includes('data-waitlist-status'))).toBe(true);
    expect(problems.some((p) => p.includes('Join the waitlist'))).toBe(true);
  });
});

describe('checkLiveHomeStructure', () => {
  const completeHtml = `
    <html><body>
      <span class="eyebrow">For church FOH volunteers &amp; worship engineers</span>
      <section id="how"></section>
      <section id="proof"></section>
      <section id="faq"></section>
      <section id="pricing">
        <div class="tier"><h3>Founding Lifetime</h3><a href="${PLACEHOLDER_FOUNDING_URL}">Become a Founding Member</a></div>
        <div class="tier"><h3>Pro Monthly</h3></div>
        <div class="tier"><h3>Pro Annual</h3></div>
        <div class="tier"><h3>Free</h3></div>
      </section>
      <footer class="site-footer"></footer>
    </body></html>
  `;

  it('returns no problems when every required element is present', () => {
    expect(checkLiveHomeStructure(completeHtml)).toEqual([]);
  });

  it('flags a missing #how section anchor', () => {
    const html = completeHtml.replace('<section id="how"></section>', '');
    expect(checkLiveHomeStructure(html).some((p) => p.includes('id="how"'))).toBe(true);
  });

  it('flags a missing #proof section anchor', () => {
    const html = completeHtml.replace('<section id="proof"></section>', '');
    expect(checkLiveHomeStructure(html).some((p) => p.includes('id="proof"'))).toBe(true);
  });

  it('flags a missing #faq section anchor', () => {
    const html = completeHtml.replace('<section id="faq"></section>', '');
    expect(checkLiveHomeStructure(html).some((p) => p.includes('id="faq"'))).toBe(true);
  });

  it('flags a missing #pricing section anchor', () => {
    const html = completeHtml.replace('id="pricing"', 'id="prices"');
    expect(checkLiveHomeStructure(html).some((p) => p.includes('id="pricing"'))).toBe(true);
  });

  it('flags a missing Founding Lifetime tier name', () => {
    const html = completeHtml.replace('Founding Lifetime', 'Founding');
    expect(checkLiveHomeStructure(html).some((p) => p.includes('Founding Lifetime'))).toBe(true);
  });

  it('flags a missing Pro Monthly tier name', () => {
    const html = completeHtml.replace('Pro Monthly', 'Pro');
    expect(checkLiveHomeStructure(html).some((p) => p.includes('Pro Monthly'))).toBe(true);
  });

  it('flags a missing Pro Annual tier name', () => {
    const html = completeHtml.replace('Pro Annual', 'Annual');
    expect(checkLiveHomeStructure(html).some((p) => p.includes('Pro Annual'))).toBe(true);
  });

  it('flags a missing Free tier name', () => {
    const html = completeHtml.replace('>Free<', '>Complimentary<');
    expect(checkLiveHomeStructure(html).some((p) => p.includes('Free'))).toBe(true);
  });

  it('flags a missing placeholder Founding checkout href', () => {
    const html = completeHtml.replace(PLACEHOLDER_FOUNDING_URL, 'https://example.com/other-checkout');
    expect(checkLiveHomeStructure(html).some((p) => p.includes(PLACEHOLDER_FOUNDING_URL))).toBe(true);
  });

  it('flags a missing <footer> element', () => {
    const html = completeHtml.replace('<footer class="site-footer"></footer>', '');
    expect(checkLiveHomeStructure(html).some((p) => /footer/i.test(p))).toBe(true);
  });

  it('flags a missing hero eyebrow', () => {
    const html = completeHtml.replace('For church FOH volunteers &amp; worship engineers', 'For churches');
    expect(checkLiveHomeStructure(html).some((p) => p.includes('For church FOH volunteers &amp; worship engineers'))).toBe(true);
  });
});
