import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Guards the dual-license structure (#55): the Electron app is proprietary,
// everything outside app/ is MIT. If a LICENSE file, package.json license
// field, or source header drifts, this fails before anything ships under the
// wrong terms. Repo-level checks are skipped when app/ is checked out without
// the surrounding monorepo (e.g. an app-only source export).
const appRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const repoRoot = path.resolve(appRoot, '..');
const hasMonorepo = fs.existsSync(path.join(repoRoot, 'packages'));

const read = (...parts: string[]) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
const readPkg = (...parts: string[]) => JSON.parse(read(...parts, 'package.json'));

const MIT_PACKAGES = ['shared', 'scene-inspector', 'audio-engine', 'ai-analyst', 'cli'];
const MIT_GRANT = 'Permission is hereby granted, free of charge';

describe('app/ proprietary license', () => {
  it('carries the proprietary license, not MIT', () => {
    const text = fs.readFileSync(path.join(appRoot, 'LICENSE'), 'utf8');
    expect(text).toContain('Sound Buddy Desktop Application License');
    expect(text).toMatch(/redistribute/i);
    expect(text).toMatch(/License Key/);
    expect(text).not.toContain(MIT_GRANT);
    expect(JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).license).toBe(
      'SEE LICENSE IN LICENSE'
    );
  });

  it('the packaged app ships the LICENSE file alongside package.json', () => {
    const builderConfig = fs.readFileSync(path.join(appRoot, 'electron-builder.yml'), 'utf8');
    expect(builderConfig).toMatch(/^\s*-\s*LICENSE\s*$/m);
  });

  it('app source files carry the proprietary header', () => {
    const header = 'Licensed under the Sound Buddy Desktop Application License (app/LICENSE).';
    const sources = ['electron', 'renderer']
      .flatMap((dir) =>
        fs
          .readdirSync(path.join(appRoot, dir))
          .filter((f) => /\.(ts|js)$/.test(f) && !/\.test\./.test(f))
          .map((f) => path.join(dir, f))
      )
      .concat(['renderer/index.html']);
    for (const file of sources) {
      const head = fs.readFileSync(path.join(appRoot, file), 'utf8').slice(0, 400);
      expect(head, `${file} is missing the proprietary license header`).toContain(header);
    }
  });
});

describe.runIf(hasMonorepo)('repo-wide dual-license structure', () => {
  it('root LICENSE explains the split: proprietary app, MIT everything else', () => {
    const text = read('LICENSE');
    expect(text).toContain('app/LICENSE');
    expect(text).toContain('MIT License');
    expect(text).toContain(MIT_GRANT);
    expect(readPkg().license).toBe('MIT');
  });

  it.each(MIT_PACKAGES)('packages/%s is MIT in both LICENSE and package.json', (name) => {
    const text = read('packages', name, 'LICENSE');
    expect(text).toContain('MIT License');
    expect(text).toContain(MIT_GRANT);
    expect(readPkg('packages', name).license).toBe('MIT');
  });

  it('README documents the dual-license split', () => {
    const readme = read('README.md');
    expect(readme).toContain('## License');
    expect(readme).toMatch(/proprietary/i);
    expect(readme).toContain('app/LICENSE');
    expect(readme).toContain('MIT');
  });
});
