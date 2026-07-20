// Guard the built homepage's visual hierarchy (#314): exactly one report-card
// mockup, real app screenshots above the fold, Browser Lite surfaced before
// the documentation sections, and buyer messaging (proof, pricing) ordered
// ahead of install instructions.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { checkRequirementsAtCtas } from './lib/requirements-cta.mjs';

const indexPath = fileURLToPath(new URL('../dist/index.html', import.meta.url));
const html = await readFile(indexPath, 'utf8');

const problems = [];
const reportCardCount = (html.match(/aria-label="Sample report card"/g) ?? []).length;

if (reportCardCount !== 1) {
  problems.push(`Expected exactly one sample report card, found ${reportCardCount}.`);
}

if (!html.includes('Sound Buddy live capture screen')) {
  problems.push('Hero live-capture screenshot alt text is missing.');
}

if (html.includes('Record the room, then review the single report card below.')) {
  problems.push(
    'Hero must no longer point at a single-report-card demo — the redesigned hero shows a collage of Live Capture, Browser Lite, and the report card (#314).',
  );
}

const proofIdx = html.indexOf('id="proof"');
const howIdx = html.indexOf('id="how"');
const pricingIdx = html.indexOf('id="pricing"');
const sysreqIdx = html.indexOf('System requirements');

if (proofIdx === -1) {
  problems.push('Expected an #proof "real app proof" section.');
}
if (howIdx === -1) {
  problems.push('Expected an #how section.');
}
if (pricingIdx === -1) {
  problems.push('Expected a #pricing section.');
}

// Browser Lite must be reachable (as a link) before the #proof and #how
// sections — it's part of the above-the-fold pitch, not buried mid-page.
const browserLiteLinkRe = /<a[^>]*href="\/browser"[^>]*>[^<]*Browser Lite[^<]*<\/a>/;
const browserLiteMatch = html.match(browserLiteLinkRe);
if (!browserLiteMatch) {
  problems.push('Expected a href="/browser" link with visible text containing "Browser Lite".');
} else {
  const browserLiteIdx = browserLiteMatch.index ?? -1;
  if (proofIdx !== -1 && browserLiteIdx >= proofIdx) {
    problems.push('The Browser Lite CTA must appear before #proof (above the fold).');
  }
  if (howIdx !== -1 && browserLiteIdx >= howIdx) {
    problems.push('The Browser Lite CTA must appear before #how (above the fold).');
  }
}

if (proofIdx !== -1 && pricingIdx !== -1 && !(proofIdx < pricingIdx)) {
  problems.push('#proof must render before #pricing (buyer story before purchase).');
}

// Virtual-soundcheck / follow-up-workflow evidence must live in the proof
// section, not just be implied elsewhere on the page.
if (proofIdx !== -1 && pricingIdx !== -1) {
  const proofSection = html.slice(proofIdx, pricingIdx === -1 ? undefined : pricingIdx);
  if (!/momentum|virtual soundcheck/i.test(proofSection)) {
    problems.push('#proof section must include momentum/virtual-soundcheck evidence.');
  }
}

if (sysreqIdx === -1) {
  problems.push('Expected a "System requirements" section.');
} else if (pricingIdx !== -1 && !(sysreqIdx > pricingIdx)) {
  problems.push('"System requirements" must render after #pricing (buyer messaging before install docs).');
}

problems.push(...checkRequirementsAtCtas(html));

if (problems.length) {
  console.error(`✖ ${problems.length} homepage visual invariant(s) broken:`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}

console.log('✓ Homepage hero/proof/pricing ordering and report-card invariants hold.');
