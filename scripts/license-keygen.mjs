#!/usr/bin/env node
// Dev tool for Sound Buddy license keys (#54). Two commands:
//
//   node scripts/license-keygen.mjs gen [outdir]
//     Generate an Ed25519 keypair (license-priv.pem / license-pub.pem).
//     The PRIVATE key must NEVER be committed — it lives with the Paddle
//     webhook (issuance is a separate issue). Paste the PUBLIC key into
//     EMBEDDED_PUBLIC_KEY_PEM in app/electron/license.ts.
//
//   node scripts/license-keygen.mjs sign <priv.pem> [--kind subscription|lifetime]
//        [--email a@b.c] [--days 365]
//     Sign a license key and print it. `--days` sets expiresAt from now
//     (subscription only; lifetime keys carry no expiry).
//
// Key format: SB1.<base64url(payload JSON)>.<base64url(Ed25519 signature)>

import { generateKeyPairSync, createPrivateKey, sign } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const cmd = process.argv[2];

if (cmd === 'gen') {
  const outdir = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : '.';
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
    console.error('usage: license-keygen.mjs sign <priv.pem> [--kind subscription|lifetime] [--email a@b.c] [--days 365]');
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
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  const key = createPrivateKey(readFileSync(privPath));
  const sig = sign(null, payloadBytes, key);
  console.log(`SB1.${b64url(payloadBytes)}.${b64url(sig)}`);
} else {
  console.error('usage: license-keygen.mjs gen [outdir] | sign <priv.pem> [options]');
  process.exit(1);
}
