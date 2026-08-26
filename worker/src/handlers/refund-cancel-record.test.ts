// Acceptance test (#1167): prove refund/cancellation recording end-to-end
// through the real webhook dispatcher, distinct from license KV entries and
// without revoking the subscriber's existing license key. The handlers
// (`handleChargeRefunded`, `handleSubscriptionDeleted`) and their dispatch
// wiring already shipped in #119 — see `charge-refunded.test.ts` and
// `subscription-deleted.test.ts` for per-handler unit coverage. This file
// is the cross-handler acceptance proof the issue's Verification section
// names.

import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { refundRecordKey, type RefundRecord } from "./charge-refunded";
import {
  subscriptionCancellationRecordKey,
  type SubscriptionCancellationRecord,
} from "./subscription-deleted";
import { handleStripeWebhook } from "../webhook";
import type { Env } from "../index";

const WEBHOOK_SECRET = "whsec_test_secret_123";
const signer = new Stripe("sk_test_signer", {
  httpClient: Stripe.createFetchHttpClient(),
});

/** In-memory KV double backed by a Map, exposing the two methods we use. */
function makeKv(): { kv: KVNamespace; store: Map<string, string> } {
  const store = new Map<string, string>();
  const kv = {
    get: async (key: string) => (store.has(key) ? store.get(key)! : null),
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  } as unknown as KVNamespace;
  return { kv, store };
}

function makeEnv(kv: KVNamespace): Env {
  return {
    LICENSE_KV: kv,
    EVENTS_KV: {} as KVNamespace,
    WAITLIST_KV: {} as KVNamespace,
    FOUNDING_CAP: "300",
    FROM_EMAIL: "hello@example.test",
    SUPPORT_EMAIL: "support@example.test",
    CUSTOMER_PORTAL_URL: "https://portal.example.test",
    APP_ORIGIN: "https://example.test",
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_SECRET_KEY: "sk_test_unused",
    LICENSE_SIGNING_PRIVATE_KEY: "",
    RESEND_API_KEY: "re_test_unused",
    LICENSE_SIGNING_KID: "test-kid",
    LICENSE_PUBLIC_KEY: "",
    GITHUB_ISSUES_TOKEN: "",
  } satisfies Env;
}

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

function chargeRefundedEvent(id: string): Stripe.Event {
  return {
    id,
    object: "event",
    type: "charge.refunded",
    created: 1_790_000_100,
    data: {
      object: {
        id: "ch_1",
        object: "charge",
        amount: 19900,
        amount_refunded: 19900,
        currency: "usd",
        created: 1_780_000_000,
        receipt_email: "a@b.c",
        refunds: {
          data: [{ reason: "requested_by_customer", created: 1_790_000_050 }],
        },
      },
    },
  } as unknown as Stripe.Event;
}

function subscriptionDeletedEvent(id: string): Stripe.Event {
  return {
    id,
    object: "event",
    type: "customer.subscription.deleted",
    created: 1_790_000_000,
    data: {
      object: {
        id: "sub_1",
        object: "subscription",
        status: "canceled",
        canceled_at: 1_790_000_123,
        cancellation_details: { reason: "cancellation_requested" },
      },
    },
  } as unknown as Stripe.Event;
}

function post(body: string, signature: string): Request {
  return new Request("https://sound-buddy-api.test/api/stripe/webhook", {
    method: "POST",
    body,
    headers: { "stripe-signature": signature },
  });
}

function sign(body: string): string {
  return signer.webhooks.generateTestHeaderString({
    payload: body,
    secret: WEBHOOK_SECRET,
  });
}

describe("refund & cancellation recording (#1167)", () => {
  it("refund is recorded distinct from any license KV entry (key not revoked)", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const existingLicenseRecord = JSON.stringify({
      latestKeyHash: "abc123",
      periodEnd: "2026-08-01T00:00:00.000Z",
    });
    const existingSignedSession = "SB1.eyJ.signed.session";
    store.set("sub:sub_1", existingLicenseRecord);
    store.set("sess:cs_1", existingSignedSession);

    const body = JSON.stringify(chargeRefundedEvent("evt_refund_1167"));
    const response = await handleStripeWebhook(post(body, sign(body)), env, ctx);
    expect(response.status).toBe(200);

    const record = JSON.parse(store.get(refundRecordKey("ch_1"))!) as RefundRecord;
    expect(record).toMatchObject({
      followUp: true,
      chargeId: "ch_1",
      amountRefunded: 19900,
      currency: "usd",
    });

    // The pre-existing license entries are untouched — refund recording is
    // distinct from license KV and never revokes the key.
    expect(store.get("sub:sub_1")).toBe(existingLicenseRecord);
    expect(store.get("sess:cs_1")).toBe(existingSignedSession);

    // The refund record itself never leaks a signed key, and its key prefix
    // is distinct from the license-key prefixes.
    expect(store.get(refundRecordKey("ch_1"))!).not.toContain("SB1.");
    expect(refundRecordKey("ch_1")).not.toBe("sub:sub_1");
    expect(refundRecordKey("ch_1")).not.toBe("sess:cs_1");
  });

  it("cancellation is recorded without revoking the existing license key", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const existing = JSON.stringify({
      latestKeyHash: "abc123",
      periodEnd: "2026-08-01T00:00:00.000Z",
    });
    store.set("sub:sub_1", existing);

    const body = JSON.stringify(subscriptionDeletedEvent("evt_subdelete_1167"));
    const response = await handleStripeWebhook(post(body, sign(body)), env, ctx);
    expect(response.status).toBe(200);

    const record = JSON.parse(
      store.get(subscriptionCancellationRecordKey("sub_1"))!,
    ) as SubscriptionCancellationRecord;
    expect(record).toMatchObject({
      subscriptionId: "sub_1",
      status: "canceled",
    });

    // Byte-identical → not revoked, mutated, or deleted.
    expect(store.get("sub:sub_1")).toBe(existing);
  });
});
