import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import {
  handleSubscriptionDeleted,
  subscriptionCancellationRecordKey,
  type SubscriptionCancellationRecord,
} from "../src/handlers/subscription-deleted";
import { eventHandlers, handleStripeWebhook } from "../src/webhook";
import type { Env } from "../src/index";

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

/** Build a `customer.subscription.deleted` event with cancellation details. */
function subscriptionDeletedEvent(
  id: string,
  created = 1_790_000_000,
  canceledAt = 1_790_000_123,
): Stripe.Event {
  return {
    id,
    object: "event",
    type: "customer.subscription.deleted",
    created,
    data: {
      object: {
        id: "sub_1",
        object: "subscription",
        status: "canceled",
        canceled_at: canceledAt,
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

/** Assert no KV value leaks a signed key (sign-on-demand invariant). */
function expectNoSignedKeyInKv(store: Map<string, string>): void {
  for (const value of store.values()) {
    expect(value).not.toContain("SB1.");
  }
}

describe("customer.subscription.deleted handler (#119)", () => {
  it("Scenario: subscription deletion is analytics-only", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const existingSubscriptionRecord = JSON.stringify({
      latestKeyHash: "abc123",
      periodEnd: "2026-08-01T00:00:00.000Z",
    });
    store.set("sub:sub_1", existingSubscriptionRecord);

    await handleSubscriptionDeleted(
      subscriptionDeletedEvent("evt_subscription_deleted"),
      env,
      ctx,
    );

    const cancellationKey = subscriptionCancellationRecordKey("sub_1");
    expect(store.get("sub:sub_1")).toBe(existingSubscriptionRecord);
    expect([...store.keys()].filter((key) => key === cancellationKey)).toHaveLength(1);
    const record = JSON.parse(
      store.get("subcancel:sub_1")!,
    ) as SubscriptionCancellationRecord;
    expect(record).toMatchObject({
      subscriptionId: "sub_1",
      status: "canceled",
      reason: "cancellation_requested",
      canceledAt: new Date(1_790_000_123 * 1000).toISOString(),
    });
    expectNoSignedKeyInKv(store);
  });

  it("Scenario: duplicate events record once", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const body = JSON.stringify(subscriptionDeletedEvent("evt_subdelete_replayed"));
    const signature = signer.webhooks.generateTestHeaderString({
      payload: body,
      secret: WEBHOOK_SECRET,
    });

    const first = await handleStripeWebhook(post(body, signature), env, ctx, {
      handlers: {
        "customer.subscription.deleted": handleSubscriptionDeleted,
      },
    });
    expect(first.status).toBe(200);

    const second = await handleStripeWebhook(post(body, signature), env, ctx, {
      handlers: {
        "customer.subscription.deleted": handleSubscriptionDeleted,
      },
    });
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({ duplicate: true });
    expect([...store.keys()].filter((key) => key === "subcancel:sub_1")).toHaveLength(
      1,
    );
  });
});

describe("dispatch wiring (#119)", () => {
  it("registers customer.subscription.deleted", () => {
    expect(eventHandlers["customer.subscription.deleted"]).toBe(
      handleSubscriptionDeleted,
    );
  });
});
