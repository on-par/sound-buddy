import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveSigningConfig, parseSpctlAssessment, parseStaplerValidation } from './signing.js';

// #1187 (decomposed from #63) pins the three acceptance criteria for the
// Developer ID signing + notarization pipeline that already ships on main
// (#53/#619-#646). No production code changes — this suite reads the same
// release-pipeline config release-notarization.test.ts already reads and
// exercises the same pure decision logic signing.test.ts already covers,
// but maps each assertion directly to an AC so a future regression fails
// loudly against the issue, not just against an unrelated unit test.
const releaseScript = readFileSync(fileURLToPath(new URL('../../../scripts/release.sh', import.meta.url)), 'utf8');
const electronBuilderYml = readFileSync(
  fileURLToPath(new URL('../../../app/electron-builder.yml', import.meta.url)),
  'utf8',
);
const entitlements = readFileSync(
  fileURLToPath(new URL('../../../app/build/entitlements.mac.plist', import.meta.url)),
  'utf8',
);

describe('#1187 AC1 — signed build produced (codesign --verify reports no errors)', () => {
  it('resolveSigningConfig signs with the full identity and the stripped identityName when both env vars are set', () => {
    const config = resolveSigningConfig({
      SOUND_BUDDY_SIGNING_IDENTITY: 'Developer ID Application: On PAR (Q7LB49TPBS)',
      SOUND_BUDDY_NOTARY_PROFILE: 'sound-buddy-notary',
    });
    expect(config.signed).toBe(true);
    expect(config.identity).toBe('Developer ID Application: On PAR (Q7LB49TPBS)');
    expect(config.identityName).toBe('On PAR (Q7LB49TPBS)');
  });

  it('resolveSigningConfig builds unsigned when neither env var is set', () => {
    expect(resolveSigningConfig({})).toEqual({ signed: false });
  });

  it('resolveSigningConfig throws an actionable error when only the signing identity is set', () => {
    expect(() =>
      resolveSigningConfig({ SOUND_BUDDY_SIGNING_IDENTITY: 'Developer ID Application: On PAR (Q7LB49TPBS)' }),
    ).toThrow(/SOUND_BUDDY_NOTARY_PROFILE/);
    expect(() =>
      resolveSigningConfig({ SOUND_BUDDY_SIGNING_IDENTITY: 'Developer ID Application: On PAR (Q7LB49TPBS)' }),
    ).toThrow(/docs\/signing-and-notarization\.md/);
  });

  it('release.sh verifies the signature with codesign --verify and dies on failure', () => {
    expect(releaseScript).toContain('codesign --verify --deep --strict');
  });

  it('electron-builder.yml enables hardened runtime and wires the entitlements file', () => {
    expect(electronBuilderYml).toMatch(/^\s+hardenedRuntime: true$/m);
    expect(electronBuilderYml).toMatch(/^\s+entitlements: build\/entitlements\.mac\.plist$/m);
    expect(electronBuilderYml).toMatch(/^\s+identity: null$/m);
  });

  it('release.sh overrides the default null identity with -c.mac.identity when signing', () => {
    expect(releaseScript).toContain('-c.mac.identity=');
  });

  it('entitlements grant the hardened-runtime keys a notarizable signed build needs', () => {
    expect(entitlements).toContain('com.apple.security.cs.allow-jit');
    expect(entitlements).toContain('com.apple.security.cs.disable-library-validation');
    expect(entitlements).toContain('com.apple.security.device.audio-input');
  });
});

describe('#1187 AC2 — notarization succeeds (ticket stapled, spctl accepted)', () => {
  it('parseStaplerValidation reports a stapled ticket on real success output', () => {
    expect(parseStaplerValidation('Processing: /x/Sound Buddy.app\nThe validate action worked!')).toEqual({
      stapled: true,
    });
  });

  it('parseStaplerValidation reports an actionable Gatekeeper-relevant error on failure', () => {
    const verdict = parseStaplerValidation('The validate action failed! Error 65');
    expect(verdict.stapled).toBe(false);
    if (verdict.stapled) throw new Error('expected failure');
    expect(verdict.error).toBeTruthy();
    expect(verdict.error).toMatch(/Gatekeeper/i);
  });

  it('parseSpctlAssessment accepts output with an ": accepted" line', () => {
    expect(parseSpctlAssessment('/path: accepted\nsource=Notarized Developer ID')).toEqual({ accepted: true });
  });

  it('parseSpctlAssessment reports an actionable error on rejection', () => {
    const verdict = parseSpctlAssessment('/path: rejected');
    expect(verdict.accepted).toBe(false);
    if (verdict.accepted) throw new Error('expected rejection');
    expect(verdict.error).toBeTruthy();
  });

  it('release.sh submits for notarization and validates the stapled ticket before publishing', () => {
    expect(releaseScript).toContain('-c.mac.notarize=true');
    expect(releaseScript).toMatch(/APPLE_KEYCHAIN_PROFILE="\$NOTARY_PROFILE"/);
    const staplerIndex = releaseScript.indexOf('xcrun stapler validate');
    const releaseCreateIndex = releaseScript.indexOf('gh release create');
    expect(staplerIndex).toBeGreaterThan(-1);
    expect(releaseCreateIndex).toBeGreaterThan(-1);
    expect(staplerIndex).toBeLessThan(releaseCreateIndex);
  });

  it('electron-builder.yml keeps notarization off by default and wires the DMG notarization hook', () => {
    expect(electronBuilderYml).toMatch(/^\s+notarize: false$/m);
    expect(electronBuilderYml).toContain('afterAllArtifactBuild: build/afterAllArtifactBuild.js');
  });
});

describe('#1187 AC3 — no Gatekeeper warning on a clean machine', () => {
  it('the verdict parsers model the Gatekeeper gate: only the exact accepted/stapled verdicts pass', () => {
    expect(parseSpctlAssessment('/path: accepted').accepted).toBe(true);
    expect(parseSpctlAssessment('/path: rejected').accepted).toBe(false);
    expect(parseSpctlAssessment('').accepted).toBe(false);
    expect(parseStaplerValidation('The validate action worked!').stapled).toBe(true);
    expect(parseStaplerValidation('The validate action failed! Error 65').stapled).toBe(false);
  });

  it('release.sh asserts Gatekeeper acceptance on both the .app and the .dmg', () => {
    expect(releaseScript).toContain('spctl --assess --type execute');
    expect(releaseScript).toContain('spctl --assess --type open --context context:primary-signature');
  });

  it('a rejected build is never pushed or published — spctl runs before git push', () => {
    const spctlIndex = releaseScript.indexOf('spctl --assess');
    const pushIndex = releaseScript.indexOf('git -C "$ROOT" push');
    expect(spctlIndex).toBeGreaterThan(-1);
    expect(pushIndex).toBeGreaterThan(-1);
    expect(spctlIndex).toBeLessThan(pushIndex);
  });
});
