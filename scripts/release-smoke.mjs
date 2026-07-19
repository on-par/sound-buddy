#!/usr/bin/env node
//
// Release channel end-to-end smoke check (#505). Run this after
// scripts/release.sh, before announcing a release: it proves the freshly cut
// tag is actually reachable through every layer of the release channel —
// the latest.json manifest, the artifact it points at, the site's /download
// redirect, and the app's update-discovery contract.
//
// Usage:
//   node scripts/release-smoke.mjs v0.3.0
//   node scripts/release-smoke.mjs v0.3.0 --site-download <url> --current-version <x.y.z>
//
// All pass/fail decisions live in packages/shared/src/release-smoke.ts — this
// file only wires real network fetchers to that tested logic.

import { createHash } from 'node:crypto';

const TIMEOUT_MS = 30_000;

function printUsageAndExit(message) {
  console.error(`error: ${message}`);
  console.error('usage: node scripts/release-smoke.mjs v<version> [--site-download <url>] [--current-version <x.y.z>]');
  process.exit(2);
}

const args = process.argv.slice(2);
const positional = [];
const flags = {};
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--site-download' || arg === '--current-version') {
    flags[arg] = args[++i];
  } else {
    positional.push(arg);
  }
}

const tag = positional[0];
if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
  printUsageAndExit(`missing or malformed tag ${JSON.stringify(tag)} — expected e.g. v0.3.0`);
}

let shared;
try {
  shared = await import('../packages/shared/dist/index.js');
} catch (err) {
  console.error(`error: could not load @sound-buddy/shared/dist — run "npm run build" first (${err.message})`);
  process.exit(2);
}

const { runReleaseSmoke, formatSmokeReport, RELEASE_MANIFEST_URL, RELEASES_REPO, SITE_DOWNLOAD_URL } = shared;

const siteDownloadUrl = flags['--site-download'] ?? SITE_DOWNLOAD_URL;
const currentVersion = flags['--current-version'];

async function fetchManifest() {
  const res = await fetch(RELEASE_MANIFEST_URL, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function fetchArtifactHead(artifactUrl) {
  const res = await fetch(artifactUrl, {
    method: 'HEAD',
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const contentLength = res.headers.get('content-length');
  const contentLengthBytes = contentLength !== null && !Number.isNaN(Number(contentLength))
    ? Number(contentLength)
    : null;
  return { status: res.status, contentLengthBytes };
}

async function fetchArtifactDigest(releaseTag, assetName) {
  const res = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/tags/${releaseTag}`, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return '';
  const release = await res.json();
  const asset = (release.assets ?? []).find((a) => a.name === assetName);
  const digest = asset?.digest ?? '';
  if (digest) return digest;

  // Older GitHub deployments don't expose asset digests — fall back to
  // streaming the artifact and hashing it locally (mirrors scripts/release.sh).
  if (!asset) return '';
  const assetRes = await fetch(asset.browser_download_url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!assetRes.ok || !assetRes.body) return '';
  const hash = createHash('sha256');
  for await (const chunk of assetRes.body) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function fetchDownloadRedirect() {
  const res = await fetch(siteDownloadUrl, {
    method: 'GET',
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: res.status, location: res.headers.get('location') };
}

const report = await runReleaseSmoke(
  { tag, ...(currentVersion ? { currentVersion } : {}) },
  { fetchManifest, fetchArtifactHead, fetchArtifactDigest, fetchDownloadRedirect },
);

console.log(formatSmokeReport(report));
process.exit(report.ok ? 0 : 1);
