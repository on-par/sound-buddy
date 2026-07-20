// Smoke-check the built pricing section: Founding Lifetime must be the visually
// dominant, first-listed tier through the July launch window (#290), the #196
// download-before-purchase CTA hierarchy must hold, the #260 MxU constraint
// must never regress, and the Founding urgency block / hero version string
// must satisfy the #560 invariants.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { checkFoundingUrgencyInvariants, checkHeroVersionInvariant } from './lib/pricing-invariants.mjs';

const indexPath = fileURLToPath(new URL('../dist/index.html', import.meta.url));
const html = await readFile(indexPath, 'utf8');

const problems = [];

const foundingIdx = html.indexOf('Founding Lifetime');
const proMonthlyIdx = html.indexOf('Pro Monthly');
if (foundingIdx === -1) {
  problems.push('Founding Lifetime tier not found in built HTML.');
} else if (proMonthlyIdx === -1) {
  problems.push('Pro Monthly tier not found in built HTML.');
} else if (!(foundingIdx < proMonthlyIdx)) {
  problems.push(
    'Founding Lifetime must render before Pro Monthly in document order (dominant tier leads on mobile stack too).',
  );
}

const tierCardRe = /<div class="tier card[^"]*"/g;
const tierCards = html.match(tierCardRe) ?? [];
const foundingCard = tierCards.find((c) => c.includes('founding'));
if (!foundingCard) {
  problems.push('No tier card carries the "founding" dominance class.');
}
const featuredCard = tierCards.find((c) => c.includes('featured'));
if (featuredCard) {
  problems.push(
    'A tier card still carries the "featured" class — Pro Monthly must no longer compete with Founding for dominance.',
  );
}

if (!/expense/i.test(html) || !/no recurring vendor approval/i.test(html)) {
  problems.push(
    'Church-expense copy missing — must convey "one-time purchase — easy to expense, no recurring vendor approval."',
  );
}

if (!html.includes('300')) {
  problems.push('300-cap framing missing from the built HTML.');
}

const downloadCtaIdx = html.indexOf('href="/download"');
const pricingSectionIdx = html.indexOf('id="pricing"');
if (downloadCtaIdx === -1) {
  problems.push('Download CTA URL not found in built HTML.');
} else if (pricingSectionIdx === -1) {
  problems.push('#pricing section not found in built HTML.');
} else if (!(downloadCtaIdx < pricingSectionIdx)) {
  problems.push(
    'The first download CTA must precede #pricing in document order (#196 first-win hierarchy).',
  );
}

if (html.includes('MxU')) {
  problems.push('Built HTML contains "MxU" — the #260 measurement-price comparison is banned.');
}

problems.push(...checkFoundingUrgencyInvariants(html), ...checkHeroVersionInvariant(html));

// #559 — the money-back guarantee must be visible inside the pricing block,
// not just in the footer, and must link to the policy it quotes.
const guaranteeIdx = html.indexOf('money-back guarantee');
const tiersIdx = html.indexOf('class="tiers"');
if (guaranteeIdx === -1) {
  problems.push('Money-back guarantee copy not found in built HTML (#559).');
} else if (pricingSectionIdx === -1 || !(guaranteeIdx > pricingSectionIdx)) {
  problems.push('Money-back guarantee must render inside the #pricing section (#559).');
} else if (tiersIdx !== -1 && !(guaranteeIdx < tiersIdx)) {
  problems.push('Money-back guarantee must render above the tier grid, next to the price (#559).');
}
if (!/class="guarantee"[^>]*href="\/refund"|href="\/refund"[^>]*class="guarantee"/.test(html)) {
  problems.push('Guarantee badge must link to /refund (#559).');
}
if (/14[-\s]day money-back/i.test(html)) {
  problems.push('Guarantee window must be 30 days, matching /refund — "14-day money-back" found (#559).');
}

if (problems.length) {
  console.error(`✖ ${problems.length} pricing invariant(s) broken:`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}

console.log('✓ Founding Lifetime is dominant, first-listed, and hierarchy/constraint invariants hold.');
