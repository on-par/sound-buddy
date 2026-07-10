// `invoice.payment_failed` handler (#118) — dunning email only.
//
// When Stripe reports a failed subscription renewal payment, this handler sends
// a transactional dunning email that points the customer at the static Customer
// Portal URL. It takes NO entitlement action: no key is minted, mutated, or
// revoked. The existing subscription key runs to its baked `expiresAt` + grace,
// per `license.ts`.
//
// Per-event idempotency (`evt:<id>`) is owned by the webhook dispatcher (#108),
// so a replayed event never reaches this handler twice.
//
// SECURITY (normative): never log the email, payload body, or KV values. Log
// event ids / subscription ids / outcomes only.

import Stripe from "stripe";
import type { Env } from "../index";
import { sendDunningEmail } from "../delivery";
import { defaultStripe, emailFromInvoice, idOf } from "./invoice-paid";

/** Injectable seams so tests never hit the live Stripe API or Resend. */
export interface InvoicePaymentFailedDeps {
  /** Build the Stripe client used for customer expansion. */
  getStripe?: (env: Env) => Stripe;
  /** Best-effort dunning email delivery; injectable so tests never hit Resend. */
  sendEmail?: typeof sendDunningEmail;
}

/**
 * Handle a verified `invoice.payment_failed` event: send a dunning email only.
 * Idempotency is guaranteed upstream by the webhook dispatcher's `evt:<id>`
 * marker, so this runs at most once per event.
 */
export async function handleInvoicePaymentFailed(
  event: Stripe.Event,
  env: Env,
  _ctx: ExecutionContext,
  deps: InvoicePaymentFailedDeps = {},
): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;

  let email = emailFromInvoice(invoice);
  if (email === undefined) {
    const customerId = idOf(invoice.customer);
    if (customerId) {
      const customer = await (deps.getStripe ?? defaultStripe)(
        env,
      ).customers.retrieve(customerId);
      if (!customer.deleted) email = customer.email ?? undefined;
    }
  }

  const send = deps.sendEmail ?? sendDunningEmail;
  let sent = false;
  try {
    sent = (await send(env, { to: email })).ok;
  } catch {
    console.error(
      `invoice.payment_failed ${event.id}: dunning email delivery threw — ignored`,
    );
  }

  const subscriptionId = idOf(invoice.parent?.subscription_details?.subscription);
  const outcome = sent ? "sent dunning email" : "dunning email not sent";
  console.log(
    subscriptionId
      ? `invoice.payment_failed ${event.id}: ${outcome} for ${subscriptionId}`
      : `invoice.payment_failed ${event.id}: ${outcome}`,
  );
}
