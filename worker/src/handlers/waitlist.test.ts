import { describe, expect, it, vi } from "vitest";
import { handleWaitlistSignup, type StoredWaitlistSignup, type WaitlistDeps } from "./waitlist";
import type { Env } from "../index";

/** In-memory KV double backed by a Map, with spy-able `get`/`put` (`put`
 * captures its options argument so TTL is assertable). */
function makeKv(): {
  kv: KVNamespace;
  store: Map<string, string>;
  getSpy: ReturnType<typeof vi.fn>;
  putSpy: ReturnType<typeof vi.fn>;
} {
  const store = new Map<string, string>();
  const getSpy = vi.fn(async (key: string) => (store.has(key) ? store.get(key)! : null));
  const putSpy = vi.fn(async (key: string, value: string, options?: { expirationTtl?: number }) => {
    store.set(key, value);
    return options;
  });
  const kv = { get: getSpy, put: putSpy } as unknown as KVNamespace;
  return { kv, store, getSpy, putSpy };
}

function makeEnv(kv: KVNamespace): Env {
  return {
    LICENSE_KV: {} as KVNamespace,
    EVENTS_KV: {} as KVNamespace,
    WAITLIST_KV: kv,
    FOUNDING_CAP: "300",
    FROM_EMAIL: "hello@example.test",
    SUPPORT_EMAIL: "support@example.test",
    CUSTOMER_PORTAL_URL: "https://portal.example.test",
    APP_ORIGIN: "https://example.test",
    STRIPE_WEBHOOK_SECRET: "whsec_unused",
    STRIPE_SECRET_KEY: "sk_test_unused",
    LICENSE_SIGNING_PRIVATE_KEY: "",
    RESEND_API_KEY: "re_test_unused",
    LICENSE_SIGNING_KID: "test-kid",
    LICENSE_PUBLIC_KEY: "",
  } satisfies Env;
}

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

const NOW = new Date("2026-07-16T12:00:00.000Z");
const deps: WaitlistDeps = { now: () => NOW };

const request = (body: unknown, ip = "1.2.3.4"): Request =>
  new Request("https://sound-buddy-api.test/api/waitlist", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "CF-Connecting-IP": ip },
  });

const rawRequest = (rawBody: string, ip = "1.2.3.4"): Request =>
  new Request("https://sound-buddy-api.test/api/waitlist", {
    method: "POST",
    body: rawBody,
    headers: { "CF-Connecting-IP": ip },
  });

describe("POST /api/waitlist (#599)", () => {
  it("valid signup, email only → 200 ok, stored with no churchName, no CORS header", async () => {
    const { kv, store, putSpy } = makeKv();
    const env = makeEnv(kv);

    const res = await handleWaitlistSignup(request({ email: "pat@example.com" }), env, ctx, deps);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(putSpy).toHaveBeenCalledWith("waitlist:pat@example.com", expect.any(String));
    const stored = JSON.parse(store.get("waitlist:pat@example.com")!) as StoredWaitlistSignup;
    expect(stored).toEqual({
      email: "pat@example.com",
      signedUpAt: NOW.toISOString(),
      ip: "1.2.3.4",
    });
    expect(stored).not.toHaveProperty("churchName");
  });

  it("valid signup with church name → 200 ok, stored verbatim", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);

    const res = await handleWaitlistSignup(
      request({ email: "pat@example.com", churchName: "Grace Community Church" }),
      env,
      ctx,
      deps,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    const stored = JSON.parse(store.get("waitlist:pat@example.com")!) as StoredWaitlistSignup;
    expect(stored.churchName).toBe("Grace Community Church");
  });

  it.each([["a string"], [null], [[]]])(
    "non-object body %j → 400 invalid_event",
    async (body) => {
      const { kv } = makeKv();
      const env = makeEnv(kv);

      const res = await handleWaitlistSignup(request(body), env, ctx, deps);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_event" });
    },
  );

  it("invalid email → 400 invalid_field email, no KV write", async () => {
    const { kv, putSpy } = makeKv();
    const env = makeEnv(kv);

    const res = await handleWaitlistSignup(request({ email: "not-an-email" }), env, ctx, deps);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_field", field: "email" });
    expect(putSpy.mock.calls.some((call) => String(call[0]).startsWith("waitlist:"))).toBe(false);
  });

  it("email over 254 chars → 400 invalid_field email", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    const overlong = `${"a".repeat(250)}@b.co`;

    const res = await handleWaitlistSignup(request({ email: overlong }), env, ctx, deps);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_field", field: "email" });
  });

  it("church name over 100 chars → 400 invalid_field churchName", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);

    const res = await handleWaitlistSignup(
      request({ email: "pat@example.com", churchName: "x".repeat(101) }),
      env,
      ctx,
      deps,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_field", field: "churchName" });
  });

  it("unknown field → 400 unknown_field, no KV write", async () => {
    const { kv, putSpy } = makeKv();
    const env = makeEnv(kv);

    const res = await handleWaitlistSignup(
      request({ email: "pat@example.com", role: "FOH volunteer" }),
      env,
      ctx,
      deps,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown_field", field: "role" });
    expect(putSpy.mock.calls.some((call) => String(call[0]).startsWith("waitlist:"))).toBe(false);
  });

  it("11 requests from one IP: 11th → 429 rate_limited; another IP still succeeds", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);

    let last!: Response;
    for (let i = 0; i < 11; i++) {
      last = await handleWaitlistSignup(
        request({ email: `pat${i}@example.com` }, "1.2.3.4"),
        env,
        ctx,
        deps,
      );
    }
    expect(last.status).toBe(429);
    expect(await last.json()).toEqual({ error: "rate_limited" });

    const other = await handleWaitlistSignup(
      request({ email: "other@example.com" }, "5.6.7.8"),
      env,
      ctx,
      deps,
    );
    expect(other.status).toBe(200);
  });

  it("KV put failure → 500 server_error", async () => {
    const store = new Map<string, string>();
    const kv = {
      get: vi.fn(async (key: string) => (store.has(key) ? store.get(key)! : null)),
      put: vi.fn(async (key: string, value: string, options?: { expirationTtl?: number }) => {
        if (key.startsWith("waitlist:")) throw new Error("boom");
        store.set(key, value);
        return options;
      }),
    } as unknown as KVNamespace;
    const env = makeEnv(kv);

    const res = await handleWaitlistSignup(request({ email: "pat@example.com" }), env, ctx, deps);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "server_error" });
  });

  it("idempotent re-signup: same email twice overwrites, store has one entry", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);

    const first = await handleWaitlistSignup(
      request({ email: "pat@example.com", churchName: "First Church" }),
      env,
      ctx,
      deps,
    );
    const second = await handleWaitlistSignup(
      request({ email: "pat@example.com", churchName: "Second Church" }),
      env,
      ctx,
      deps,
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toEqual({ status: "ok" });
    expect(await second.json()).toEqual({ status: "ok" });
    const waitlistKeys = [...store.keys()].filter((key) => key.startsWith("waitlist:"));
    expect(waitlistKeys).toHaveLength(1);
    const stored = JSON.parse(store.get("waitlist:pat@example.com")!) as StoredWaitlistSignup;
    expect(stored.churchName).toBe("Second Church");
  });

  it("email lowercased in KV key", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);

    const res = await handleWaitlistSignup(request({ email: "Pat@Example.COM" }), env, ctx, deps);

    expect(res.status).toBe(200);
    expect(store.has("waitlist:pat@example.com")).toBe(true);
  });

  it("body over 4 KB → 413 payload_too_large, KV untouched", async () => {
    const { kv, putSpy } = makeKv();
    const env = makeEnv(kv);
    const big = "x".repeat(4 * 1024 + 1);

    const res = await handleWaitlistSignup(rawRequest(big), env, ctx, deps);

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "payload_too_large" });
    expect(putSpy).not.toHaveBeenCalled();
  });

  it("invalid JSON body → 400 invalid_json", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);

    const res = await handleWaitlistSignup(rawRequest("not json"), env, ctx, deps);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
  });

  it("missing CF-Connecting-IP header buckets rate limit under 'unknown'", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);

    const res = await handleWaitlistSignup(
      new Request("https://sound-buddy-api.test/api/waitlist", {
        method: "POST",
        body: JSON.stringify({ email: "pat@example.com" }),
      }),
      env,
      ctx,
      deps,
    );

    expect(res.status).toBe(200);
    expect(store.has("rl:waitlist:unknown")).toBe(true);
  });

  it("default deps (real clock): accepted signup stores a real ISO timestamp", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);

    const res = await handleWaitlistSignup(request({ email: "pat@example.com" }), env, ctx);

    expect(res.status).toBe(200);
    const stored = JSON.parse(store.get("waitlist:pat@example.com")!) as StoredWaitlistSignup;
    expect(() => new Date(stored.signedUpAt).toISOString()).not.toThrow();
    expect(new Date(stored.signedUpAt).toISOString()).toBe(stored.signedUpAt);
  });
});
