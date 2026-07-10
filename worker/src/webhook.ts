// Stripe webhook handler (#108): verify → de-duplicate → dispatch.
//
// The Workers runtime lacks Node's `crypto`, so signatures are verified with
// `constructEventAsync` + a SubtleCrypto provider (Web Crypto). Verified events
// are de-duplicated through KV so a replayed event never double-mints a license,
// then handed to a per-event dispatch table. The per-event handler *bodies*
// (license minting, subscription lifecycle, …) land in #110/#111/#118/#119;
// this story delivers verification, idempotency, and the dispatch skeleton only.
//
// SECURITY (normative — 2026-07-08 keypair review): never log the payload body,
// the signature header, or KV values. Log event ids/types and outcomes only.

import Stripe from "stripe";
import type { Env } from "./index";
import { json } from "./http";
import { handleCheckoutCompleted } from "./handlers/checkout-completed";
import { handleInvoicePaid } from "./handlers/invoice-paid";
import { handleInvoicePaymentFailed } from "./handlers/invoice-payment-failed";

/**
 * KV marker TTL for processed events. Stripe retries a webhook for up to ~3
 * days; 30 days keeps the idempotency marker well past that window so a late
 * retry still de-duplicates, while letting KV reclaim the key eventually.
 */
const PROCESSED_EVENT_TTL_SECONDS = 30 * 24 * 60 * 60;

// Signature verification needs a Stripe instance but never calls the API, so the
// client carries a placeholder key and no HTTP client — this keeps the story
// scoped to the one secret it touches (STRIPE_WEBHOOK_SECRET). The real
// STRIPE_SECRET_KEY is added to Env by the first API-calling handler
// (#110/#111). Both the client and the SubtleCrypto provider are stateless, so
// they are built once at module scope rather than per request.
const stripe = new Stripe("sb_webhook_verification_only");
const cryptoProvider = Stripe.createSubtleCryptoProvider();

/** KV key for a processed event id. `sess:<id>` is the founding flow's session marker. */
const eventKey = (id: string): string => `evt:${id}`;

/**
 * A verified Stripe event is dispatched to the handler registered for its type.
 * Real handlers land in downstream stories; the registry below ships empty.
 */
export type EventHandler = (
  event: Stripe.Event,
  env: Env,
  ctx: ExecutionContext,
) => Promise<void> | void;

/**
 * Dispatch table keyed by Stripe event type. Checkout events are registered for
 * the founding one-time flow, but that handler mints only payment-mode lifetime
 * sessions and ignores subscription-mode sessions. `invoice.paid` remains the
 * sole subscription mint path, so the initial period cannot double-mint.
 */
export const eventHandlers: Record<string, EventHandler> = {
  "invoice.paid": handleInvoicePaid,
  "invoice.payment_failed": handleInvoicePaymentFailed,
  "checkout.session.completed": handleCheckoutCompleted,
  "checkout.session.async_payment_succeeded": handleCheckoutCompleted,
};

interface WebhookDeps {
  /** Dispatch table; injectable so tests can observe handler invocation. */
  handlers?: Record<string, EventHandler>;
}

/**
 * Handle `POST /api/stripe/webhook`.
 *
 * - Missing signature header → 400 (no dispatch, no KV write).
 * - Bad signature / unparseable body → 400 (no dispatch, no KV write).
 * - Already-seen event id → 200 no-op (no dispatch).
 * - First sight → dispatch, then record the idempotency marker → 200.
 *
 * A handler that throws propagates as a 500 so Stripe retries the event; the
 * marker is written only after a handler returns, so a failed event is not
 * silently swallowed.
 */
export async function handleStripeWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  deps: WebhookDeps = {},
): Promise<Response> {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    // Misconfiguration, not a client error. Never name the missing secret.
    console.error("stripe webhook: signing secret not configured");
    return json({ error: "server_misconfigured" }, 500);
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return json({ error: "missing_signature" }, 400);
  }

  // The raw body string is required verbatim for signature verification.
  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
      undefined,
      cryptoProvider,
    );
  } catch {
    // Bad signature or malformed payload. Do not log the body or signature.
    console.warn("stripe webhook: signature verification failed");
    return json({ error: "invalid_signature" }, 400);
  }

  // De-duplicate on the event id. KV has no atomic compare-and-set, so this
  // check-then-record is best-effort: two deliveries of the same event racing
  // inside the process→record window could both dispatch. That is acceptable
  // here because the money-critical guard is defence-in-depth in the downstream
  // handlers — the checkout flow keys idempotency on `sess:<session.id>`
  // so a license is minted at most once regardless of this window.
  const key = eventKey(event.id);
  if ((await env.LICENSE_KV.get(key)) !== null) {
    console.log(
      `stripe webhook: duplicate event ${event.id} (${event.type}) — no-op`,
    );
    return json({ received: true, duplicate: true });
  }

  const handlers = deps.handlers ?? eventHandlers;
  const handler = handlers[event.type];
  if (handler) {
    await handler(event, env, ctx);
  }

  // Record only after a handler returns, so a throwing handler (→ 500) is
  // retried by Stripe rather than marked processed. The marker stays small and
  // holds no payload data — just the event type, for log/debug context.
  await env.LICENSE_KV.put(key, event.type, {
    expirationTtl: PROCESSED_EVENT_TTL_SECONDS,
  });

  console.log(`stripe webhook: processed event ${event.id} (${event.type})`);
  return json({ received: true });
}
