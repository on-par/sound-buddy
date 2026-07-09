// `invoice.paid` handler (#110) — the SINGLE subscription license mint path.
//
// Stripe fires `invoice.paid` for both the initial subscription purchase and
// every renewal, so this handler owns subscription minting outright:
// `checkout.session.completed` deliberately does NOT mint for subscription mode
// (that would double-mint the initial period). Each paid invoice mints a fresh,
// immutable `subscription` key whose `expiresAt` is the current period end, with
// the customer email and the Stripe subscription id (`sub`) baked in.
//
// SIGN-ON-DEMAND (normative — 2026-07-08 keypair security review): KV must hold
// NO signed keys. The key is minted in memory here (its hash and expiry are the
// persisted artifacts; email delivery is #114), and only non-secret metadata is
// stored: `sub:<subscription_id>` → { latestKeyHash, periodEnd, email },
// overwritten on every renewal. That record is the "DB of current keys" #113's
// seamless-refresh endpoint reads to decide whether a caller's key is superseded.
// Per-event idempotency (`evt:<id>`) is owned by the webhook dispatcher (#108),
// so a replayed event never reaches this handler twice.
//
// SECURITY (normative): never log the minted `SB1.` string, key material, the
// email, or KV values. Log event ids / subscription ids / outcomes only.

import Stripe from "stripe";
import type { Env } from "../index";
import { importSigningKey, mintLicenseKey } from "../license-sign";

/**
 * Non-secret metadata persisted per subscription. Contains NO signed key — only
 * the hash of the latest minted key (drives #113's supersede check), the period
 * end it entitles through, and the email it was minted for. Overwritten on every
 * renewal so the record always reflects the *current* key.
 */
export interface SubscriptionRecord {
  /** SHA-256 (lowercase hex) of the latest minted key string. */
  latestKeyHash: string;
  /** ISO 8601 expiry of the latest key = the current billing period end. */
  periodEnd: string;
  /** Email the key was minted for, when known. */
  email?: string;
}

/** KV key for a subscription's current-key metadata. Retrieved by #113. */
export const subscriptionRecordKey = (subscriptionId: string): string =>
  `sub:${subscriptionId}`;

/** Injectable seams so tests never hit the live Stripe API. */
export interface InvoicePaidDeps {
  /** Build the Stripe client used for customer/subscription expansion. */
  getStripe?: (env: Env) => Stripe;
}

/** Lowercase-hex SHA-256 of a string, via Web Crypto (no Node `crypto`). */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
 * The Stripe subscription id an invoice belongs to. On API version
 * `2026-06-24.dahlia` this lives at `parent.subscription_details.subscription`
 * (the legacy top-level `invoice.subscription` field is gone). Absent for
 * one-off / non-subscription invoices — those are not minted here.
 */
function subscriptionIdOf(invoice: Stripe.Invoice): string | undefined {
  return idOf(invoice.parent?.subscription_details?.subscription);
}

/**
 * Current period end (unix seconds) read straight from the webhook payload:
 * the furthest-out `period.end` among the invoice lines tied to this
 * subscription. A renewal invoice's subscription line covers the new period, so
 * its end is the new current period end. Returns undefined when no subscription
 * line carries a period — the caller then expands the subscription via the API.
 */
function periodEndFromLines(
  invoice: Stripe.Invoice,
  subscriptionId: string,
): number | undefined {
  let latest: number | undefined;
  for (const line of invoice.lines?.data ?? []) {
    if (idOf(line.subscription) !== subscriptionId) continue;
    const end = line.period?.end;
    if (typeof end === "number" && (latest === undefined || end > latest)) {
      latest = end;
    }
  }
  return latest;
}

/**
 * Furthest-out `current_period_end` (unix seconds) across a subscription's
 * items — the API-expansion counterpart of {@link periodEndFromLines}. Items can
 * bill on staggered anchors, so the *latest* end is the period the whole
 * subscription is entitled through; taking `items.data[0]` alone would expire a
 * multi-item subscription early. Undefined when no item carries an end.
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

/** Email from the invoice payload, if present (no API call). */
function emailFromInvoice(invoice: Stripe.Invoice): string | undefined {
  if (typeof invoice.customer_email === "string" && invoice.customer_email) {
    return invoice.customer_email;
  }
  const customer = invoice.customer;
  if (customer && typeof customer !== "string" && !("deleted" in customer)) {
    return customer.email ?? undefined;
  }
  return undefined;
}

/**
 * Handle a verified `invoice.paid` event: mint the current subscription key and
 * persist its metadata. Idempotency is guaranteed upstream by the webhook
 * dispatcher's `evt:<id>` marker, so this runs at most once per event.
 *
 * A non-subscription invoice is acknowledged without minting. Any thrown error
 * (missing signing key, Stripe expansion failure) propagates so the webhook
 * returns 500 and Stripe retries — the event is not marked processed.
 */
export async function handleInvoicePaid(
  event: Stripe.Event,
  env: Env,
  _ctx: ExecutionContext,
  deps: InvoicePaidDeps = {},
): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;

  const subscriptionId = subscriptionIdOf(invoice);
  if (!subscriptionId) {
    // One-off / non-subscription invoice — nothing to mint on this path.
    console.log(`invoice.paid ${event.id}: no subscription — skipping mint`);
    return;
  }

  // Expand via the Stripe API only when the payload is missing a field. The
  // client is built lazily so the happy path (payload has everything) makes no
  // API call and needs no secret at hand.
  let stripe: Stripe | undefined;
  const stripeClient = (): Stripe =>
    (stripe ??= (deps.getStripe ?? defaultStripe)(env));

  let email = emailFromInvoice(invoice);
  if (email === undefined) {
    const customerId = idOf(invoice.customer);
    if (customerId) {
      const customer = await stripeClient().customers.retrieve(customerId);
      if (!customer.deleted) email = customer.email ?? undefined;
    }
  }

  let periodEndUnix = periodEndFromLines(invoice, subscriptionId);
  if (periodEndUnix === undefined) {
    const subscription = await stripeClient().subscriptions.retrieve(subscriptionId);
    periodEndUnix = periodEndFromSubscription(subscription);
  }
  if (typeof periodEndUnix !== "number" || Number.isNaN(periodEndUnix)) {
    throw new Error(
      `invoice.paid ${event.id}: no period end for ${subscriptionId}`,
    );
  }
  const expiresAt = new Date(periodEndUnix * 1000).toISOString();

  // Mint in memory: the key itself is never persisted (sign-on-demand). Its hash
  // and expiry are the durable record; email delivery of the key is #114.
  const signingKey = await importSigningKey(env.LICENSE_SIGNING_PRIVATE_KEY);
  const key = await mintLicenseKey(signingKey, {
    kind: "subscription",
    kid: env.LICENSE_SIGNING_KID,
    ...(email ? { email } : {}),
    expiresAt,
    sub: subscriptionId,
  });

  const record: SubscriptionRecord = {
    latestKeyHash: await sha256Hex(key),
    periodEnd: expiresAt,
    ...(email ? { email } : {}),
  };
  await env.LICENSE_KV.put(
    subscriptionRecordKey(subscriptionId),
    JSON.stringify(record),
  );

  console.log(
    `invoice.paid ${event.id}: minted subscription key for ${subscriptionId} (expires ${expiresAt})`,
  );
}
