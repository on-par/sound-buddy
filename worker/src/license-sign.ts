// Ed25519 SB1-format license signing (#109) — the Workers-runtime counterpart
// of scripts/license-keygen.mjs `sign` and app/electron/license.ts verify.
//
// The Worker mints keys shaped EXACTLY like the app expects:
//
//   SB1.<base64url(JSON.stringify(payload))>.<base64url(raw Ed25519 signature)>
//
// base64url = standard base64 with `+`→`-`, `/`→`_`, and no `=` padding —
// mirroring `b64url` in scripts/license-keygen.mjs and `fromBase64Url` in
// app/electron/license.ts, so a Worker-minted key verifies byte-for-byte
// against the app with zero app changes.
//
// The Workers runtime has no Node `crypto`, so everything here targets Web
// Crypto (SubtleCrypto): `importKey('pkcs8'|'spki', …, 'Ed25519', …)`,
// `sign('Ed25519', …)`, `verify('Ed25519', …)`. Ed25519 needs no digest — the
// algorithm implies it — matching license.ts's `crypto.verify(null, …)`.
//
// SECURITY (normative — 2026-07-08 keypair review): the signing key is imported
// with `extractable: false` and the PEM string must not be referenced after
// import. Never log key material, the raw private key, or minted `SB1.` strings.
// Log kid/jti/outcomes only (see #107 / index.ts logging rule).
//
// The SB1 codec, `kind` rules, and grace-window math are the isomorphic
// license *policy* (TD-006, #400) — single-sourced with
// app/electron/license.ts in @sound-buddy/license-policy. Only the Web Crypto
// signature step (Workers has no Node `crypto`) stays here.

import {
  KEY_PREFIX,
  GRACE_DAYS,
  decodeSb1Key,
  parsePayload,
  resolvePolicyState,
  isPolicyError,
  type LicenseKind,
  type LicensePayload,
  type PolicyState,
} from "@sound-buddy/license-policy";

export { GRACE_DAYS, type LicenseKind, type LicensePayload };

/** Issuer claim stamped into every minted payload (security review v2). */
export const LICENSE_ISSUER = "soundbuddy.online";

/** Inputs for minting a key. `issuedAt`/`jti` default to now / a fresh UUID. */
export interface MintParams {
  kind: LicenseKind;
  /** Signing-key id (v2). */
  kid: string;
  email?: string;
  /**
   * ISO 8601 expiry. Required for `subscription`; must be omitted for
   * `lifetime` (mint throws otherwise, so a lifetime key can never carry one).
   */
  expiresAt?: string;
  /** Stripe subscription id (v2) — `subscription` kind only. */
  sub?: string;
  /** Override the issued-at timestamp (default: now). */
  issuedAt?: string;
  /** Override the unique key id (default: crypto.randomUUID()). */
  jti?: string;
}

/** Result of verifying a key — an alias of the shared policy's result type
 * (tier is the single gating input; status is messaging detail), kept under
 * this name since it's the public API existing callers import. */
export type VerifyResult = PolicyState;

// --- base64 / PEM helpers (Web Crypto has no Buffer) --------------------------

/** Encode bytes as base64url: standard base64, `+`→`-`, `/`→`_`, no padding. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Strip PEM armor for `label` and decode the base64 body to DER bytes. */
function pemToDer(pem: string, label: string): Uint8Array {
  const body = pem
    .replace(`-----BEGIN ${label}-----`, "")
    .replace(`-----END ${label}-----`, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const der = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) der[i] = binary.charCodeAt(i);
  return der;
}

// --- key import ---------------------------------------------------------------

/**
 * Import the pkcs8 PEM signing secret (`LICENSE_SIGNING_PRIVATE_KEY`) as a
 * non-extractable Ed25519 signing key. The caller keeps only the returned
 * CryptoKey and drops the PEM — the key material can never be read back out.
 */
export function importSigningKey(pkcs8Pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    pemToDer(pkcs8Pem, "PRIVATE KEY"),
    "Ed25519",
    false,
    ["sign"],
  );
}

/**
 * Import an spki PEM public key as an Ed25519 verify key — the counterpart used
 * by {@link verifyLicenseKey} to prove format parity against a minted key.
 */
export function importVerifyKey(spkiPem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    pemToDer(spkiPem, "PUBLIC KEY"),
    "Ed25519",
    false,
    ["verify"],
  );
}

// --- mint ---------------------------------------------------------------------

/**
 * Mint a `SB1.` license key signed by `signingKey`.
 *
 * - `subscription` requires `expiresAt`; `lifetime` must NOT carry one.
 * - Stamps v2 claims: `kid`, a unique `jti`, `iss`, and (subscriptions) `sub`.
 * - Signature is over the exact payload bytes that ship in the key, so
 *   verification re-derives the same bytes and matches byte-for-byte.
 *
 * Never logs the returned string or any key material.
 */
export async function mintLicenseKey(
  signingKey: CryptoKey,
  params: MintParams,
): Promise<string> {
  if (params.kind === "subscription" && !params.expiresAt) {
    throw new Error("subscription license requires expiresAt");
  }
  if (params.kind === "lifetime" && params.expiresAt) {
    throw new Error("lifetime license must not carry expiresAt");
  }

  // Insertion order here is cosmetic (see LicensePayload doc) but kept stable.
  const payload: LicensePayload = {
    ...(params.email ? { email: params.email } : {}),
    kind: params.kind,
    issuedAt: params.issuedAt ?? new Date().toISOString(),
    ...(params.kind === "subscription" ? { expiresAt: params.expiresAt } : {}),
    kid: params.kid,
    jti: params.jti ?? crypto.randomUUID(),
    iss: LICENSE_ISSUER,
    ...(params.kind === "subscription" && params.sub ? { sub: params.sub } : {}),
  };

  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const signature = await crypto.subtle.sign("Ed25519", signingKey, payloadBytes);

  return `${KEY_PREFIX}.${toBase64Url(payloadBytes)}.${toBase64Url(new Uint8Array(signature))}`;
}

// --- hashing --------------------------------------------------------------

/** Lowercase-hex SHA-256 of a string, via Web Crypto (no Node `crypto`). */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// --- verify (parity helper) ---------------------------------------------------

function invalid(error: string): VerifyResult {
  return { tier: "free", status: "invalid", error };
}

/**
 * Verify a `SB1.` key's Ed25519 signature against `publicKey` and return its
 * parsed payload — or `null` on any format/encoding/signature failure. Unlike
 * {@link verifyLicenseKey} this does NOT gate on expiry: #113's refresh
 * endpoint must accept expired keys (that's exactly when refresh matters) and
 * needs `sub` from the payload, which `verifyLicenseKey`'s result omits.
 * Never throws.
 */
export async function verifySignedPayload(
  key: string,
  publicKey: CryptoKey,
): Promise<LicensePayload | null> {
  const decoded = decodeSb1Key(key);
  if (isPolicyError(decoded)) return null;

  let ok = false;
  try {
    ok = await crypto.subtle.verify("Ed25519", publicKey, decoded.sigBytes, decoded.payloadBytes);
  } catch {
    return null;
  }
  if (!ok) return null;

  const payload = parsePayload(decoded.payloadBytes);
  if (isPolicyError(payload)) return null;
  return payload;
}

/**
 * Verify a `SB1.` key against `publicKey` and resolve its state as of `now` —
 * a Web Crypto port of app/electron/license.ts `verifyLicenseKey`, used to
 * prove cross-tool format parity (a scripts/license-keygen.mjs key must verify
 * here, and a key minted here must verify there). Never throws; every failure
 * path resolves to `{ status: 'invalid' }`.
 */
export async function verifyLicenseKey(
  key: string,
  publicKey: CryptoKey,
  now: Date = new Date(),
): Promise<VerifyResult> {
  const decoded = decodeSb1Key(key);
  if (isPolicyError(decoded)) return invalid(decoded.error);

  let ok = false;
  try {
    ok = await crypto.subtle.verify("Ed25519", publicKey, decoded.sigBytes, decoded.payloadBytes);
  } catch {
    return invalid("Invalid signature");
  }
  if (!ok) return invalid("Invalid signature");

  const payload = parsePayload(decoded.payloadBytes);
  if (isPolicyError(payload)) return invalid(payload.error);

  return resolvePolicyState(payload, now);
}
