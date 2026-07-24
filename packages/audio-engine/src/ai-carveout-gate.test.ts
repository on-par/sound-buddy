import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// AI carve-out 4/5 (#660): deletes the narrative port/adapter
// (src/narrative/port.ts, src/narrative/pi-adapter.ts) and the dead
// engineer.ts / LLM-deep-dive call chain (src/engineer.ts, and the
// stream/index.ts "LLM Deep-Dive" trigger it powered), then drops both
// runtime SDK dependencies whose scope name is built by concatenation below.
// The banned tokens are built by string concatenation — never spelled out
// literally anywhere in this file, including in prose — so this gate never
// trips its own greps.

const audioEngineSrc = path.dirname(fileURLToPath(import.meta.url));
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

const TOKENS = ['earen' + 'dil', 'Pi' + 'NarrativeAdapter', 'Narrative' + 'Port'];

const REMOVED_FILES = [
  'src/narrative/pi-adapter.ts',
  'src/narrative/pi-adapter.test.ts',
  'src/narrative/port.ts',
  'src/engineer.ts',
  'src/engineer.test.ts',
];

describe('AI carve-out gate (#660)', () => {
  const scannedFiles = collectAllTsFiles(audioEngineSrc);

  it.each(scannedFiles.map((f) => [path.relative(audioEngineSrc, f), f] as const))(
    '%s contains no removed narrative-port/engineer token',
    (_relative, file) => {
      const text = fs.readFileSync(file, 'utf8');
      for (const token of TOKENS) {
        expect(text).not.toContain(token);
      }
    },
  );

  it.each(REMOVED_FILES)('%s no longer exists', (relativePath) => {
    expect(fs.existsSync(path.join(audioEngineSrc, '..', relativePath))).toBe(false);
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
