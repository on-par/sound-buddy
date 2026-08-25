// Acceptance suite for #1155: pins the issue's named verification command
// (`npm test -- webhook-verify.test.ts`) to executable checks against the
// already-shipped handleStripeWebhook (see webhook.ts, webhook.test.ts).
// No source changes accompany this file — see .factory/plans/issue-1155.md.

import { describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { handleStripeWebhook, type EventHandler } from "./webhook";
import type { Env } from "./index";

const WEBHOOK_SECRET = "whsec_test_secret_123";

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

const payloadFor = (id: string, type = "checkout.session.completed"): string =>
  JSON.stringify({ id, object: "event", type, data: { object: {} } });

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://sound-buddy-api.test/api/stripe/webhook", {
    method: "POST",
    body,
    headers,
  });
}

describe("#1155 acceptance: webhook signature verification + KV idempotency", () => {
  it("validly-signed request dispatches to the registered handler and returns 200", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const handler = vi.fn<EventHandler>();
    const body = payloadFor("evt_accept_123");

    const res = await handleStripeWebhook(
      post(body, { "stripe-signature": sign(body) }),
      env,
      ctx,
      { handlers: { "checkout.session.completed": handler } },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ received: true });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].id).toBe("evt_accept_123");
    expect(store.get("evt:evt_accept_123")).toBe("checkout.session.completed");
  });

  it("invalid signature is rejected with 400 and writes nothing to KV", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const handler = vi.fn<EventHandler>();
    const body = payloadFor("evt_accept_bad_sig");

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

  it("missing signature header is rejected with 400 and writes nothing to KV", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const handler = vi.fn<EventHandler>();
    const body = payloadFor("evt_accept_no_sig");

    const res = await handleStripeWebhook(post(body), env, ctx, {
      handlers: { "checkout.session.completed": handler },
    });

    expect(res.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it("a replayed event id is acknowledged with 200 without re-invoking the handler", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const handler = vi.fn<EventHandler>();
    const body = payloadFor("evt_accept_dupe");
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

    const second = await handleStripeWebhook(
      post(body, { "stripe-signature": signature }),
      env,
      ctx,
      deps,
    );
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({ duplicate: true });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(1);
  });
});
