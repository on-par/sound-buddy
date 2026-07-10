// `checkout.session.completed` / `checkout.session.async_payment_succeeded`
// handler (#111) — the SINGLE founding one-time lifetime license mint path.
//
// Stripe fires `checkout.session.completed` for immediate payment methods and
// `checkout.session.async_payment_succeeded` when a delayed payment method later
// succeeds. This handler owns founding lifetime minting outright for
// payment-mode Checkout Sessions only: subscription-mode sessions are skipped so
// `invoice.paid` remains the sole subscription mint path and never double-mints
// the initial period.
//
// SIGN-ON-DEMAND (normative — 2026-07-08 keypair security review): KV must hold
// NO signed keys. The key is minted in memory here (its hash is the persisted
// artifact; email delivery is #114), and only non-secret metadata is stored:
// `sess:<session_id>` → { latestKeyHash, email, kind }. That same record is
// this handler's idempotency marker across the sync+async pair for one session.
// Per-event idempotency (`evt:<id>`) is owned by the webhook dispatcher (#108),
// so a replayed event never reaches this handler twice.
//
// SECURITY (normative): never log the minted `SB1.` string, key material, the
// email, or KV values. Log event ids / session ids / outcomes only.

import Stripe from "stripe";
import type { Env } from "../index";
import { sendLicenseEmail } from "../delivery";
import { importSigningKey, mintLicenseKey } from "../license-sign";

/**
 * Non-secret metadata persisted per founding Checkout Session. Contains NO
 * signed key — only the hash of the minted lifetime key and the email it was
 * minted for. This is the sign-on-demand artifact #112 reads by session id.
 */
export interface SessionRecord {
  /** SHA-256 (lowercase hex) of the minted key string. */
  latestKeyHash: string;
  /** Email the key was minted for, when known. */
  email?: string;
  /** Founding one-time purchases mint lifetime licenses. */
  kind: "lifetime";
}

/** KV key for a Checkout Session's lifetime-key metadata. Retrieved by #112. */
export const sessionRecordKey = (sessionId: string): string =>
  `sess:${sessionId}`;

/** Injectable seams so tests never hit the live Stripe API. */
export interface CheckoutCompletedDeps {
  /** Build the Stripe client used for the customer email lookup. */
  getStripe?: (env: Env) => Stripe;
  /** Best-effort license-key email delivery; injectable so tests never hit Resend. */
  sendEmail?: typeof sendLicenseEmail;
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

/** Email from the Checkout Session payload, if present (no API call). */
function emailFromSession(session: Stripe.Checkout.Session): string | undefined {
  const email = session.customer_details?.email ?? session.customer_email;
  return typeof email === "string" && email ? email : undefined;
}

/**
 * Handle a verified founding Checkout event: mint one lifetime key for a paid
 * payment-mode session and persist its metadata. The `sess:<id>` record is a
 * best-effort idempotency marker for the completed + async_payment_succeeded
 * pair that can share a session id (KV has no atomic compare-and-set).
 *
 * Subscription-mode sessions are acknowledged without minting. Any thrown error
 * (missing signing key, Stripe customer lookup failure) propagates so the
 * webhook returns 500 and Stripe retries — the event is not marked processed.
 */
export async function handleCheckoutCompleted(
  event: Stripe.Event,
  env: Env,
  _ctx: ExecutionContext,
  deps: CheckoutCompletedDeps = {},
): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  const send = deps.sendEmail ?? sendLicenseEmail;

  if (session.mode !== "payment") {
    console.log(
      `${event.type} ${event.id}: mode ${session.mode} — not a founding payment, skipping`,
    );
    return;
  }

  if (session.payment_status !== "paid") {
    console.log(
      `${event.type} ${event.id}: payment_status ${session.payment_status} — not paid yet, skipping`,
    );
    return;
  }

  const recordKey = sessionRecordKey(session.id);
  if ((await env.LICENSE_KV.get(recordKey)) !== null) {
    console.log(
      `${event.type} ${event.id}: session ${session.id} already minted — no-op`,
    );
    return;
  }

  let stripe: Stripe | undefined;
  const stripeClient = (): Stripe =>
    (stripe ??= (deps.getStripe ?? defaultStripe)(env));

  let email = emailFromSession(session);
  if (email === undefined) {
    const customerId = idOf(session.customer);
    if (customerId) {
      const customer = await stripeClient().customers.retrieve(customerId);
      if (!customer.deleted) email = customer.email ?? undefined;
    }
  }

  // Mint in memory: the key itself is never persisted (sign-on-demand). Its hash
  // is the durable record; email delivery of the key is #114.
  const signingKey = await importSigningKey(env.LICENSE_SIGNING_PRIVATE_KEY);
  const key = await mintLicenseKey(signingKey, {
    kind: "lifetime",
    kid: env.LICENSE_SIGNING_KID,
    ...(email ? { email } : {}),
  });

  await env.LICENSE_KV.put(
    recordKey,
    JSON.stringify({
      latestKeyHash: await sha256Hex(key),
      ...(email ? { email } : {}),
      kind: "lifetime",
    } satisfies SessionRecord),
  );

  try {
    await send(env, { to: email, key, kind: "lifetime" });
  } catch {
    console.error(`${event.type} ${event.id}: license email delivery threw — ignored`);
  }

  console.log(
    `${event.type} ${event.id}: minted lifetime key for session ${session.id}`,
  );
}
