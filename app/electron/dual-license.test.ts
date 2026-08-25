// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Pins #1186's two acceptance criteria as executable assertions, alongside the
// broader drift guard in licensing.test.ts. AC1 proves the proprietary header
// predicate both accepts and rejects (the existing guard only checks
// positively); AC2 proves the license split for app/, root, and every
// packages/* directory.
const appRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const repoRoot = path.resolve(appRoot, '..');

const read = (...parts: string[]) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
const readPkg = (...parts: string[]) => JSON.parse(read(...parts, 'package.json'));

const PROPRIETARY_HEADER = 'Licensed under the Sound Buddy Desktop Application License (app/LICENSE).';
const MIT_GRANT = 'Permission is hereby granted, free of charge';
const APP_LICENSE_TITLE = 'Sound Buddy Desktop Application License';
const HEADER_SCAN_BYTES = 400;

/** True if the first HEADER_SCAN_BYTES of `text` carry the proprietary header. */
function hasProprietaryHeader(text: string): boolean {
  return text.slice(0, HEADER_SCAN_BYTES).includes(PROPRIETARY_HEADER);
}

describe('#1186 AC1 — new app source requires the proprietary header', () => {
  it('accepts content that carries the proprietary header', () => {
    const fixture = [
      '// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.',
      `// ${PROPRIETARY_HEADER}`,
      '',
      "import { app } from 'electron';",
    ].join('\n');
    expect(hasProprietaryHeader(fixture)).toBe(true);
  });

  it('rejects content missing the proprietary header', () => {
    const fixture = 'const x = 1;\n';
    expect(hasProprietaryHeader(fixture)).toBe(false);
  });

  it('a real shipped app source file carries the header', () => {
    const text = fs.readFileSync(path.join(appRoot, 'electron', 'main.ts'), 'utf8');
    expect(hasProprietaryHeader(text)).toBe(true);
  });
});

describe('#1186 AC2 — app/ is proprietary, everything else is MIT', () => {
  it('app/LICENSE carries proprietary terms, not MIT', () => {
    const text = fs.readFileSync(path.join(appRoot, 'LICENSE'), 'utf8');
    expect(text).toContain(APP_LICENSE_TITLE);
    expect(text).toMatch(/redistribute/i);
    expect(text).toContain('License Key');
    expect(text).not.toContain(MIT_GRANT);
  });

  it('app/package.json points at the proprietary LICENSE', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
    expect(pkg.license).toBe('SEE LICENSE IN LICENSE');
  });

  it('root LICENSE grants MIT and root package.json is MIT', () => {
    const text = read('LICENSE');
    expect(text).toContain('MIT License');
    expect(text).toContain(MIT_GRANT);
    expect(readPkg().license).toBe('MIT');
  });

  const packagesRoot = path.join(repoRoot, 'packages');
  const realPackages = fs
    .readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(packagesRoot, name, 'package.json')));

  it.each(realPackages)('packages/%s is MIT in both LICENSE and package.json', (name) => {
    const text = read('packages', name, 'LICENSE');
    expect(text).toContain(MIT_GRANT);
    expect(readPkg('packages', name).license).toBe('MIT');
  });
});
