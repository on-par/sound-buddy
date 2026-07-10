// `customer.subscription.deleted` handler (#119) — cancellation analytics only.
//
// When Stripe reports a deleted subscription, this handler takes NO entitlement
// action. The subscription key deliberately runs to its baked `expiresAt` +
// grace, per `license.ts`. This writes only an analytics record.
//
// Per-event idempotency (`evt:<id>`) is owned by the webhook dispatcher (#108),
// so a replayed event never reaches this handler twice.
//
// SECURITY (normative): never log the payload body, email, or KV values. Log
// event ids / subscription ids / outcomes only.

import Stripe from "stripe";
import type { Env } from "../index";

/** Non-secret cancellation metadata persisted for analytics only. */
export interface SubscriptionCancellationRecord {
  subscriptionId: string;
  status?: string;
  reason?: string;
  canceledAt: string;
}

/** KV key for subscription cancellation analytics; distinct from `sub:<id>`. */
export const subscriptionCancellationRecordKey = (
  subscriptionId: string,
): string => `subcancel:${subscriptionId}`;

/**
 * Handle a verified `customer.subscription.deleted` event: record analytics
 * only. Idempotency is guaranteed upstream by the webhook dispatcher's
 * `evt:<id>` marker, so this runs at most once per event.
 */
export async function handleSubscriptionDeleted(
  event: Stripe.Event,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  const subscription = event.data.object as Stripe.Subscription;
  const reason = subscription.cancellation_details?.reason ?? undefined;

  const record: SubscriptionCancellationRecord = {
    subscriptionId: subscription.id,
    ...(subscription.status ? { status: subscription.status } : {}),
    ...(reason ? { reason } : {}),
    canceledAt: new Date(
      (subscription.canceled_at ?? subscription.ended_at ?? event.created) * 1000,
    ).toISOString(),
  };

  await env.LICENSE_KV.put(
    subscriptionCancellationRecordKey(subscription.id),
    JSON.stringify(record),
  );

  console.log(
    `customer.subscription.deleted ${event.id}: recorded cancellation for ${subscription.id} (analytics only)`,
  );
}
