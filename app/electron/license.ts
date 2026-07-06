// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// License key validation + feature gating (#54) — offline-first, no phone-home.
//
//   ~/Library/Application Support/SoundBuddy/license.json
//
// A license key is a Paddle-issued signed payload the app verifies LOCALLY with
// an embedded Ed25519 public key — no network call on launch, ever (privacy
// stance). Key format (versioned):
//
//   SB1.<base64url(payload JSON)>.<base64url(Ed25519 signature of payload)>
//
// Payload: { email?, kind: 'subscription' | 'lifetime', issuedAt, expiresAt? }
// `lifetime` keys (#90) skip expiry and grace-period checks entirely.
// A `subscription` key past `expiresAt` keeps Pro for a 7-day grace period
// (with a banner), then reverts to the free tier. User data is never locked.
//
// This is a $9/mo product, not enterprise DRM — the design optimizes for zero
// friction for paying users, not for defeating a determined pirate.

import * as fs from 'fs';
import * as path from 'path';
import { createPublicKey, verify as cryptoVerify, KeyObject } from 'crypto';
import { app } from 'electron';
import { logWarn } from './logger';

/**
 * DEV public key — the production Paddle signing keypair replaces this before
 * checkout ships (key issuance is out of scope here, see the Paddle webhook
 * issue). Generate a pair + sign test keys with scripts/license-keygen.mjs.
 * Override for tests/e2e via SOUND_BUDDY_LICENSE_PUBKEY (PEM, or base64 SPKI DER).
 */
const EMBEDDED_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEADAAF8d47qtdei8k1oP9b/7N8SlrhcABssKew3QBwUs8=
-----END PUBLIC KEY-----`;

/** Days a subscription key stays Pro after `expiresAt` (with a banner). */
export const GRACE_DAYS = 7;

const KEY_PREFIX = 'SB1';

export type LicenseKind = 'subscription' | 'lifetime';

/** The signed payload embedded in a license key. */
interface LicensePayload {
  email?: string;
  kind: LicenseKind;
  /** ISO 8601. */
  issuedAt?: string;
  /** ISO 8601; required for `subscription`, absent for `lifetime`. */
  expiresAt?: string;
}

/**
 * The renderer-facing license state. `tier` is the single gating input
 * ('pro' covers both `valid` and `grace`); the rest is messaging detail.
 */
export interface LicenseState {
  tier: 'free' | 'pro';
  status: 'none' | 'valid' | 'grace' | 'expired' | 'invalid';
  kind?: LicenseKind;
  email?: string;
  expiresAt?: string;
  /** Present only while status === 'grace'. */
  graceEndsAt?: string;
  /** Human-readable reason when status === 'invalid'. */
  error?: string;
}

const FREE_STATE: LicenseState = { tier: 'free', status: 'none' };

/** Pro-gated features. Anything not listed here is free — the report card
 * (score, metrics, recommendations) is the funnel, not the product. Gating
 * must key off THESE flags only — never recording count/length/size (#91). */
const PRO_FEATURES = new Set(['saved-rigs', 'live-monitoring', 'virtual-soundcheck', 'ai-narrative']);

function licensePath(): string {
  return path.join(app.getPath('userData'), 'license.json');
}

/**
 * Resolve the verification key: env override (tests/e2e — dev builds only, so
 * the shipped .app can't be pointed at a self-signed keypair) or the embedded
 * key. Exported so a test can prove the embedded PEM actually parses — a bad
 * paste of the production key would otherwise reject every real license while
 * the suite stays green against test keypairs.
 */
export function licensePublicKey(): KeyObject {
  const env = !app.isPackaged && process.env.SOUND_BUDDY_LICENSE_PUBKEY?.trim();
  if (env) {
    if (env.includes('BEGIN PUBLIC KEY')) return createPublicKey(env);
    return createPublicKey({ key: Buffer.from(env, 'base64'), format: 'der', type: 'spki' });
  }
  return createPublicKey(EMBEDDED_PUBLIC_KEY_PEM);
}

function fromBase64Url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function invalid(error: string): LicenseState {
  return { tier: 'free', status: 'invalid', error };
}

/**
 * Verify a key string offline and resolve its state as of `now`.
 * Never throws — malformed input, a bad signature, or an unparseable payload
 * all resolve to { status: 'invalid' } with a human-readable reason.
 */
export function verifyLicenseKey(key: string, now: Date = new Date()): LicenseState {
  const trimmed = typeof key === 'string' ? key.trim() : '';
  if (!trimmed) return invalid('Empty license key');

  const parts = trimmed.split('.');
  if (parts.length !== 3 || parts[0] !== KEY_PREFIX) {
    return invalid('Not a Sound Buddy license key');
  }

  const payloadBytes = fromBase64Url(parts[1]);
  const sigBytes = fromBase64Url(parts[2]);
  try {
    // Ed25519: algorithm is implied by the key; pass null for the digest.
    if (!cryptoVerify(null, payloadBytes, licensePublicKey(), sigBytes)) {
      return invalid('Invalid signature');
    }
  } catch (err) {
    logWarn(`license signature check failed: ${String(err)}`);
    return invalid('Invalid signature');
  }

  let payload: LicensePayload;
  try {
    payload = JSON.parse(payloadBytes.toString('utf8')) as LicensePayload;
  } catch {
    return invalid('Corrupt license payload');
  }
  if (payload == null || typeof payload !== 'object') return invalid('Corrupt license payload');

  const base = {
    kind: payload.kind,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    expiresAt: typeof payload.expiresAt === 'string' ? payload.expiresAt : undefined,
  };

  // Lifetime keys (#90) never expire — skip expiry and grace entirely.
  if (payload.kind === 'lifetime') return { tier: 'pro', status: 'valid', ...base, expiresAt: undefined };
  if (payload.kind !== 'subscription') return invalid('Unknown license kind');

  const expiresMs = Date.parse(base.expiresAt ?? '');
  if (Number.isNaN(expiresMs)) return invalid('License has no valid expiry');

  if (now.getTime() < expiresMs) return { tier: 'pro', status: 'valid', ...base };

  const graceEndsMs = expiresMs + GRACE_DAYS * 24 * 60 * 60 * 1000;
  if (now.getTime() < graceEndsMs) {
    return { tier: 'pro', status: 'grace', ...base, graceEndsAt: new Date(graceEndsMs).toISOString() };
  }
  return { tier: 'free', status: 'expired', ...base };
}

/** Read the stored key from license.json ('' when absent/unreadable). */
function readStoredKey(): string {
  try {
    const p = licensePath();
    if (!fs.existsSync(p)) return '';
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as { key?: unknown };
    return typeof parsed?.key === 'string' ? parsed.key : '';
  } catch (err) {
    logWarn(`could not read license.json: ${String(err)}`);
    return '';
  }
}

/**
 * The current license state: stored key re-verified offline on every read.
 * No stored key ⇒ free tier ({ status: 'none' }) — the app works fully
 * without a license (report card only).
 */
export function getLicenseState(now: Date = new Date()): LicenseState {
  const key = readStoredKey();
  if (!key) return { ...FREE_STATE };
  return verifyLicenseKey(key, now);
}

/**
 * Validate a pasted key and, when it grants Pro (valid or in-grace), persist it
 * — unlocking takes effect immediately, no restart. An invalid or expired key
 * is returned for messaging but never overwrites a stored key, and never locks
 * the app. Rethrows a write failure so a lost save surfaces to the caller.
 */
export function activateLicense(key: string, now: Date = new Date()): LicenseState {
  const state = verifyLicenseKey(key, now);
  if (state.tier !== 'pro') return state;
  try {
    fs.writeFileSync(licensePath(), JSON.stringify({ key: key.trim() }, null, 2));
  } catch (err) {
    logWarn(`could not write license.json: ${String(err)}`);
    throw err;
  }
  return state;
}

/**
 * Remove the stored key, reverting to the free tier. User data is untouched.
 * Rethrows a delete failure (EPERM/EBUSY — force only suppresses ENOENT) so
 * the UI can't report "removed" while the key is still stored.
 */
export function removeLicense(): LicenseState {
  try {
    fs.rmSync(licensePath(), { force: true });
  } catch (err) {
    logWarn(`could not remove license.json: ${String(err)}`);
    throw err;
  }
  return { ...FREE_STATE };
}

/**
 * Feature gate, usable anywhere in the main process. Free features are always
 * entitled; the PRO_FEATURES set requires an active Pro license (valid or
 * in-grace). Feature flags only — never usage-based limits (#91).
 */
export function isEntitled(feature: string, now: Date = new Date()): boolean {
  if (!PRO_FEATURES.has(feature)) return true;
  return getLicenseState(now).tier === 'pro';
}
