import { describe, expect, it } from 'vitest';
import { checkFoundingUrgencyInvariants, checkHeroVersionInvariant } from './pricing-invariants.mjs';

const countdownPresentHtml = `
  <div id="pricing">
    <div class="founding-countdown" data-drop-deadline="2026-07-24T17:00:00.000Z">
      <p class="fc-copy">Founding pricing locks with the demo video drop — <strong data-fc-remaining>4d 21h 3m left</strong> to claim one of 300.</p>
    </div>
  </div>
`;

const countdownAbsentHtml = `
  <div id="pricing">
    <div class="founding-cap">
      <p class="fc-copy">Limited to 300 founding licenses — one-time $199, then Founding closes.</p>
    </div>
  </div>
`;

describe('checkFoundingUrgencyInvariants', () => {
  it('no problems for a countdown-present fixture', () => {
    expect(checkFoundingUrgencyInvariants(countdownPresentHtml)).toEqual([]);
  });

  it('no problems for a countdown-absent fixture that still says 300', () => {
    expect(checkFoundingUrgencyInvariants(countdownAbsentHtml)).toEqual([]);
  });

  it('flags a countdown-absent fixture that leaks data-fc-remaining', () => {
    const html = `
      <div id="pricing">
        <div class="founding-cap">
          <p class="fc-copy">Limited to 300 founding licenses.</p>
          <span data-fc-remaining>4d 21h 3m left</span>
        </div>
      </div>
    `;
    const problems = checkFoundingUrgencyInvariants(html);
    expect(problems.length).toBeGreaterThan(0);
  });

  it('flags a countdown-absent fixture with no 300', () => {
    const html = `<div id="pricing"><div class="founding-cap"><p class="fc-copy">Founding licenses limited.</p></div></div>`;
    const problems = checkFoundingUrgencyInvariants(html);
    expect(problems.length).toBeGreaterThan(0);
  });

  it('flags an invalid data-drop-deadline', () => {
    const html = countdownPresentHtml.replace('2026-07-24T17:00:00.000Z', 'not-a-date');
    const problems = checkFoundingUrgencyInvariants(html);
    expect(problems.some((p) => p.includes('data-drop-deadline'))).toBe(true);
  });

  it('flags a countdown rendered before id="pricing"', () => {
    const html = `
      <div class="founding-countdown" data-drop-deadline="2026-07-24T17:00:00.000Z">
        <p class="fc-copy">Founding pricing locks with the demo video drop — <strong data-fc-remaining>4d 21h 3m left</strong> to claim one of 300.</p>
      </div>
      <div id="pricing"></div>
    `;
    const problems = checkFoundingUrgencyInvariants(html);
    expect(problems.some((p) => /#pricing/.test(p))).toBe(true);
  });

  it('flags any fixture containing the retired unbacked "now live" claim', () => {
    const html = `${countdownAbsentHtml}<p>now live — final licenses going fast</p>`;
    const problems = checkFoundingUrgencyInvariants(html);
    expect(problems.some((p) => /now live/i.test(p))).toBe(true);
  });
});

describe('checkHeroVersionInvariant', () => {
  it('no problems when the hero spec line carries no version', () => {
    const html = '<p class="hero-fine mono">Apple Silicon · macOS 26+</p>';
    expect(checkHeroVersionInvariant(html)).toEqual([]);
  });

  it('one problem when the hero spec line carries a version', () => {
    const html = '<p class="hero-fine mono">Apple Silicon · macOS 26+ · v0.8.3</p>';
    const problems = checkHeroVersionInvariant(html);
    expect(problems).toHaveLength(1);
  });

  it('no problems when a different element elsewhere mentions a version', () => {
    const html = '<p class="hero-fine mono">Apple Silicon · macOS 26+</p><p class="footer-meta">v0.8.3</p>';
    expect(checkHeroVersionInvariant(html)).toEqual([]);
  });
});
