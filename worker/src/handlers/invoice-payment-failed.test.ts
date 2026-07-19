import { describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import {
  handleInvoicePaymentFailed,
  type InvoicePaymentFailedDeps,
} from "./invoice-payment-failed";
import { eventHandlers, handleStripeWebhook, type EventHandler } from "../webhook";
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

interface InvoiceOverrides {
  subscription?: string | null;
  customerEmail?: string | null;
  customer?: string;
}

/** Build an `invoice.payment_failed` event with a subscription by default. */
function invoicePaymentFailedEvent(
  id: string,
  o: InvoiceOverrides = {},
): Stripe.Event {
  const sub = o.subscription === undefined ? "sub_1" : o.subscription;
  const invoice: Record<string, unknown> = {
    id: "in_1",
    object: "invoice",
    customer: o.customer ?? "cus_1",
    customer_email: o.customerEmail === undefined ? "a@b.c" : o.customerEmail,
    parent: sub ? { subscription_details: { subscription: sub } } : null,
  };
  return {
    id,
    object: "event",
    type: "invoice.payment_failed",
    data: { object: invoice },
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

describe("invoice.payment_failed handler (#118)", () => {
  it("Scenario: payment failure sends a dunning email", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    const sendEmail = vi.fn(async () => ({ ok: true }));

    await handleInvoicePaymentFailed(
      invoicePaymentFailedEvent("evt_failed_email", {
        customerEmail: "a@b.c",
      }),
      env,
      ctx,
      { sendEmail },
    );

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [calledEnv, params] = sendEmail.mock.calls[0] as unknown as Parameters<
      NonNullable<InvoicePaymentFailedDeps["sendEmail"]>
    >;
    expect(calledEnv).toBe(env);
    expect(params).toEqual({ to: "a@b.c" });
    expect(env.CUSTOMER_PORTAL_URL).toBe("https://portal.example.test");
  });

  it("Scenario: no entitlement change on failure", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);

    await handleInvoicePaymentFailed(
      invoicePaymentFailedEvent("evt_no_entitlement"),
      env,
      ctx,
      { sendEmail: vi.fn(async () => ({ ok: true })) },
    );

    expect(store.size).toBe(0);
    expect([...store.keys()].filter((key) => key.startsWith("sub:"))).toHaveLength(0);
    expectNoSignedKeyInKv(store);
  });

  it("Scenario: duplicate failure event emails once", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    const sendEmail = vi.fn(async () => ({ ok: true }));
    const body = JSON.stringify(
      invoicePaymentFailedEvent("evt_failed_replayed", {
        customerEmail: "a@b.c",
      }),
    );
    const signature = signer.webhooks.generateTestHeaderString({
      payload: body,
      secret: WEBHOOK_SECRET,
    });
    const handler: EventHandler = (event, handlerEnv, handlerCtx) =>
      handleInvoicePaymentFailed(event, handlerEnv, handlerCtx, { sendEmail });

    const first = await handleStripeWebhook(post(body, signature), env, ctx, {
      handlers: { "invoice.payment_failed": handler },
    });
    expect(first.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);

    const second = await handleStripeWebhook(post(body, signature), env, ctx, {
      handlers: { "invoice.payment_failed": handler },
    });
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({ duplicate: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("expands the customer via the API when the payload omits email", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    const customersRetrieve = vi.fn(async () => ({ email: "expanded@example.test" }));
    const getStripe = vi.fn(() =>
      ({
        customers: { retrieve: customersRetrieve },
      }) as unknown as Stripe,
    );
    const sendEmail = vi.fn(async () => ({ ok: true }));

    await handleInvoicePaymentFailed(
      invoicePaymentFailedEvent("evt_expand_failed", {
        customer: "cus_x",
        customerEmail: null,
      }),
      env,
      ctx,
      {
        getStripe: getStripe as unknown as InvoicePaymentFailedDeps["getStripe"],
        sendEmail,
      },
    );

    expect(getStripe).toHaveBeenCalledWith(env);
    expect(customersRetrieve).toHaveBeenCalledWith("cus_x");
    expect(sendEmail).toHaveBeenCalledWith(env, { to: "expanded@example.test" });
  });

  it("expands to a deleted customer — dunning email sent with no recipient", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    const customersRetrieve = vi.fn(async () => ({ deleted: true }));
    const getStripe = vi.fn(() =>
      ({
        customers: { retrieve: customersRetrieve },
      }) as unknown as Stripe,
    );
    const sendEmail = vi.fn(async () => ({ ok: true }));

    await handleInvoicePaymentFailed(
      invoicePaymentFailedEvent("evt_expand_deleted", {
        customer: "cus_deleted",
        customerEmail: null,
      }),
      env,
      ctx,
      {
        getStripe: getStripe as unknown as InvoicePaymentFailedDeps["getStripe"],
        sendEmail,
      },
    );

    expect(customersRetrieve).toHaveBeenCalledWith("cus_deleted");
    expect(sendEmail).toHaveBeenCalledWith(env, { to: undefined });
  });

  it("does not expand the customer when the payload carries email", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    const getStripe = vi.fn(() => {
      throw new Error("should not build a Stripe client");
    });

    await handleInvoicePaymentFailed(
      invoicePaymentFailedEvent("evt_no_expand_failed", {
        customerEmail: "a@b.c",
      }),
      env,
      ctx,
      {
        getStripe: getStripe as unknown as InvoicePaymentFailedDeps["getStripe"],
        sendEmail: vi.fn(async () => ({ ok: true })),
      },
    );

    expect(getStripe).not.toHaveBeenCalled();
  });

  it("Scenario: email failure does not fail the webhook", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const sendEmail = vi.fn(async () => {
      throw new Error("resend down");
    });
    const body = JSON.stringify(
      invoicePaymentFailedEvent("evt_failed_delivery", {
        subscription: "sub_failed_delivery",
        customerEmail: "a@b.c",
      }),
    );
    const signature = signer.webhooks.generateTestHeaderString({
      payload: body,
      secret: WEBHOOK_SECRET,
    });

    const res = await handleStripeWebhook(post(body, signature), env, ctx, {
      handlers: {
        "invoice.payment_failed": (event, handlerEnv, handlerCtx) =>
          handleInvoicePaymentFailed(event, handlerEnv, handlerCtx, { sendEmail }),
      },
    });

    expect(res.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect([...store.keys()].filter((key) => key.startsWith("sub:"))).toHaveLength(0);
    expectNoSignedKeyInKv(store);
  });
});

describe("dispatch wiring (#118)", () => {
  it("registers invoice.payment_failed", () => {
    expect(eventHandlers["invoice.payment_failed"]).toBe(handleInvoicePaymentFailed);
  });
});
