import { describe, expect, it } from 'vitest';
import { checkRequirementsAtCtas, REQUIREMENT_LINE, REQUIREMENT_TOOLTIP } from './requirements-cta.mjs';

function tierCard(reqLine = REQUIREMENT_LINE) {
  return `
    <div class="tier card">
      <h3>Tier</h3>
      <a class="btn btn-primary" href="/download" rel="noopener">CTA</a>
      <p class="tier-req mono">${reqLine}</p>
      <ul class="tier-features"></ul>
    </div>
  `;
}

function compliantHtml() {
  return `
    <header>
      <a class="btn btn-primary" href="/download" rel="noopener" title="${REQUIREMENT_TOOLTIP}">Grade last Sunday's mix</a>
    </header>
    <p class="hero-fine mono">${REQUIREMENT_LINE}</p>
    ${tierCard()}
    ${tierCard()}
    ${tierCard()}
    ${tierCard()}
    <a class="btn btn-ghost" href="/download" rel="noopener">Get the Mac app</a>
    <p class="req-fine mono">${REQUIREMENT_LINE}</p>
    <footer>
      <a href="/download" rel="noopener" title="${REQUIREMENT_TOOLTIP}">Download</a>
    </footer>
  `;
}

describe('checkRequirementsAtCtas', () => {
  it('no problems for a fully compliant fixture', () => {
    expect(checkRequirementsAtCtas(compliantHtml())).toEqual([]);
  });

  it('flags a missing hero fine-print', () => {
    const html = compliantHtml().replace(`<p class="hero-fine mono">${REQUIREMENT_LINE}</p>`, '');
    const problems = checkRequirementsAtCtas(html);
    expect(problems.some((p) => /Hero fine-print/.test(p))).toBe(true);
  });

  it('flags a tier count vs. tier-req count mismatch', () => {
    const html = `
      <header><a title="${REQUIREMENT_TOOLTIP}">CTA</a></header>
      <p class="hero-fine mono">${REQUIREMENT_LINE}</p>
      <div class="tier card"><a>CTA</a></div>
      <div class="tier card"><a>CTA</a><p class="tier-req mono">${REQUIREMENT_LINE}</p></div>
      <a class="btn btn-ghost" href="/download">Get the Mac app</a>
      <p class="req-fine mono">${REQUIREMENT_LINE}</p>
      <footer><a title="${REQUIREMENT_TOOLTIP}">Download</a></footer>
    `;
    const problems = checkRequirementsAtCtas(html);
    expect(problems.some((p) => /tiers but 1 tier-req/.test(p))).toBe(true);
  });

  it('flags drifted tier-req text', () => {
    const html = compliantHtml().replace(
      `<p class="tier-req mono">${REQUIREMENT_LINE}</p>`,
      '<p class="tier-req mono">Apple Silicon · macOS 15+</p>',
    );
    const problems = checkRequirementsAtCtas(html);
    expect(problems.some((p) => /requirement text drifted/.test(p))).toBe(true);
  });

  it('flags a missing req-fine on the browser-compare download CTA', () => {
    const html = compliantHtml().replace(`<p class="req-fine mono">${REQUIREMENT_LINE}</p>`, '');
    const problems = checkRequirementsAtCtas(html);
    expect(problems.some((p) => /req-fine/.test(p))).toBe(true);
  });

  it('flags a missing header tooltip', () => {
    const html = compliantHtml().replace(` title="${REQUIREMENT_TOOLTIP}"`, '');
    const problems = checkRequirementsAtCtas(html);
    expect(problems.some((p) => /Header download button/.test(p))).toBe(true);
  });

  it('flags a missing footer tooltip', () => {
    const html = compliantHtml().replace(
      `<a href="/download" rel="noopener" title="${REQUIREMENT_TOOLTIP}">Download</a>`,
      '<a href="/download" rel="noopener">Download</a>',
    );
    const problems = checkRequirementsAtCtas(html);
    expect(problems.some((p) => /Footer download link/.test(p))).toBe(true);
  });

  it('flags an outdated macOS floor anywhere on the page', () => {
    const html = `${compliantHtml()}<p>Requires macOS 15+ or newer</p>`;
    const problems = checkRequirementsAtCtas(html);
    expect(problems.some((p) => /outdated macOS floor/.test(p))).toBe(true);
  });

  it('derives REQUIREMENT_TOOLTIP from REQUIREMENT_LINE', () => {
    expect(REQUIREMENT_TOOLTIP).toBe(`Requires ${REQUIREMENT_LINE}`);
  });

  it('no problems when Astro scoped-style data-astro-cid attributes are present on the tagged elements', () => {
    // Astro injects a data-astro-cid-* attribute onto elements styled by a
    // component's scoped <style> block, so the real built HTML never matches
    // a bare `<p class="...">` literal — the checker must tolerate it.
    const html = `
      <header>
        <a title="${REQUIREMENT_TOOLTIP}" data-astro-cid-abc123>CTA</a>
      </header>
      <p class="hero-fine mono" data-astro-cid-abc123>${REQUIREMENT_LINE}</p>
      ${tierCard()
        .replace('class="tier card"', 'class="tier card" data-astro-cid-abc123')
        .replace('class="tier-req mono"', 'class="tier-req mono" data-astro-cid-abc123')}
      ${tierCard()
        .replace('class="tier card"', 'class="tier card" data-astro-cid-abc123')
        .replace('class="tier-req mono"', 'class="tier-req mono" data-astro-cid-abc123')}
      ${tierCard()
        .replace('class="tier card"', 'class="tier card" data-astro-cid-abc123')
        .replace('class="tier-req mono"', 'class="tier-req mono" data-astro-cid-abc123')}
      ${tierCard()
        .replace('class="tier card"', 'class="tier card" data-astro-cid-abc123')
        .replace('class="tier-req mono"', 'class="tier-req mono" data-astro-cid-abc123')}
      <a class="btn btn-ghost" href="/download" rel="noopener">Get the Mac app</a>
      <p class="req-fine mono" data-astro-cid-abc123>${REQUIREMENT_LINE}</p>
      <footer>
        <a title="${REQUIREMENT_TOOLTIP}" data-astro-cid-abc123>Download</a>
      </footer>
    `;
    expect(checkRequirementsAtCtas(html)).toEqual([]);
  });
});
