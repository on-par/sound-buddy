import { describe, expect, it, vi } from "vitest";
import {
  AUTH_OTP_PREFIX,
  AUTH_SESSION_PREFIX,
  handleAuthSession,
  handleAuthStart,
  handleAuthVerify,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_SECONDS,
  readSession,
  SESSION_TTL_SECONDS,
  type AuthDeps,
} from "./auth";
import { sha256Hex } from "../license-sign";
import type { Env } from "../index";

/** In-memory KV double backed by a Map, with spy-able get/put/delete (`put`
 * captures its options argument so TTL is assertable) — extends
 * waitlist.test.ts's makeKv pattern with a delete spy (#1525). */
function makeKv(): {
  kv: KVNamespace;
  store: Map<string, string>;
  getSpy: ReturnType<typeof vi.fn>;
  putSpy: ReturnType<typeof vi.fn>;
  deleteSpy: ReturnType<typeof vi.fn>;
} {
  const store = new Map<string, string>();
  const getSpy = vi.fn(async (key: string) => (store.has(key) ? store.get(key)! : null));
  const putSpy = vi.fn(async (key: string, value: string, options?: { expirationTtl?: number }) => {
    store.set(key, value);
    return options;
  });
  const deleteSpy = vi.fn(async (key: string) => {
    store.delete(key);
  });
  const kv = { get: getSpy, put: putSpy, delete: deleteSpy } as unknown as KVNamespace;
  return { kv, store, getSpy, putSpy, deleteSpy };
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
    WAITLIST_AUDIENCE_ID: "",
    GITHUB_ISSUES_TOKEN: "",
  } satisfies Env;
}

function makeCtx(): { ctx: ExecutionContext; settled: () => Promise<unknown[]> } {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => pending.push(p),
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  return { ctx, settled: () => Promise.all(pending) };
}

const NOW = new Date("2026-09-25T12:00:00.000Z");

const okFetch = () =>
  vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}", { status: 200 }));

function startRequest(body: unknown, ip = "1.2.3.4"): Request {
  return new Request("https://sound-buddy-api.test/api/auth/start", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "CF-Connecting-IP": ip },
  });
}

function rawStartRequest(rawBody: string, ip = "1.2.3.4"): Request {
  return new Request("https://sound-buddy-api.test/api/auth/start", {
    method: "POST",
    body: rawBody,
    headers: { "CF-Connecting-IP": ip },
  });
}

function verifyRequest(body: unknown, ip = "1.2.3.4"): Request {
  return new Request("https://sound-buddy-api.test/api/auth/verify", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "CF-Connecting-IP": ip },
  });
}

function sessionRequest(cookie?: string): Request {
  return new Request("https://sound-buddy-api.test/api/auth/session", {
    method: "GET",
    headers: cookie ? { Cookie: cookie } : {},
  });
}

const baseDeps = (overrides: AuthDeps = {}): AuthDeps => ({
  now: () => NOW,
  fetch: okFetch() as unknown as typeof fetch,
  randomCode: () => "482913",
  randomToken: () => "test-token-12345",
  ...overrides,
});

describe("POST /api/auth/start (#1525)", () => {
  it("valid email → 200 ok, stores a hashed code (not the plaintext) with TTL 600", async () => {
    const { kv, store, putSpy } = makeKv();
    const env = makeEnv(kv);
    const deps = baseDeps();

    const res = await handleAuthStart(startRequest({ email: "pat@example.com" }), env, makeCtx().ctx, deps);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });

    const putCall = putSpy.mock.calls.find((call) => String(call[0]) === `${AUTH_OTP_PREFIX}pat@example.com`);
    expect(putCall).toBeDefined();
    expect(putCall![2]).toEqual({ expirationTtl: OTP_TTL_SECONDS });

    const stored = JSON.parse(store.get(`${AUTH_OTP_PREFIX}pat@example.com`)!) as {
      codeHash: string;
      attempts: number;
    };
    expect(stored.codeHash).not.toBe("482913");
    expect(stored.codeHash).toBe(await sha256Hex("482913"));
    expect(stored.attempts).toBe(0);
  });

  it("sends the code via the injected fetch", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    const fetchSpy = okFetch();
    const { ctx, settled } = makeCtx();

    await handleAuthStart(startRequest({ email: "pat@example.com" }), env, ctx, baseDeps({ fetch: fetchSpy as unknown as typeof fetch }));
    await settled();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(body.text).toContain("482913");
  });

  it("email lowercased in KV key", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);

    const res = await handleAuthStart(startRequest({ email: "Pat@Example.COM" }), env, makeCtx().ctx, baseDeps());

    expect(res.status).toBe(200);
    expect(store.has(`${AUTH_OTP_PREFIX}pat@example.com`)).toBe(true);
  });

  it("unknown field → 400 unknown_field", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);

    const res = await handleAuthStart(
      startRequest({ email: "pat@example.com", extra: "nope" }),
      env,
      makeCtx().ctx,
      baseDeps(),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown_field", field: "extra" });
  });

  it("invalid email → 400 invalid_field email", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);

    const res = await handleAuthStart(startRequest({ email: "not-an-email" }), env, makeCtx().ctx, baseDeps());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_field", field: "email" });
  });

  it("invalid JSON body → 400 invalid_json", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);

    const res = await handleAuthStart(rawStartRequest("not json"), env, makeCtx().ctx, baseDeps());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
  });

  it("body over 4 KB → 413 payload_too_large", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    const big = "x".repeat(4 * 1024 + 1);

    const res = await handleAuthStart(rawStartRequest(big), env, makeCtx().ctx, baseDeps());

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "payload_too_large" });
  });

  it("6th request from one IP within the window → 429 rate_limited", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);

    let last!: Response;
    for (let i = 0; i < 6; i++) {
      last = await handleAuthStart(startRequest({ email: `pat${i}@example.com` }, "9.9.9.9"), env, makeCtx().ctx, baseDeps());
    }
    expect(last.status).toBe(429);
    expect(await last.json()).toEqual({ error: "rate_limited" });
  });

  it("6th request for one email (different IPs) → 429 rate_limited", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);

    let last!: Response;
    for (let i = 0; i < 6; i++) {
      last = await handleAuthStart(startRequest({ email: "pat@example.com" }, `1.1.1.${i}`), env, makeCtx().ctx, baseDeps());
    }
    expect(last.status).toBe(429);
    expect(await last.json()).toEqual({ error: "rate_limited" });
  });

  it("default deps (real clock, real randomness): accepted request stores a real 6-digit hashed code", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);

    const res = await handleAuthStart(startRequest({ email: "pat@example.com" }), env, makeCtx().ctx, {
      fetch: okFetch() as unknown as typeof fetch,
    });

    expect(res.status).toBe(200);
    const stored = JSON.parse(store.get(`${AUTH_OTP_PREFIX}pat@example.com`)!) as { codeHash: string };
    expect(stored.codeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("KV put failure → 500 server_error", async () => {
    const store = new Map<string, string>();
    const kv = {
      get: vi.fn(async (key: string) => (store.has(key) ? store.get(key)! : null)),
      put: vi.fn(async (key: string) => {
        if (key.startsWith(AUTH_OTP_PREFIX)) throw new Error("boom");
        return undefined;
      }),
      delete: vi.fn(async () => {}),
    } as unknown as KVNamespace;
    const env = makeEnv(kv);

    const res = await handleAuthStart(startRequest({ email: "pat@example.com" }), env, makeCtx().ctx, baseDeps());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "server_error" });
  });
});

describe("POST /api/auth/verify (#1525)", () => {
  async function seedOtp(kv: KVNamespace, email: string, code: string, attempts = 0): Promise<void> {
    await kv.put(`${AUTH_OTP_PREFIX}${email}`, JSON.stringify({ codeHash: await sha256Hex(code), attempts }));
  }

  it("right code → 200, sets sb_session cookie with the correct flags", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    await seedOtp(kv, "pat@example.com", "482913");

    const res = await handleAuthVerify(
      verifyRequest({ email: "pat@example.com", code: "482913" }),
      env,
      makeCtx().ctx,
      baseDeps(),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signedIn: true, email: "pat@example.com" });
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain("sb_session=test-token-12345");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/api");
    expect(cookie).toContain("Max-Age=2592000");
  });

  it("session KV key is auth:session:<sha256(token)> with TTL 2592000", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    await seedOtp(kv, "pat@example.com", "482913");

    await handleAuthVerify(verifyRequest({ email: "pat@example.com", code: "482913" }), env, makeCtx().ctx, baseDeps());

    const key = `${AUTH_SESSION_PREFIX}${await sha256Hex("test-token-12345")}`;
    expect(store.has(key)).toBe(true);
    const stored = JSON.parse(store.get(key)!) as { email: string; createdAt: string };
    expect(stored).toEqual({ email: "pat@example.com", createdAt: NOW.toISOString() });
  });

  it("verify with the correct code puts the session with expirationTtl SESSION_TTL_SECONDS", async () => {
    const { kv, putSpy } = makeKv();
    const env = makeEnv(kv);
    await seedOtp(kv, "pat@example.com", "482913");

    await handleAuthVerify(verifyRequest({ email: "pat@example.com", code: "482913" }), env, makeCtx().ctx, baseDeps());

    const sessionPut = putSpy.mock.calls.find((call) => String(call[0]).startsWith(AUTH_SESSION_PREFIX));
    expect(sessionPut![2]).toEqual({ expirationTtl: SESSION_TTL_SECONDS });
  });

  it("otp key is deleted on success — a second verify with the same code fails", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    await seedOtp(kv, "pat@example.com", "482913");

    const first = await handleAuthVerify(verifyRequest({ email: "pat@example.com", code: "482913" }), env, makeCtx().ctx, baseDeps());
    const second = await handleAuthVerify(verifyRequest({ email: "pat@example.com", code: "482913" }), env, makeCtx().ctx, baseDeps());

    expect(first.status).toBe(200);
    expect(second.status).toBe(401);
    expect(await second.json()).toEqual({ error: "invalid_code" });
  });

  it("wrong code → 401 invalid_code, attempts incremented", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    await seedOtp(kv, "pat@example.com", "482913");

    const res = await handleAuthVerify(verifyRequest({ email: "pat@example.com", code: "000000" }), env, makeCtx().ctx, baseDeps());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_code" });
    const stored = JSON.parse(store.get(`${AUTH_OTP_PREFIX}pat@example.com`)!) as { attempts: number };
    expect(stored.attempts).toBe(1);
  });

  it(`${OTP_MAX_ATTEMPTS}th wrong attempt deletes the otp key`, async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv);
    await seedOtp(kv, "pat@example.com", "482913", OTP_MAX_ATTEMPTS - 1);

    const res = await handleAuthVerify(verifyRequest({ email: "pat@example.com", code: "000000" }), env, makeCtx().ctx, baseDeps());

    expect(res.status).toBe(401);
    expect(store.has(`${AUTH_OTP_PREFIX}pat@example.com`)).toBe(false);
  });

  it("default deps (real clock, real randomness): right code → 200 with a real base64url token cookie", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    await seedOtp(kv, "pat@example.com", "482913");

    const res = await handleAuthVerify(verifyRequest({ email: "pat@example.com", code: "482913" }), env, makeCtx().ctx, {});

    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/sb_session=[A-Za-z0-9_-]{20,}; HttpOnly/);
  });

  it("otp KV get throws → 401 invalid_code (never 500)", async () => {
    const store = new Map<string, string>();
    const kv = {
      get: vi.fn(async (key: string) => {
        if (key.startsWith(AUTH_OTP_PREFIX)) throw new Error("kv down");
        return store.has(key) ? store.get(key)! : null;
      }),
      put: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      delete: vi.fn(async () => {}),
    } as unknown as KVNamespace;
    const env = makeEnv(kv);

    const res = await handleAuthVerify(verifyRequest({ email: "pat@example.com", code: "482913" }), env, makeCtx().ctx, baseDeps());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_code" });
  });

  it("malformed stored otp JSON → 401 invalid_code", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    await kv.put(`${AUTH_OTP_PREFIX}pat@example.com`, "not json");

    const res = await handleAuthVerify(verifyRequest({ email: "pat@example.com", code: "482913" }), env, makeCtx().ctx, baseDeps());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_code" });
  });

  it("missing otp record → 401 invalid_code", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);

    const res = await handleAuthVerify(verifyRequest({ email: "nobody@example.com", code: "482913" }), env, makeCtx().ctx, baseDeps());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_code" });
  });

  it("malformed code (not 6 digits) → 400 invalid_field", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);

    const res = await handleAuthVerify(verifyRequest({ email: "pat@example.com", code: "12a" }), env, makeCtx().ctx, baseDeps());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_field", field: "code" });
  });

  it("unknown field → 400 unknown_field", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);

    const res = await handleAuthVerify(
      verifyRequest({ email: "pat@example.com", code: "482913", extra: 1 }),
      env,
      makeCtx().ctx,
      baseDeps(),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown_field", field: "extra" });
  });

  it("invalid email → 400 invalid_field", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);

    const res = await handleAuthVerify(verifyRequest({ email: "nope", code: "482913" }), env, makeCtx().ctx, baseDeps());

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_field", field: "email" });
  });

  it("6th verify request from one IP within the window → 429 rate_limited", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);

    let last!: Response;
    for (let i = 0; i < 6; i++) {
      last = await handleAuthVerify(verifyRequest({ email: "pat@example.com", code: "000000" }, "8.8.8.8"), env, makeCtx().ctx, baseDeps());
    }
    expect(last.status).toBe(429);
    expect(await last.json()).toEqual({ error: "rate_limited" });
  });
});

describe("GET /api/auth/session + readSession (#1525)", () => {
  it("valid cookie → 200 {signedIn:true,email} with cache-control: no-store", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    const tokenHash = await sha256Hex("valid-token");
    await kv.put(`${AUTH_SESSION_PREFIX}${tokenHash}`, JSON.stringify({ email: "pat@example.com", createdAt: NOW.toISOString() }));

    const res = await handleAuthSession(sessionRequest("sb_session=valid-token"), env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signedIn: true, email: "pat@example.com" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("no cookie → 401 {signedIn:false} with cache-control: no-store", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);

    const res = await handleAuthSession(sessionRequest(), env);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ signedIn: false });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("unknown token → 401 {signedIn:false}", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);

    const res = await handleAuthSession(sessionRequest("sb_session=unknown-token"), env);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ signedIn: false });
  });

  it("malformed stored JSON → 401 {signedIn:false} (readSession returns null)", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    const tokenHash = await sha256Hex("bad-token");
    await kv.put(`${AUTH_SESSION_PREFIX}${tokenHash}`, "not json");

    const session = await readSession(sessionRequest("sb_session=bad-token"), env);
    expect(session).toBeNull();

    const res = await handleAuthSession(sessionRequest("sb_session=bad-token"), env);
    expect(res.status).toBe(401);
  });

  it("KV get throws → readSession returns null, never 500", async () => {
    const kv = {
      get: vi.fn(async () => {
        throw new Error("kv down");
      }),
      put: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    } as unknown as KVNamespace;
    const env = makeEnv(kv);

    const session = await readSession(sessionRequest("sb_session=any-token"), env);
    expect(session).toBeNull();

    const res = await handleAuthSession(sessionRequest("sb_session=any-token"), env);
    expect(res.status).toBe(401);
  });

  it("cookie parsed correctly among other cookies", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    const tokenHash = await sha256Hex("valid-token");
    await kv.put(`${AUTH_SESSION_PREFIX}${tokenHash}`, JSON.stringify({ email: "pat@example.com", createdAt: NOW.toISOString() }));

    const res = await handleAuthSession(sessionRequest("other=1; sb_session=valid-token; another=2"), env);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signedIn: true, email: "pat@example.com" });
  });

  it("cookie header present but sb_session not among them → 401 (never looked up)", async () => {
    const { kv, getSpy } = makeKv();
    const env = makeEnv(kv);

    const res = await handleAuthSession(sessionRequest("other=1; another=2"), env);

    expect(res.status).toBe(401);
    expect(getSpy).not.toHaveBeenCalled();
  });

  it("empty cookie value → 401 (never looked up)", async () => {
    const { kv, getSpy } = makeKv();
    const env = makeEnv(kv);

    const res = await handleAuthSession(sessionRequest("sb_session="), env);

    expect(res.status).toBe(401);
    expect(getSpy).not.toHaveBeenCalled();
  });
});
