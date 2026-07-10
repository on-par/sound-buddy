// `charge.refunded` handler (#119) — refund record only.
//
// When Stripe reports a refunded charge, this handler records
// `refund:<charge_id>` with a manual-follow-up flag. It takes NO entitlement
// action: no key is minted, mutated, or revoked. Offline lifetime keys cannot
// be revoked after refund (Decision 3 gap), and that risk is bounded by the 300
// founding cap.
//
// Per-event idempotency (`evt:<id>`) is owned by the webhook dispatcher (#108),
// so a replayed event never reaches this handler twice.
//
// SECURITY (normative): never log the payload body, email, or KV values. Log
// event ids / charge ids / outcomes only.

import Stripe from "stripe";
import type { Env } from "../index";

/** Non-secret refund metadata persisted for manual follow-up. */
export interface RefundRecord {
  chargeId: string;
  amountRefunded: number;
  currency: string;
  reason?: string;
  email?: string;
  followUp: true;
  refundedAt: string;
}

/** KV key for a refunded charge's manual-follow-up record. */
export const refundRecordKey = (chargeId: string): string => `refund:${chargeId}`;

/**
 * Handle a verified `charge.refunded` event: record the refund only.
 * Idempotency is guaranteed upstream by the webhook dispatcher's `evt:<id>`
 * marker, so this runs at most once per event.
 */
export async function handleChargeRefunded(
  event: Stripe.Event,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  const charge = event.data.object as Stripe.Charge;
  const refund = charge.refunds?.data?.[0];
  const reason = refund?.reason ?? undefined;
  const email = charge.receipt_email ?? charge.billing_details?.email ?? undefined;

  const record: RefundRecord = {
    chargeId: charge.id,
    amountRefunded: charge.amount_refunded ?? 0,
    currency: charge.currency,
    ...(reason ? { reason } : {}),
    ...(email ? { email } : {}),
    followUp: true,
    // `charge.created` is the charge's original creation time, not the
    // refund time, and is always present — it would win an `?? event.created`
    // fallback and silently misdate every refund. The refund object's own
    // `created` is the actual refund timestamp; `event.created` (when Stripe
    // emitted this webhook) is the next-best fallback if it's absent.
    refundedAt: new Date((refund?.created ?? event.created) * 1000).toISOString(),
  };

  await env.LICENSE_KV.put(refundRecordKey(charge.id), JSON.stringify(record));

  console.log(
    `charge.refunded ${event.id}: recorded refund for ${charge.id} (follow-up)`,
  );
}
