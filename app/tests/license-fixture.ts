// Shared license fixture for the e2e specs (#54). Generates a throwaway
// Ed25519 keypair per test run, signs keys the way scripts/license-keygen.mjs
// does, and lets a spec seed a Pro license.json into its --user-data-dir.
// The app verifies against the matching public key via the
// SOUND_BUDDY_LICENSE_PUBKEY env override — pass LICENSE_ENV to electron.launch.

import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');

/**
 * Spread into electron.launch's env so the app trusts this run's keypair. Also
 * suppresses the first-run onboarding overlay (#69) — its modal scrim would
 * otherwise intercept the tab/button clicks these specs make on a fresh
 * --user-data-dir. onboarding.spec.ts deliberately omits this to exercise the
 * overlay for real.
 */
export const LICENSE_ENV = {
  SOUND_BUDDY_LICENSE_PUBKEY: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  SOUND_BUDDY_DISABLE_ONBOARDING: '1',
};

/**
 * Trust this run's keypair AND suppress the first-launch trial (#61) so a spec
 * can exercise the deterministic free tier — otherwise a fresh --user-data-dir
 * boots straight into the 14-day Pro trial. Dev-only env, honored by the
 * unpackaged app the e2e harness launches.
 */
export const NO_TRIAL_ENV = { ...LICENSE_ENV, SOUND_BUDDY_DISABLE_TRIAL: '1' };

/**
 * Trust this run's keypair AND kill the #117 auto-refresh so a matrix spec's
 * zero-network assertion is airtight and deterministic for every Pro/
 * subscription state — otherwise a subscription in or near grace fires a real
 * outbound refresh call on launch. Refresh itself is #117's concern (its own
 * license-refresh.test.ts covers it), not this matrix.
 */
export const MATRIX_ENV = { ...LICENSE_ENV, SOUND_BUDDY_DISABLE_LICENSE_REFRESH: '1' };

/** MATRIX_ENV plus the trial kill-switch, for the deterministic free state. */
export const MATRIX_FREE_ENV = { ...MATRIX_ENV, SOUND_BUDDY_DISABLE_TRIAL: '1' };

/**
 * Seed a license.json whose trial started `startedDaysAgo` days ago (#61) —
 * negative/small values give an active trial, ≥14 an expired one. Lets a spec
 * reach the trial states without waiting real days.
 */
export function seedTrial(userDataDir: string, startedDaysAgo: number): void {
  fs.mkdirSync(userDataDir, { recursive: true });
  const startedAt = new Date(Date.now() - startedDaysAgo * 24 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync(
    path.join(userDataDir, 'license.json'),
    JSON.stringify({ trialStartedAt: startedAt }, null, 2),
  );
}

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

/**
 * Write a license.json for a `subscription` key expiring `expiresDaysFromNow`
 * days from now (fractional/negative allowed) — positive ⇒ valid, a small
 * negative within GRACE_DAYS ⇒ grace, a large negative ⇒ past-grace/expired.
 * Lets the entitlement matrix reach every subscription state deterministically.
 */
export function seedSubscription(userDataDir: string, expiresDaysFromNow: number): void {
  fs.mkdirSync(userDataDir, { recursive: true });
  const expiresAt = new Date(Date.now() + expiresDaysFromNow * 24 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync(
    path.join(userDataDir, 'license.json'),
    JSON.stringify({ key: makeLicenseKey({ kind: 'subscription', email: 'e2e@test.local', expiresAt }) }, null, 2),
  );
}
