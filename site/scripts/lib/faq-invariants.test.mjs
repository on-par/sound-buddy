import { describe, expect, it } from 'vitest';
import { checkFaqInvariants } from './faq-invariants.mjs';

const FAQ_IDS = [
  'faq-privacy',
  'faq-unsigned-install',
  'faq-ai',
  'faq-refund',
  'faq-requirements',
  'faq-offline',
  'faq-free-tier',
  'faq-trial',
];

function faqItem(id, question, extraBody = '') {
  const body =
    extraBody ||
    `<summary><h3>${question}</h3><span class="faq-chevron" aria-hidden="true">+</span></summary><div class="faq-answer"><p>Answer.</p></div>`;
  return `<details class="faq-item card" id="${id}">${body}</details>`;
}

function goodFaqSection() {
  const items = FAQ_IDS.map((id) => {
    if (id === 'faq-unsigned-install') {
      return faqItem(
        id,
        'Unsigned?',
        '<summary><h3>The app isn\'t signed. Is it safe?</h3></summary><div class="faq-answer"><p>Gatekeeper blocks it. Click Open Anyway.</p></div>',
      );
    }
    return faqItem(id, `Question ${id}?`);
  }).join('');
  return `<section id="faq" class="section faq"><div class="container">${items}</div></section>`;
}

function buildHtml({ faqSection = goodFaqSection(), extraTail = '' } = {}) {
  return `
    <div id="pricing">Pricing block</div>
    ${faqSection}
    <div id="install-walkthrough">Walkthrough: Gatekeeper, Open Anyway</div>
    ${extraTail}
  `;
}

describe('checkFaqInvariants', () => {
  it('returns no problems for a well-formed FAQ section', () => {
    expect(checkFaqInvariants(buildHtml())).toEqual([]);
  });

  it('flags a FAQ section that renders before #pricing', () => {
    const html = `${goodFaqSection()}<div id="pricing">Pricing block</div><div id="install-walkthrough"></div>`;
    const problems = checkFaqInvariants(html);
    expect(problems.some((p) => /after #pricing/.test(p))).toBe(true);
  });

  it('flags a FAQ section that renders after #install-walkthrough', () => {
    const html = `<div id="pricing"></div><div id="install-walkthrough">Gatekeeper Open Anyway</div>${goodFaqSection()}`;
    const problems = checkFaqInvariants(html);
    expect(problems.some((p) => /before the sysreq/.test(p))).toBe(true);
  });

  it('flags a count other than 8 faq-item entries', () => {
    const shortIds = FAQ_IDS.slice(0, 7);
    const items = shortIds.map((id) => faqItem(id, `Question ${id}?`)).join('');
    const faqSection = `<section id="faq" class="section faq"><div class="container">${items}</div></section>`;
    const problems = checkFaqInvariants(buildHtml({ faqSection }));
    expect(problems.some((p) => /Expected exactly 8/.test(p))).toBe(true);
  });

  it('flags a missing expected FAQ id', () => {
    const idsWithoutTrial = FAQ_IDS.filter((id) => id !== 'faq-trial');
    const items = [...idsWithoutTrial, 'faq-bogus'].map((id) => faqItem(id, `Question ${id}?`)).join('');
    const faqSection = `<section id="faq" class="section faq"><div class="container">${items}</div></section>`;
    const problems = checkFaqInvariants(buildHtml({ faqSection }));
    expect(problems.some((p) => p.includes('faq-trial'))).toBe(true);
  });

  it('flags a summary with a bare <strong> instead of a real <h3>', () => {
    const items = FAQ_IDS.map((id) =>
      id === 'faq-privacy'
        ? faqItem(id, 'Privacy?', '<summary><strong>Is my audio private?</strong></summary><div class="faq-answer"><p>Yes.</p></div>')
        : faqItem(id, `Question ${id}?`),
    ).join('');
    const faqSection = `<section id="faq" class="section faq"><div class="container">${items}</div></section>`;
    const problems = checkFaqInvariants(buildHtml({ faqSection }));
    expect(problems.some((p) => /real <h3>/.test(p))).toBe(true);
  });

  it('flags Gatekeeper/Open Anyway copy that only appears after #install-walkthrough (buried in the footer)', () => {
    const items = FAQ_IDS.map((id) => faqItem(id, `Question ${id}?`)).join('');
    const faqSection = `<section id="faq" class="section faq"><div class="container">${items}</div></section>`;
    const html = `
      <div id="pricing"></div>
      ${faqSection}
      <div id="install-walkthrough">Walkthrough: Gatekeeper, Open Anyway</div>
    `;
    const problems = checkFaqInvariants(html);
    expect(problems.some((p) => /buried only in the footer/.test(p))).toBe(true);
  });

  it('flags a "14-day money-back" string anywhere in the built HTML', () => {
    const problems = checkFaqInvariants(buildHtml({ extraTail: '<p>14-day money-back guarantee</p>' }));
    expect(problems.some((p) => /GUARANTEE_WINDOW_DAYS/.test(p))).toBe(true);
  });

  it('flags entirely missing FAQ section', () => {
    const html = '<div id="pricing"></div><div id="install-walkthrough"></div>';
    const problems = checkFaqInvariants(html);
    expect(problems.some((p) => /FAQ section \(id="faq"\) not found/.test(p))).toBe(true);
  });
});
