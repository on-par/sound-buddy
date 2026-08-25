import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import Stripe from "stripe";
import { handleStripeWebhook, type EventHandler } from "./webhook";
import {
  handleCheckoutCompleted,
  sessionRecordKey,
  type SessionRecord,
  type CheckoutCompletedDeps,
} from "./handlers/checkout-completed";
import { importVerifyKey, verifyLicenseKey, sha256Hex } from "./license-sign";
import type { Env } from "./index";

// Pins issue #1189's two acceptance criteria to executable assertions driven
// through the real webhook entry point (worker/src/webhook.ts): a validly-signed
// checkout.session.completed event that has actually completed payment issues
// and emails a verifiable license key and records a purchase→license mapping,
// while one that has not completed payment issues no key and sends no email.
// Mirrors the #1155–#1168 sibling precedent: a discretely-named acceptance
// suite for behavior that already exists (webhook.ts verify/de-dup/dispatch +
// checkout-completed.ts mint/email), no production code changes.

function throwawayKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    pkcs8Pem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    spkiPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

const { pkcs8Pem: PKCS8_PEM, spkiPem: SPKI_PEM } = throwawayKeypair();

const WEBHOOK_SECRET = "whsec_test_secret_1189";

// A Stripe client used only to sign fixtures. `generateTestHeaderString` mints a
// valid `Stripe-Signature` header for a payload, exactly as a live webhook would.
const signer = new Stripe("sk_test_signer", {
  httpClient: Stripe.createFetchHttpClient(),
});

const sign = (payload: string): string =>
  signer.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });

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
  sessionId?: string;
  paymentStatus?: Stripe.Checkout.Session.PaymentStatus;
  email?: string | null;
}

/** Build a checkout.session.completed webhook event. */
function checkoutEvent(id: string, o: CheckoutOverrides = {}): Stripe.Event {
  const email = o.email === undefined ? "buyer@church.test" : o.email;
  const session: Record<string, unknown> = {
    id: o.sessionId ?? "cs_1189",
    object: "checkout.session",
    mode: "payment",
    payment_status: o.paymentStatus ?? "paid",
    customer_details: { email },
    customer_email: email,
    customer: "cus_1189",
  };
  return {
    id,
    object: "event",
    type: "checkout.session.completed",
    data: { object: session },
  } as unknown as Stripe.Event;
}

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://sound-buddy-api.test/api/stripe/webhook", {
    method: "POST",
    body,
    headers,
  });
}

/** Handlers table wrapping the real dispatcher with an email-capturing spy. */
function makeHandlers(): {
  handlers: Record<string, EventHandler>;
  sent: { to?: string; key: string; kind: string }[];
} {
  const sent: { to?: string; key: string; kind: string }[] = [];
  const sendEmail: NonNullable<CheckoutCompletedDeps["sendEmail"]> = async (
    _env,
    params,
  ) => {
    sent.push({ to: params.to, key: params.key, kind: params.kind });
    return { ok: true };
  };
  const handlers: Record<string, EventHandler> = {
    "checkout.session.completed": (event, env, handlerCtx) =>
      handleCheckoutCompleted(event, env, handlerCtx, { sendEmail }),
  };
  return { handlers, sent };
}

function readSessionRecord(
  store: Map<string, string>,
  sessionId: string,
): SessionRecord | undefined {
  const raw = store.get(sessionRecordKey(sessionId));
  return raw ? (JSON.parse(raw) as SessionRecord) : undefined;
}

describe("Stripe billing and license provisioning acceptance (#1189)", () => {
  it("a successful checkout event issues and emails a key and records a purchase→license mapping", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const { handlers, sent } = makeHandlers();
    const body = JSON.stringify(
      checkoutEvent("evt_1189_ok", {
        sessionId: "cs_1189_ok",
        paymentStatus: "paid",
        email: "buyer@church.test",
      }),
    );

    const res = await handleStripeWebhook(
      post(body, { "stripe-signature": sign(body) }),
      env,
      ctx,
      { handlers },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ received: true });

    expect(sent).toHaveLength(1);
    const [emailed] = sent;
    expect(emailed.to).toBe("buyer@church.test");
    expect(emailed.kind).toBe("lifetime");
    expect(emailed.key.startsWith("SB1.")).toBe(true);
    expect(emailed.key.split(".")).toHaveLength(3);

    // A far-future `now` proves the minted key never expires.
    const state = await verifyLicenseKey(
      emailed.key,
      await importVerifyKey(SPKI_PEM),
      new Date("2100-01-01T00:00:00.000Z"),
    );
    expect(state.tier).toBe("pro");
    expect(state.status).toBe("valid");

    const record = readSessionRecord(store, "cs_1189_ok");
    expect(record?.kind).toBe("lifetime");
    expect(record?.email).toBe("buyer@church.test");
    expect(record?.latestKeyHash).toBe(await sha256Hex(emailed.key));

    expect(store.get("evt:evt_1189_ok")).toBe("checkout.session.completed");

    for (const value of store.values()) {
      expect(value).not.toContain("SB1.");
    }
  });

  it("a checkout event that does not complete payment issues no key and sends no email", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    const { handlers, sent } = makeHandlers();
    const body = JSON.stringify(
      checkoutEvent("evt_1189_unpaid", {
        sessionId: "cs_1189_unpaid",
        paymentStatus: "unpaid",
        email: "buyer@church.test",
      }),
    );

    const res = await handleStripeWebhook(
      post(body, { "stripe-signature": sign(body) }),
      env,
      ctx,
      { handlers },
    );

    expect(res.status).toBe(200);
    expect(sent).toHaveLength(0);
    expect(readSessionRecord(store, "cs_1189_unpaid")).toBeUndefined();
  });
});
