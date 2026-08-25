import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import Stripe from "stripe";
import { handleActivate } from "./handlers/activate";
import { handleGetLicense, type LicenseDeps } from "./handlers/license";
import { importVerifyKey, verifyLicenseKey } from "./license-sign";
import type { Env } from "./index";

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

const request = (sessionId?: string): Request =>
  new Request(
    `https://sound-buddy-api.test/api/license${sessionId !== undefined ? `?session_id=${encodeURIComponent(sessionId)}` : ""}`,
  );

const activateRequest = (query = ""): Request =>
  new Request(`https://sound-buddy-api.test/activate${query}`);

async function verifyKey(key: string) {
  const verifyKeyHandle = await importVerifyKey(SPKI_PEM);
  return verifyLicenseKey(key, verifyKeyHandle, NOW);
}

describe("/activate checkout-to-key race acceptance (#1160)", () => {
  it("Scenario: key available immediately — first /api/license poll returns the key with no waiting state", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    const getStripe: LicenseDeps["getStripe"] = () =>
      ({
        checkout: {
          sessions: {
            retrieve: async () => ({
              id: "cs_ready",
              mode: "payment",
              payment_status: "paid",
              status: "complete",
              created: unix("2026-07-09T11:00:00.000Z"),
              customer_details: { email: "buyer@example.test" },
            }),
          },
        },
        subscriptions: { retrieve: async () => ({}) },
        customers: { retrieve: async () => ({ email: undefined }) },
      }) as unknown as Stripe;

    const res = await handleGetLicense(request("cs_ready"), env, ctx, {
      getStripe,
      now: () => NOW,
    });

    expect(res.status).not.toBe(202);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { key: string };
    expect(body.key.startsWith("SB1.")).toBe(true);

    const state = await verifyKey(body.key);
    expect(state.tier).toBe("pro");
    expect(state.kind).toBe("lifetime");
    expect(state.email).toBe("buyer@example.test");

    const page = await handleActivate(activateRequest("?session_id=cs_ready"), env, ctx).text();
    expect(page).toContain('id="ready"');
    expect(page).toContain("cs_ready");
  });

  it("Scenario: key not yet available — page polls, shows waiting state, then renders the key without an error flash", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    let paid = false;
    const getStripe: LicenseDeps["getStripe"] = () =>
      ({
        checkout: {
          sessions: {
            retrieve: async () =>
              paid
                ? {
                    id: "cs_race",
                    mode: "payment",
                    payment_status: "paid",
                    status: "complete",
                    created: unix("2026-07-09T11:00:00.000Z"),
                    customer_details: { email: "racer@example.test" },
                  }
                : {
                    id: "cs_race",
                    mode: "payment",
                    payment_status: "unpaid",
                    status: "open",
                    created: unix("2026-07-09T11:00:00.000Z"),
                  },
          },
        },
        subscriptions: { retrieve: async () => ({}) },
        customers: { retrieve: async () => ({ email: undefined }) },
      }) as unknown as Stripe;

    const pending = await handleGetLicense(request("cs_race"), env, ctx, {
      getStripe,
      now: () => NOW,
    });
    expect(pending.status).toBe(202);
    expect(await pending.json()).toEqual({ status: "pending" });

    paid = true;
    const resolved = await handleGetLicense(request("cs_race"), env, ctx, {
      getStripe,
      now: () => NOW,
    });
    expect(resolved.status).toBe(200);
    const body = (await resolved.json()) as { key: string };
    expect(body.key.startsWith("SB1.")).toBe(true);
    const state = await verifyKey(body.key);
    expect(state.tier).toBe("pro");
    expect(state.kind).toBe("lifetime");

    const page = await handleActivate(activateRequest("?session_id=cs_race"), env, ctx).text();
    expect(page).toContain('id="pending"');
    expect(page).toContain('id="fallback"');
    expect(page).toMatch(/id="fallback" style="display:\s*none"/);
    expect(page).toMatch(/if \(res\.status === 202\)/);
    expect(page).toMatch(/setTimeout\(poll, POLL_INTERVAL_MS\)/);
  });
});
