import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Guards the DMG target + notarization wiring (#622): electron-builder 24
// notarizes + staples only the .app (inside its sign phase), so the DMG target
// added here needs its own afterAllArtifactBuild hook to submit + staple it —
// if electron-builder.yml drifts, the release ships an unstapled DMG that fails
// `xcrun stapler validate` and blocks offline first launch.
const appRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const builderConfig = fs.readFileSync(path.join(appRoot, 'electron-builder.yml'), 'utf8');

describe('electron-builder.yml dmg target (#622)', () => {
  it('adds a dmg target entry with arch: arm64', () => {
    // Matches "- target: dmg" followed on the next line by its own "arch: arm64",
    // not just any arch: arm64 elsewhere in the file (e.g. the zip entry's).
    expect(builderConfig).toMatch(/^\s*-\s*target:\s*dmg\s*\n\s*arch:\s*arm64\s*$/m);
  });

  it('keeps the zip target (the dmg must not replace it)', () => {
    expect(builderConfig).toMatch(/^\s*-\s*target:\s*zip\s*$/m);
  });

  it('declares a top-level dmg: block', () => {
    expect(builderConfig).toMatch(/^dmg:\s*$/m);
  });

  it('signs the dmg', () => {
    expect(builderConfig).toMatch(/^\s*sign:\s*true\s*$/m);
  });

  it('includes a drag-to-Applications link in contents', () => {
    expect(builderConfig).toMatch(/type:\s*link/);
    expect(builderConfig).toMatch(/path:\s*\/Applications/);
  });

  it('includes a file entry in contents', () => {
    expect(builderConfig).toMatch(/type:\s*file/);
  });

  it('declares numeric window width and height', () => {
    expect(builderConfig).toMatch(/^\s*width:\s*\d+\s*$/m);
    expect(builderConfig).toMatch(/^\s*height:\s*\d+\s*$/m);
  });

  it('disables writeUpdateInfo (no dmg differential-update blockmap)', () => {
    expect(builderConfig).toMatch(/^\s*writeUpdateInfo:\s*false\s*$/m);
  });

  it('wires afterAllArtifactBuild to the new hook', () => {
    expect(builderConfig).toMatch(/^\s*afterAllArtifactBuild:\s*build\/afterAllArtifactBuild\.js\s*$/m);
  });

  it('afterAllArtifactBuild.js exists on disk', () => {
    expect(fs.existsSync(path.join(appRoot, 'build', 'afterAllArtifactBuild.js'))).toBe(true);
  });
});
