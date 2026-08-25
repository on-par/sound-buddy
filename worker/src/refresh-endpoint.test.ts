import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import Stripe from "stripe";
import { handleRefreshLicense, type RefreshDeps } from "./handlers/license-refresh";
import {
  importSigningKey,
  importVerifyKey,
  mintLicenseKey,
  sha256Hex,
  verifyLicenseKey,
} from "./license-sign";
import { subscriptionRecordKey, type SubscriptionRecord } from "./handlers/invoice-paid";
import type { Env } from "./index";

// Pins issue #1161's three acceptance criteria to executable assertions
// against the already-shipped seamless-renewal handler
// (worker/src/handlers/license-refresh.ts, #113): a valid presented key
// returns the subscription's latest signed key; a still-current subscription
// with no newer period returns an unambiguous same-period key; a forged/
// invalid key is refused 401 without any KV or Stripe lookup. Mirrors the
// #1156-#1160 sibling acceptance-suite precedent (same throwaway-keypair
// setup, same makeKv/makeEnv/ctx helpers). No production code changes.

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PKCS8_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const SPKI_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();

// A second, unrelated keypair — signs a "forged" key that never verifies
// against SPKI_PEM.
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
    EVENTS_KV: {} as KVNamespace,
    WAITLIST_KV: {} as KVNamespace,
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
    GITHUB_ISSUES_TOKEN: "",
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

interface MintOverrides {
  sub?: string;
  email?: string;
  expiresAt?: string;
  signingPem?: string;
}

/** Mint a `subscription`-kind key signed by the throwaway private key (or an override PEM). */
async function mintPresentedKey(o: MintOverrides = {}): Promise<string> {
  const signingKey = await importSigningKey(o.signingPem ?? PKCS8_PEM);
  return mintLicenseKey(signingKey, {
    kind: "subscription",
    kid: "test-kid",
    ...(o.email ? { email: o.email } : {}),
    expiresAt: o.expiresAt ?? "2026-07-01T00:00:00.000Z",
    sub: o.sub ?? "sub_123",
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

function stubStripe(subscription: Record<string, unknown>): RefreshDeps["getStripe"] {
  return () =>
    ({
      subscriptions: {
        retrieve: async () => subscription,
      },
    }) as unknown as Stripe;
}

async function verifyKey(key: string) {
  const verifyKeyHandle = await importVerifyKey(SPKI_PEM);
  return verifyLicenseKey(key, verifyKeyHandle, NOW);
}

describe("POST /api/license/refresh acceptance (#1161)", () => {
  it("Scenario: valid latest key + active subscription → 200 with the latest signed key for that subscription", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const presentedKey = await mintPresentedKey({
      sub: "sub_ACCEPT",
      expiresAt: "2026-07-01T00:00:00.000Z", // ~8 days before NOW — in-window
      email: "subscriber@example.test",
    });
    await seedRecord(store, "sub_ACCEPT", presentedKey, { email: "subscriber@example.test" });

    const getStripe = stubStripe({
      status: "active",
      items: { data: [{ current_period_end: unix("2027-01-01T00:00:00.000Z") }] },
    });

    const res = await handleRefreshLicense(request({ key: presentedKey }), env, ctx, {
      getStripe,
      now: () => NOW,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { key: string };
    expect(body.key.startsWith("SB1.")).toBe(true);

    const state = await verifyKey(body.key);
    expect(state.tier).toBe("pro");
    expect(state.kind).toBe("subscription");
    expect(state.expiresAt).toBe("2027-01-01T00:00:00.000Z");

    const record = JSON.parse(store.get(subscriptionRecordKey("sub_ACCEPT"))!) as SubscriptionRecord;
    expect(record.latestKeyHash).toBe(await sha256Hex(body.key));
    expect(record.latestKeyHash).not.toBe(await sha256Hex(presentedKey));
    for (const value of store.values()) expect(value).not.toContain("SB1.");
  });

  it("Scenario: still-current subscription with no newer period → 200 key with unchanged expiresAt", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const presentedKey = await mintPresentedKey({
      sub: "sub_CURRENT",
      expiresAt: "2026-08-01T00:00:00.000Z", // ~23 days after NOW — not yet expired, still in-window
    });
    await seedRecord(store, "sub_CURRENT", presentedKey, { periodEnd: "2026-08-01T00:00:00.000Z" });

    // The SAME period end the presented key already carries — no newer period.
    const getStripe = stubStripe({
      status: "active",
      items: { data: [{ current_period_end: unix("2026-08-01T00:00:00.000Z") }] },
    });

    const res = await handleRefreshLicense(request({ key: presentedKey }), env, ctx, {
      getStripe,
      now: () => NOW,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { key: string };
    expect(body.key.startsWith("SB1.")).toBe(true);

    const state = await verifyKey(body.key);
    expect(state.expiresAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("Scenario: forged/invalid signature → 401 without any KV or Stripe lookup", async () => {
    const { kv, store, getSpy } = makeKv();
    const env = makeEnv(kv);
    // Seed a real record for sub_ACCEPT to prove it is never consulted.
    await seedRecord(store, "sub_ACCEPT", "SB1.legit-latest.sig");
    const forgedKey = await mintPresentedKey({ sub: "sub_ACCEPT", signingPem: OTHER_PKCS8_PEM });
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
    expect(getSpy).not.toHaveBeenCalled();
    expect(getStripe).not.toHaveBeenCalled();
  });
});
