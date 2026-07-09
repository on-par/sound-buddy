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

/** Key format version prefix. Bump only on a breaking payload/signature change. */
const KEY_PREFIX = "SB1";

/** Issuer claim stamped into every minted payload (security review v2). */
export const LICENSE_ISSUER = "soundbuddy.online";

/** Days a subscription key stays Pro after `expiresAt` — mirrors license.ts. */
export const GRACE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export type LicenseKind = "subscription" | "lifetime";

/**
 * The signed payload (v2). Field order is irrelevant to interop — the app
 * verifies the signature over the transmitted bytes, then re-parses — but
 * JSON.stringify fixes insertion order here for stable, testable output.
 *
 * Verification everywhere stays tolerant of unknown/missing fields: the v2
 * claims (kid/jti/iss/sub) are informational and never gate `verifyLicenseKey`,
 * so a v1 key from scripts/license-keygen.mjs still verifies.
 */
export interface LicensePayload {
  email?: string;
  kind: LicenseKind;
  /** ISO 8601. */
  issuedAt: string;
  /** ISO 8601; present for `subscription`, absent for `lifetime`. */
  expiresAt?: string;
  /** Signing-key id — lets the app rotate keys without re-issuing everything. */
  kid: string;
  /** Unique per minted key (jwt-style id) — enables per-key revocation later. */
  jti: string;
  /** Issuer. Always {@link LICENSE_ISSUER}. */
  iss: string;
  /** Stripe subscription id — `subscription` kind only. */
  sub?: string;
}

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

/** Result of verifying a key — the interop-relevant subset of license.ts's
 * LicenseState (tier is the single gating input; status is messaging detail). */
export interface VerifyResult {
  tier: "free" | "pro";
  status: "valid" | "grace" | "expired" | "invalid";
  kind?: LicenseKind;
  email?: string;
  expiresAt?: string;
  /** Present only while status === 'grace'. */
  graceEndsAt?: string;
  /** Human-readable reason when status === 'invalid'. */
  error?: string;
}

// --- base64 / PEM helpers (Web Crypto has no Buffer) --------------------------

/** Encode bytes as base64url: standard base64, `+`→`-`, `/`→`_`, no padding. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decode a base64url string (padding optional) back to bytes. */
function fromBase64Url(s: string): Uint8Array {
  const binary = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
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

// --- verify (parity helper) ---------------------------------------------------

function invalid(error: string): VerifyResult {
  return { tier: "free", status: "invalid", error };
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
  const trimmed = typeof key === "string" ? key.trim() : "";
  if (!trimmed) return invalid("Empty license key");

  const parts = trimmed.split(".");
  if (parts.length !== 3 || parts[0] !== KEY_PREFIX) {
    return invalid("Not a Sound Buddy license key");
  }

  let payloadBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    payloadBytes = fromBase64Url(parts[1]);
    sigBytes = fromBase64Url(parts[2]);
  } catch {
    return invalid("Corrupt license encoding");
  }

  let ok = false;
  try {
    ok = await crypto.subtle.verify("Ed25519", publicKey, sigBytes, payloadBytes);
  } catch {
    return invalid("Invalid signature");
  }
  if (!ok) return invalid("Invalid signature");

  let payload: LicensePayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as LicensePayload;
  } catch {
    return invalid("Corrupt license payload");
  }
  if (payload == null || typeof payload !== "object") {
    return invalid("Corrupt license payload");
  }

  const base = {
    kind: payload.kind,
    email: typeof payload.email === "string" ? payload.email : undefined,
    expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : undefined,
  };

  // Lifetime keys never expire — skip expiry and grace entirely.
  if (payload.kind === "lifetime") {
    return { tier: "pro", status: "valid", ...base, expiresAt: undefined };
  }
  if (payload.kind !== "subscription") return invalid("Unknown license kind");

  const expiresMs = Date.parse(base.expiresAt ?? "");
  if (Number.isNaN(expiresMs)) return invalid("License has no valid expiry");

  if (now.getTime() < expiresMs) return { tier: "pro", status: "valid", ...base };

  const graceEndsMs = expiresMs + GRACE_DAYS * DAY_MS;
  if (now.getTime() < graceEndsMs) {
    return {
      tier: "pro",
      status: "grace",
      ...base,
      graceEndsAt: new Date(graceEndsMs).toISOString(),
    };
  }
  return { tier: "free", status: "expired", ...base };
}
