import { describe, expect, it, vi } from "vitest";
import {
  handleInvite,
  handleListInvitees,
  isAdminAuthorized,
  type WaitlistInviteDeps,
} from "./waitlist-invite";
import type { StoredWaitlistSignup } from "./waitlist";
import type { Env } from "../index";

/** In-memory KV double backed by a Map, with spy-able `get`/`put`/`list`.
 * `list` filters the backing Map by prefix and supports simple pagination via
 * a `pageSize` override so cursor pass-through/echo tests can force a
 * `list_complete: false` page. */
function makeKv(pageSize = Number.POSITIVE_INFINITY): {
  kv: KVNamespace;
  store: Map<string, string>;
  getSpy: ReturnType<typeof vi.fn>;
  putSpy: ReturnType<typeof vi.fn>;
  listSpy: ReturnType<typeof vi.fn>;
} {
  const store = new Map<string, string>();
  const getSpy = vi.fn(async (key: string) => (store.has(key) ? store.get(key)! : null));
  const putSpy = vi.fn(async (key: string, value: string) => {
    store.set(key, value);
  });
  const listSpy = vi.fn(async (options?: { prefix?: string; cursor?: string }) => {
    const prefix = options?.prefix ?? "";
    const allNames = [...store.keys()].filter((key) => key.startsWith(prefix)).sort();
    const start = options?.cursor ? Number.parseInt(options.cursor, 10) : 0;
    const page = allNames.slice(start, start + pageSize);
    const keys = page.map((name) => ({ name }));
    const nextStart = start + page.length;
    if (nextStart < allNames.length) {
      return { keys, list_complete: false, cursor: String(nextStart) };
    }
    return { keys, list_complete: true };
  });
  const kv = { get: getSpy, put: putSpy, list: listSpy } as unknown as KVNamespace;
  return { kv, store, getSpy, putSpy, listSpy };
}

function makeEnv(kv: KVNamespace, adminToken = "test-admin-token"): Env {
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
    WAITLIST_ADMIN_TOKEN: adminToken,
  } satisfies Env;
}

const ctx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

const NOW = new Date("2026-07-24T12:00:00.000Z");
const deps: WaitlistInviteDeps = { now: () => NOW };

function seed(store: Map<string, string>, signup: StoredWaitlistSignup): void {
  store.set(`waitlist:${signup.email}`, JSON.stringify(signup));
}

const waitlistRow = (overrides: Partial<StoredWaitlistSignup> = {}): StoredWaitlistSignup => ({
  email: "pat@example.com",
  signedUpAt: "2026-07-01T00:00:00.000Z",
  ip: "1.2.3.4",
  status: "waitlist",
  ...overrides,
});

const inviteRequest = (body: unknown, token = "test-admin-token"): Request =>
  new Request("https://sound-buddy-api.test/api/waitlist/invite", {
    method: "POST",
    body: JSON.stringify(body),
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

const rawInviteRequest = (rawBody: string, token = "test-admin-token"): Request =>
  new Request("https://sound-buddy-api.test/api/waitlist/invite", {
    method: "POST",
    body: rawBody,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

const invitieesRequest = (params: Record<string, string> = {}, token = "test-admin-token"): Request => {
  const url = new URL("https://sound-buddy-api.test/api/waitlist/invitees");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new Request(url, {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
};

describe("isAdminAuthorized", () => {
  it("correct Bearer <token> → true", async () => {
    const env = makeEnv(makeKv().kv);
    const req = new Request("https://sound-buddy-api.test/x", {
      headers: { Authorization: "Bearer test-admin-token" },
    });
    expect(await isAdminAuthorized(req, env)).toBe(true);
  });

  it("wrong token → false", async () => {
    const env = makeEnv(makeKv().kv);
    const req = new Request("https://sound-buddy-api.test/x", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(await isAdminAuthorized(req, env)).toBe(false);
  });

  it("non-Bearer scheme → false", async () => {
    const env = makeEnv(makeKv().kv);
    const req = new Request("https://sound-buddy-api.test/x", {
      headers: { Authorization: "Basic dGVzdA==" },
    });
    expect(await isAdminAuthorized(req, env)).toBe(false);
  });

  it("missing Authorization header → false", async () => {
    const env = makeEnv(makeKv().kv);
    const req = new Request("https://sound-buddy-api.test/x");
    expect(await isAdminAuthorized(req, env)).toBe(false);
  });

  it("WAITLIST_ADMIN_TOKEN unset → false even with a matching-looking header", async () => {
    const env = makeEnv(makeKv().kv, "");
    const req = new Request("https://sound-buddy-api.test/x", {
      headers: { Authorization: "Bearer whatever" },
    });
    expect(await isAdminAuthorized(req, env)).toBe(false);
  });
});

describe("POST /api/waitlist/invite (#642)", () => {
  it("no Authorization header → 401 unauthorized, no KV reads", async () => {
    const { kv, getSpy } = makeKv();
    const env = makeEnv(kv);

    const res = await handleInvite(inviteRequest({ emails: ["pat@example.com"] }, ""), env, ctx, deps);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(getSpy).not.toHaveBeenCalled();
  });

  it("wrong token → 401 unauthorized", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);

    const res = await handleInvite(inviteRequest({ emails: ["pat@example.com"] }, "nope"), env, ctx, deps);

    expect(res.status).toBe(401);
  });

  it("WAITLIST_ADMIN_TOKEN unset → 401 even with a header", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv, "");

    const res = await handleInvite(inviteRequest({ emails: ["pat@example.com"] }), env, ctx, deps);

    expect(res.status).toBe(401);
  });

  it("body over MAX_BODY_BYTES → 413 payload_too_large", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    const big = "x".repeat(64 * 1024 + 1);

    const res = await handleInvite(rawInviteRequest(big), env, ctx, deps);

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "payload_too_large" });
  });

  it("invalid JSON → 400 invalid_json", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);

    const res = await handleInvite(rawInviteRequest("not json"), env, ctx, deps);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
  });

  it.each([["a string"], [null], [[]]])("non-object body %j → 400 invalid_event", async (body) => {
    const { kv } = makeKv();
    const env = makeEnv(kv);

    const res = await handleInvite(inviteRequest(body), env, ctx, deps);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_event" });
  });

  it("unknown key → 400 unknown_field", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);

    const res = await handleInvite(
      inviteRequest({ emails: ["pat@example.com"], extra: "nope" }),
      env,
      ctx,
      deps,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown_field", field: "extra" });
  });

  it("emails missing → 400 invalid_field emails", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);

    const res = await handleInvite(inviteRequest({}), env, ctx, deps);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_field", field: "emails" });
  });

  it("emails empty array → 400 invalid_field emails", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);

    const res = await handleInvite(inviteRequest({ emails: [] }), env, ctx, deps);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_field", field: "emails" });
  });

  it("emails non-string entry → 400 invalid_field emails", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);

    const res = await handleInvite(inviteRequest({ emails: ["pat@example.com", 5] }), env, ctx, deps);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_field", field: "emails" });
  });

  it("emails bad email format → 400 invalid_field emails", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);

    const res = await handleInvite(inviteRequest({ emails: ["not-an-email"] }), env, ctx, deps);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_field", field: "emails" });
  });

  it("emails over MAX_INVITE_BATCH entries → 400 invalid_field emails", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    const emails = Array.from({ length: 201 }, (_, i) => `pat${i}@example.com`);

    const res = await handleInvite(inviteRequest({ emails }), env, ctx, deps);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_field", field: "emails" });
  });

  it("contact in waitlist status → 200, outcome invited; KV row updated with invitedAt, other fields unchanged", async () => {
    const { kv, store } = makeKv();
    seed(store, waitlistRow({ churchName: "Grace Community Church" }));
    const env = makeEnv(kv);

    const res = await handleInvite(inviteRequest({ emails: ["pat@example.com"] }), env, ctx, deps);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [{ email: "pat@example.com", outcome: "invited" }] });
    const stored = JSON.parse(store.get("waitlist:pat@example.com")!) as StoredWaitlistSignup;
    expect(stored).toEqual({
      email: "pat@example.com",
      churchName: "Grace Community Church",
      signedUpAt: "2026-07-01T00:00:00.000Z",
      ip: "1.2.3.4",
      status: "invited",
      invitedAt: NOW.toISOString(),
    });
  });

  it("uppercase input email matches the lowercased KV key", async () => {
    const { kv, store } = makeKv();
    seed(store, waitlistRow());
    const env = makeEnv(kv);

    const res = await handleInvite(inviteRequest({ emails: ["Pat@Example.COM"] }), env, ctx, deps);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [{ email: "pat@example.com", outcome: "invited" }] });
  });

  it("contact already invited → outcome skipped, put not called for that key, invitedAt unchanged", async () => {
    const { kv, store, putSpy } = makeKv();
    seed(store, waitlistRow({ status: "invited", invitedAt: "2026-07-10T00:00:00.000Z" }));
    const env = makeEnv(kv);

    const res = await handleInvite(inviteRequest({ emails: ["pat@example.com"] }), env, ctx, deps);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: [{ email: "pat@example.com", outcome: "skipped", status: "invited" }],
    });
    expect(putSpy).not.toHaveBeenCalled();
    const stored = JSON.parse(store.get("waitlist:pat@example.com")!) as StoredWaitlistSignup;
    expect(stored.invitedAt).toBe("2026-07-10T00:00:00.000Z");
  });

  it("contact in activated status → outcome skipped", async () => {
    const { kv, store } = makeKv();
    seed(store, waitlistRow({ status: "activated" }));
    const env = makeEnv(kv);

    const res = await handleInvite(inviteRequest({ emails: ["pat@example.com"] }), env, ctx, deps);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: [{ email: "pat@example.com", outcome: "skipped", status: "activated" }],
    });
  });

  it("unknown email → outcome not_found", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);

    const res = await handleInvite(inviteRequest({ emails: ["ghost@example.com"] }), env, ctx, deps);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [{ email: "ghost@example.com", outcome: "not_found" }] });
  });

  it("mixed batch → per-email results in input order", async () => {
    const { kv, store } = makeKv();
    seed(store, waitlistRow({ email: "a@example.com" }));
    seed(store, waitlistRow({ email: "b@example.com", status: "invited", invitedAt: "2026-07-10T00:00:00.000Z" }));
    const env = makeEnv(kv);

    const res = await handleInvite(
      inviteRequest({ emails: ["a@example.com", "b@example.com", "c@example.com"] }),
      env,
      ctx,
      deps,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: [
        { email: "a@example.com", outcome: "invited" },
        { email: "b@example.com", outcome: "skipped", status: "invited" },
        { email: "c@example.com", outcome: "not_found" },
      ],
    });
  });

  it("put throwing for one email → that email error, others still processed, response still 200", async () => {
    const store = new Map<string, string>();
    seed(store, waitlistRow({ email: "a@example.com" }));
    seed(store, waitlistRow({ email: "b@example.com" }));
    const kv = {
      get: vi.fn(async (key: string) => (store.has(key) ? store.get(key)! : null)),
      put: vi.fn(async (key: string, value: string) => {
        if (key === "waitlist:a@example.com") throw new Error("boom");
        store.set(key, value);
      }),
    } as unknown as KVNamespace;
    const env = makeEnv(kv);

    const res = await handleInvite(
      inviteRequest({ emails: ["a@example.com", "b@example.com"] }),
      env,
      ctx,
      deps,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: [
        { email: "a@example.com", outcome: "error" },
        { email: "b@example.com", outcome: "invited" },
      ],
    });
  });

  it("unparseable stored JSON → outcome error", async () => {
    const { kv, store } = makeKv();
    store.set("waitlist:pat@example.com", "not json");
    const env = makeEnv(kv);

    const res = await handleInvite(inviteRequest({ emails: ["pat@example.com"] }), env, ctx, deps);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [{ email: "pat@example.com", outcome: "error" }] });
  });

  it("get() throwing for one email → that email error, others still processed, response still 200", async () => {
    const store = new Map<string, string>();
    seed(store, waitlistRow({ email: "a@example.com" }));
    seed(store, waitlistRow({ email: "b@example.com" }));
    const kv = {
      get: vi.fn(async (key: string) => {
        if (key === "waitlist:a@example.com") throw new Error("boom");
        return store.has(key) ? store.get(key)! : null;
      }),
      put: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
    } as unknown as KVNamespace;
    const env = makeEnv(kv);

    const res = await handleInvite(
      inviteRequest({ emails: ["a@example.com", "b@example.com"] }),
      env,
      ctx,
      deps,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      results: [
        { email: "a@example.com", outcome: "error" },
        { email: "b@example.com", outcome: "invited" },
      ],
    });
  });

  it("empty-string churchName is preserved verbatim on the invited record", async () => {
    const { kv, store } = makeKv();
    seed(store, waitlistRow({ churchName: "" }));
    const env = makeEnv(kv);

    const res = await handleInvite(inviteRequest({ emails: ["pat@example.com"] }), env, ctx, deps);

    expect(res.status).toBe(200);
    const stored = JSON.parse(store.get("waitlist:pat@example.com")!) as StoredWaitlistSignup;
    expect(stored.churchName).toBe("");
  });

  it("a batch of multiple invites all get the same invitedAt (one clock read per request)", async () => {
    const { kv, store } = makeKv();
    seed(store, waitlistRow({ email: "a@example.com" }));
    seed(store, waitlistRow({ email: "b@example.com" }));
    const env = makeEnv(kv);

    const res = await handleInvite(
      inviteRequest({ emails: ["a@example.com", "b@example.com"] }),
      env,
      ctx,
      deps,
    );

    expect(res.status).toBe(200);
    const a = JSON.parse(store.get("waitlist:a@example.com")!) as StoredWaitlistSignup;
    const b = JSON.parse(store.get("waitlist:b@example.com")!) as StoredWaitlistSignup;
    expect(a.invitedAt).toBe(NOW.toISOString());
    expect(b.invitedAt).toBe(a.invitedAt);
  });

  it("default deps (real clock): invited contact gets a real ISO timestamp", async () => {
    const { kv, store } = makeKv();
    seed(store, waitlistRow());
    const env = makeEnv(kv);

    const res = await handleInvite(inviteRequest({ emails: ["pat@example.com"] }), env, ctx);

    expect(res.status).toBe(200);
    const stored = JSON.parse(store.get("waitlist:pat@example.com")!) as StoredWaitlistSignup;
    expect(() => new Date(stored.invitedAt!).toISOString()).not.toThrow();
    expect(new Date(stored.invitedAt!).toISOString()).toBe(stored.invitedAt);
  });
});

describe("GET /api/waitlist/invitees (#642)", () => {
  it("no Authorization header → 401 unauthorized, no KV reads", async () => {
    const { kv, listSpy } = makeKv();
    const env = makeEnv(kv);

    const res = await handleListInvitees(invitieesRequest({}, ""), env, ctx);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(listSpy).not.toHaveBeenCalled();
  });

  it("wrong token → 401", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);

    const res = await handleListInvitees(invitieesRequest({}, "nope"), env, ctx);

    expect(res.status).toBe(401);
  });

  it("returns only status: waitlist rows; invited/activated rows excluded", async () => {
    const { kv, store } = makeKv();
    seed(store, waitlistRow({ email: "a@example.com" }));
    seed(store, waitlistRow({ email: "b@example.com", status: "invited", invitedAt: "2026-07-10T00:00:00.000Z" }));
    seed(store, waitlistRow({ email: "c@example.com", status: "activated" }));
    const env = makeEnv(kv);

    const res = await handleListInvitees(invitieesRequest(), env, ctx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { invitees: unknown[] };
    expect(body.invitees).toEqual([
      { email: "a@example.com", signedUpAt: "2026-07-01T00:00:00.000Z" },
    ]);
  });

  it("response entries contain email/signedUpAt/optional churchName and never ip", async () => {
    const { kv, store } = makeKv();
    seed(store, waitlistRow({ churchName: "Grace Community Church" }));
    const env = makeEnv(kv);

    const res = await handleListInvitees(invitieesRequest(), env, ctx);
    const body = (await res.json()) as { invitees: Array<Record<string, unknown>> };

    expect(body.invitees).toEqual([
      {
        email: "pat@example.com",
        signedUpAt: "2026-07-01T00:00:00.000Z",
        churchName: "Grace Community Church",
      },
    ]);
    expect(body.invitees[0]).not.toHaveProperty("ip");
  });

  it("empty-string churchName is included, not dropped", async () => {
    const { kv, store } = makeKv();
    seed(store, waitlistRow({ churchName: "" }));
    const env = makeEnv(kv);

    const res = await handleListInvitees(invitieesRequest(), env, ctx);
    const body = (await res.json()) as { invitees: Array<Record<string, unknown>> };

    expect(body.invitees).toEqual([
      { email: "pat@example.com", signedUpAt: "2026-07-01T00:00:00.000Z", churchName: "" },
    ]);
  });

  it("rate-limit keys are invisible: list called with { prefix: 'waitlist:' }", async () => {
    const { kv, store, listSpy } = makeKv();
    store.set("rl:waitlist:1.2.3.4", "3");
    seed(store, waitlistRow());
    const env = makeEnv(kv);

    await handleListInvitees(invitieesRequest(), env, ctx);

    expect(listSpy).toHaveBeenCalledWith(expect.objectContaining({ prefix: "waitlist:" }));
  });

  it("cursor query param is passed through to kv.list; incomplete lists echo cursor and complete: false", async () => {
    const { kv, store } = makeKv(1);
    seed(store, waitlistRow({ email: "a@example.com" }));
    seed(store, waitlistRow({ email: "b@example.com" }));
    const env = makeEnv(kv);

    const res = await handleListInvitees(invitieesRequest(), env, ctx);
    const body = (await res.json()) as { invitees: unknown[]; complete: boolean; cursor?: string };

    expect(body.complete).toBe(false);
    expect(body.cursor).toBe("1");
    expect(body.invitees).toHaveLength(1);

    const secondRes = await handleListInvitees(invitieesRequest({ cursor: "1" }), env, ctx);
    const secondBody = (await secondRes.json()) as { invitees: unknown[]; complete: boolean; cursor?: string };
    expect(secondBody.complete).toBe(true);
    expect(secondBody.cursor).toBeUndefined();
    expect(secondBody.invitees).toHaveLength(1);
  });

  it("complete lists return complete: true with no cursor", async () => {
    const { kv, store } = makeKv();
    seed(store, waitlistRow());
    const env = makeEnv(kv);

    const res = await handleListInvitees(invitieesRequest(), env, ctx);
    const body = (await res.json()) as { complete: boolean; cursor?: string };

    expect(body.complete).toBe(true);
    expect(body.cursor).toBeUndefined();
  });

  it("unparseable row is skipped, not fatal", async () => {
    const { kv, store } = makeKv();
    store.set("waitlist:broken@example.com", "not json");
    seed(store, waitlistRow());
    const env = makeEnv(kv);

    const res = await handleListInvitees(invitieesRequest(), env, ctx);
    const body = (await res.json()) as { invitees: unknown[] };

    expect(res.status).toBe(200);
    expect(body.invitees).toHaveLength(1);
  });

  it("a key returned by list but gone by the time get runs is skipped, not fatal", async () => {
    const store = new Map<string, string>();
    seed(store, waitlistRow());
    const kv = {
      get: vi.fn(async (key: string) => (store.has(key) ? store.get(key)! : null)),
      put: vi.fn(),
      list: vi.fn(async () => ({
        keys: [{ name: "waitlist:pat@example.com" }, { name: "waitlist:ghost@example.com" }],
        list_complete: true,
      })),
    } as unknown as KVNamespace;
    const env = makeEnv(kv);

    const res = await handleListInvitees(invitieesRequest(), env, ctx);
    const body = (await res.json()) as { invitees: unknown[] };

    expect(res.status).toBe(200);
    expect(body.invitees).toHaveLength(1);
  });

  it("get() throwing for one listed key is skipped, other invitees still returned, 200", async () => {
    const store = new Map<string, string>();
    seed(store, waitlistRow({ email: "a@example.com" }));
    seed(store, waitlistRow({ email: "b@example.com" }));
    const kv = {
      get: vi.fn(async (key: string) => {
        if (key === "waitlist:a@example.com") throw new Error("boom");
        return store.has(key) ? store.get(key)! : null;
      }),
      put: vi.fn(),
      list: vi.fn(async () => ({
        keys: [{ name: "waitlist:a@example.com" }, { name: "waitlist:b@example.com" }],
        list_complete: true,
      })),
    } as unknown as KVNamespace;
    const env = makeEnv(kv);

    const res = await handleListInvitees(invitieesRequest(), env, ctx);
    const body = (await res.json()) as { invitees: Array<{ email: string }> };

    expect(res.status).toBe(200);
    expect(body.invitees).toEqual([{ email: "b@example.com", signedUpAt: "2026-07-01T00:00:00.000Z" }]);
  });

  it("KV list throwing → 500 server_error", async () => {
    const kv = {
      get: vi.fn(),
      put: vi.fn(),
      list: vi.fn(async () => {
        throw new Error("boom");
      }),
    } as unknown as KVNamespace;
    const env = makeEnv(kv);

    const res = await handleListInvitees(invitieesRequest(), env, ctx);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "server_error" });
  });
});
