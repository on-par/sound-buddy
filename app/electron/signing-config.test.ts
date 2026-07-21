import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Guards the notarization wiring (#53): hardened runtime + entitlements are
// required for `xcrun notarytool` to accept the build. If electron-builder.yml
// or the entitlements plist drift, notarization fails silently at release
// time — this catches it in CI instead.
const appRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const builderConfig = fs.readFileSync(path.join(appRoot, 'electron-builder.yml'), 'utf8');
const entitlementsPath = path.join(appRoot, 'build', 'entitlements.mac.plist');

const ENTITLEMENT_KEYS = [
  'com.apple.security.cs.allow-jit',
  'com.apple.security.cs.allow-unsigned-executable-memory',
  'com.apple.security.cs.disable-library-validation',
  'com.apple.security.device.audio-input',
];

describe('electron-builder.yml notarization wiring', () => {
  it('enables hardened runtime and disables gatekeeper assessment', () => {
    expect(builderConfig).toMatch(/^\s*hardenedRuntime:\s*true\s*$/m);
    expect(builderConfig).toMatch(/^\s*gatekeeperAssess:\s*false\s*$/m);
  });

  it('points entitlements and entitlementsInherit at build/entitlements.mac.plist', () => {
    expect(builderConfig).toMatch(/^\s*entitlements:\s*build\/entitlements\.mac\.plist\s*$/m);
    expect(builderConfig).toMatch(/^\s*entitlementsInherit:\s*build\/entitlements\.mac\.plist\s*$/m);
  });

  it('still declares NSMicrophoneUsageDescription alongside the entitlement', () => {
    expect(builderConfig).toContain('NSMicrophoneUsageDescription');
  });
});

// Parses the `signIgnore:` list out of the raw YAML with a regex instead of
// pulling in a YAML parser dependency just for this drift guard (#620).
function parseSignIgnorePatterns(config: string): string[] {
  const lines = config.split('\n');
  const startIndex = lines.findIndex((line) => /^\s*signIgnore:\s*$/.test(line));
  if (startIndex === -1) return [];

  const patterns: string[] = [];
  for (const line of lines.slice(startIndex + 1)) {
    const match = line.match(/^\s+- "(.+)"$/);
    if (!match) break;
    patterns.push(match[1]);
  }
  return patterns;
}

describe('electron-builder.yml signIgnore (#620)', () => {
  const patterns = parseSignIgnorePatterns(builderConfig);
  const regexes = patterns.map((pattern) => new RegExp(pattern));

  it('parses a non-empty signIgnore list', () => {
    expect(patterns.length).toBeGreaterThan(0);
  });

  it('ignores the python runtime tree that afterPack already signed', () => {
    const pycPath =
      '/Applications/Sound Buddy.app/Contents/Resources/python/lib/python3.12/ctypes/macholib/__pycache__/dylib.cpython-312.pyc';
    const pyPath = '/Applications/Sound Buddy.app/Contents/Resources/python/lib/python3.12/ctypes/macholib/dylib.py';
    const txtPath = '/Applications/Sound Buddy.app/Contents/Resources/python/lib/python3.12/some-file.txt';
    const scriptsPath = '/Applications/Sound Buddy.app/Contents/Resources/scripts/analyze.py';

    for (const path of [pycPath, pyPath, txtPath, scriptsPath]) {
      expect(regexes.some((re) => re.test(path)), `expected a signIgnore pattern to match ${path}`).toBe(true);
    }
  });

  it.each(['python', 'bin', 'lib'])('ignores a file directly under afterPack-owned dir %s', (dir) => {
    const filePath = `/Applications/Sound Buddy.app/Contents/Resources/${dir}/some-file`;
    expect(regexes.some((re) => re.test(filePath))).toBe(true);
  });

  it('never ignores the app, its helpers, or the Electron frameworks', () => {
    const protectedPaths = [
      'Contents/MacOS/Sound Buddy',
      'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
      'Contents/Frameworks/Sound Buddy Helper.app/Contents/MacOS/Sound Buddy Helper',
      'Contents/Resources/app.asar',
    ];
    for (const path of protectedPaths) {
      expect(regexes.some((re) => re.test(path)), `expected no signIgnore pattern to match ${path}`).toBe(false);
    }
  });

  it('keeps signIgnore inside the mac block', () => {
    const macIndex = builderConfig.indexOf('\nmac:');
    const signIgnoreIndex = builderConfig.indexOf('\n  signIgnore:');
    expect(macIndex).toBeGreaterThan(-1);
    expect(signIgnoreIndex).toBeGreaterThan(macIndex);
  });
});

describe('build/entitlements.mac.plist', () => {
  it('exists', () => {
    expect(fs.existsSync(entitlementsPath)).toBe(true);
  });

  it.each(ENTITLEMENT_KEYS)('declares %s as true', (key) => {
    const plist = fs.readFileSync(entitlementsPath, 'utf8');
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`<key>${escapedKey}</key>\\s*(?:<!--.*?-->\\s*)?<true\\s*/>`, 's');
    expect(plist, `${key} should be followed by <true/>`).toMatch(pattern);
  });
});
