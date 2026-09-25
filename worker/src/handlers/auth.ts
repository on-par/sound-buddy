// `POST /api/auth/start`, `POST /api/auth/verify`, `GET /api/auth/session`
// handlers (#1525) — email one-time-code sign-in for the Free web tier. No
// passwords, magic links, or third-party identity providers: a 6-digit code
// is emailed via Resend and traded for an opaque session cookie. Records live
// in the existing WAITLIST_KV under an `auth:` prefix (see ADR in
// .factory/state/plans/issue-1525.md) rather than a dedicated namespace, since
// the factory cannot provision new Cloudflare KV bindings out-of-band.
//
// SECURITY (normative): KV never holds a plaintext code or session token —
// only SHA-256 hashes. Never log emails, codes, or tokens; logs are
// outcome/status only, matching delivery.ts.

import { json } from "../http";
import { sha256Hex } from "../license-sign";
import { sendSignInCodeEmail } from "../delivery";
import { EMAIL_PATTERN, isPlainObject, MAX_EMAIL_LENGTH } from "./waitlist";
import type { Env } from "../index";

export const AUTH_OTP_PREFIX = "auth:otp:";
export const AUTH_SESSION_PREFIX = "auth:session:";
export const AUTH_RATE_PREFIX = "rl:auth:";
export const SESSION_COOKIE_NAME = "sb_session";
export const OTP_TTL_SECONDS = 600;
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_DIGITS = 6;
const MAX_BODY_BYTES = 4 * 1024;
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 5;

const CODE_PATTERN = /^\d{6}$/;

export interface AuthSession {
  email: string;
  createdAt: string;
}

/** Injectable seam so tests never depend on the wall clock, the network, or
 * real randomness. */
export interface AuthDeps {
  now?: () => Date;
  fetch?: typeof fetch;
  /** Default: crypto.getRandomValues -> zero-padded 6 digits. */
  randomCode?: () => string;
  /** Default: 32 random bytes, base64url. */
  randomToken?: () => string;
}

interface StoredOtp {
  codeHash: string;
  attempts: number;
}

function defaultRandomCode(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(array[0] % 10 ** OTP_DIGITS).padStart(OTP_DIGITS, "0");
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function defaultRandomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

type ParsedBody =
  | { ok: true; body: unknown }
  | { ok: false; status: number; error: string };

/** Body-size bound + JSON.parse, same as waitlist.ts. */
async function parseJsonBody(request: Request): Promise<ParsedBody> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return { ok: false, status: 413, error: "payload_too_large" };
  }
  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, status: 400, error: "invalid_json" };
  }
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = part.slice(0, separatorIndex).trim();
    if (key !== name) continue;
    const value = part.slice(separatorIndex + 1).trim();
    return value || null;
  }
  return null;
}

/** Best-effort (KV has no atomic CAS), not a security boundary — copy of
 * `withinWaitlistRateLimit` against a caller-supplied `rl:auth:` bucket. */
async function withinRateLimit(env: Env, key: string): Promise<boolean> {
  const current = await env.WAITLIST_KV.get(key);
  const count = current ? Number.parseInt(current, 10) : 0;
  if (count >= RATE_LIMIT_MAX_REQUESTS) return false;
  await env.WAITLIST_KV.put(key, String(count + 1), {
    expirationTtl: RATE_LIMIT_WINDOW_SECONDS,
  });
  return true;
}

function sessionCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=${SESSION_TTL_SECONDS}`;
}

function validateEmailField(body: Record<string, unknown>): { ok: true; email: string } | { ok: false; res: Response } {
  const email = body.email;
  if (
    typeof email !== "string" ||
    !email ||
    email.length > MAX_EMAIL_LENGTH ||
    !EMAIL_PATTERN.test(email)
  ) {
    return { ok: false, res: json({ error: "invalid_field", field: "email" }, 400) };
  }
  return { ok: true, email: email.toLowerCase() };
}

/**
 * Handle `POST /api/auth/start`: validate + rate-limit (per IP and per
 * email), generate a 6-digit code, store only its hash with a 10-minute TTL,
 * and hand the plaintext code to Resend via `ctx.waitUntil` — never returns
 * whether the email has signed in before (no account enumeration).
 */
export async function handleAuthStart(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  deps: AuthDeps = {},
): Promise<Response> {
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  if (!isPlainObject(parsed.body)) return json({ error: "invalid_event" }, 400);

  for (const key of Object.keys(parsed.body)) {
    if (key !== "email") return json({ error: "unknown_field", field: key }, 400);
  }

  const validated = validateEmailField(parsed.body);
  if (!validated.ok) return validated.res;
  const emailLower = validated.email;

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (!(await withinRateLimit(env, `${AUTH_RATE_PREFIX}start:ip:${ip}`))) {
    return json({ error: "rate_limited" }, 429);
  }
  if (!(await withinRateLimit(env, `${AUTH_RATE_PREFIX}start:email:${emailLower}`))) {
    return json({ error: "rate_limited" }, 429);
  }

  const code = (deps.randomCode ?? defaultRandomCode)();
  const stored: StoredOtp = { codeHash: await sha256Hex(code), attempts: 0 };

  try {
    await env.WAITLIST_KV.put(`${AUTH_OTP_PREFIX}${emailLower}`, JSON.stringify(stored), {
      expirationTtl: OTP_TTL_SECONDS,
    });
  } catch {
    return json({ error: "server_error" }, 500);
  }

  const deliveryDeps = deps.fetch ? { fetch: deps.fetch } : {};
  ctx.waitUntil(sendSignInCodeEmail(env, { to: emailLower, code }, deliveryDeps));

  return json({ status: "ok" }, 200);
}

/**
 * Handle `POST /api/auth/verify`: validate + rate-limit (per IP), compare the
 * presented code's hash against the stored OTP record, burn the code after
 * `OTP_MAX_ATTEMPTS` wrong guesses, and on a match issue a random opaque
 * session token (hashed in KV) with a 30-day TTL.
 */
export async function handleAuthVerify(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  deps: AuthDeps = {},
): Promise<Response> {
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  if (!isPlainObject(parsed.body)) return json({ error: "invalid_event" }, 400);

  for (const key of Object.keys(parsed.body)) {
    if (key !== "email" && key !== "code") return json({ error: "unknown_field", field: key }, 400);
  }

  const validated = validateEmailField(parsed.body);
  if (!validated.ok) return validated.res;
  const emailLower = validated.email;

  const code = parsed.body.code;
  if (typeof code !== "string" || !CODE_PATTERN.test(code)) {
    return json({ error: "invalid_field", field: "code" }, 400);
  }

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (!(await withinRateLimit(env, `${AUTH_RATE_PREFIX}verify:ip:${ip}`))) {
    return json({ error: "rate_limited" }, 429);
  }

  const otpKey = `${AUTH_OTP_PREFIX}${emailLower}`;
  let raw: string | null;
  try {
    raw = await env.WAITLIST_KV.get(otpKey);
  } catch {
    raw = null;
  }
  if (raw === null) {
    return json({ error: "invalid_code" }, 401);
  }

  let stored: StoredOtp;
  try {
    stored = JSON.parse(raw) as StoredOtp;
  } catch {
    return json({ error: "invalid_code" }, 401);
  }

  const presentedHash = await sha256Hex(code);
  if (presentedHash !== stored.codeHash) {
    const attempts = stored.attempts + 1;
    if (attempts >= OTP_MAX_ATTEMPTS) {
      await env.WAITLIST_KV.delete(otpKey);
    } else {
      await env.WAITLIST_KV.put(otpKey, JSON.stringify({ ...stored, attempts }), {
        expirationTtl: OTP_TTL_SECONDS,
      });
    }
    return json({ error: "invalid_code" }, 401);
  }

  // Single-use: delete before issuing the session so a replayed request (or a
  // second tab racing the same code) can never mint a second session.
  await env.WAITLIST_KV.delete(otpKey);

  const token = (deps.randomToken ?? defaultRandomToken)();
  const createdAt = (deps.now ?? (() => new Date()))().toISOString();
  const session: AuthSession = { email: emailLower, createdAt };
  await env.WAITLIST_KV.put(`${AUTH_SESSION_PREFIX}${await sha256Hex(token)}`, JSON.stringify(session), {
    expirationTtl: SESSION_TTL_SECONDS,
  });

  return json({ signedIn: true, email: emailLower }, 200, { "set-cookie": sessionCookie(token) });
}

/**
 * Resolve the caller's session from the `sb_session` cookie. The one function
 * any Free-tier endpoint (starting with #1526's upload guard) uses to decide
 * who the caller is. Fails to signed-out (`null`) on any KV error or
 * malformed record — never a 500, so a KV blip degrades to "please sign in"
 * rather than a hard failure.
 */
export async function readSession(request: Request, env: Env): Promise<AuthSession | null> {
  const token = readCookie(request, SESSION_COOKIE_NAME);
  if (!token) return null;

  let raw: string | null;
  try {
    raw = await env.WAITLIST_KV.get(`${AUTH_SESSION_PREFIX}${await sha256Hex(token)}`);
  } catch {
    return null;
  }
  if (raw === null) return null;

  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

/** Handle `GET /api/auth/session`: 200 when the cookie resolves to a live
 * session, 401 otherwise. Never cached — a stale 200 would keep a signed-out
 * visitor looking signed in after they sign out on another tab. */
export async function handleAuthSession(request: Request, env: Env): Promise<Response> {
  const session = await readSession(request, env);
  if (!session) {
    return json({ signedIn: false }, 401, { "cache-control": "no-store" });
  }
  return json({ signedIn: true, email: session.email }, 200, { "cache-control": "no-store" });
}
