import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// AI carve-out (#661/#864): #661 deleted the AI insights pass from the CLI
// (src/insights.ts + src/insights.test.ts and the prompts/system-analyst.ts
// system prompt), but never added the carve-out gate every other layer got
// (#657 renderer, #658/#659 electron, #660 audio-engine). #864 closes that
// gap: every .ts under packages/cli/src must stay free of the removed AI
// flag/symbol names, the deleted insights modules must stay absent, and
// packages/cli/package.json must declare no @earendil-scoped dependency. The
// banned tokens are built by string concatenation — never spelled out
// literally anywhere in this file, including in prose — so this gate never
// trips its own greps.

const cliSrc = path.dirname(fileURLToPath(import.meta.url));
const GATE_FILE_NAME = path.basename(fileURLToPath(import.meta.url));

function collectAllTsFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectAllTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && entry.name !== GATE_FILE_NAME) {
      found.push(full);
    }
  }
  return found;
}

const TOKENS = [
  '--no-' + 'ai',
  'no' + 'Ai',
  'insights',
  'generate' + 'Insights',
  'Analyst' + 'Input',
  'Narrative' + 'Port',
  'Pi' + 'NarrativeAdapter',
  'ANALYST_' + 'SYSTEM_PROMPT',
  'earen' + 'dil',
];

const REMOVED_FILES = ['src/insights.ts', 'src/insights.test.ts'];

describe('AI carve-out gate (#661)', () => {
  const scannedFiles = collectAllTsFiles(cliSrc);

  it.each(scannedFiles.map((f) => [path.relative(cliSrc, f), f] as const))(
    '%s contains no removed AI flag/symbol token',
    (_relative, file) => {
      const text = fs.readFileSync(file, 'utf8');
      for (const token of TOKENS) {
        expect(text).not.toContain(token);
      }
    },
  );

  it.each(REMOVED_FILES)('%s no longer exists', (relativePath) => {
    expect(fs.existsSync(path.join(cliSrc, '..', relativePath))).toBe(false);
  });

  it('package.json declares no removed-SDK-scope dependency', () => {
    const pkg = JSON.parse(
      fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { dependencies: Record<string, string> };
    const hasEarendil = Object.keys(pkg.dependencies).some((name) =>
      name.includes('earen' + 'dil'),
    );
    expect(hasEarendil).toBe(false);
  });
});
