import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import Stripe from "stripe";
import {
  handleCheckoutCompleted,
  sessionRecordKey,
  type SessionRecord,
  type CheckoutCompletedDeps,
} from "./handlers/checkout-completed";
import { importVerifyKey, verifyLicenseKey } from "./license-sign";
import type { Env } from "./index";

// Pins issue #1159's two acceptance criteria to executable assertions against
// the already-shipped checkout.session.completed / async_payment_succeeded
// handler (worker/src/handlers/checkout-completed.ts, #111): a synchronous
// completion mints a cryptographically-verifiable, non-expiring SB1. lifetime
// key, and a later async_payment_succeeded for the same session never mints a
// second one. Mirrors the #1155/#1156/#1157/#1158 precedent (webhook-verify /
// sb1-signer / keygen-v2 / invoice-paid .test.ts): a discretely-named
// acceptance suite for behavior that already exists, no production code
// changes.

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

/** Capture the minted key by intercepting the injected sendEmail seam. */
function captureKey(): { sendEmail: NonNullable<CheckoutCompletedDeps["sendEmail"]>; keys: string[] } {
  const keys: string[] = [];
  const sendEmail: NonNullable<CheckoutCompletedDeps["sendEmail"]> = async (_env, params) => {
    keys.push(params.key);
    return { ok: true };
  };
  return { sendEmail, keys };
}

describe("founding lifetime mint acceptance (#1159)", () => {
  it("Scenario: synchronous completion mints a verifiable non-expiring lifetime key and writes one sess:<id> record", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const { sendEmail, keys } = captureKey();

    await handleCheckoutCompleted(
      checkoutEvent("evt_founder_accept", {
        type: "checkout.session.completed",
        mode: "payment",
        paymentStatus: "paid",
        email: "a@b.c",
        sessionId: "cs_founder_accept",
      }),
      env,
      ctx,
      { sendEmail },
    );

    expect(keys).toHaveLength(1);
    const [capturedKey] = keys;
    expect(capturedKey.startsWith("SB1.")).toBe(true);
    expect(capturedKey.split(".")).toHaveLength(3);

    // A far-future `now` proves the lifetime key never expires.
    const state = await verifyLicenseKey(
      capturedKey,
      await importVerifyKey(SPKI_PEM),
      new Date("2100-01-01T00:00:00.000Z"),
    );
    expect(state.tier).toBe("pro");
    expect(state.status).toBe("valid");

    const record = readSessionRecord(store, "cs_founder_accept");
    expect(record.kind).toBe("lifetime");
    expect(record.email).toBe("a@b.c");
    expect(record.latestKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expect([...store.keys()].filter((k) => k.startsWith("sess:"))).toHaveLength(1);
    expectNoSignedKeyInKv(store);
  });

  it("Scenario: async_payment_succeeded after the sync mint does not double-mint", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const first = captureKey();

    await handleCheckoutCompleted(
      checkoutEvent("evt_once_sync", {
        type: "checkout.session.completed",
        sessionId: "cs_once",
      }),
      env,
      ctx,
      { sendEmail: first.sendEmail },
    );
    const initial = readSessionRecord(store, "cs_once");
    expect(first.keys).toHaveLength(1);

    const second = captureKey();
    await handleCheckoutCompleted(
      checkoutEvent("evt_once_async", {
        type: "checkout.session.async_payment_succeeded",
        sessionId: "cs_once",
      }),
      env,
      ctx,
      { sendEmail: second.sendEmail },
    );

    expect(second.keys).toHaveLength(0);
    expect(readSessionRecord(store, "cs_once").latestKeyHash).toBe(
      initial.latestKeyHash,
    );
    expect([...store.keys()].filter((k) => k.startsWith("sess:"))).toHaveLength(1);
    expectNoSignedKeyInKv(store);
  });
});
