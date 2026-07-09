#!/usr/bin/env node
// Dev tool for Sound Buddy license keys (#54). Two commands:
//
//   node scripts/license-keygen.mjs gen <outdir> [--force]
//     Generate an Ed25519 keypair (license-priv.pem / license-pub.pem).
//     The PRIVATE key must NEVER be committed — it lives with the Stripe
//     checkout webhook (#56). Paste the PUBLIC key into
//     EMBEDDED_PUBLIC_KEY_PEM in app/electron/license.ts.
//     `outdir` is REQUIRED (no cwd default) and must sit OUTSIDE any git
//     working tree — `gen` refuses to write a private key into a checkout
//     (one `git add -A` from committing it). `--force` overrides, for tests.
//
//   node scripts/license-keygen.mjs sign <priv.pem> [--kind subscription|lifetime]
//        [--email a@b.c] [--days 365] [--kid <id>] [--sub <subscription_id>]
//     Sign a license key and print it. `--days` sets expiresAt from now
//     (subscription only; lifetime keys carry no expiry). Every signed key
//     carries payload v2 claims (#109): a fresh `jti` and `iss`, plus `kid`
//     when given and `sub` for subscriptions.
//
// Key format: SB1.<base64url(payload JSON)>.<base64url(Ed25519 signature)>

import { generateKeyPairSync, createPrivateKey, sign, randomUUID } from 'node:crypto';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

/** Issuer stamped into every minted payload — mirrors the Worker (#109). */
const LICENSE_ISSUER = 'soundbuddy.online';

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/**
 * Return the root of the git working tree containing `startDir`, or null if it
 * sits outside any repo. Walks up looking for a `.git` entry — a directory in a
 * normal clone, a file in a worktree/submodule — both mean "committable here".
 */
function gitWorkTreeRoot(startDir) {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const cmd = process.argv[2];

if (cmd === 'gen') {
  const outdir = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : null;
  const force = process.argv.includes('--force');
  if (!outdir) {
    console.error('usage: license-keygen.mjs gen <outdir> [--force]');
    console.error('Refusing to default to the cwd — pass an explicit output directory,');
    console.error('OUTSIDE any git working tree (the private key must never be committed).');
    process.exit(1);
  }
  if (!force) {
    const root = gitWorkTreeRoot(outdir);
    if (root) {
      console.error(`Refusing to write a private key inside a git working tree (${root}).`);
      console.error('Pick an outdir outside the repo (e.g. ~/SoundBuddy-keys), or pass --force.');
      process.exit(1);
    }
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubPath = join(outdir, 'license-pub.pem');
  const privPath = join(outdir, 'license-priv.pem');
  writeFileSync(pubPath, publicKey.export({ type: 'spki', format: 'pem' }));
  writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  console.log(`wrote ${pubPath} and ${privPath}`);
  console.log('Embed the PUBLIC key in app/electron/license.ts; keep the private key OUT of git.');
} else if (cmd === 'sign') {
  const privPath = process.argv[3];
  if (!privPath || privPath.startsWith('--')) {
    console.error('usage: license-keygen.mjs sign <priv.pem> [--kind subscription|lifetime] [--email a@b.c] [--days 365] [--kid <id>] [--sub <subscription_id>]');
    process.exit(1);
  }
  const kind = arg('kind', 'subscription');
  if (kind !== 'subscription' && kind !== 'lifetime') {
    console.error(`unknown --kind "${kind}" (subscription | lifetime)`);
    process.exit(1);
  }
  const payload = { kind, issuedAt: new Date().toISOString() };
  const email = arg('email');
  if (email) payload.email = email;
  if (kind === 'subscription') {
    const days = Number(arg('days', '365'));
    payload.expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }
  // Payload v2 (#109): `jti`/`iss` on every key; `kid` when supplied; `sub`
  // for subscriptions only (mirrors the Worker's mintLicenseKey). All are
  // informational — verifyLicenseKey never gates on them, so v1 keys still pass.
  const kid = arg('kid');
  if (kid) payload.kid = kid;
  payload.jti = randomUUID();
  payload.iss = LICENSE_ISSUER;
  const sub = arg('sub');
  if (sub) {
    if (kind === 'subscription') payload.sub = sub;
    else console.error('note: --sub ignored for a lifetime key (subscriptions only)');
  }
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  const key = createPrivateKey(readFileSync(privPath));
  const sig = sign(null, payloadBytes, key);
  console.log(`SB1.${b64url(payloadBytes)}.${b64url(sig)}`);
} else {
  console.error('usage: license-keygen.mjs gen <outdir> [--force] | sign <priv.pem> [options]');
  process.exit(1);
}
