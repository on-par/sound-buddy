import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import Stripe from "stripe";
import {
  handleInvoicePaid,
  subscriptionRecordKey,
  type SubscriptionRecord,
  type InvoicePaidDeps,
} from "./handlers/invoice-paid";
import { importVerifyKey, verifyLicenseKey } from "./license-sign";
import type { Env } from "./index";

// Pins issue #1158's two acceptance criteria to executable assertions against
// the already-shipped invoice.paid handler (worker/src/handlers/invoice-paid.ts,
// #110): a fresh, cryptographically-verifiable SB1. subscription key is minted
// on both the initial invoice.paid and every renewal, and only non-secret
// sub:<id> metadata is recorded in KV. Mirrors the #1155/#1156/#1157 precedent
// (webhook-verify.test.ts / sb1-signer.test.ts / keygen-v2.test.ts): a
// discretely-named acceptance suite for behavior that already exists, no
// production code changes.

function throwawayKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    pkcs8Pem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    spkiPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

const { pkcs8Pem: PKCS8_PEM, spkiPem: SPKI_PEM } = throwawayKeypair();

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
    STRIPE_WEBHOOK_SECRET: "whsec_unused",
    STRIPE_SECRET_KEY: "sk_test_unused",
    LICENSE_SIGNING_PRIVATE_KEY: PKCS8_PEM,
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

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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

/** Capture the minted key by intercepting the injected sendEmail seam. */
function captureKey(): { sendEmail: NonNullable<InvoicePaidDeps["sendEmail"]>; keys: string[] } {
  const keys: string[] = [];
  const sendEmail: NonNullable<InvoicePaidDeps["sendEmail"]> = async (_env, params) => {
    keys.push(params.key);
    return { ok: true };
  };
  return { sendEmail, keys };
}

describe("invoice.paid subscription mint acceptance (#1158)", () => {
  it("Scenario: initial invoice mints a verifiable key and writes the subscription id to KV", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const { sendEmail, keys } = captureKey();

    await handleInvoicePaid(
      invoicePaidEvent("evt_initial", {
        subscription: "sub_ACCEPT",
        customerEmail: "a@b.c",
        lines: [{ subscription: "sub_ACCEPT", periodEnd: unix("2027-01-01T00:00:00.000Z") }],
      }),
      env,
      ctx,
      { sendEmail },
    );

    expect(keys).toHaveLength(1);
    const [capturedKey] = keys;
    expect(capturedKey.startsWith("SB1.")).toBe(true);
    expect(capturedKey.split(".")).toHaveLength(3);

    const state = await verifyLicenseKey(
      capturedKey,
      await importVerifyKey(SPKI_PEM),
      new Date("2026-08-25T00:00:00.000Z"),
    );
    expect(state.tier).toBe("pro");
    expect(state.status).toBe("valid");

    const record = readRecord(store, "sub_ACCEPT");
    expect(record.periodEnd).toBe("2027-01-01T00:00:00.000Z");
    expect(record.email).toBe("a@b.c");
    expect(record.latestKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expectNoSignedKeyInKv(store);
  });

  it("Scenario: renewal invoice mints a fresh distinct key and overwrites KV to the latest metadata", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const first = captureKey();

    await handleInvoicePaid(
      invoicePaidEvent("evt_r1", {
        subscription: "sub_ACCEPT",
        customerEmail: "a@b.c",
        lines: [{ subscription: "sub_ACCEPT", periodEnd: unix("2027-01-01T00:00:00.000Z") }],
      }),
      env,
      ctx,
      { sendEmail: first.sendEmail },
    );
    const record1 = readRecord(store, "sub_ACCEPT");
    const capturedKey1 = first.keys[0];

    const second = captureKey();
    await handleInvoicePaid(
      invoicePaidEvent("evt_r2", {
        subscription: "sub_ACCEPT",
        customerEmail: "a@b.c",
        lines: [{ subscription: "sub_ACCEPT", periodEnd: unix("2027-02-01T00:00:00.000Z") }],
      }),
      env,
      ctx,
      { sendEmail: second.sendEmail },
    );
    const record2 = readRecord(store, "sub_ACCEPT");
    const capturedKey2 = second.keys[0];

    expect(capturedKey2).not.toBe(capturedKey1);

    const state = await verifyLicenseKey(
      capturedKey2,
      await importVerifyKey(SPKI_PEM),
      new Date("2026-08-25T00:00:00.000Z"),
    );
    expect(state.tier).toBe("pro");
    expect(state.status).toBe("valid");

    expect(record2.periodEnd).toBe("2027-02-01T00:00:00.000Z");
    expect(record2.latestKeyHash).not.toBe(record1.latestKeyHash);
    expect([...store.keys()].filter((k) => k.startsWith("sub:"))).toHaveLength(1);
    expectNoSignedKeyInKv(store);
  });
});
