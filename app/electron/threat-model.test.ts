import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Guards the council-mandated Tier 1/Tier 2 threat model doc (#379): Tier 2
// (console-network) work — including the #371 OSC spike — must not start
// before this doc exists with a complete, frozen feature classification.
// This keeps that classification from silently rotting as features move.
// Skips repo-level checks when app/ is checked out without the surrounding
// monorepo (e.g. an app-only source export), matching licensing.test.ts.
const appRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const repoRoot = path.resolve(appRoot, '..');
const hasMonorepo = fs.existsSync(path.join(repoRoot, 'packages'));

const DOC_PATH = path.join(repoRoot, 'docs', 'security', 'tier-1-tier-2-threat-model.md');

const REQUIRED_SECTIONS = [
  '## Tier definitions',
  '## Existing network surfaces (outside the tier model)',
  '## Feature classification',
  '## Tier 1 data flow',
  '## Tier 2 data flow',
  '## Tier 2 attack surface',
  '## Mitigations',
  '## Review & sign-off',
];

const FEATURE_COUNT = 22;
const TIER_2_FEATURES = [3, 10, 13, 14];

// Feature classification table columns: `| # | Feature | Group | Tier | v1 status | Notes |`.
// cells[0] is '' (leading pipe) after split('|'), so data columns start at index 1.
const FEATURE_NUMBER_COLUMN = 1;
const TIER_COLUMN = 4;

/** Parses `| # | ... |` data rows out of the Feature classification table into trimmed cell arrays. */
function parseFeatureRows(doc: string): string[][] {
  return doc
    .split('\n')
    .filter((line) => /^\|\s*\d+\s*\|/.test(line))
    .map((line) => line.split('|').map((cell) => cell.trim()));
}

describe.runIf(hasMonorepo)('Tier 1/Tier 2 threat model doc (#379)', () => {
  it('exists', () => {
    expect(fs.existsSync(DOC_PATH)).toBe(true);
  });

  const doc = hasMonorepo && fs.existsSync(DOC_PATH) ? fs.readFileSync(DOC_PATH, 'utf8') : '';

  it.each(REQUIRED_SECTIONS)('contains the required section heading %s', (heading) => {
    expect(doc).toContain(heading);
  });

  it('classifies exactly 22 features, numbered 1-22 with no gaps or duplicates', () => {
    const numbers = parseFeatureRows(doc).map((cells) => Number(cells[FEATURE_NUMBER_COLUMN]));
    expect(numbers).toHaveLength(FEATURE_COUNT);
    expect([...numbers].sort((a, b) => a - b)).toEqual(
      Array.from({ length: FEATURE_COUNT }, (_, i) => i + 1)
    );
  });

  it('every classified feature has a Tier cell of exactly "Tier 1" or "Tier 2"', () => {
    const rows = parseFeatureRows(doc);
    expect(rows.length).toBeGreaterThan(0);
    for (const cells of rows) {
      const tier = cells[TIER_COLUMN];
      expect(
        ['Tier 1', 'Tier 2'],
        `row "${cells.join('|')}" has an invalid Tier cell: "${tier}"`
      ).toContain(tier);
    }
  });

  it('matches the frozen council Tier 2 set exactly: features {3, 10, 13, 14}', () => {
    const tier2 = parseFeatureRows(doc)
      .filter((cells) => cells[TIER_COLUMN] === 'Tier 2')
      .map((cells) => Number(cells[FEATURE_NUMBER_COLUMN]));
    expect(tier2.sort((a, b) => a - b)).toEqual(TIER_2_FEATURES);
  });

  it('mentions the #378 consent modal and enforces read-only OSC in the Mitigations section', () => {
    const mitigationsStart = doc.indexOf('## Mitigations');
    expect(mitigationsStart).toBeGreaterThan(-1);
    const signoffStart = doc.indexOf('## Review & sign-off');
    const mitigations = doc.slice(mitigationsStart, signoffStart > -1 ? signoffStart : undefined);
    expect(mitigations).toContain('#378');
    expect(mitigations).toMatch(/read-only/i);
  });
});
