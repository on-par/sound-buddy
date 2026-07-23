#!/usr/bin/env node
//
// Writes app/release/latest.json for a tagged CI release (#652). Follows the
// scripts/ci-signing.mjs convention: all decisions live in packages/shared —
// this file only wires real files / env vars to that tested logic. Requires
// "npm run build" and the electron-builder dist step to have run first.
//
// scripts/release.sh writes the same manifest for a local release. CI needs
// its own copy because the local script's version is computed mid-run from
// live GitHub state, while CI already knows the tag it was triggered by.
//
// Usage:
//   node scripts/ci-release-manifest.mjs <tag>

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC_REPO = 'on-par/sound-buddy-releases';
const RELEASE_DIR = 'app/release';

const tag = process.argv[2];
if (!tag) {
  console.error('error: missing tag argument');
  console.error('usage: node scripts/ci-release-manifest.mjs <tag>');
  process.exit(2);
}

let shared;
try {
  shared = await import('../packages/shared/dist/index.js');
} catch (err) {
  console.error(`error: could not load @sound-buddy/shared/dist — run "npm run build" first (${err.message})`);
  process.exit(2);
}

const { version } = JSON.parse(readFileSync('app/package.json', 'utf8'));
// A tag that disagrees with the committed version would publish a manifest
// advertising a version nobody can download — fail before anything ships.
if (tag !== `v${version}`) {
  console.error(`error: tag ${tag} does not match app/package.json version ${version}`);
  process.exit(1);
}

const zipName = readdirSync(RELEASE_DIR).find((name) => name.endsWith('-arm64-mac.zip'));
if (!zipName) {
  console.error(`error: no *-arm64-mac.zip found in ${RELEASE_DIR}`);
  process.exit(1);
}
const zipPath = join(RELEASE_DIR, zipName);
const zipBytes = readFileSync(zipPath);

// The leading HTML comment in RELEASE_HIGHLIGHTS.md is an editor-only
// instruction — strip it so it never ships as literal release-note text.
let highlights;
try {
  highlights = readFileSync('RELEASE_HIGHLIGHTS.md', 'utf8')
    .split('\n')
    .filter((line) => !/^<!--.*-->\s*$/.test(line))
    .join('\n');
} catch {
  highlights = undefined;
}

const manifest = shared.buildReleaseManifest({
  version,
  notes: shared.buildReleaseNotes({ version, signed: true, highlights: highlights || undefined }),
  releaseUrl: `https://github.com/${PUBLIC_REPO}/releases/tag/${tag}`,
  artifactUrl: `https://github.com/${PUBLIC_REPO}/releases/download/${tag}/${zipName}`,
  artifactSizeBytes: statSync(zipPath).size,
  sha256: createHash('sha256').update(zipBytes).digest('hex'),
  publishedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  signed: true,
});

const outPath = join(RELEASE_DIR, 'latest.json');
writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${outPath} for ${tag} (${zipName})`);
