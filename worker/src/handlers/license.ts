// `GET /api/license` handler (#112) — the sign-on-demand license fetch a buyer's
// browser calls immediately after Stripe checkout redirects to `/activate`,
// before (or instead of racing) the async webhook mint.
//
// SIGN-ON-DEMAND (normative — 2026-07-08 keypair security review): KV holds NO
// signed keys anywhere (see `sess:`/`sub:` records in checkout-completed.ts /
// invoice-paid.ts). This handler never reads those records for entitlement —
// entitlement is derived fresh from Stripe on every call, and a fresh key is
// signed on every successful call. The only KV write here is the best-effort
// per-session rate-limit marker (`rl:<session_id>`); no key material is ever
// written to KV.
//
// SECURITY (normative): never log the minted `SB1.` string, key material, full
// session ids, or Stripe object details. Log outcomes only.

import Stripe from "stripe";
import type { Env } from "../index";
import { json } from "../http";
import { importSigningKey, mintLicenseKey } from "../license-sign";

/** Injectable seams so tests never hit the live Stripe API or wall clock. */
export interface LicenseDeps {
  /** Build the Stripe client used to look up the session/subscription/customer. */
  getStripe?: (env: Env) => Stripe;
  /** Current time, for the fetch-window check. Defaults to `new Date()`. */
  now?: () => Date;
}

/** Default Stripe client for the Workers runtime (fetch-based HTTP). */
function defaultStripe(env: Env): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });
}

/** Resolve an object-or-id reference to its id string. */
function idOf(ref: string | { id: string } | null | undefined): string | undefined {
  if (!ref) return undefined;
  return typeof ref === "string" ? ref : ref.id;
}

/**
 * Furthest-out `current_period_end` (unix seconds) across a subscription's
 * items — matching invoice-paid.ts's copy so a mid-cycle fetch reports the same
 * period end the webhook path would mint. Undefined when no item carries one.
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

/** Best-effort per-session rate limit: KV has no atomic CAS, so a request that
 * races another read-increment-write on the same session id could both slip
 * through — acceptable here since this only throttles repeat fetches, it is
 * not a security boundary. The cap must comfortably exceed the /activate
 * page's own poll budget (up to 16 requests across its 30s/2s poll loop) so a
 * legitimate still-processing purchase never gets rate-limited into the
 * page's fallback UI before its own timeout. */
const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 20;

/** Longest plausible Stripe Checkout Session id — real ids are well under this;
 * rejecting oversized values up front avoids handing an unbounded attacker
 * string to the KV rate-limit key (KV keys are capped at 512 bytes) or Stripe. */
const MAX_SESSION_ID_LENGTH = 200;

/** Resolves `true` when the request is within the per-session rate limit. */
async function withinRateLimit(env: Env, sessionId: string): Promise<boolean> {
  const key = `rl:${sessionId}`;
  const current = await env.LICENSE_KV.get(key);
  const count = current ? Number.parseInt(current, 10) : 0;
  if (count >= RATE_LIMIT_MAX_REQUESTS) return false;
  await env.LICENSE_KV.put(key, String(count + 1), {
    expirationTtl: RATE_LIMIT_WINDOW_SECONDS,
  });
  return true;
}

/** How long after a Checkout Session was created this endpoint will still fetch
 * a key for it. Past this, the page directs the buyer to check their email. */
const FETCH_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Email from the Checkout Session payload, falling back to a customer lookup —
 * mirrors checkout-completed.ts's emailFromSession + customer expansion. */
async function resolveEmail(
  session: Stripe.Checkout.Session,
  stripeClient: () => Stripe,
): Promise<string | undefined> {
  const direct = session.customer_details?.email ?? session.customer_email;
  if (typeof direct === "string" && direct) return direct;

  const customerId = idOf(session.customer);
  if (!customerId) return undefined;
  const customer = await stripeClient().customers.retrieve(customerId);
  return !customer.deleted ? customer.email ?? undefined : undefined;
}

type Entitlement =
  | { kind: "lifetime"; email?: string }
  | { kind: "subscription"; email?: string; expiresAt: string; sub: string };

/** Subscription statuses that entitle the customer to a Pro key right now. */
const ENTITLED_SUBSCRIPTION_STATUSES = new Set<Stripe.Subscription.Status>([
  "active",
  "trialing",
  "past_due",
]);

/**
 * Derive entitlement for a Checkout Session directly from Stripe — never from
 * the `sess:`/`sub:` KV records, per the sign-on-demand invariant. Resolves to
 * `"pending"` when the purchase is still plausibly in flight (should retry) or
 * `"not_paid"` when it is terminally not entitled (never retry, never leak).
 */
async function resolveEntitlement(
  session: Stripe.Checkout.Session,
  stripeClient: () => Stripe,
): Promise<Entitlement | "pending" | "not_paid"> {
  if (session.mode === "payment") {
    if (session.payment_status === "paid") {
      const email = await resolveEmail(session, stripeClient);
      return { kind: "lifetime", ...(email ? { email } : {}) };
    }
    // A Checkout Session's own expiry (distinct from this endpoint's 48h fetch
    // window) is terminal; otherwise the session is still open or awaiting an
    // async payment method's result — not yet final, the page should retry.
    return session.status === "expired" ? "not_paid" : "pending";
  }

  if (session.mode === "subscription") {
    const subscriptionId = idOf(session.subscription);
    if (!subscriptionId) {
      // Symmetric with the payment-mode check above: Stripe attaches the
      // subscription id as soon as the session completes, but that can lag
      // the session's own status by a beat (read-after-write consistency), so
      // treat anything short of the session's own terminal expiry as pending
      // rather than risk terminally denying an about-to-be-entitled buyer.
      return session.status === "expired" ? "not_paid" : "pending";
    }

    const subscription = await stripeClient().subscriptions.retrieve(subscriptionId);
    if (ENTITLED_SUBSCRIPTION_STATUSES.has(subscription.status)) {
      const periodEndUnix = periodEndFromSubscription(subscription);
      // An entitled subscription with no derivable period end is a transient
      // data gap, not a denial — retry rather than terminally refuse someone
      // who is, in fact, a paying subscriber.
      if (typeof periodEndUnix !== "number") return "pending";
      const email = await resolveEmail(session, stripeClient);
      return {
        kind: "subscription",
        ...(email ? { email } : {}),
        expiresAt: new Date(periodEndUnix * 1000).toISOString(),
        sub: subscriptionId,
      };
    }
    return subscription.status === "incomplete" ? "pending" : "not_paid";
  }

  // Unrecognized Checkout Session mode — never entitled.
  return "not_paid";
}

/**
 * Handle `GET /api/license?session_id=…`: sign and return a fresh license key
 * for a paid Checkout Session, deriving entitlement from Stripe at request
 * time so it works even before the `checkout.session.completed` /
 * `invoice.paid` webhook has landed.
 *
 * Never returns Stripe object details or key material on a refusal path.
 */
export async function handleGetLicense(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  deps: LicenseDeps = {},
): Promise<Response> {
  const sessionId = new URL(request.url).searchParams.get("session_id");
  if (!sessionId) {
    return json({ error: "missing_session_id" }, 400);
  }
  if (sessionId.length > MAX_SESSION_ID_LENGTH) {
    // Longer than any real Stripe session id could ever be — treat exactly
    // like an unknown session rather than handing it to KV/Stripe.
    return json({ error: "unknown_session" }, 404);
  }

  if (!(await withinRateLimit(env, sessionId))) {
    return json({ error: "rate_limited" }, 429);
  }

  let stripe: Stripe | undefined;
  const stripeClient = (): Stripe => (stripe ??= (deps.getStripe ?? defaultStripe)(env));

  let session: Stripe.Checkout.Session;
  try {
    session = await stripeClient().checkout.sessions.retrieve(sessionId);
  } catch {
    // Unknown/malformed session id, or a Stripe-side error. No details leak.
    return json({ error: "unknown_session" }, 404);
  }

  const now = (deps.now ?? (() => new Date()))();
  if (typeof session.created === "number" && now.getTime() - session.created * 1000 > FETCH_WINDOW_MS) {
    return json({ error: "window_expired" }, 410);
  }

  let entitlement: Entitlement | "pending" | "not_paid";
  try {
    entitlement = await resolveEntitlement(session, stripeClient);
  } catch {
    // Subscription/customer expansion failed (deleted resource, transient
    // Stripe error). Same refusal shape as an unknown session — no details leak.
    return json({ error: "unknown_session" }, 404);
  }
  if (entitlement === "pending") {
    return json({ status: "pending" }, 202);
  }
  if (entitlement === "not_paid") {
    return json({ error: "not_paid" }, 402);
  }

  // Sign fresh: KV never held a key for this session (sign-on-demand). Never
  // log the returned string or any key material.
  const signingKey = await importSigningKey(env.LICENSE_SIGNING_PRIVATE_KEY);
  const key = await mintLicenseKey(signingKey, {
    kind: entitlement.kind,
    kid: env.LICENSE_SIGNING_KID,
    ...(entitlement.email ? { email: entitlement.email } : {}),
    ...(entitlement.kind === "subscription"
      ? { expiresAt: entitlement.expiresAt, sub: entitlement.sub }
      : {}),
  });

  return json({ key }, 200);
}
