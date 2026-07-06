// Shared license fixture for the e2e specs (#54). Generates a throwaway
// Ed25519 keypair per test run, signs keys the way scripts/license-keygen.mjs
// does, and lets a spec seed a Pro license.json into its --user-data-dir.
// The app verifies against the matching public key via the
// SOUND_BUDDY_LICENSE_PUBKEY env override — pass LICENSE_ENV to electron.launch.

import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');

/** Spread into electron.launch's env so the app trusts this run's keypair. */
export const LICENSE_ENV = {
  SOUND_BUDDY_LICENSE_PUBKEY: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
};

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Sign a license key with an explicit private key (format:
 * SB1.<b64url payload>.<b64url signature>). The single test-side signer —
 * unit tests bring their own keypairs, the e2e fixtures use this run's.
 */
export function signLicenseKey(payload: Record<string, unknown>, privKey: KeyObject): string {
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  return `SB1.${b64url(payloadBytes)}.${b64url(cryptoSign(null, payloadBytes, privKey))}`;
}

/** Sign a license key with this test run's fixture keypair. */
export function makeLicenseKey(payload: Record<string, unknown>): string {
  return signLicenseKey(payload, privateKey);
}

/**
 * Write a license.json granting Pro into a spec's throwaway userData dir
 * (creating it if needed) so gated UI is unlocked at launch. Lifetime by
 * default — no expiry to trip long-running suites.
 */
export function seedProLicense(
  userDataDir: string,
  payload: Record<string, unknown> = { kind: 'lifetime', email: 'e2e@test.local' },
): void {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, 'license.json'),
    JSON.stringify({ key: makeLicenseKey(payload) }, null, 2),
  );
}
