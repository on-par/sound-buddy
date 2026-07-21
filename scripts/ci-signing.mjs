#!/usr/bin/env node
//
// CI signing preflight + identity lookup (#624). Follows the
// scripts/release-smoke.mjs convention: all decisions live in
// packages/shared — this file only wires real env vars / stdin to that
// tested logic. Requires "npm run build" to have run first.
//
// Usage:
//   node scripts/ci-signing.mjs check-secrets
//   security find-identity -v -p codesigning "$KEYCHAIN_PATH" | node scripts/ci-signing.mjs identity

function printUsageAndExit(message) {
  console.error(`error: ${message}`);
  console.error('usage: node scripts/ci-signing.mjs <check-secrets|identity>');
  process.exit(2);
}

const subcommand = process.argv[2];
if (subcommand !== 'check-secrets' && subcommand !== 'identity') {
  printUsageAndExit(`unknown subcommand ${JSON.stringify(subcommand ?? '')}`);
}

let shared;
try {
  shared = await import('../packages/shared/dist/index.js');
} catch (err) {
  console.error(`error: could not load @sound-buddy/shared/dist — run "npm run build" first (${err.message})`);
  process.exit(2);
}

if (subcommand === 'check-secrets') {
  const verdict = shared.resolveCiSigningSecrets(process.env);
  if (!verdict.ok) {
    console.error(verdict.error);
    process.exit(1);
  }
  console.log(`signing secrets present (team ${verdict.teamId})`);
  process.exit(0);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const findIdentityOutput = await readStdin();
const result = shared.parseCodesigningIdentity(findIdentityOutput, process.env.APPLE_TEAM_ID ?? '');
if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.stdout.write(`${result.identity}\n`);
