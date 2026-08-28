#!/usr/bin/env node
//
// Verifies app/release/latest-mac.yml against the artifacts this build produced (#1238).
// Mirrors scripts/release.sh's Phase A gate using the same shared functions — all decisions
// live in packages/shared; this file only wires real files to that tested logic. Requires
// "npm run build" and the electron-builder dist step to have run first.
//
// Usage:
//   node scripts/ci-update-feed.mjs

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RELEASE_DIR = 'app/release';
const FEED_NAME = 'latest-mac.yml';
const SKIPPED_ENTRIES = new Set([FEED_NAME, 'latest.json']);

let shared;
try {
  shared = await import('../packages/shared/dist/index.js');
} catch (err) {
  console.error(`error: could not load @sound-buddy/shared/dist — run "npm run build" first (${err.message})`);
  process.exit(2);
}

const { version } = JSON.parse(readFileSync('app/package.json', 'utf8'));

const feedPath = join(RELEASE_DIR, FEED_NAME);
if (!existsSync(feedPath)) {
  console.error(
    `error: no ${feedPath} — electron-builder did not generate latest-mac.yml — confirm the publish: block in ` +
      'app/electron-builder.yml still names provider github / owner on-par / repo sound-buddy-releases, then re-run',
  );
  process.exit(1);
}

const artifacts = readdirSync(RELEASE_DIR, { withFileTypes: true })
  .filter((entry) => entry.isFile() && !SKIPPED_ENTRIES.has(entry.name))
  .map((entry) => {
    const path = join(RELEASE_DIR, entry.name);
    return {
      name: entry.name,
      sizeBytes: statSync(path).size,
      sha512Base64: createHash('sha512').update(readFileSync(path)).digest('base64'),
    };
  });

const verdict = shared.checkUpdateFeed(shared.parseLatestMacYml(readFileSync(feedPath, 'utf8')), artifacts, version);

if (!verdict.ok) {
  console.error(verdict.problems.join('\n'));
  console.error(
    "latest-mac.yml does not describe this build's artifacts — electron-updater would fail with a " +
      'signature/sha512 error; re-run the build (#1226)',
  );
  process.exit(1);
}

console.log(`latest-mac.yml: consistent with the built artifacts (${artifacts.length} checked)`);
