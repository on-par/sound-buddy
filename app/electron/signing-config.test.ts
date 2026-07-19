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

describe('build/entitlements.mac.plist', () => {
  it('exists', () => {
    expect(fs.existsSync(entitlementsPath)).toBe(true);
  });

  it.each(ENTITLEMENT_KEYS)('declares %s as true', (key) => {
    const plist = fs.readFileSync(entitlementsPath, 'utf8');
    const escapedKey = key.replace(/\./g, '\\.');
    const pattern = new RegExp(`<key>${escapedKey}</key>\\s*(?:<!--.*?-->\\s*)?<true\\s*/>`, 's');
    expect(plist, `${key} should be followed by <true/>`).toMatch(pattern);
  });
});
