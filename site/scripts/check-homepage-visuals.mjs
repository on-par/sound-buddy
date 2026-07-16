// Guard the built homepage against duplicating the report-card mockup. The
// dedicated #report-card section should be the only sample report card; the
// hero uses a different real app screenshot so the page does not repeat itself.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

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

if (!html.includes('Record the room, then review the single report card below.')) {
  problems.push('Hero caption must point users to the single report-card showcase.');
}

if (problems.length) {
  console.error(`✖ ${problems.length} homepage visual invariant(s) broken:`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}

console.log('✓ Homepage renders one report-card mockup and a distinct hero app screenshot.');
