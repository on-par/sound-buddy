import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Guards the release version source of truth (#1339). app/package.json is the
// single version source scripts/release.sh reads and that CI stamps into the
// generated latest.json manifest (release.sh:87/207 feed
// `require(app/package.json).version` into buildReleaseManifestPreview). If it
// falls behind the tag being cut — 0.9.0 while the RC is v0.9.1 — CI publishes a
// manifest whose version mismatches the tag, exactly the drift the release-smoke
// check flags at its manifest layer (`manifest reports v0.9.0 but the tag under
// test is v0.9.1`). This does not exercise the smoke command itself: that reads
// the live published manifest over the network, so it only goes green once the
// tag is actually released (out of scope for #1339). This guards the local
// source the manifest is built from.
//
// This is a floor, not an exact pin: it catches the "version fell behind the
// release tag" regression without breaking the release gate on every future
// bump (0.9.2, 0.10.0, …), which would happen if it hardcoded one exact value.

const appRoot = path.resolve(__dirname, '..');
const RELEASE_FLOOR = '0.9.1'; // the 0.9.1 release candidate this repo head cuts

const SEMVER = /^\d+\.\d+\.\d+$/;

function parseSemver(v: string): [number, number, number] {
  const [major, minor, patch] = v.split('.').map((n) => parseInt(n, 10));
  return [major, minor, patch];
}

// Returns true when `a` is greater than or equal to `b` by semver precedence.
function isAtLeast(a: string, b: string): boolean {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i];
  }
  return true;
}

describe('app release version', () => {
  const version: string = JSON.parse(
    fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'),
  ).version;

  it('app/package.json declares a valid semver version', () => {
    expect(version).toMatch(SEMVER);
  });

  it(`is at or ahead of the ${RELEASE_FLOOR} release candidate (not stale behind the tag)`, () => {
    expect(isAtLeast(version, RELEASE_FLOOR)).toBe(true);
  });
});
