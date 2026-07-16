import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import {
  handleChargeRefunded,
  refundRecordKey,
  type RefundRecord,
} from "./charge-refunded";
import { eventHandlers, handleStripeWebhook } from "../webhook";
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
  } satisfies Env;
}

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

/**
 * Build a `charge.refunded` event. `purchaseCreated` (the charge's original
 * creation time) is deliberately distinct from `refundCreated` (the refund's
 * own timestamp) and `eventCreated` (webhook emission time), so a test
 * asserting on `refundedAt` proves which field the handler actually used.
 * Pass `refundCreated: null` to omit the field from the refund object
 * entirely (exercises the fallback to `eventCreated`).
 */
function chargeRefundedEvent(
  id: string,
  {
    purchaseCreated = 1_780_000_000,
    refundCreated = 1_790_000_050,
    eventCreated = 1_790_000_100,
  }: {
    purchaseCreated?: number;
    refundCreated?: number | null;
    eventCreated?: number;
  } = {},
): Stripe.Event {
  const refund: Record<string, unknown> = { reason: "requested_by_customer" };
  if (refundCreated !== null) refund.created = refundCreated;

  return {
    id,
    object: "event",
    type: "charge.refunded",
    created: eventCreated,
    data: {
      object: {
        id: "ch_1",
        object: "charge",
        amount: 19900,
        amount_refunded: 19900,
        currency: "usd",
        created: purchaseCreated,
        receipt_email: "a@b.c",
        refunds: { data: [refund] },
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

/** Assert no KV value leaks a signed key (sign-on-demand invariant). */
function expectNoSignedKeyInKv(store: Map<string, string>): void {
  for (const value of store.values()) {
    expect(value).not.toContain("SB1.");
  }
}

describe("charge.refunded handler (#119)", () => {
  it("Scenario: refund is recorded, key not revoked", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);

    await handleChargeRefunded(chargeRefundedEvent("evt_refund_recorded"), env, ctx);

    expect(store.size).toBe(1);
    expect([...store.keys()]).toEqual([refundRecordKey("ch_1")]);
    const record = JSON.parse(store.get("refund:ch_1")!) as RefundRecord;
    expect(record).toMatchObject({
      followUp: true,
      chargeId: "ch_1",
      amountRefunded: 19900,
      currency: "usd",
      reason: "requested_by_customer",
      email: "a@b.c",
      refundedAt: new Date(1_790_000_050 * 1000).toISOString(),
    });
    expect([...store.keys()].filter((key) => key.startsWith("sub:"))).toHaveLength(0);
    expect([...store.keys()].filter((key) => key.startsWith("sess:"))).toHaveLength(0);
    expectNoSignedKeyInKv(store);
  });

  it("Scenario: refundedAt falls back to the event's created time when the refund object omits one", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);

    await handleChargeRefunded(
      chargeRefundedEvent("evt_refund_no_refund_created", {
        purchaseCreated: 1_780_000_000,
        refundCreated: null,
        eventCreated: 1_790_000_100,
      }),
      env,
      ctx,
    );

    const record = JSON.parse(store.get("refund:ch_1")!) as RefundRecord;
    expect(record.refundedAt).toBe(new Date(1_790_000_100 * 1000).toISOString());
  });

  it("Scenario: duplicate events record once", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const body = JSON.stringify(chargeRefundedEvent("evt_refund_replayed"));
    const signature = signer.webhooks.generateTestHeaderString({
      payload: body,
      secret: WEBHOOK_SECRET,
    });

    const first = await handleStripeWebhook(post(body, signature), env, ctx, {
      handlers: { "charge.refunded": handleChargeRefunded },
    });
    expect(first.status).toBe(200);

    const second = await handleStripeWebhook(post(body, signature), env, ctx, {
      handlers: { "charge.refunded": handleChargeRefunded },
    });
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({ duplicate: true });
    expect([...store.keys()].filter((key) => key === "refund:ch_1")).toHaveLength(1);
  });
});

describe("dispatch wiring (#119)", () => {
  it("registers charge.refunded", () => {
    expect(eventHandlers["charge.refunded"]).toBe(handleChargeRefunded);
  });
});
