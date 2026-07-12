import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import Stripe from "stripe";
import { handleRefreshLicense, type RefreshDeps } from "./license-refresh";
import {
  importSigningKey,
  importVerifyKey,
  mintLicenseKey,
  sha256Hex,
  verifyLicenseKey,
} from "../license-sign";
import { subscriptionRecordKey, type SubscriptionRecord } from "./invoice-paid";
import type { Env } from "../index";

// A throwaway signing keypair, generated exactly as scripts/license-keygen.mjs
// does (ed25519 → pkcs8/spki PEM). The real production key (H3) is never used.
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PKCS8_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const SPKI_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();

// A second, unrelated keypair — used to sign a "forged" key that will never
// verify against SPKI_PEM.
const { privateKey: otherPrivateKey } = generateKeyPairSync("ed25519");
const OTHER_PKCS8_PEM = otherPrivateKey.export({ type: "pkcs8", format: "pem" }).toString();

/** In-memory KV double backed by a Map, with a spy-able `get`. */
function makeKv(): {
  kv: KVNamespace;
  store: Map<string, string>;
  getSpy: ReturnType<typeof vi.fn>;
} {
  const store = new Map<string, string>();
  const getSpy = vi.fn(async (key: string) => (store.has(key) ? store.get(key)! : null));
  const kv = {
    get: getSpy,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  } as unknown as KVNamespace;
  return { kv, store, getSpy };
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
    LICENSE_PUBLIC_KEY: SPKI_PEM,
  } satisfies Env;
}

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

const NOW = new Date("2026-07-09T12:00:00.000Z");
const unix = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

const request = (body: unknown): Request =>
  new Request("https://sound-buddy-api.test/api/license/refresh", {
    method: "POST",
    body: JSON.stringify(body),
  });

const rawRequest = (rawBody: string): Request =>
  new Request("https://sound-buddy-api.test/api/license/refresh", {
    method: "POST",
    body: rawBody,
  });

interface MintOverrides {
  kind?: "subscription" | "lifetime";
  sub?: string;
  email?: string;
  expiresAt?: string;
  signingPem?: string;
}

/** Mint a key signed by the throwaway private key (or an override PEM). */
async function mintPresentedKey(o: MintOverrides = {}): Promise<string> {
  const signingKey = await importSigningKey(o.signingPem ?? PKCS8_PEM);
  return mintLicenseKey(signingKey, {
    kind: o.kind ?? "subscription",
    kid: "test-kid",
    ...(o.email ? { email: o.email } : {}),
    ...((o.kind ?? "subscription") === "subscription"
      ? { expiresAt: o.expiresAt ?? "2026-07-01T00:00:00.000Z", sub: o.sub ?? "sub_123" }
      : {}),
  });
}

async function seedRecord(
  store: Map<string, string>,
  sub: string,
  presentedKey: string,
  overrides: Partial<SubscriptionRecord> = {},
): Promise<void> {
  const record: SubscriptionRecord = {
    latestKeyHash: await sha256Hex(presentedKey),
    periodEnd: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
  store.set(subscriptionRecordKey(sub), JSON.stringify(record));
}

interface StubStripeOverrides {
  subscription?: Record<string, unknown> | (() => never);
}

function stubStripe(o: StubStripeOverrides = {}): RefreshDeps["getStripe"] {
  return () =>
    ({
      subscriptions: {
        retrieve: async () => {
          if (typeof o.subscription === "function") return o.subscription();
          return o.subscription ?? {};
        },
      },
    }) as unknown as Stripe;
}

async function verifyKey(key: string) {
  const verifyKeyHandle = await importVerifyKey(SPKI_PEM);
  return verifyLicenseKey(key, verifyKeyHandle, NOW);
}

describe("POST /api/license/refresh (#113)", () => {
  it("Scenario: valid latest key, active subscription → 200 with a new signed key, hash rotated", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const presentedKey = await mintPresentedKey({
      sub: "sub_123",
      expiresAt: "2026-07-01T00:00:00.000Z", // ~8 days before NOW — in-window
      email: "subscriber@example.test",
    });
    await seedRecord(store, "sub_123", presentedKey, { email: "subscriber@example.test" });

    const periodEnd = unix("2027-01-01T00:00:00.000Z");
    const getStripe = stubStripe({ subscription: { status: "active", items: { data: [{ current_period_end: periodEnd }] } } });

    const res = await handleRefreshLicense(request({ key: presentedKey }), env, ctx, {
      getStripe,
      now: () => NOW,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { key: string };
    const state = await verifyKey(body.key);
    expect(state.tier).toBe("pro");
    expect(state.kind).toBe("subscription");
    expect(state.expiresAt).toBe("2027-01-01T00:00:00.000Z");

    const record = JSON.parse(store.get(subscriptionRecordKey("sub_123"))!) as SubscriptionRecord;
    expect(record.latestKeyHash).toBe(await sha256Hex(body.key));
    expect(record.latestKeyHash).not.toBe(await sha256Hex(presentedKey));
    for (const value of store.values()) expect(value).not.toContain("SB1.");
  });

  it("Scenario: forged/tampered signature → 401, no KV read, no Stripe call", async () => {
    const { kv, getSpy } = makeKv();
    const env = makeEnv(kv);
    const forgedKey = await mintPresentedKey({ sub: "sub_123", signingPem: OTHER_PKCS8_PEM });
    const getStripe = vi.fn(() => {
      throw new Error("should not build a Stripe client");
    });

    const res = await handleRefreshLicense(request({ key: forgedKey }), env, ctx, {
      getStripe: getStripe as unknown as RefreshDeps["getStripe"],
      now: () => NOW,
    });

    expect(res.status).toBe(401);
    const bodyText = await res.text();
    expect(bodyText).not.toContain("SB1.");
    expect(getStripe).not.toHaveBeenCalled();
    expect(getSpy).not.toHaveBeenCalled();
  });

  it("Scenario: superseded (non-latest) key → 403, no mint", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const presentedKey = await mintPresentedKey({ sub: "sub_123" });
    // Seed the record with a DIFFERENT latest hash — presented key is stale.
    await seedRecord(store, "sub_123", "SB1.some-other-latest-key.sig");
    const before = store.get(subscriptionRecordKey("sub_123"));

    const getStripe = vi.fn(() => {
      throw new Error("should not build a Stripe client");
    });

    const res = await handleRefreshLicense(request({ key: presentedKey }), env, ctx, {
      getStripe: getStripe as unknown as RefreshDeps["getStripe"],
      now: () => NOW,
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "superseded" });
    expect(getStripe).not.toHaveBeenCalled();
    expect(store.get(subscriptionRecordKey("sub_123"))).toBe(before);
  });

  it("Scenario: canceled subscription → 403 no-active-subscription, no mint", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const presentedKey = await mintPresentedKey({ sub: "sub_canceled" });
    await seedRecord(store, "sub_canceled", presentedKey);
    const before = store.get(subscriptionRecordKey("sub_canceled"));

    const getStripe = stubStripe({ subscription: { status: "canceled" } });

    const res = await handleRefreshLicense(request({ key: presentedKey }), env, ctx, {
      getStripe,
      now: () => NOW,
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "no-active-subscription" });
    expect(store.get(subscriptionRecordKey("sub_canceled"))).toBe(before);
  });

  it("Scenario: canceled subscription with no KV record → 403 no-active-subscription, no mint", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const presentedKey = await mintPresentedKey({ sub: "sub_gone" });
    const getStripe = stubStripe({ subscription: { status: "canceled" } });

    const res = await handleRefreshLicense(request({ key: presentedKey }), env, ctx, {
      getStripe,
      now: () => NOW,
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "no-active-subscription" });
    expect(store.has(subscriptionRecordKey("sub_gone"))).toBe(false);
  });

  it("Scenario: lifetime key → 200 { status: 'lifetime' }, no key, no Stripe call", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    const lifetimeKey = await mintPresentedKey({ kind: "lifetime", email: "founder@example.test" });
    const getStripe = vi.fn(() => {
      throw new Error("should not build a Stripe client");
    });

    const res = await handleRefreshLicense(request({ key: lifetimeKey }), env, ctx, {
      getStripe: getStripe as unknown as RefreshDeps["getStripe"],
      now: () => NOW,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "lifetime" });
    expect(getStripe).not.toHaveBeenCalled();
  });

  it("Scenario: key expired more than 60 days → 410 expired_too_long", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const presentedKey = await mintPresentedKey({
      sub: "sub_stale",
      expiresAt: "2026-04-10T00:00:00.000Z", // ~90 days before NOW
    });
    await seedRecord(store, "sub_stale", presentedKey);
    const getStripe = vi.fn(() => {
      throw new Error("should not build a Stripe client");
    });

    const res = await handleRefreshLicense(request({ key: presentedKey }), env, ctx, {
      getStripe: getStripe as unknown as RefreshDeps["getStripe"],
      now: () => NOW,
    });

    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body).toEqual({ error: "expired_too_long" });
    expect(getStripe).not.toHaveBeenCalled();
  });

  it("Scenario: key expired ~5 days (still in-window) → 200 with a new key", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const presentedKey = await mintPresentedKey({
      sub: "sub_recent",
      expiresAt: "2026-07-04T12:00:00.000Z", // 5 days before NOW
    });
    await seedRecord(store, "sub_recent", presentedKey);
    const periodEnd = unix("2027-01-01T00:00:00.000Z");
    const getStripe = stubStripe({ subscription: { status: "active", items: { data: [{ current_period_end: periodEnd }] } } });

    const res = await handleRefreshLicense(request({ key: presentedKey }), env, ctx, {
      getStripe,
      now: () => NOW,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { key: string };
    expect(body.key.startsWith("SB1.")).toBe(true);
  });

  it("Scenario: missing key field → 400", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);

    const res = await handleRefreshLicense(request({}), env, ctx, { now: () => NOW });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "missing_key" });
  });

  it("Scenario: empty key string → 400", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);

    const res = await handleRefreshLicense(request({ key: "" }), env, ctx, { now: () => NOW });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "missing_key" });
  });

  it("Scenario: oversized key string → 400, never reaching crypto", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);

    const res = await handleRefreshLicense(
      request({ key: "SB1." + "x".repeat(5000) }),
      env,
      ctx,
      { now: () => NOW },
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "missing_key" });
  });

  it("Scenario: malformed JSON body → 400", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);

    const res = await handleRefreshLicense(rawRequest("not json"), env, ctx, { now: () => NOW });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "missing_key" });
  });

  it("Scenario: rate limits after the cap for one subscription id", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const presentedKey = await mintPresentedKey({ sub: "sub_hot" });
    await seedRecord(store, "sub_hot", presentedKey);
    const periodEnd = unix("2027-01-01T00:00:00.000Z");
    const getStripe = stubStripe({ subscription: { status: "active", items: { data: [{ current_period_end: periodEnd }] } } });

    let last!: Response;
    for (let i = 0; i < 21; i++) {
      last = await handleRefreshLicense(request({ key: presentedKey }), env, ctx, {
        getStripe,
        now: () => NOW,
      });
    }

    expect(last.status).toBe(429);
    const body = await last.json();
    expect(body).toEqual({ error: "rate_limited" });
  });

  it("Scenario: unknown subscription lookup failure refuses without leaking the Stripe error", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const presentedKey = await mintPresentedKey({ sub: "sub_lookup_fail" });
    await seedRecord(store, "sub_lookup_fail", presentedKey);
    const getStripe = stubStripe({
      subscription: () => {
        throw new Error("No such subscription: sub_lookup_fail");
      },
    });

    const res = await handleRefreshLicense(request({ key: presentedKey }), env, ctx, {
      getStripe,
      now: () => NOW,
    });

    expect(res.status).toBe(404);
    const bodyText = await res.text();
    expect(bodyText).not.toContain("SB1.");
    expect(bodyText).not.toContain("No such subscription");
  });

  it("Scenario: entitled subscription with no derivable period end → 404 unknown_subscription, no mint", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const presentedKey = await mintPresentedKey({ sub: "sub_no_period" });
    await seedRecord(store, "sub_no_period", presentedKey);
    const getStripe = stubStripe({ subscription: { status: "active", items: { data: [] } } });

    const res = await handleRefreshLicense(request({ key: presentedKey }), env, ctx, {
      getStripe,
      now: () => NOW,
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "unknown_subscription" });
  });

  it("Scenario: forged payload carrying a valid sub is refused before any lookup", async () => {
    const { kv, store, getSpy } = makeKv();
    const env = makeEnv(kv);
    // Seed a real record for sub_123 to prove it is never consulted.
    await seedRecord(store, "sub_123", "SB1.legit-latest.sig");
    const forgedKey = await mintPresentedKey({ sub: "sub_123", signingPem: OTHER_PKCS8_PEM });
    const getStripe = vi.fn(() => {
      throw new Error("should not build a Stripe client");
    });

    const res = await handleRefreshLicense(request({ key: forgedKey }), env, ctx, {
      getStripe: getStripe as unknown as RefreshDeps["getStripe"],
      now: () => NOW,
    });

    expect(res.status).toBe(401);
    expect(getSpy).not.toHaveBeenCalled();
    expect(getStripe).not.toHaveBeenCalled();
  });

  it("Scenario: a non-subscription/no-sub payload is refused as no-active-subscription", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    const signingKey = await importSigningKey(PKCS8_PEM);
    // A key minted without `sub` (shouldn't happen for real #110 keys, but the
    // handler must not crash or leak on it).
    const noSubKey = await mintLicenseKey(signingKey, {
      kind: "subscription",
      kid: "test-kid",
      expiresAt: "2026-07-01T00:00:00.000Z",
    });

    const res = await handleRefreshLicense(request({ key: noSubKey }), env, ctx, { now: () => NOW });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "no-active-subscription" });
  });

  it("Leak guard: refusal bodies never contain the presented key, email, or raw Stripe error text", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const presentedKey = await mintPresentedKey({
      sub: "sub_leak",
      email: "leaky@example.test",
    });
    await seedRecord(store, "sub_leak", presentedKey, { email: "leaky@example.test" });
    const getStripe = stubStripe({
      subscription: () => {
        throw new Error("Stripe internal detail: cus_secret_123");
      },
    });

    const res = await handleRefreshLicense(request({ key: presentedKey }), env, ctx, {
      getStripe,
      now: () => NOW,
    });

    const bodyText = await res.text();
    expect(bodyText).not.toContain("SB1.");
    expect(bodyText).not.toContain("leaky@example.test");
    expect(bodyText).not.toContain("Stripe internal detail");
  });
});
