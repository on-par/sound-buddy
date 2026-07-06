import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Guards the dual-license structure (#55): the Electron app is proprietary,
// the workspace packages stay MIT. If a LICENSE file or package.json license
// field drifts, this fails before anything ships under the wrong terms.
const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const read = (...parts: string[]) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');
const readPkg = (...parts: string[]) => JSON.parse(read(...parts, 'package.json'));

const MIT_PACKAGES = ['shared', 'scene-inspector', 'audio-engine', 'ai-analyst', 'cli'];

describe('dual-license structure', () => {
  it('root LICENSE explains the split and points at both license trees', () => {
    const text = read('LICENSE');
    expect(text).toContain('app/LICENSE');
    expect(text).toContain('MIT License');
  });

  it('app/ carries the proprietary license, not MIT', () => {
    const text = read('app', 'LICENSE');
    expect(text).toContain('Sound Buddy Desktop Application License');
    expect(text).toMatch(/redistribute/i);
    expect(text).toMatch(/License Key/);
    expect(text).not.toContain('Permission is hereby granted, free of charge');
    expect(readPkg('app').license).toBe('SEE LICENSE IN LICENSE');
  });

  it.each(MIT_PACKAGES)('packages/%s is MIT in both LICENSE and package.json', (name) => {
    const text = read('packages', name, 'LICENSE');
    expect(text).toContain('MIT License');
    expect(text).toContain('Permission is hereby granted, free of charge');
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
