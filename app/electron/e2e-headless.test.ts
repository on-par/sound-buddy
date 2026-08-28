import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  HEADLESS_SWITCHES,
  headlessLaunchOptions,
  isHeaded,
} from '../tests/launch-electron';

const appRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const repoRoot = path.resolve(appRoot, '..');

function findTypeScriptFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findTypeScriptFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : [];
  });
}

describe('e2e headless launch helper (#1249)', () => {
  it('leaves the caller options untouched when headed', () => {
    const opts = { args: ['dist/electron/main.js'] };

    expect(headlessLaunchOptions(opts, true)).toBe(opts);
  });

  it('appends anti-throttling switches and injects the headless flag by default', () => {
    const options = headlessLaunchOptions({ args: ['dist/electron/main.js'], env: {} }, false);

    expect(options.args).toEqual(['dist/electron/main.js', ...HEADLESS_SWITCHES]);
    expect(options.env?.SB_E2E_HEADLESS).toBe('1');
  });

  it('uses the switches when the caller supplies no args or environment', () => {
    const options = headlessLaunchOptions({}, false);

    expect(options.args).toEqual(HEADLESS_SWITCHES);
    expect(options.env?.SB_E2E_HEADLESS).toBe('1');
  });

  it('preserves restricted caller environments and packaged executable paths', () => {
    const options = headlessLaunchOptions(
      {
        args: ['--test'],
        env: { PATH: '/usr/bin', HOME: '/tmp/h' },
        executablePath: '/tmp/Sound Buddy.app/Contents/MacOS/Sound Buddy',
      },
      false,
    );

    expect(options.env).toEqual({ PATH: '/usr/bin', HOME: '/tmp/h', SB_E2E_HEADLESS: '1' });
    expect(options.executablePath).toBe('/tmp/Sound Buddy.app/Contents/MacOS/Sound Buddy');
  });

  it('recognizes only SB_E2E_HEADED=1 as headed', () => {
    expect(isHeaded({ SB_E2E_HEADED: '1' })).toBe(true);
    expect(isHeaded({})).toBe(false);
    expect(isHeaded({ SB_E2E_HEADED: '0' })).toBe(false);
  });
});

describe('e2e headless repository guards (#1249)', () => {
  it('requires every e2e spec to use the shared Electron launch helper', () => {
    const testsRoot = path.join(appRoot, 'tests');
    const rendererRoot = path.join(appRoot, 'renderer', 'src');
    const files = [
      ...findTypeScriptFiles(testsRoot).filter((file) => file !== path.join(testsRoot, 'launch-electron.ts')),
      ...findTypeScriptFiles(rendererRoot).filter((file) => file.endsWith('.e2e.spec.ts')),
    ];

    expect(files).not.toEqual([]);
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      expect(text, `${path.relative(appRoot, file)} bypasses launchElectron`).not.toContain('electron.launch(');
      expect(text, `${path.relative(appRoot, file)} imports _electron directly`).not.toContain('_electron');
    }
  });

  it('keeps e2e npm scripts free of headed, UI, and debug flags', () => {
    const scripts = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).scripts;
    for (const name of ['test:e2e', 'test:e2e:stubbed']) {
      expect(scripts[name], `${name} contains a prohibited interactive flag`).not.toMatch(
        /--headed|--ui|--debug/,
      );
    }
  });

  it('documents the SB_E2E_HEADED debugging escape hatch', () => {
    expect(fs.readFileSync(path.join(repoRoot, 'TESTS.md'), 'utf8')).toContain('SB_E2E_HEADED');
  });
});
