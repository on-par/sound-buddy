// Smoke-check the built pricing section: Founding Lifetime must be the visually
// dominant, first-listed tier through the July launch window (#290), the #196
// download-before-purchase CTA hierarchy must hold, and the #260 MxU constraint
// must never regress.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

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

const downloadCtaIdx = html.indexOf(
  'https://github.com/on-par/sound-buddy-releases/releases/latest',
);
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

// #377 — Founding urgency must be synced to a machine-readable drop date.
const deadlineMatch = html.match(/data-drop-deadline="([^"]+)"/);
if (!deadlineMatch) {
  problems.push('Founding countdown missing — no data-drop-deadline anchor in built HTML (#377).');
} else if (Number.isNaN(new Date(deadlineMatch[1]).getTime())) {
  problems.push(`data-drop-deadline is not a valid date: "${deadlineMatch[1]}" (#377).`);
}
if (!/data-fc-remaining/.test(html)) {
  problems.push('Founding countdown missing its live-remaining (data-fc-remaining) node (#377).');
}
if (!/demo video/i.test(html)) {
  problems.push('Countdown copy must reference the demo video drop (#377).');
}
const countdownIdx = html.indexOf('founding-countdown');
if (countdownIdx === -1 || !(pricingSectionIdx !== -1 && countdownIdx > pricingSectionIdx)) {
  problems.push('Founding countdown must render inside the #pricing section (#377).');
}

if (problems.length) {
  console.error(`✖ ${problems.length} pricing invariant(s) broken:`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}

console.log('✓ Founding Lifetime is dominant, first-listed, and hierarchy/constraint invariants hold.');
