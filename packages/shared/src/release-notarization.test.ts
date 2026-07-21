import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Regression guard for #621: electron-builder does notarization + stapling
// natively (inside its sign phase, before the zip target is built), so
// release.sh must not hand-roll notarytool submit / stapler staple / a
// post-hoc re-zip. It still verifies the result (stapler validate + spctl)
// before anything is pushed or published.
const releaseScript = readFileSync(
  fileURLToPath(new URL('../../../scripts/release.sh', import.meta.url)),
  'utf8',
);

const electronBuilderYml = readFileSync(
  fileURLToPath(new URL('../../../app/electron-builder.yml', import.meta.url)),
  'utf8',
);

describe('release.sh notarization (#621)', () => {
  it('does not hand-roll notarytool submit', () => {
    expect(releaseScript).not.toMatch(/notarytool submit/);
  });

  it('does not hand-roll stapler staple', () => {
    expect(releaseScript).not.toMatch(/stapler staple/);
  });

  it('does not re-zip the app with ditto', () => {
    expect(releaseScript).not.toMatch(/ditto -c/);
  });

  it('passes -c.mac.notarize=true in the signed build branch', () => {
    expect(releaseScript).toContain('-c.mac.notarize=true');
  });

  it('exports APPLE_KEYCHAIN_PROFILE in the signed build branch', () => {
    expect(releaseScript).toMatch(/APPLE_KEYCHAIN_PROFILE="\$NOTARY_PROFILE"/);
  });

  it('still validates the stapled ticket', () => {
    expect(releaseScript).toContain('xcrun stapler validate');
  });

  it('still assesses with Gatekeeper', () => {
    expect(releaseScript).toContain('spctl --assess --type execute');
  });

  it('runs the stapler + spctl verification before pushing to the source repo', () => {
    const spctlIndex = releaseScript.indexOf('spctl --assess');
    const pushIndex = releaseScript.indexOf('git -C "$ROOT" push');
    expect(spctlIndex).toBeGreaterThan(-1);
    expect(pushIndex).toBeGreaterThan(-1);
    expect(spctlIndex).toBeLessThan(pushIndex);
  });

  it('runs the stapler + spctl verification before publishing the release', () => {
    const spctlIndex = releaseScript.indexOf('spctl --assess');
    const releaseIndex = releaseScript.indexOf('gh release create');
    expect(spctlIndex).toBeGreaterThan(-1);
    expect(releaseIndex).toBeGreaterThan(-1);
    expect(spctlIndex).toBeLessThan(releaseIndex);
  });

  it('electron-builder.yml declares mac.notarize off by default', () => {
    expect(electronBuilderYml).toMatch(/^\s+notarize: false$/m);
  });
});

describe('release.sh dmg publishing (#622)', () => {
  it('defines DMG=', () => {
    expect(releaseScript).toMatch(/^DMG="/m);
  });

  it('dies when the expected dmg is missing', () => {
    expect(releaseScript).toMatch(/\[\[ -f "\$DMG" \]\] \|\| die/);
  });

  it('validates the stapled ticket on the dmg with xcrun stapler validate', () => {
    expect(releaseScript).toMatch(/xcrun stapler validate "\$DMG"/);
  });

  it('passes both the zip and the dmg to gh release create', () => {
    expect(releaseScript).toMatch(/gh release create "\$TAG" "\$ZIP" "\$DMG"/);
  });

  it('runs the dmg verification before pushing to the source repo', () => {
    const dmgStaplerIndex = releaseScript.indexOf('xcrun stapler validate "$DMG"');
    const pushIndex = releaseScript.indexOf('git -C "$ROOT" push');
    expect(dmgStaplerIndex).toBeGreaterThan(-1);
    expect(pushIndex).toBeGreaterThan(-1);
    expect(dmgStaplerIndex).toBeLessThan(pushIndex);
  });

  it('runs the dmg verification before publishing the release', () => {
    const dmgStaplerIndex = releaseScript.indexOf('xcrun stapler validate "$DMG"');
    const releaseIndex = releaseScript.indexOf('gh release create');
    expect(dmgStaplerIndex).toBeGreaterThan(-1);
    expect(releaseIndex).toBeGreaterThan(-1);
    expect(dmgStaplerIndex).toBeLessThan(releaseIndex);
  });

  it('ASSET_NAME still ends in .zip (manifest contract unchanged)', () => {
    expect(releaseScript).toMatch(/ASSET_NAME="Sound\.Buddy-\$NEXT-arm64-mac\.zip"/);
  });
});
