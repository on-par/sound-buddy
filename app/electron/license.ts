// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// License key validation + feature gating (#54) — offline-first, no phone-home.
//
//   ~/Library/Application Support/SoundBuddy/license.json
//
// A license key is a signed payload — issued by the Stripe checkout webhook
// (#56) — the app verifies LOCALLY with
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
// TRIAL (#61): on first launch — no key, no prior trial — we stamp
// `trialStartedAt` into the same license.json and grant full Pro for 14 days so
// a new user feels the workflow before the paywall. A paid key always outranks
// the trial; once it lapses the app drops to the free tier (report card stays
// free, an upgrade card appears). Re-trial prevention is the local timestamp
// only (issue non-goal) — activate/remove preserve it so buy→remove can't reset
// the clock, but there is no server-side tracking.
//
// This is a $9/mo product, not enterprise DRM — the design optimizes for zero
// friction for paying users, not for defeating a determined pirate.

import * as fs from 'fs';
import * as path from 'path';
import { createPublicKey, verify as cryptoVerify, KeyObject } from 'crypto';
import { app } from 'electron';
import { logWarn } from './logger';

/**
 * DEV public key — the production signing keypair replaces this before
 * checkout ships (key issuance is out of scope here, see #56, the Stripe
 * checkout + license provisioning webhook). Generate a pair + sign test keys
 * with scripts/license-keygen.mjs.
 * Override for tests/e2e via SOUND_BUDDY_LICENSE_PUBKEY (PEM, or base64 SPKI DER).
 */
const EMBEDDED_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEADAAF8d47qtdei8k1oP9b/7N8SlrhcABssKew3QBwUs8=
-----END PUBLIC KEY-----`;

/** Days a subscription key stays Pro after `expiresAt` (with a banner). */
export const GRACE_DAYS = 7;

/** Days of full Pro access granted by the first-launch trial (#61). */
export const TRIAL_DAYS = 14;

export const DAY_MS = 24 * 60 * 60 * 1000;

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
  status: 'none' | 'valid' | 'grace' | 'expired' | 'invalid' | 'trial' | 'trial-expired';
  kind?: LicenseKind;
  email?: string;
  expiresAt?: string;
  /** Present only while status === 'grace'. */
  graceEndsAt?: string;
  /** Present while status === 'trial' or 'trial-expired' (#61). */
  trialEndsAt?: string;
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

/** The parsed license.json — a paid key and/or a first-launch trial stamp. */
interface LicenseStore {
  key?: string;
  /** ISO 8601 timestamp of the first-launch trial start (#61). */
  trialStartedAt?: string;
}

/** Read license.json ({} when absent/unreadable/corrupt — never throws). */
function readStore(): LicenseStore {
  try {
    const p = licensePath();
    if (!fs.existsSync(p)) return {};
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as LicenseStore;
    if (parsed == null || typeof parsed !== 'object') return {};
    return {
      key: typeof parsed.key === 'string' ? parsed.key : undefined,
      trialStartedAt: typeof parsed.trialStartedAt === 'string' ? parsed.trialStartedAt : undefined,
    };
  } catch (err) {
    logWarn(`could not read license.json: ${String(err)}`);
    return {};
  }
}

/** Write license.json, dropping empty fields. Rethrows on failure. */
function writeStore(store: LicenseStore): void {
  const out: LicenseStore = {};
  if (store.key) out.key = store.key;
  if (store.trialStartedAt) out.trialStartedAt = store.trialStartedAt;
  fs.writeFileSync(licensePath(), JSON.stringify(out, null, 2));
}

/**
 * Trial is disabled only via a dev-only env override (tests/e2e) so a suite can
 * exercise the deterministic free tier — a shipped .app always offers it.
 */
function trialDisabled(): boolean {
  return !app.isPackaged && !!process.env.SOUND_BUDDY_DISABLE_TRIAL;
}

/** Resolve the trial state from a stored `trialStartedAt`, or null if none. */
function trialState(trialStartedAt: string | undefined, now: Date): LicenseState | null {
  if (!trialStartedAt || trialDisabled()) return null;
  const startMs = Date.parse(trialStartedAt);
  if (Number.isNaN(startMs)) return null; // corrupt stamp ⇒ ignore the trial
  const endMs = startMs + TRIAL_DAYS * DAY_MS;
  const trialEndsAt = new Date(endMs).toISOString();
  if (now.getTime() < endMs) return { tier: 'pro', status: 'trial', trialEndsAt };
  return { tier: 'free', status: 'trial-expired', trialEndsAt };
}

/**
 * The current license state, re-derived offline on every read. Precedence:
 * a paid key granting Pro (valid/grace) always wins; otherwise the first-launch
 * trial (active ⇒ Pro, lapsed ⇒ trial-expired free); otherwise a lapsed/invalid
 * key's messaging; otherwise free ({ status: 'none' }). The app works fully
 * unlicensed (report card only).
 */
export function getLicenseState(now: Date = new Date()): LicenseState {
  const store = readStore();
  const keyState = store.key ? verifyLicenseKey(store.key, now) : null;
  if (keyState && keyState.tier === 'pro') return keyState;

  const trial = trialState(store.trialStartedAt, now);
  if (trial) return trial;

  if (keyState) return keyState; // invalid/expired paid key — keep its messaging
  return { ...FREE_STATE };
}

/**
 * Start the first-launch trial (#61) if the user has neither a stored key nor a
 * prior trial stamp. Idempotent — a second launch (or a returning user) is a
 * no-op. Call once at app startup, before the renderer reads the license.
 * Never throws: a write failure just means the trial isn't offered this launch.
 */
export function ensureTrialStarted(now: Date = new Date()): LicenseState {
  if (!trialDisabled()) {
    const store = readStore();
    if (!store.key && !store.trialStartedAt) {
      try {
        writeStore({ ...store, trialStartedAt: now.toISOString() });
      } catch (err) {
        logWarn(`could not start trial (license.json write failed): ${String(err)}`);
      }
    }
  }
  return getLicenseState(now);
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
    // Preserve any trial stamp so buy→remove can't reset the trial clock (#61).
    writeStore({ ...readStore(), key: key.trim() });
  } catch (err) {
    logWarn(`could not write license.json: ${String(err)}`);
    throw err;
  }
  return state;
}

/**
 * Remove the stored key, reverting to whatever the key was masking — a still
 * active/expired trial (#61) or the free tier. User data is untouched. The
 * trial stamp is kept (re-trial prevention), so with no trial the file is
 * deleted outright; with one it's rewritten to just the stamp. Rethrows a
 * write/delete failure (EPERM/EBUSY — force only suppresses ENOENT) so the UI
 * can't report "removed" while the key is still stored.
 */
export function removeLicense(now: Date = new Date()): LicenseState {
  const { trialStartedAt } = readStore();
  try {
    if (trialStartedAt) writeStore({ trialStartedAt });
    else fs.rmSync(licensePath(), { force: true });
  } catch (err) {
    logWarn(`could not remove license.json: ${String(err)}`);
    throw err;
  }
  return getLicenseState(now);
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

/** The raw stored license key string, or undefined when none is stored. Used by
 *  license-refresh.ts (#117) to present the current credential to the Worker —
 *  the only place the app sends it anywhere. */
export function getStoredKey(): string | undefined {
  return readStore().key;
}
