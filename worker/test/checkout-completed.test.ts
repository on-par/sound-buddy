import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import Stripe from "stripe";
import {
  handleCheckoutCompleted,
  sessionRecordKey,
  type CheckoutCompletedDeps,
  type SessionRecord,
} from "../src/handlers/checkout-completed";
import { handleStripeWebhook } from "../src/webhook";
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
    SUPPORT_EMAIL: "support@example.test",
    CUSTOMER_PORTAL_URL: "https://portal.example.test",
    APP_ORIGIN: "https://example.test",
    STRIPE_WEBHOOK_SECRET: "whsec_unused",
    STRIPE_SECRET_KEY: "sk_test_unused",
    LICENSE_SIGNING_PRIVATE_KEY: PKCS8_PEM,
    RESEND_API_KEY: "re_test_unused",
    LICENSE_SIGNING_KID: "test-kid",
    LICENSE_PUBLIC_KEY: "",
  } satisfies Env;
}

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface CheckoutOverrides {
  type?: "checkout.session.completed" | "checkout.session.async_payment_succeeded";
  mode?: Stripe.Checkout.Session.Mode;
  paymentStatus?: Stripe.Checkout.Session.PaymentStatus;
  email?: string | null;
  customer?: string | null;
  sessionId?: string;
}

/** Build a Checkout Session event for founding payment tests. */
function checkoutEvent(id: string, o: CheckoutOverrides = {}): Stripe.Event {
  const email = o.email === undefined ? "a@b.c" : o.email;
  const session: Record<string, unknown> = {
    id: o.sessionId ?? "cs_test_1",
    object: "checkout.session",
    mode: o.mode ?? "payment",
    payment_status: o.paymentStatus ?? "paid",
    customer_details: { email },
    customer_email: email,
    customer: o.customer ?? "cus_1",
  };
  return {
    id,
    object: "event",
    type: o.type ?? "checkout.session.completed",
    data: { object: session },
  } as unknown as Stripe.Event;
}

function readSessionRecord(
  store: Map<string, string>,
  sessionId: string,
): SessionRecord {
  const raw = store.get(sessionRecordKey(sessionId));
  expect(raw, `record for ${sessionId}`).toBeTruthy();
  return JSON.parse(raw!) as SessionRecord;
}

/** Assert no KV value leaks a signed key (sign-on-demand invariant). */
function expectNoSignedKeyInKv(store: Map<string, string>): void {
  for (const value of store.values()) {
    expect(value).not.toContain("SB1.");
  }
}

describe("checkout completed handler (#111)", () => {
  it("Scenario: payment-mode completion mints a lifetime key", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);

    await handleCheckoutCompleted(
      checkoutEvent("evt_founder", {
        mode: "payment",
        paymentStatus: "paid",
        email: "a@b.c",
        sessionId: "cs_founder",
      }),
      env,
      ctx,
    );

    const record = readSessionRecord(store, "cs_founder");
    expect(record.kind).toBe("lifetime");
    expect(record.email).toBe("a@b.c");
    expect(record.latestKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expectNoSignedKeyInKv(store);
  });

  it("Scenario: founding mint triggers a key email", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const sendEmail = vi.fn(async () => ({ ok: true }));

    await handleCheckoutCompleted(
      checkoutEvent("evt_founder_email", {
        mode: "payment",
        paymentStatus: "paid",
        email: "founder@example.test",
        sessionId: "cs_founder_email",
      }),
      env,
      ctx,
      { sendEmail },
    );

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [calledEnv, params] = sendEmail.mock.calls[0] as unknown as Parameters<
      NonNullable<CheckoutCompletedDeps["sendEmail"]>
    >;
    expect(calledEnv).toBe(env);
    expect(params).toMatchObject({
      to: "founder@example.test",
      kind: "lifetime",
    });
    expect(params.key).toMatch(/^SB1\./);
    expect(readSessionRecord(store, "cs_founder_email").latestKeyHash).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expectNoSignedKeyInKv(store);
  });

  it("Scenario: subscription-mode completion is ignored", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);

    await handleCheckoutCompleted(
      checkoutEvent("evt_subscription", {
        mode: "subscription",
        paymentStatus: "paid",
        sessionId: "cs_subscription",
      }),
      env,
      ctx,
    );

    expect(store.size).toBe(0);
  });

  it("Scenario: async_payment_succeeded mints for delayed methods", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);

    await handleCheckoutCompleted(
      checkoutEvent("evt_async", {
        type: "checkout.session.async_payment_succeeded",
        mode: "payment",
        paymentStatus: "paid",
        sessionId: "cs_async",
      }),
      env,
      ctx,
    );

    expect(readSessionRecord(store, "cs_async").kind).toBe("lifetime");
    expectNoSignedKeyInKv(store);
  });

  it("Scenario: sync + async for the same session mint once", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);

    await handleCheckoutCompleted(
      checkoutEvent("evt_sync", { sessionId: "cs_once" }),
      env,
      ctx,
    );
    const first = readSessionRecord(store, "cs_once");

    await handleCheckoutCompleted(
      checkoutEvent("evt_async", {
        type: "checkout.session.async_payment_succeeded",
        sessionId: "cs_once",
      }),
      env,
      ctx,
    );
    const second = readSessionRecord(store, "cs_once");

    expect(second.latestKeyHash).toBe(first.latestKeyHash);
    expect([...store.keys()].filter((k) => k.startsWith("sess:"))).toHaveLength(1);
    expectNoSignedKeyInKv(store);
  });

  it("Scenario: delayed-method completed is unpaid, later async mints", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);

    await handleCheckoutCompleted(
      checkoutEvent("evt_unpaid", {
        type: "checkout.session.completed",
        paymentStatus: "unpaid",
        sessionId: "cs_delayed",
      }),
      env,
      ctx,
    );
    expect(store.size).toBe(0);

    await handleCheckoutCompleted(
      checkoutEvent("evt_paid_later", {
        type: "checkout.session.async_payment_succeeded",
        paymentStatus: "paid",
        sessionId: "cs_delayed",
      }),
      env,
      ctx,
    );

    expect(readSessionRecord(store, "cs_delayed").kind).toBe("lifetime");
    expect([...store.keys()].filter((k) => k.startsWith("sess:"))).toHaveLength(1);
    expectNoSignedKeyInKv(store);
  });

  it("looks up the customer via the API when the payload omits email", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const customersRetrieve = vi.fn(async () => ({ email: "expanded@example.test" }));
    const getStripe: CheckoutCompletedDeps["getStripe"] = () =>
      ({
        customers: { retrieve: customersRetrieve },
      }) as unknown as Stripe;

    await handleCheckoutCompleted(
      checkoutEvent("evt_expand", {
        email: null,
        customer: "cus_x",
        sessionId: "cs_expand",
      }),
      env,
      ctx,
      { getStripe },
    );

    expect(customersRetrieve).toHaveBeenCalledWith("cus_x");
    const record = readSessionRecord(store, "cs_expand");
    expect(record.email).toBe("expanded@example.test");
    expectNoSignedKeyInKv(store);
  });

  it("does not look up the customer when the payload already carries email", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    const getStripe = vi.fn(() => {
      throw new Error("should not build a Stripe client");
    });

    await handleCheckoutCompleted(
      checkoutEvent("evt_nofetch", { email: "payload@example.test" }),
      env,
      ctx,
      { getStripe: getStripe as unknown as CheckoutCompletedDeps["getStripe"] },
    );

    expect(getStripe).not.toHaveBeenCalled();
  });
});

describe("checkout completed idempotency through the webhook (#111)", () => {
  const WEBHOOK_SECRET = "whsec_test_secret_123";
  const signer = new Stripe("sk_test_signer", {
    httpClient: Stripe.createFetchHttpClient(),
  });

  it("Scenario: completed + async_payment_succeeded event ids mint once", async () => {
    const { kv, store } = makeKv();
    const env = { ...makeEnv(kv), STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET };

    const sign = (body: string): string =>
      signer.webhooks.generateTestHeaderString({
        payload: body,
        secret: WEBHOOK_SECRET,
      });
    const post = (body: string) =>
      new Request("https://sound-buddy-api.test/api/stripe/webhook", {
        method: "POST",
        body,
        headers: { "stripe-signature": sign(body) },
      });

    const completed = JSON.stringify(
      checkoutEvent("evt_completed", {
        type: "checkout.session.completed",
        sessionId: "cs_webhook_once",
      }),
    );
    const asyncSucceeded = JSON.stringify(
      checkoutEvent("evt_async_succeeded", {
        type: "checkout.session.async_payment_succeeded",
        sessionId: "cs_webhook_once",
      }),
    );

    const first = await handleStripeWebhook(post(completed), env, ctx);
    expect(first.status).toBe(200);
    const minted = readSessionRecord(store, "cs_webhook_once");

    const second = await handleStripeWebhook(post(asyncSucceeded), env, ctx);
    expect(second.status).toBe(200);

    expect(readSessionRecord(store, "cs_webhook_once").latestKeyHash).toBe(
      minted.latestKeyHash,
    );
    expect([...store.keys()].filter((k) => k.startsWith("sess:"))).toHaveLength(1);
    expectNoSignedKeyInKv(store);
  });

  it("Scenario: email failure does not fail the webhook", async () => {
    const { kv, store } = makeKv();
    const env = { ...makeEnv(kv), STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET };
    const sendEmail = vi.fn(async () => {
      throw new Error("resend down");
    });

    const body = JSON.stringify(
      checkoutEvent("evt_checkout_email_failure", {
        type: "checkout.session.completed",
        sessionId: "cs_email_failure",
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

    const res = await handleStripeWebhook(post(), env, ctx, {
      handlers: {
        "checkout.session.completed": (event, handlerEnv, handlerCtx) =>
          handleCheckoutCompleted(event, handlerEnv, handlerCtx, { sendEmail }),
      },
    });

    expect(res.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const record = readSessionRecord(store, "cs_email_failure");
    expect(record.latestKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expectNoSignedKeyInKv(store);
  });
});
