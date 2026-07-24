// `POST /api/waitlist` handler (#599) — receiving side for the marketing
// site's waitlist form (e18-02, not part of this story). Follows the same
// validate → rate-limit → redact → store pattern as `ingest.ts` (#475), but
// stores into a dedicated `WAITLIST_KV` namespace with an idempotent,
// non-expiring key per email rather than an append-only, TTL'd event log.

import { json } from "../http";
import { redactText } from "./ingest";
import { sendWaitlistConfirmationEmail, syncWaitlistContact } from "../delivery";
import type { Env } from "../index";

const MAX_BODY_BYTES = 4 * 1024; // waitlist bodies are tiny — email + short name
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 10; // per client IP per window — lower than ingest's 30, this is a single small form
export const MAX_EMAIL_LENGTH = 254;
const MAX_CHURCH_NAME_LENGTH = 100;
// same pattern as ingest.ts's CONTACT_EMAIL_PATTERN; exported so waitlist-invite.ts
// (#642) reuses it rather than duplicating.
export const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const ALLOWED_FIELDS = new Set(["email", "churchName"]);
// KV key prefix for a stored signup, keyed by lowercased email. Exported so
// waitlist-invite.ts (#642) shares this single source of truth instead of a
// second inline literal that could drift out of sync.
export const WAITLIST_KEY_PREFIX = "waitlist:";

export interface WaitlistSignup {
  email: string;
  churchName?: string;
}

/**
 * Lifecycle of a signup (#642). Written on every new row so the beta-invite
 * work does not have to backfill existing records: `waitlist` on signup,
 * `invited` once a beta invite goes out, `activated` once they run a build.
 */
export type WaitlistStatus = "waitlist" | "invited" | "activated";

export interface StoredWaitlistSignup {
  email: string;
  churchName?: string;
  signedUpAt: string;
  ip: string;
  status: WaitlistStatus;
  /** ISO timestamp stamped when the contact transitions to `invited` (#642). */
  invitedAt?: string;
}

/** Injectable seam so tests never depend on the wall clock or the network. */
export interface WaitlistDeps {
  now?: () => Date;
  fetch?: typeof fetch;
}

type ValidationResult =
  | { ok: true; signup: WaitlistSignup }
  | { ok: false; error: string; field?: string; status: number };

/** Exported so waitlist-invite.ts (#642) reuses it rather than duplicating. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Explicit hand-rolled validation of a waitlist signup body: non-object
 * guard, then an unknown-key allowlist, then field-level rules. On success
 * the signup is rebuilt field-by-field from the allowlist — the raw body is
 * never spread into the stored signup.
 */
function validateWaitlistSignup(body: unknown): ValidationResult {
  if (!isPlainObject(body)) {
    return { ok: false, error: "invalid_event", status: 400 };
  }

  for (const key of Object.keys(body)) {
    if (!ALLOWED_FIELDS.has(key)) {
      return { ok: false, error: "unknown_field", field: key, status: 400 };
    }
  }

  const email = body.email;
  if (
    typeof email !== "string" ||
    !email ||
    email.length > MAX_EMAIL_LENGTH ||
    !EMAIL_PATTERN.test(email)
  ) {
    return { ok: false, error: "invalid_field", field: "email", status: 400 };
  }

  const churchName = body.churchName;
  if (
    churchName !== undefined &&
    (typeof churchName !== "string" || churchName.length > MAX_CHURCH_NAME_LENGTH)
  ) {
    return { ok: false, error: "invalid_field", field: "churchName", status: 400 };
  }

  return {
    ok: true,
    signup: {
      email,
      ...(churchName !== undefined ? { churchName: churchName as string } : {}),
    },
  };
}

/** Resolves `true` when the request is within the per-client-IP rate limit.
 * Best-effort (KV has no atomic CAS), not a security boundary — mirrors
 * `withinRateLimit` in ingest.ts, keyed against a dedicated bucket. */
async function withinWaitlistRateLimit(env: Env, ip: string): Promise<boolean> {
  const key = `rl:waitlist:${ip}`;
  const current = await env.WAITLIST_KV.get(key);
  const count = current ? Number.parseInt(current, 10) : 0;
  if (count >= RATE_LIMIT_MAX_REQUESTS) return false;
  await env.WAITLIST_KV.put(key, String(count + 1), {
    expirationTtl: RATE_LIMIT_WINDOW_SECONDS,
  });
  return true;
}

/**
 * Handle `POST /api/waitlist`: bound + parse the body, rate-limit per client
 * IP, validate, redact PII in `churchName`, and store the accepted signup in
 * `WAITLIST_KV` keyed by lowercased email — idempotent, non-expiring (no
 * TTL), so a repeat signup simply overwrites the prior entry. No auth — the
 * marketing site form is an unauthenticated client; bounds are body size,
 * rate limit, and strict field validation.
 */
export async function handleWaitlistSignup(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  deps: WaitlistDeps = {},
): Promise<Response> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (!(await withinWaitlistRateLimit(env, ip))) {
    return json({ error: "rate_limited" }, 429);
  }

  const validated = validateWaitlistSignup(parsed);
  if (!validated.ok) {
    return json(
      { error: validated.error, ...(validated.field ? { field: validated.field } : {}) },
      validated.status,
    );
  }

  const { signup } = validated;
  const emailLower = signup.email.toLowerCase();
  const churchName = signup.churchName !== undefined ? redactText(signup.churchName) : undefined;
  const signedUpAt = (deps.now ?? (() => new Date()))().toISOString();
  const stored: StoredWaitlistSignup = {
    email: emailLower,
    ...(churchName !== undefined ? { churchName } : {}),
    signedUpAt,
    ip,
    status: "waitlist",
  };

  try {
    await env.WAITLIST_KV.put(`${WAITLIST_KEY_PREFIX}${emailLower}`, JSON.stringify(stored));
  } catch {
    return json({ error: "server_error" }, 500);
  }

  // Storage above is the source of truth and has already succeeded. The
  // confirmation email (#639) and Audience sync (#640) are deferred to
  // `waitUntil` so neither latency nor a Resend outage can turn a stored
  // signup into a user-visible failure. Both senders swallow their own errors.
  const deliveryDeps = deps.fetch ? { fetch: deps.fetch } : {};
  ctx.waitUntil(sendWaitlistConfirmationEmail(env, { to: emailLower }, deliveryDeps));
  ctx.waitUntil(
    syncWaitlistContact(env, { email: emailLower, ...(churchName ? { churchName } : {}) }, deliveryDeps),
  );

  return json({ status: "ok" }, 200);
}
