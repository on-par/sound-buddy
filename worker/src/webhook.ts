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

/**
 * KV marker TTL for processed events. Stripe retries a webhook for up to ~3
 * days; 30 days keeps the idempotency marker well past that window so a late
 * retry still de-duplicates, while letting KV reclaim the key eventually.
 */
const PROCESSED_EVENT_TTL_SECONDS = 30 * 24 * 60 * 60;

/** KV key for a processed event id. `sess:<id>` (one-time flows) lands in #111. */
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
 * Dispatch table keyed by Stripe event type. Empty for now — #110/#111/#118/#119
 * register their handlers here. An event whose type has no handler is a
 * deliberate no-op: this endpoint receives event types it does not care about,
 * and acknowledging them (200) is correct so Stripe stops retrying.
 */
export const eventHandlers: Record<string, EventHandler> = {};

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

  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    // Bad signature or malformed payload. Do not log the body or signature.
    console.warn("stripe webhook: signature verification failed");
    return json({ error: "invalid_signature" }, 400);
  }

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
