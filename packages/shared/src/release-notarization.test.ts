import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Regression guard for #621: electron-builder does notarization + stapling
// natively (inside its sign phase, before the zip target is built), so
// the pipeline must not hand-roll notarytool submit / stapler staple / a
// post-hoc re-zip. It still verifies the result (stapler validate + spctl)
// before anything is pushed or published.
//
// #1237: the guards below used to read scripts/release.sh. #1236 slice 3
// (#1239) reduces that script to tag-and-wait, so the file that actually
// signs, notarizes, staples and Gatekeeper-verifies is the CI workflow —
// these assert against it, unchanged in strength, so they keep biting once
// CI is the authoritative publisher.
const releaseWorkflow = readFileSync(
  fileURLToPath(new URL('../../../.github/workflows/release.yml', import.meta.url)),
  'utf8',
);

const electronBuilderYml = readFileSync(
  fileURLToPath(new URL('../../../app/electron-builder.yml', import.meta.url)),
  'utf8',
);

describe('release.yml notarization (#621, retargeted #1237)', () => {
  it('does not hand-roll notarytool submit', () => {
    expect(releaseWorkflow).not.toMatch(/notarytool submit/);
  });

  it('does not hand-roll stapler staple', () => {
    expect(releaseWorkflow).not.toMatch(/stapler staple/);
  });

  it('does not re-zip the app with ditto', () => {
    expect(releaseWorkflow).not.toMatch(/ditto -c/);
  });

  it('passes -c.mac.notarize=true in the signed build step', () => {
    expect(releaseWorkflow).toContain('-c.mac.notarize=true');
  });

  it('wires the notary credentials electron-builder 26 reads from the environment', () => {
    // release.sh authenticated notarytool with a stored keychain profile
    // (APPLE_KEYCHAIN_PROFILE). A fresh CI runner has no stored profile, so the
    // workflow passes the same credentials as APPLE_ID / APPLE_TEAM_ID /
    // APPLE_APP_SPECIFIC_PASSWORD, which electron-builder 26 reads directly
    // (#1225). Same property — the notary submission is authenticated.
    expect(releaseWorkflow).toMatch(/^\s*APPLE_ID: \$\{\{ secrets\.APPLE_ID \}\}$/m);
    expect(releaseWorkflow).toMatch(/^\s*APPLE_TEAM_ID: \$\{\{ secrets\.APPLE_TEAM_ID \}\}$/m);
    expect(releaseWorkflow).toMatch(
      /^\s*APPLE_APP_SPECIFIC_PASSWORD: \$\{\{ secrets\.APPLE_APP_SPECIFIC_PASSWORD \}\}$/m,
    );
  });

  it('still validates the stapled ticket', () => {
    expect(releaseWorkflow).toContain('xcrun stapler validate');
  });

  it('still assesses with Gatekeeper', () => {
    expect(releaseWorkflow).toContain('spctl --assess --type execute');
  });

  it('runs the stapler + spctl verification before the build artifact leaves the job', () => {
    // The CI counterpart of release.sh's "verify before git push": the workflow
    // artifact upload is the first step where a binary escapes the build.
    const spctlIndex = releaseWorkflow.indexOf('spctl --assess');
    const uploadIndex = releaseWorkflow.indexOf('uses: actions/upload-artifact@v7');
    expect(spctlIndex).toBeGreaterThan(-1);
    expect(uploadIndex).toBeGreaterThan(-1);
    expect(spctlIndex).toBeLessThan(uploadIndex);
  });

  it('runs the stapler + spctl verification before publishing the release', () => {
    const spctlIndex = releaseWorkflow.indexOf('spctl --assess');
    const publishIndex = releaseWorkflow.indexOf('uses: softprops/action-gh-release@v2');
    expect(spctlIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeGreaterThan(-1);
    expect(spctlIndex).toBeLessThan(publishIndex);
  });

  it('electron-builder.yml declares mac.notarize off by default', () => {
    expect(electronBuilderYml).toMatch(/^\s+notarize: false$/m);
  });
});

describe('release.yml dmg publishing (#622, retargeted #1237)', () => {
  it('defines DMG=', () => {
    expect(releaseWorkflow).toMatch(/^\s*DMG="\$\(ls app\/release\/\*\.dmg\)"$/m);
  });

  it('fails the job when the expected dmg is missing', () => {
    // The verify step's `set -euo pipefail` makes the failing `ls` kill the
    // step; the publish step separately refuses an unmatched glob.
    expect(releaseWorkflow).toMatch(/^\s*DMG="\$\(ls app\/release\/\*\.dmg\)"$/m);
    expect(releaseWorkflow).toContain('fail_on_unmatched_files: true');
  });

  it('validates the stapled ticket on the dmg with xcrun stapler validate', () => {
    expect(releaseWorkflow).toMatch(/xcrun stapler validate "\$DMG"/);
  });

  it('publishes both the zip and the dmg to the releases repo', () => {
    expect(releaseWorkflow).toMatch(
      /files:\s*\|\n\s+app\/release\/\*-arm64\.dmg\n\s+app\/release\/\*-arm64-mac\.zip/,
    );
  });

  it('runs the dmg verification before the build artifact leaves the job', () => {
    const dmgStaplerIndex = releaseWorkflow.indexOf('xcrun stapler validate "$DMG"');
    const uploadIndex = releaseWorkflow.indexOf('uses: actions/upload-artifact@v7');
    expect(dmgStaplerIndex).toBeGreaterThan(-1);
    expect(uploadIndex).toBeGreaterThan(-1);
    expect(dmgStaplerIndex).toBeLessThan(uploadIndex);
  });

  it('runs the dmg verification before publishing the release', () => {
    const dmgStaplerIndex = releaseWorkflow.indexOf('xcrun stapler validate "$DMG"');
    const publishIndex = releaseWorkflow.indexOf('uses: softprops/action-gh-release@v2');
    expect(dmgStaplerIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeGreaterThan(-1);
    expect(dmgStaplerIndex).toBeLessThan(publishIndex);
  });

  it('the published zip asset is still an arm64-mac .zip (manifest contract unchanged)', () => {
    expect(releaseWorkflow).toMatch(/^\s*path: app\/release\/\*-arm64-mac\.zip$/m);
  });
});
