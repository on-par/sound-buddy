// Smoke-check the built FAQ / objection-handling section (#558): it must
// render near pricing, cover all eight entries with real <h3> headings inside
// each disclosure, and surface the unsigned-install answer up top rather than
// only in the footer walkthrough.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { checkFaqInvariants } from './lib/faq-invariants.mjs';

const indexPath = fileURLToPath(new URL('../dist/index.html', import.meta.url));
const html = await readFile(indexPath, 'utf8');

const problems = checkFaqInvariants(html);

if (problems.length) {
  console.error(`✖ ${problems.length} FAQ invariant(s) broken:`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}

console.log('✓ FAQ section renders near pricing with all 8 entries and accessible disclosures.');
