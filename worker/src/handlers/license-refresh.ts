// `POST /api/license/refresh` handler (#113) — seamless renewal: a subscriber's
// app hands the Worker its current (or recently expired) signed key and gets
// back the latest valid key. The signed key IS the credential (unforgeable,
// no accounts) — the Worker verifies its Ed25519 signature, reads `sub` from
// the verified payload, gates the subscription as active at Stripe, and mints
// a fresh key on read (sign-on-demand — KV never stores signed keys).
//
// SECURITY (normative — 2026-07-08 keypair security review, approved by
// Patrick): ordering is the security contract — do not reorder.
//   1. Verify the presented key's signature BEFORE reading `sub`. An
//      unverified/forged payload must never drive a KV or Stripe lookup.
//   2. Supersede check: the presented key's hash must equal
//      `sub:<id>.latestKeyHash`. A non-latest (superseded) key is refused —
//      each refresh invalidates all previously issued copies as refresh
//      credentials, so a leaked key goes dead at the owner's next refresh.
//   3. Gate on Stripe (entitlement source of truth) — sign-on-demand never
//      trusts KV for entitlement, only for the supersede check above.
//
// CROSS-STORY NOTE (see PR body): #110's `invoice.paid` rotates
// `latestKeyHash` on every renewal. If a renewal has already rotated the hash
// to a key the app never received, step 2 refuses the app's presented key —
// which would defeat the "renewals are invisible" goal end-to-end. This PR
// implements the normative hardened spec as written and does NOT modify
// `invoice-paid.ts`; the interaction is a follow-up decision for Patrick.
//
// SECURITY: never log the presented or minted `SB1.` string, key material,
// email, or KV values. Log outcomes only.

import Stripe from "stripe";
import type { Env } from "../index";
import { json } from "../http";
import {
  importSigningKey,
  importVerifyKey,
  mintLicenseKey,
  sha256Hex,
  verifySignedPayload,
} from "../license-sign";
import { subscriptionRecordKey, type SubscriptionRecord } from "./invoice-paid";

/** Injectable seams so tests never hit the live Stripe API or wall clock. */
export interface RefreshDeps {
  /** Build the Stripe client used to look up the subscription. */
  getStripe?: (env: Env) => Stripe;
  /** Current time, for the staleness/rate-limit checks. Defaults to `new Date()`. */
  now?: () => Date;
}

/** Default Stripe client for the Workers runtime (fetch-based HTTP). */
function defaultStripe(env: Env): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });
}

/**
 * Furthest-out `current_period_end` (unix seconds) across a subscription's
 * items — matching invoice-paid.ts/license.ts's copy so a refresh reports the
 * same period end the webhook path would mint.
 */
function periodEndFromSubscription(
  subscription: Stripe.Subscription,
): number | undefined {
  let latest: number | undefined;
  for (const item of subscription.items?.data ?? []) {
    const end = item.current_period_end;
    if (typeof end === "number" && (latest === undefined || end > latest)) {
      latest = end;
    }
  }
  return latest;
}

/** Subscription statuses that entitle the customer to a Pro key right now. */
const ENTITLED_SUBSCRIPTION_STATUSES = new Set<Stripe.Subscription.Status>([
  "active",
  "trialing",
  "past_due",
]);

/** Longest presented key string this endpoint will run crypto over — bounds an
 * attacker-supplied string before any signature verification. */
const MAX_KEY_LENGTH = 4096;

/** How far past `expiresAt` a presented key is still eligible for refresh —
 * beyond this the credential is treated as stale and the user is directed to
 * the Customer Portal / email instead. */
const STALE_AFTER_MS = 60 * 24 * 60 * 60 * 1000;

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 20;

/** Resolves `true` when the request is within the per-subscription rate limit.
 * Best-effort (KV has no atomic CAS) — not a security boundary, just keeps the
 * endpoint boring. */
async function withinRateLimit(env: Env, sub: string): Promise<boolean> {
  const key = `rl:refresh:${sub}`;
  const current = await env.LICENSE_KV.get(key);
  const count = current ? Number.parseInt(current, 10) : 0;
  if (count >= RATE_LIMIT_MAX_REQUESTS) return false;
  await env.LICENSE_KV.put(key, String(count + 1), {
    expirationTtl: RATE_LIMIT_WINDOW_SECONDS,
  });
  return true;
}

/**
 * Handle `POST /api/license/refresh` with body `{ key: "SB1...." }`: verify
 * the presented key's signature, confirm it is the latest issued key for its
 * subscription, re-gate entitlement at Stripe, and mint+return a fresh key.
 *
 * Never returns Stripe object details, key material, or email on a refusal
 * path.
 */
export async function handleRefreshLicense(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  deps: RefreshDeps = {},
): Promise<Response> {
  // 1. Parse + bound the body. No KV/Stripe touched on this path.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "missing_key" }, 400);
  }
  const presentedKey =
    body != null && typeof body === "object" && "key" in body
      ? (body as { key: unknown }).key
      : undefined;
  if (
    typeof presentedKey !== "string" ||
    !presentedKey ||
    presentedKey.length > MAX_KEY_LENGTH
  ) {
    return json({ error: "missing_key" }, 400);
  }

  // 2. Verify the signature BEFORE reading `sub`. No KV/Stripe call has
  // happened yet — an unverified/forged payload never drives a lookup.
  const verifyKey = await importVerifyKey(env.LICENSE_PUBLIC_KEY);
  const payload = await verifySignedPayload(presentedKey, verifyKey);
  if (!payload) {
    return json({ error: "invalid_signature" }, 401);
  }

  // 3. Lifetime keys never expire — nothing to refresh.
  if (payload.kind === "lifetime") {
    return json({ status: "lifetime" }, 200);
  }

  // 4. A real #110 subscription key always carries `sub`.
  if (payload.kind !== "subscription" || !payload.sub) {
    return json({ error: "no-active-subscription" }, 403);
  }
  const sub = payload.sub;

  // 5. Stale bound: accept any past expiresAt within the 60-day window — that
  // is exactly when refresh is needed — but refuse further-stale credentials.
  const now = (deps.now ?? (() => new Date()))();
  const expiresMs = typeof payload.expiresAt === "string" ? Date.parse(payload.expiresAt) : NaN;
  if (!Number.isNaN(expiresMs) && now.getTime() - expiresMs > STALE_AFTER_MS) {
    return json({ error: "expired_too_long" }, 410);
  }

  // 6. Rate-limit per sub. Now that the signature is verified, this KV write
  // is attacker-bounded to real subscription ids.
  if (!(await withinRateLimit(env, sub))) {
    return json({ error: "rate_limited" }, 429);
  }

  // 7. Supersede check: the presented key's hash must equal the recorded
  // latest key's hash. No record (KV/eventing gap) → nothing to compare
  // against, proceed to the Stripe gate.
  const recordKey = subscriptionRecordKey(sub);
  const recordRaw = await env.LICENSE_KV.get(recordKey);
  let record: SubscriptionRecord | undefined;
  if (recordRaw !== null) {
    record = JSON.parse(recordRaw) as SubscriptionRecord;
    const presentedHash = await sha256Hex(presentedKey);
    if (presentedHash !== record.latestKeyHash) {
      return json({ error: "superseded" }, 403);
    }
  }

  // 8. Gate on Stripe — entitlement source of truth; sign-on-demand never
  // trusts KV for entitlement.
  let stripe: Stripe | undefined;
  const stripeClient = (): Stripe => (stripe ??= (deps.getStripe ?? defaultStripe)(env));

  let subscription: Stripe.Subscription;
  try {
    subscription = await stripeClient().subscriptions.retrieve(sub);
  } catch {
    return json({ error: "unknown_subscription" }, 404);
  }
  if (!ENTITLED_SUBSCRIPTION_STATUSES.has(subscription.status)) {
    return json({ error: "no-active-subscription" }, 403);
  }

  // 9. Mint fresh + rotate.
  const periodEndUnix = periodEndFromSubscription(subscription);
  if (typeof periodEndUnix !== "number") {
    return json({ error: "unknown_subscription" }, 404);
  }
  const expiresAt = new Date(periodEndUnix * 1000).toISOString();

  const email = payload.email ?? record?.email;
  const signingKey = await importSigningKey(env.LICENSE_SIGNING_PRIVATE_KEY);
  const newKey = await mintLicenseKey(signingKey, {
    kind: "subscription",
    kid: env.LICENSE_SIGNING_KID,
    ...(email ? { email } : {}),
    expiresAt,
    sub,
  });

  const newRecord: SubscriptionRecord = {
    latestKeyHash: await sha256Hex(newKey),
    periodEnd: expiresAt,
    ...(email ? { email } : {}),
  };
  await env.LICENSE_KV.put(recordKey, JSON.stringify(newRecord));

  return json({ key: newKey }, 200);
}
