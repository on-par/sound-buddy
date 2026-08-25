import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import Stripe from "stripe";
import {
  handleInvoicePaid,
  subscriptionRecordKey,
  type SubscriptionRecord,
} from "./handlers/invoice-paid";
import {
  handleCheckoutCompleted,
  sessionRecordKey,
  type SessionRecord,
} from "./handlers/checkout-completed";
import { sha256Hex } from "./license-sign";
import type { Env } from "./index";

// Pins issue #1162's two acceptance criteria to executable assertions against
// the already-shipped Resend delivery (worker/src/delivery.ts
// `sendLicenseEmail`, #114) invoked by both mint handlers: a mint sends the
// key to the customer's Stripe email, and a Resend outage never blocks the
// mint. Mirrors the #1157/#1158/#1159 precedent (keygen-v2 / invoice-paid /
// founding-mint .test.ts): a discretely-named acceptance suite for behavior
// that already exists, no production code changes.
//
// Unlike the sibling suites, `deps.sendEmail` is NOT injected here — the
// handlers are driven with default deps so the real `sendLicenseEmail` runs
// against a mocked global `fetch` (the mocked Resend client).

function throwawayKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    pkcs8Pem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    spkiPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

const { pkcs8Pem: PKCS8_PEM } = throwawayKeypair();

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

function fetchMock() {
  return globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
}

function resendBody(
  mock: ReturnType<typeof vi.fn>,
  callIndex = 0,
): { from: string; to: string[]; subject: string; text: string; html: string } {
  const [, init] = mock.mock.calls[callIndex];
  return JSON.parse((init as RequestInit).body as string) as {
    from: string;
    to: string[];
    subject: string;
    text: string;
    html: string;
  };
}

const SB1_RE = /SB1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

describe("license delivery email acceptance (#1162)", () => {
  it("Scenario: subscription mint sends the key to the customer's Stripe email", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);

    await handleInvoicePaid(
      invoicePaidEvent("evt_email_sub", { customerEmail: "buyer@church.test" }),
      env,
      ctx,
    );

    const mock = fetchMock();
    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer re_test_unused",
    });

    const body = resendBody(mock);
    expect(body.to).toEqual(["buyer@church.test"]);
    expect(body.subject).toBe("Your Sound Buddy license key");
    expect(body.text).toMatch(SB1_RE);

    const key = body.text.match(SB1_RE)![0];
    expect(await sha256Hex(key)).toBe(readRecord(store, "sub_1").latestKeyHash);
  });

  it("Scenario: founding lifetime mint sends the key to the customer's Stripe email", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);

    await handleCheckoutCompleted(
      checkoutEvent("evt_email_founder", { email: "founder@church.test", sessionId: "cs_email_1" }),
      env,
      ctx,
    );

    const mock = fetchMock();
    expect(mock).toHaveBeenCalledTimes(1);
    const body = resendBody(mock);
    expect(body.to).toEqual(["founder@church.test"]);
    expect(body.text).toMatch(SB1_RE);

    const key = body.text.match(SB1_RE)![0];
    expect(await sha256Hex(key)).toBe(readSessionRecord(store, "cs_email_1").latestKeyHash);
  });

  it("Scenario: a Resend failure response does not block the subscription mint", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      handleInvoicePaid(invoicePaidEvent("evt_fail_sub"), env, ctx),
    ).resolves.toBeUndefined();

    expect(readRecord(store, "sub_1").latestKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("Scenario: a network throw during delivery does not block the founding mint", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      handleCheckoutCompleted(
        checkoutEvent("evt_fail_founder", { sessionId: "cs_fail_1" }),
        env,
        ctx,
      ),
    ).resolves.toBeUndefined();

    const record = readSessionRecord(store, "cs_fail_1");
    expect(record.latestKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(record.kind).toBe("lifetime");
    errSpy.mockRestore();
  });
});
