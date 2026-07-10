import { describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { handleStripeWebhook, type EventHandler } from "../src/webhook";
import type { Env } from "../src/index";

// Local test secret — the live `whsec_` secret is provisioned out-of-band (H4);
// tests sign their own fixtures against this one.
const WEBHOOK_SECRET = "whsec_test_secret_123";

// A Stripe client used only to sign fixtures. `generateTestHeaderString` mints a
// valid `Stripe-Signature` header for a payload, exactly as a live webhook would.
const signer = new Stripe("sk_test_signer", {
  httpClient: Stripe.createFetchHttpClient(),
});

const sign = (payload: string, secret = WEBHOOK_SECRET): string =>
  signer.webhooks.generateTestHeaderString({ payload, secret });

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
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_SECRET_KEY: "sk_test_unused",
    LICENSE_SIGNING_PRIVATE_KEY: "",
    LICENSE_SIGNING_KID: "test-kid",
    LICENSE_PUBLIC_KEY: "",
  } satisfies Env;
}

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

const payloadFor = (id: string, type = "checkout.session.completed"): string =>
  JSON.stringify({ id, object: "event", type, data: { object: {} } });

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://sound-buddy-api.test/api/stripe/webhook", {
    method: "POST",
    body,
    headers,
  });
}

describe("stripe webhook: signature verification + idempotency", () => {
  it("accepts a validly-signed request, dispatches it, and returns 200", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const handler = vi.fn<EventHandler>();
    const body = payloadFor("evt_123");

    const res = await handleStripeWebhook(
      post(body, { "stripe-signature": sign(body) }),
      env,
      ctx,
      { handlers: { "checkout.session.completed": handler } },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ received: true });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].id).toBe("evt_123");
    // Idempotency marker recorded, and it holds no payload data.
    expect(store.get("evt:evt_123")).toBe("checkout.session.completed");
  });

  it("rejects a bad signature with 400, invoking no handler and writing nothing to KV", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const handler = vi.fn<EventHandler>();
    const body = payloadFor("evt_bad");

    // Signed with the wrong secret → signature will not match the configured one.
    const res = await handleStripeWebhook(
      post(body, { "stripe-signature": sign(body, "whsec_wrong_secret") }),
      env,
      ctx,
      { handlers: { "checkout.session.completed": handler } },
    );

    expect(res.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it("rejects a tampered body (signature no longer matches) with 400", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const handler = vi.fn<EventHandler>();
    const signed = payloadFor("evt_tamper");
    const signature = sign(signed);
    const tampered = payloadFor("evt_tamper_swapped");

    const res = await handleStripeWebhook(
      post(tampered, { "stripe-signature": signature }),
      env,
      ctx,
      { handlers: { "checkout.session.completed": handler } },
    );

    expect(res.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it("rejects a missing signature header with 400 before touching KV", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const handler = vi.fn<EventHandler>();
    const body = payloadFor("evt_nosig");

    const res = await handleStripeWebhook(post(body), env, ctx, {
      handlers: { "checkout.session.completed": handler },
    });

    expect(res.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it("processes a replayed event id exactly once (idempotency)", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const handler = vi.fn<EventHandler>();
    const body = payloadFor("evt_dupe");
    const signature = sign(body);
    const deps = { handlers: { "checkout.session.completed": handler } };

    const first = await handleStripeWebhook(
      post(body, { "stripe-signature": signature }),
      env,
      ctx,
      deps,
    );
    expect(first.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);

    // Identically-signed replay of the same event id.
    const second = await handleStripeWebhook(
      post(body, { "stripe-signature": signature }),
      env,
      ctx,
      deps,
    );
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({ duplicate: true });
    // Handler NOT invoked a second time.
    expect(handler).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(1);
  });

  it("acknowledges (200) and records a verified event with no registered handler", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const body = payloadFor("evt_unhandled", "customer.subscription.updated");

    const res = await handleStripeWebhook(
      post(body, { "stripe-signature": sign(body) }),
      env,
      ctx,
      { handlers: {} },
    );

    expect(res.status).toBe(200);
    expect(store.get("evt:evt_unhandled")).toBe("customer.subscription.updated");
  });

  it("does not record the event (500) when a handler throws, so Stripe retries", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const body = payloadFor("evt_throws");
    const handler = vi.fn<EventHandler>(() => {
      throw new Error("handler blew up");
    });

    await expect(
      handleStripeWebhook(post(body, { "stripe-signature": sign(body) }), env, ctx, {
        handlers: { "checkout.session.completed": handler },
      }),
    ).rejects.toThrow("handler blew up");

    // Nothing recorded → the retry will be treated as first-sight.
    expect(store.size).toBe(0);
  });

  it("returns 500 (not 400) when the signing secret is not configured", async () => {
    const { kv, store } = makeKv();
    const env = { ...makeEnv(kv), STRIPE_WEBHOOK_SECRET: "" };
    const body = payloadFor("evt_nosecret");

    const res = await handleStripeWebhook(
      post(body, { "stripe-signature": sign(body) }),
      env,
      ctx,
    );

    expect(res.status).toBe(500);
    expect(store.size).toBe(0);
  });
});
