import { describe, expect, it, vi } from "vitest";
import {
  generateKeyPairSync,
  createPublicKey,
  verify as nodeVerify,
} from "node:crypto";
import Stripe from "stripe";
import {
  importSigningKey,
  importVerifyKey,
  mintLicenseKey,
  verifyLicenseKey,
  LICENSE_ISSUER,
} from "./license-sign";
import { handleGetLicense, type LicenseDeps } from "./handlers/license";
import type { Env } from "./index";
import type { LicensePayload } from "@sound-buddy/license-policy";

// Pins issue #1157's two acceptance criteria to executable assertions against
// the already-shipped v2 payload claims (kid/jti/iss/sub) and the sign-on-demand
// key-material guards. Mirrors the #1155/#1156 precedent
// (webhook-verify.test.ts / sb1-signer.test.ts): a colocated acceptance suite
// for behavior that already exists, no production code changes.

function throwawayKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    pkcs8Pem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    spkiPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

/** Decode a base64url segment to bytes (test-side mirror of fromBase64Url). */
function fromB64url(s: string): Uint8Array {
  const binary = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * license.ts's exact signature check: Ed25519 verify with a null digest against
 * the SPKI public key, over the transmitted payload bytes.
 */
function verifiesLikeLicenseTs(key: string, spkiPem: string): boolean {
  const [, payloadSeg, sigSeg] = key.split(".");
  return nodeVerify(
    null,
    fromB64url(payloadSeg),
    createPublicKey(spkiPem),
    fromB64url(sigSeg),
  );
}

function parsePayloadSegment(key: string): LicensePayload {
  return JSON.parse(
    new TextDecoder().decode(fromB64url(key.split(".")[1])),
  ) as LicensePayload;
}

/** Version is by additive claims, not a field — kid+jti+iss present means v2. */
function payloadVersion(p: LicensePayload): 1 | 2 {
  return p.kid && p.jti && p.iss ? 2 : 1;
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const now = new Date("2026-07-08T00:00:00.000Z");
const future = new Date(now.getTime() + YEAR_MS).toISOString();

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

function makeEnv(kv: KVNamespace, pkcs8Pem: string): Env {
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
    LICENSE_SIGNING_PRIVATE_KEY: pkcs8Pem,
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

const request = (sessionId?: string): Request =>
  new Request(
    `https://sound-buddy-api.test/api/license${sessionId !== undefined ? `?session_id=${encodeURIComponent(sessionId)}` : ""}`,
  );

interface StubStripeOverrides {
  session?: Record<string, unknown> | (() => never);
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
      subscriptions: { retrieve: async () => ({}) },
      customers: { retrieve: async () => ({ email: undefined }) },
    }) as unknown as Stripe;
}

describe("v2 payload signs and verifies (#1157)", () => {
  it("Scenario: subscription v2 round-trips and reports v2", async () => {
    const { pkcs8Pem, spkiPem } = throwawayKeypair();
    const signingKey = await importSigningKey(pkcs8Pem);

    const key = await mintLicenseKey(signingKey, {
      kind: "subscription",
      kid: "sb-sign-2026-08",
      email: "engineer@example.test",
      expiresAt: future,
      sub: "sub_ABC123",
    });

    expect(key.startsWith("SB1.")).toBe(true);
    expect(key.split(".")).toHaveLength(3);
    expect(verifiesLikeLicenseTs(key, spkiPem)).toBe(true);

    const verifyKey = await importVerifyKey(spkiPem);
    const state = await verifyLicenseKey(key, verifyKey, now);
    expect(state.tier).toBe("pro");
    expect(state.status).toBe("valid");

    const payload = parsePayloadSegment(key);
    expect(payload.iss).toBe(LICENSE_ISSUER);
    expect(payload.kid).toBe("sb-sign-2026-08");
    expect(payload.jti).toBeTruthy();
    expect(payload.sub).toBe("sub_ABC123");
    expect(payloadVersion(payload)).toBe(2);
  });

  it("Scenario: lifetime v2 round-trips and reports v2", async () => {
    const { pkcs8Pem, spkiPem } = throwawayKeypair();
    const signingKey = await importSigningKey(pkcs8Pem);

    const key = await mintLicenseKey(signingKey, {
      kind: "lifetime",
      kid: "sb-sign-2026-08",
    });

    expect(verifiesLikeLicenseTs(key, spkiPem)).toBe(true);

    const verifyKey = await importVerifyKey(spkiPem);
    const state = await verifyLicenseKey(key, verifyKey, now);
    expect(state.tier).toBe("pro");
    expect(state.status).toBe("valid");

    const payload = parsePayloadSegment(key);
    expect(payload.kid).toBe("sb-sign-2026-08");
    expect(payload.jti).toBeTruthy();
    expect(payload.iss).toBe(LICENSE_ISSUER);
    expect(payload.sub).toBeUndefined();
    expect(payload.expiresAt).toBeUndefined();
    expect(payloadVersion(payload)).toBe(2);
  });
});

describe("key material never logged or echoed (#1157)", () => {
  it("Scenario: signing/verifying emits no key material to any console channel", async () => {
    const { pkcs8Pem, spkiPem } = throwawayKeypair();
    const captured: unknown[] = [];
    const spies = (
      ["log", "info", "warn", "error", "debug"] as const
    ).map((channel) =>
      vi.spyOn(console, channel).mockImplementation((...args: unknown[]) => {
        captured.push(...args);
      }),
    );

    try {
      const signingKey = await importSigningKey(pkcs8Pem);
      const key = await mintLicenseKey(signingKey, {
        kind: "lifetime",
        kid: "sb-sign-2026-08",
      });
      const verifyKey = await importVerifyKey(spkiPem);
      await verifyLicenseKey(key, verifyKey, now);

      const pemBody = pkcs8Pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
      const flattened = captured.map((a) => String(a)).join("\n");
      expect(flattened).not.toContain(pemBody);
      expect(flattened).not.toContain("PRIVATE KEY");
      expect(flattened).not.toContain("SB1.");
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });

  it("Scenario: mint validation error carries no key material (subscription missing expiresAt)", async () => {
    const { pkcs8Pem } = throwawayKeypair();
    const signingKey = await importSigningKey(pkcs8Pem);

    await expect(
      mintLicenseKey(signingKey, { kind: "subscription", kid: "k1" }),
    ).rejects.toThrow(/subscription license requires expiresAt/);

    try {
      await mintLicenseKey(signingKey, { kind: "subscription", kid: "k1" });
      throw new Error("expected mintLicenseKey to reject");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toContain("PRIVATE KEY");
      expect(message).not.toContain("SB1.");
      expect(message).not.toContain(pkcs8Pem);
    }
  });

  it("Scenario: mint validation error carries no key material (lifetime with expiresAt)", async () => {
    const { pkcs8Pem } = throwawayKeypair();
    const signingKey = await importSigningKey(pkcs8Pem);

    await expect(
      mintLicenseKey(signingKey, {
        kind: "lifetime",
        kid: "k1",
        expiresAt: future,
      }),
    ).rejects.toThrow(/lifetime license must not carry expiresAt/);

    try {
      await mintLicenseKey(signingKey, {
        kind: "lifetime",
        kid: "k1",
        expiresAt: future,
      });
      throw new Error("expected mintLicenseKey to reject");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toContain("PRIVATE KEY");
      expect(message).not.toContain("SB1.");
      expect(message).not.toContain(pkcs8Pem);
    }
  });

  it("Scenario: handler refusal leaks no key material or payload secrets", async () => {
    const { pkcs8Pem } = throwawayKeypair();
    const { kv, store } = makeKv();
    const env = makeEnv(kv, pkcs8Pem);
    const NOW = new Date("2026-07-09T12:00:00.000Z");
    const unix = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

    const getStripe = stubStripe({
      session: {
        id: "cs_ghost",
        mode: "payment",
        payment_status: "unpaid",
        status: "expired",
        created: unix("2026-07-09T11:00:00.000Z"),
        customer_details: { email: "ghost@example.test" },
      },
    });

    const res = await handleGetLicense(request("cs_ghost"), env, ctx, {
      getStripe,
      now: () => NOW,
    });

    expect(res.status).toBe(402);
    const bodyText = await res.text();
    const pemBody = pkcs8Pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
    expect(bodyText).not.toContain(pemBody);
    expect(bodyText).not.toContain("PRIVATE KEY");
    expect(bodyText).not.toContain("SB1.");
    expect(bodyText).not.toContain("ghost@example.test");
    expect(bodyText).not.toContain("cs_ghost");

    for (const value of store.values()) {
      expect(value).not.toContain("SB1.");
      expect(value).not.toContain(pemBody);
    }
  });
});
