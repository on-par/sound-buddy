// Isomorphic Sound Buddy license *policy* (TD-006, #400): the drift-prone SB1
// structural parse, base64url codec, payload validation, `kind` rules, and
// `GRACE_DAYS` grace-window math — single-sourced for both
// `app/electron/license.ts` (Node `crypto.verify`) and
// `worker/src/license-sign.ts` (Web Crypto `crypto.subtle.verify`).
//
// Deliberately dependency-free: no `crypto`, no `Buffer`, no `atob`/`btoa`, no
// Electron. Signature verification is NOT this module's concern — it stays
// per-runtime and is injected by each adapter; every function here assumes a
// signature (if any) has already been checked by the caller.

/** Key format version prefix. */
export const KEY_PREFIX = 'SB1';

/** Days a subscription key stays Pro after `expiresAt` (with a banner). */
export const GRACE_DAYS = 7;

export const DAY_MS = 24 * 60 * 60 * 1000;

export type LicenseKind = 'subscription' | 'lifetime';

/** Signed payload. v2 claims (kid/jti/iss/sub) are informational — never gated. */
export interface LicensePayload {
  email?: string;
  kind: LicenseKind;
  issuedAt?: string;
  expiresAt?: string;
  kid?: string;
  jti?: string;
  iss?: string;
  sub?: string;
}

/** Policy result — the interop subset shared by app LicenseState & worker VerifyResult. */
export interface PolicyState {
  tier: 'free' | 'pro';
  status: 'valid' | 'grace' | 'expired' | 'invalid';
  kind?: LicenseKind;
  email?: string;
  expiresAt?: string;
  /** Present only while status === 'grace'. */
  graceEndsAt?: string;
  /** Human-readable reason when status === 'invalid'. */
  error?: string;
}

export interface DecodedKey {
  payloadBytes: Uint8Array;
  sigBytes: Uint8Array;
}

export interface PolicyError {
  error: string;
}

/** True if `x` is a {@link PolicyError} rather than a successful result. */
export function isPolicyError(x: unknown): x is PolicyError {
  return typeof x === 'object' && x !== null && 'error' in x;
}

// --- base64url (no padding) — no atob/btoa/Buffer, so this runs identically
// in Node and Workers. -------------------------------------------------------

const BASE64URL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const BASE64URL_REVERSE: Record<string, number> = {};
for (let i = 0; i < BASE64URL_CHARS.length; i++) BASE64URL_REVERSE[BASE64URL_CHARS[i]] = i;

/** Encode bytes as base64url: standard base64 alphabet variant, no padding. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let result = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    result +=
      BASE64URL_CHARS[(n >> 18) & 63] +
      BASE64URL_CHARS[(n >> 12) & 63] +
      BASE64URL_CHARS[(n >> 6) & 63] +
      BASE64URL_CHARS[n & 63];
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const n = bytes[i] << 16;
    result += BASE64URL_CHARS[(n >> 18) & 63] + BASE64URL_CHARS[(n >> 12) & 63];
  } else if (remaining === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    result +=
      BASE64URL_CHARS[(n >> 18) & 63] + BASE64URL_CHARS[(n >> 12) & 63] + BASE64URL_CHARS[(n >> 6) & 63];
  }
  return result;
}

/** Decode a base64url string (no padding) back to bytes. Throws on invalid characters. */
export function base64UrlToBytes(s: string): Uint8Array {
  const len = s.length;
  const outLen = Math.floor((len * 6) / 8);
  const bytes = new Uint8Array(outLen);
  let bitBuffer = 0;
  let bitCount = 0;
  let outIndex = 0;
  for (let i = 0; i < len; i++) {
    const code = BASE64URL_REVERSE[s[i]];
    if (code === undefined) throw new Error(`Invalid base64url character: ${JSON.stringify(s[i])}`);
    bitBuffer = (bitBuffer << 6) | code;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes[outIndex++] = (bitBuffer >> bitCount) & 0xff;
    }
  }
  return bytes;
}

// --- structural decode / payload parse --------------------------------------

/** Structural SB1 parse — split, prefix + arity check, base64url-decode. NO signature check. */
export function decodeSb1Key(key: string): DecodedKey | PolicyError {
  // key is typed string, but callers across the app/worker boundary aren't
  // always TS — the non-string branch is unreachable from any test here.
  /* c8 ignore next */
  const trimmed = typeof key === 'string' ? key.trim() : '';
  if (!trimmed) return { error: 'Empty license key' };

  const parts = trimmed.split('.');
  if (parts.length !== 3 || parts[0] !== KEY_PREFIX) {
    return { error: 'Not a Sound Buddy license key' };
  }

  try {
    return { payloadBytes: base64UrlToBytes(parts[1]), sigBytes: base64UrlToBytes(parts[2]) };
  } catch {
    return { error: 'Corrupt license encoding' };
  }
}

/** Parse + validate the decoded payload bytes as a {@link LicensePayload}. */
export function parsePayload(payloadBytes: Uint8Array): LicensePayload | PolicyError {
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return { error: 'Corrupt license payload' };
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { error: 'Corrupt license payload' };
  }
  return payload as LicensePayload;
}

// --- policy resolution -------------------------------------------------------

/**
 * The drift-prone core: resolve a validated {@link LicensePayload} into a
 * {@link PolicyState} as of `now`. Assumes the signature is ALREADY verified
 * by the caller — this function has no crypto dependency at all.
 */
export function resolvePolicyState(payload: LicensePayload, now: Date): PolicyState {
  const base = {
    kind: payload.kind,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    expiresAt: typeof payload.expiresAt === 'string' ? payload.expiresAt : undefined,
  };

  // Lifetime keys (#90) never expire — skip expiry and grace entirely.
  if (payload.kind === 'lifetime') {
    return { tier: 'pro', status: 'valid', ...base, expiresAt: undefined };
  }
  if (payload.kind !== 'subscription') {
    return { tier: 'free', status: 'invalid', error: 'Unknown license kind' };
  }

  const expiresMs = Date.parse(base.expiresAt ?? '');
  if (Number.isNaN(expiresMs)) {
    return { tier: 'free', status: 'invalid', error: 'License has no valid expiry' };
  }

  if (now.getTime() < expiresMs) return { tier: 'pro', status: 'valid', ...base };

  const graceEndsMs = expiresMs + GRACE_DAYS * DAY_MS;
  if (now.getTime() < graceEndsMs) {
    return { tier: 'pro', status: 'grace', ...base, graceEndsAt: new Date(graceEndsMs).toISOString() };
  }
  return { tier: 'free', status: 'expired', ...base };
}
