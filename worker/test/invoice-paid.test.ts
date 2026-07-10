import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import Stripe from "stripe";
import {
  handleInvoicePaid,
  subscriptionRecordKey,
  type SubscriptionRecord,
  type InvoicePaidDeps,
} from "../src/handlers/invoice-paid";
import { handleCheckoutCompleted } from "../src/handlers/checkout-completed";
import { eventHandlers, handleStripeWebhook } from "../src/webhook";
import type { Env } from "../src/index";

// A throwaway signing key, generated exactly as scripts/license-keygen.mjs does
// (ed25519 → pkcs8 PEM). The real production key (H3) is never used.
const { privateKey } = generateKeyPairSync("ed25519");
const PKCS8_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

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
    APP_ORIGIN: "https://example.test",
    STRIPE_WEBHOOK_SECRET: "whsec_unused",
    STRIPE_SECRET_KEY: "sk_test_unused",
    LICENSE_SIGNING_PRIVATE_KEY: PKCS8_PEM,
    LICENSE_SIGNING_KID: "test-kid",
    LICENSE_PUBLIC_KEY: "",
  } satisfies Env;
}

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

/** Unix seconds for an ISO instant. */
const unix = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

interface InvoiceOverrides {
  subscription?: string | null;
  customerEmail?: string | null;
  customer?: string;
  lines?: Array<{ subscription?: string | null; periodEnd?: number }>;
}

/** Build an `invoice.paid` event with a subscription line by default. */
function invoicePaidEvent(id: string, o: InvoiceOverrides = {}): Stripe.Event {
  const sub = o.subscription === undefined ? "sub_1" : o.subscription;
  const invoice: Record<string, unknown> = {
    id: "in_1",
    object: "invoice",
    customer: o.customer ?? "cus_1",
    customer_email: o.customerEmail === undefined ? "a@b.c" : o.customerEmail,
    parent: sub ? { subscription_details: { subscription: sub } } : null,
    lines: {
      data: (o.lines ?? [{ subscription: "sub_1", periodEnd: unix("2027-01-01T00:00:00.000Z") }]).map(
        (l) => ({
          subscription: l.subscription ?? null,
          period: l.periodEnd === undefined ? {} : { end: l.periodEnd },
        }),
      ),
    },
  };
  return {
    id,
    object: "event",
    type: "invoice.paid",
    data: { object: invoice },
  } as unknown as Stripe.Event;
}

function readRecord(store: Map<string, string>, subId: string): SubscriptionRecord {
  const raw = store.get(subscriptionRecordKey(subId));
  expect(raw, `record for ${subId}`).toBeTruthy();
  return JSON.parse(raw!) as SubscriptionRecord;
}

/** Assert no KV value leaks a signed key (sign-on-demand invariant). */
function expectNoSignedKeyInKv(store: Map<string, string>): void {
  for (const value of store.values()) {
    expect(value).not.toContain("SB1.");
  }
}

describe("invoice.paid handler (#110)", () => {
  it("Scenario: initial invoice.paid mints a subscription key from the payload", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const periodEnd = "2027-01-01T00:00:00.000Z";

    await handleInvoicePaid(
      invoicePaidEvent("evt_initial", {
        customerEmail: "a@b.c",
        lines: [{ subscription: "sub_1", periodEnd: unix(periodEnd) }],
      }),
      env,
      ctx,
    );

    const record = readRecord(store, "sub_1");
    expect(record.periodEnd).toBe(periodEnd);
    expect(record.email).toBe("a@b.c");
    expect(record.latestKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expectNoSignedKeyInKv(store);
  });

  it("Scenario: renewal mints a NEW key with a later period end, overwriting the record", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);

    await handleInvoicePaid(
      invoicePaidEvent("evt_r1", {
        lines: [{ subscription: "sub_1", periodEnd: unix("2027-01-01T00:00:00.000Z") }],
      }),
      env,
      ctx,
    );
    const first = readRecord(store, "sub_1");

    await handleInvoicePaid(
      invoicePaidEvent("evt_r2", {
        lines: [{ subscription: "sub_1", periodEnd: unix("2027-02-01T00:00:00.000Z") }],
      }),
      env,
      ctx,
    );
    const second = readRecord(store, "sub_1");

    expect(second.periodEnd).toBe("2027-02-01T00:00:00.000Z");
    // A fresh, immutable key each time → a different hash. The record is
    // overwritten (a single `sub:` entry), never the prior key mutated.
    expect(second.latestKeyHash).not.toBe(first.latestKeyHash);
    expect([...store.keys()].filter((k) => k.startsWith("sub:"))).toHaveLength(1);
    expectNoSignedKeyInKv(store);
  });

  it("records the end-to-end expiry/email contract from the payload", async () => {
    // Only the key's hash is stored (sign-on-demand), so the observable contract
    // is the record's period end + email; the key's byte-level correctness is
    // proven in license-sign.test.ts.
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const periodEnd = "2027-06-30T12:00:00.000Z";

    await handleInvoicePaid(
      invoicePaidEvent("evt_claims", {
        subscription: "sub_claims",
        customerEmail: "engineer@example.test",
        lines: [{ subscription: "sub_claims", periodEnd: unix(periodEnd) }],
      }),
      env,
      ctx,
    );

    const record = readRecord(store, "sub_claims");
    expect(record.periodEnd).toBe(periodEnd);
    expect(record.email).toBe("engineer@example.test");
  });

  it("expands the customer + subscription via the API when the payload omits them", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const periodEnd = unix("2028-03-15T00:00:00.000Z");

    const customersRetrieve = vi.fn(async () => ({ email: "expanded@example.test" }));
    const subscriptionsRetrieve = vi.fn(async () => ({
      items: { data: [{ current_period_end: periodEnd }] },
    }));
    const getStripe: InvoicePaidDeps["getStripe"] = () =>
      ({
        customers: { retrieve: customersRetrieve },
        subscriptions: { retrieve: subscriptionsRetrieve },
      }) as unknown as Stripe;

    await handleInvoicePaid(
      invoicePaidEvent("evt_expand", {
        subscription: "sub_expand",
        customer: "cus_expand",
        customerEmail: null, // forces customer expansion
        lines: [{ subscription: "sub_expand" }], // no period → forces subscription expansion
      }),
      env,
      ctx,
      { getStripe },
    );

    expect(customersRetrieve).toHaveBeenCalledWith("cus_expand");
    expect(subscriptionsRetrieve).toHaveBeenCalledWith("sub_expand");
    const record = readRecord(store, "sub_expand");
    expect(record.email).toBe("expanded@example.test");
    expect(record.periodEnd).toBe("2028-03-15T00:00:00.000Z");
    expectNoSignedKeyInKv(store);
  });

  it("uses the FURTHEST-OUT item period end when expanding a multi-item subscription", async () => {
    // Staggered billing anchors: the whole subscription is entitled through the
    // latest item end, not items.data[0]. Picking the first would expire early.
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const getStripe: InvoicePaidDeps["getStripe"] = () =>
      ({
        subscriptions: {
          retrieve: async () => ({
            items: {
              data: [
                { current_period_end: unix("2027-01-15T00:00:00.000Z") },
                { current_period_end: unix("2027-02-01T00:00:00.000Z") },
              ],
            },
          }),
        },
      }) as unknown as Stripe;

    await handleInvoicePaid(
      invoicePaidEvent("evt_multi", {
        subscription: "sub_multi",
        lines: [{ subscription: "sub_multi" }], // no period → forces subscription expansion
      }),
      env,
      ctx,
      { getStripe },
    );

    expect(readRecord(store, "sub_multi").periodEnd).toBe("2027-02-01T00:00:00.000Z");
  });

  it("does not expand when the payload already carries email and period end", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    const getStripe = vi.fn(() => {
      throw new Error("should not build a Stripe client");
    });

    await handleInvoicePaid(
      invoicePaidEvent("evt_nofetch"),
      env,
      ctx,
      { getStripe: getStripe as unknown as InvoicePaidDeps["getStripe"] },
    );

    expect(getStripe).not.toHaveBeenCalled();
  });

  it("acknowledges a non-subscription invoice without minting", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);

    await handleInvoicePaid(
      invoicePaidEvent("evt_oneoff", { subscription: null }),
      env,
      ctx,
    );

    expect(store.size).toBe(0);
  });

  it("throws when no period end can be resolved (so Stripe retries)", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const getStripe: InvoicePaidDeps["getStripe"] = () =>
      ({
        subscriptions: {
          retrieve: async () => ({ items: { data: [] } }),
        },
      }) as unknown as Stripe;

    await expect(
      handleInvoicePaid(
        invoicePaidEvent("evt_noend", {
          subscription: "sub_noend",
          lines: [{ subscription: "sub_noend" }],
        }),
        env,
        ctx,
        { getStripe },
      ),
    ).rejects.toThrow(/period end/);
    expect(store.size).toBe(0);
  });
});

describe("dispatch wiring (#110)", () => {
  it("registers invoice.paid and checkout founding payment events", () => {
    expect(eventHandlers["invoice.paid"]).toBe(handleInvoicePaid);
    expect(eventHandlers["checkout.session.completed"]).toBe(handleCheckoutCompleted);
    expect(eventHandlers["checkout.session.async_payment_succeeded"]).toBe(
      handleCheckoutCompleted,
    );
  });
});

// End-to-end through the real webhook: a replayed invoice.paid event id mints
// exactly once, because the dispatcher's `evt:<id>` marker de-duplicates before
// the handler runs a second time.
describe("invoice.paid idempotency through the webhook (#110)", () => {
  const WEBHOOK_SECRET = "whsec_test_secret_123";
  const signer = new Stripe("sk_test_signer", {
    httpClient: Stripe.createFetchHttpClient(),
  });

  it("Scenario: duplicate invoice.paid event id mints once", async () => {
    const { kv, store } = makeKv();
    const env = { ...makeEnv(kv), STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET };

    const body = JSON.stringify(
      invoicePaidEvent("evt_replayed", {
        lines: [{ subscription: "sub_1", periodEnd: unix("2027-09-01T00:00:00.000Z") }],
      }),
    );
    const signature = signer.webhooks.generateTestHeaderString({
      payload: body,
      secret: WEBHOOK_SECRET,
    });
    const post = () =>
      new Request("https://sound-buddy-api.test/api/stripe/webhook", {
        method: "POST",
        body,
        headers: { "stripe-signature": signature },
      });

    const first = await handleStripeWebhook(post(), env, ctx);
    expect(first.status).toBe(200);
    const minted = readRecord(store, "sub_1");

    const second = await handleStripeWebhook(post(), env, ctx);
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({ duplicate: true });

    // Same single record — the replay never re-minted (hash unchanged).
    expect(readRecord(store, "sub_1").latestKeyHash).toBe(minted.latestKeyHash);
    expect([...store.keys()].filter((k) => k.startsWith("sub:"))).toHaveLength(1);
    expectNoSignedKeyInKv(store);
  });
});
