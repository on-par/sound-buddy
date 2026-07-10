import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import Stripe from "stripe";
import { handleGetLicense, type LicenseDeps } from "../src/handlers/license";
import { importVerifyKey, verifyLicenseKey } from "../src/license-sign";
import type { Env } from "../src/index";

// A throwaway signing keypair, generated exactly as scripts/license-keygen.mjs
// does (ed25519 → pkcs8/spki PEM). The real production key (H3) is never used.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PKCS8_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const SPKI_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();

/** In-memory KV double backed by a Map, exposing get/put with TTL. */
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
  } satisfies Env;
}

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

const NOW = new Date("2026-07-09T12:00:00.000Z");
const unix = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

const request = (sessionId?: string): Request =>
  new Request(
    `https://sound-buddy-api.test/api/license${sessionId !== undefined ? `?session_id=${encodeURIComponent(sessionId)}` : ""}`,
  );

interface StubStripeOverrides {
  session?: Record<string, unknown> | (() => never);
  subscription?: Record<string, unknown> | (() => never);
  customer?: Record<string, unknown>;
}

function stubStripe(o: StubStripeOverrides = {}): LicenseDeps["getStripe"] {
  return () =>
    ({
      checkout: {
        sessions: {
          retrieve: async () => {
            if (typeof o.session === "function") return o.session();
            return o.session ?? {};
          },
        },
      },
      subscriptions: {
        retrieve: async () => {
          if (typeof o.subscription === "function") return o.subscription();
          return o.subscription ?? {};
        },
      },
      customers: {
        retrieve: async () => o.customer ?? { email: undefined },
      },
    }) as unknown as Stripe;
}

async function verifyKey(key: string) {
  const verifyKeyHandle = await importVerifyKey(SPKI_PEM);
  return verifyLicenseKey(key, verifyKeyHandle, NOW);
}

describe("GET /api/license (#112)", () => {
  it("Scenario: paid payment-mode session mints a lifetime key", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const getStripe = stubStripe({
      session: {
        id: "cs_paid",
        mode: "payment",
        payment_status: "paid",
        status: "complete",
        created: unix("2026-07-09T11:00:00.000Z"),
        customer_details: { email: "buyer@example.test" },
      },
    });

    const res = await handleGetLicense(request("cs_paid"), env, ctx, {
      getStripe,
      now: () => NOW,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { key: string };
    expect(body.key.startsWith("SB1.")).toBe(true);

    const state = await verifyKey(body.key);
    expect(state.tier).toBe("pro");
    expect(state.kind).toBe("lifetime");
    expect(state.email).toBe("buyer@example.test");
    for (const value of store.values()) expect(value).not.toContain("SB1.");
  });

  it("Scenario: race — webhook has NOT written sess: yet, still mints from Stripe", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    expect(store.size).toBe(0); // KV empty — no sess: record written by any webhook.

    const getStripe = stubStripe({
      session: {
        id: "cs_race",
        mode: "payment",
        payment_status: "paid",
        status: "complete",
        created: unix("2026-07-09T11:00:00.000Z"),
        customer_details: { email: "racer@example.test" },
      },
    });

    const res = await handleGetLicense(request("cs_race"), env, ctx, {
      getStripe,
      now: () => NOW,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { key: string };
    const state = await verifyKey(body.key);
    expect(state.tier).toBe("pro");
    expect(state.kind).toBe("lifetime");
    for (const value of store.values()) expect(value).not.toContain("SB1.");
  });

  it("Scenario: active subscription session mints a subscription key", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const periodEnd = unix("2027-01-01T00:00:00.000Z");
    const getStripe = stubStripe({
      session: {
        id: "cs_sub",
        mode: "subscription",
        status: "complete",
        created: unix("2026-07-09T11:00:00.000Z"),
        subscription: "sub_active",
        customer_details: { email: "subscriber@example.test" },
      },
      subscription: {
        status: "active",
        items: { data: [{ current_period_end: periodEnd }] },
      },
    });

    const res = await handleGetLicense(request("cs_sub"), env, ctx, {
      getStripe,
      now: () => NOW,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { key: string };
    const state = await verifyKey(body.key);
    expect(state.tier).toBe("pro");
    expect(state.kind).toBe("subscription");
    expect(state.expiresAt).toBe("2027-01-01T00:00:00.000Z");
    for (const value of store.values()) expect(value).not.toContain("SB1.");
  });

  it("Scenario: terminal not-paid session refuses with no key or Stripe details", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const getStripe = stubStripe({
      session: {
        id: "cs_expired",
        mode: "payment",
        payment_status: "unpaid",
        status: "expired",
        created: unix("2026-07-09T11:00:00.000Z"),
        customer_details: { email: "ghost@example.test" },
      },
    });

    const res = await handleGetLicense(request("cs_expired"), env, ctx, {
      getStripe,
      now: () => NOW,
    });

    expect(res.status).toBe(402);
    const bodyText = await res.text();
    expect(bodyText).not.toContain("SB1.");
    expect(bodyText).not.toContain("ghost@example.test");
    expect(bodyText).not.toContain("cs_expired");
    for (const value of store.values()) expect(value).not.toContain("SB1.");
  });

  it("Scenario: unknown session id refuses without details", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    const getStripe = stubStripe({
      session: () => {
        throw new Error("No such checkout session: cs_unknown");
      },
    });

    const res = await handleGetLicense(request("cs_unknown"), env, ctx, {
      getStripe,
      now: () => NOW,
    });

    expect(res.status).toBe(404);
    const bodyText = await res.text();
    expect(bodyText).not.toContain("SB1.");
    expect(bodyText).not.toContain("No such checkout session");
  });

  it("Scenario: an oversized session_id refuses as unknown, never reaching KV/Stripe", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    const getStripe = vi.fn(() => {
      throw new Error("should not build a Stripe client");
    });

    const res = await handleGetLicense(request("cs_" + "x".repeat(250)), env, ctx, {
      getStripe: getStripe as unknown as LicenseDeps["getStripe"],
      now: () => NOW,
    });

    expect(res.status).toBe(404);
    expect(getStripe).not.toHaveBeenCalled();
  });

  it("Scenario: a failing subscription lookup refuses as unknown without leaking the Stripe error", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const getStripe = stubStripe({
      session: {
        id: "cs_sub_error",
        mode: "subscription",
        status: "complete",
        created: unix("2026-07-09T11:00:00.000Z"),
        subscription: "sub_gone",
      },
      subscription: () => {
        throw new Error("No such subscription: sub_gone");
      },
    });

    const res = await handleGetLicense(request("cs_sub_error"), env, ctx, {
      getStripe,
      now: () => NOW,
    });

    expect(res.status).toBe(404);
    const bodyText = await res.text();
    expect(bodyText).not.toContain("SB1.");
    expect(bodyText).not.toContain("No such subscription");
    for (const value of store.values()) expect(value).not.toContain("SB1.");
  });

  it("Scenario: entitled subscription with no derivable period end returns 202 pending, not a terminal refusal", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    const getStripe = stubStripe({
      session: {
        id: "cs_sub_no_period",
        mode: "subscription",
        status: "complete",
        created: unix("2026-07-09T11:00:00.000Z"),
        subscription: "sub_no_period",
      },
      subscription: { status: "active", items: { data: [] } },
    });

    const res = await handleGetLicense(request("cs_sub_no_period"), env, ctx, {
      getStripe,
      now: () => NOW,
    });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({ status: "pending" });
  });

  it("Scenario: subscription-mode session completed but not yet carrying a subscription id is pending, not terminal", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    const getStripe = stubStripe({
      session: {
        id: "cs_sub_lag",
        mode: "subscription",
        status: "complete", // completed, but Stripe hasn't attached the subscription id yet
        created: unix("2026-07-09T11:00:00.000Z"),
        subscription: null,
      },
    });

    const res = await handleGetLicense(request("cs_sub_lag"), env, ctx, {
      getStripe,
      now: () => NOW,
    });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({ status: "pending" });
  });

  it("Scenario: pending payment-mode session returns 202 with no key", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    const getStripe = stubStripe({
      session: {
        id: "cs_pending",
        mode: "payment",
        payment_status: "unpaid",
        status: "open",
        created: unix("2026-07-09T11:00:00.000Z"),
      },
    });

    const res = await handleGetLicense(request("cs_pending"), env, ctx, {
      getStripe,
      now: () => NOW,
    });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({ status: "pending" });
  });

  it("Scenario: incomplete subscription returns 202 with no key", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    const getStripe = stubStripe({
      session: {
        id: "cs_sub_pending",
        mode: "subscription",
        status: "open",
        created: unix("2026-07-09T11:00:00.000Z"),
        subscription: "sub_incomplete",
      },
      subscription: { status: "incomplete", items: { data: [] } },
    });

    const res = await handleGetLicense(request("cs_sub_pending"), env, ctx, {
      getStripe,
      now: () => NOW,
    });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({ status: "pending" });
  });

  it("Scenario: missing session_id returns 400", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);

    const res = await handleGetLicense(request(), env, ctx, { now: () => NOW });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "missing_session_id" });
  });

  it("Scenario: fetch window expired (session.created > 48h ago) returns 410", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    const getStripe = stubStripe({
      session: {
        id: "cs_old",
        mode: "payment",
        payment_status: "paid",
        status: "complete",
        created: unix("2026-07-01T00:00:00.000Z"), // >48h before NOW
        customer_details: { email: "late@example.test" },
      },
    });

    const res = await handleGetLicense(request("cs_old"), env, ctx, {
      getStripe,
      now: () => NOW,
    });

    expect(res.status).toBe(410);
    const bodyText = await res.text();
    expect(bodyText).not.toContain("SB1.");
  });

  it("Scenario: rate limits after the cap for one session id", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const getStripe = stubStripe({
      session: {
        id: "cs_hot",
        mode: "payment",
        payment_status: "paid",
        status: "complete",
        created: unix("2026-07-09T11:00:00.000Z"),
        customer_details: { email: "hot@example.test" },
      },
    });

    let last!: Response;
    for (let i = 0; i < 21; i++) {
      last = await handleGetLicense(request("cs_hot"), env, ctx, {
        getStripe,
        now: () => NOW,
      });
    }

    expect(last.status).toBe(429);
    const body = await last.json();
    expect(body).toEqual({ error: "rate_limited" });
    for (const value of store.values()) expect(value).not.toContain("SB1.");
  });
});
