// `POST /api/waitlist/invite` + `GET /api/waitlist/invitees` handlers (#642) —
// admin-authenticated invite path off the waitlist: list contacts still in
// `waitlist` status (the segment an invite Broadcast targets) and mark
// contacts `invited` so they are excluded from every subsequent selection. KV
// stays the source of truth; the invite email itself remains a manually-sent
// Resend Broadcast and is out of scope.
//
// SECURITY: never log emails, tokens, or KV values — outcomes/counts only.

import { json } from "../http";
import { sha256Hex } from "../license-sign";
import {
  EMAIL_PATTERN,
  isPlainObject,
  MAX_EMAIL_LENGTH,
  WAITLIST_KEY_PREFIX,
  type StoredWaitlistSignup,
} from "./waitlist";
import type { Env } from "../index";

const MAX_BODY_BYTES = 64 * 1024; // an invite batch is a list of emails — far below this
const MAX_INVITE_BATCH = 200; // per-call cap; also bounds KV writes per request
const BEARER_PREFIX = "Bearer ";

/** Injectable seam so tests never depend on the wall clock. */
export interface WaitlistInviteDeps {
  now?: () => Date;
}

/**
 * Constant-time-ish shared-secret check: compares SHA-256 digests via
 * sha256Hex so a plain string compare never touches the raw token. Unset
 * WAITLIST_ADMIN_TOKEN disables the admin endpoints entirely (always false);
 * the console.error tells the operator what to configure.
 */
export async function isAdminAuthorized(request: Request, env: Env): Promise<boolean> {
  if (!env.WAITLIST_ADMIN_TOKEN) {
    console.error(
      "waitlist admin: WAITLIST_ADMIN_TOKEN not configured — set it with `wrangler secret put WAITLIST_ADMIN_TOKEN`",
    );
    return false;
  }

  const header = request.headers.get("Authorization");
  if (!header || !header.startsWith(BEARER_PREFIX)) {
    return false;
  }

  const presented = header.slice(BEARER_PREFIX.length);
  return (await sha256Hex(presented)) === (await sha256Hex(env.WAITLIST_ADMIN_TOKEN));
}

type InviteValidationResult =
  | { ok: true; emails: string[] }
  | { ok: false; error: string; field?: string; status: number };

/**
 * Hand-rolled validation mirroring `validateWaitlistSignup`'s shape: non-object
 * guard, then an unknown-key allowlist, then field-level rules for `emails`.
 */
function validateInviteBody(body: unknown): InviteValidationResult {
  if (!isPlainObject(body)) {
    return { ok: false, error: "invalid_event", status: 400 };
  }

  for (const key of Object.keys(body)) {
    if (key !== "emails") {
      return { ok: false, error: "unknown_field", field: key, status: 400 };
    }
  }

  const emails = body.emails;
  const isValidEmailList =
    Array.isArray(emails) &&
    emails.length >= 1 &&
    emails.length <= MAX_INVITE_BATCH &&
    emails.every(
      (email) =>
        typeof email === "string" &&
        email.length > 0 &&
        email.length <= MAX_EMAIL_LENGTH &&
        EMAIL_PATTERN.test(email),
    );

  if (!isValidEmailList) {
    return { ok: false, error: "invalid_field", field: "emails", status: 400 };
  }

  return { ok: true, emails: emails as string[] };
}

type InviteOutcome = "invited" | "skipped" | "not_found" | "error";

interface InviteResult {
  email: string;
  outcome: InviteOutcome;
  status?: string;
}

/**
 * Handle `POST /api/waitlist/invite`: admin-authenticated, marks each
 * presented email `invited` if (and only if) it is currently `waitlist` —
 * every other status is left untouched (`skipped`), which is the guarantee
 * that a re-run invite never re-transitions a contact.
 */
export async function handleInvite(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  deps: WaitlistInviteDeps = {},
): Promise<Response> {
  if (!(await isAdminAuthorized(request, env))) {
    return json({ error: "unauthorized" }, 401);
  }

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

  const validated = validateInviteBody(parsed);
  if (!validated.ok) {
    return json(
      { error: validated.error, ...(validated.field ? { field: validated.field } : {}) },
      validated.status,
    );
  }

  // Read once for the whole batch — every contact invited in the same call
  // gets the same invitedAt, matching the "invited together" intent.
  const invitedAt = (deps.now ?? (() => new Date()))().toISOString();
  const results: InviteResult[] = [];

  for (const email of validated.emails) {
    const emailLower = email.toLowerCase();
    const key = `${WAITLIST_KEY_PREFIX}${emailLower}`;

    let raw: string | null;
    try {
      raw = await env.WAITLIST_KV.get(key);
    } catch {
      results.push({ email: emailLower, outcome: "error" });
      continue;
    }
    if (raw === null) {
      results.push({ email: emailLower, outcome: "not_found" });
      continue;
    }

    let record: StoredWaitlistSignup;
    try {
      record = JSON.parse(raw) as StoredWaitlistSignup;
    } catch {
      results.push({ email: emailLower, outcome: "error" });
      continue;
    }

    if (record.status !== "waitlist") {
      results.push({ email: emailLower, outcome: "skipped", status: record.status });
      continue;
    }

    const updated: StoredWaitlistSignup = {
      ...record,
      status: "invited",
      invitedAt,
    };
    try {
      await env.WAITLIST_KV.put(key, JSON.stringify(updated));
    } catch {
      results.push({ email: emailLower, outcome: "error" });
      continue;
    }
    results.push({ email: emailLower, outcome: "invited" });
  }

  return json({ results }, 200);
}

interface Invitee {
  email: string;
  signedUpAt: string;
  churchName?: string;
}

/**
 * Handle `GET /api/waitlist/invitees`: admin-authenticated list of contacts
 * still in `waitlist` status — the segment an invite Broadcast targets. Never
 * returns `ip`.
 */
export async function handleListInvitees(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  if (!(await isAdminAuthorized(request, env))) {
    return json({ error: "unauthorized" }, 401);
  }

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");

  let list;
  try {
    list = await env.WAITLIST_KV.list({
      prefix: WAITLIST_KEY_PREFIX,
      ...(cursor ? { cursor } : {}),
    });
  } catch {
    return json({ error: "server_error" }, 500);
  }

  // Per-key reads are isolated from the list() call above: a transient read
  // failure or an unparseable row skips just that key rather than discarding
  // every invitee already gathered from the page.
  const invitees: Invitee[] = [];
  for (const key of list.keys) {
    let raw: string | null;
    try {
      raw = await env.WAITLIST_KV.get(key.name);
    } catch {
      continue;
    }
    if (raw === null) continue;

    let record: StoredWaitlistSignup;
    try {
      record = JSON.parse(raw) as StoredWaitlistSignup;
    } catch {
      continue;
    }

    if (record.status !== "waitlist") continue;
    invitees.push({
      email: record.email,
      signedUpAt: record.signedUpAt,
      ...(record.churchName !== undefined ? { churchName: record.churchName } : {}),
    });
  }

  return json(
    {
      invitees,
      complete: list.list_complete,
      ...(list.list_complete ? {} : { cursor: list.cursor }),
    },
    200,
  );
}
