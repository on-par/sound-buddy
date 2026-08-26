import { describe, expect, it, vi } from "vitest";
import { countFoundingKeys, handleFoundingCount } from "./founding-count";
import { sessionRecordKey } from "./checkout-completed";
import type { Env } from "../index";

/** In-memory KV double exposing `list({ prefix, cursor })` with pagination,
 *  mirroring founding-mint.test.ts's Map-backed double. */
function makeKv(
  keys: string[],
  pageSize = 1000,
): { kv: KVNamespace; list: ReturnType<typeof vi.fn> } {
  const list = vi.fn(
    async ({ prefix, cursor }: { prefix: string; cursor?: string }) => {
      const matching = keys.filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number.parseInt(cursor, 10) : 0;
      const page = matching.slice(start, start + pageSize);
      const nextStart = start + page.length;
      const list_complete = nextStart >= matching.length;
      return {
        keys: page.map((name) => ({ name })),
        list_complete,
        ...(list_complete ? {} : { cursor: String(nextStart) }),
      };
    },
  );
  const kv = { list } as unknown as KVNamespace;
  return { kv, list };
}

/** In-memory Cache double backed by a Map. */
function makeCache(): { store: Map<string, Response>; cache: Pick<Cache, "match" | "put"> } {
  const store = new Map<string, Response>();
  const cache: Pick<Cache, "match" | "put"> = {
    match: async (req) => store.get(new Request(req).url)?.clone(),
    put: async (req, res) => {
      store.set(new Request(req).url, res.clone());
    },
  };
  return { store, cache };
}

function makeEnv(kv: KVNamespace, foundingCap = "300"): Env {
  return {
    LICENSE_KV: kv,
    EVENTS_KV: {} as KVNamespace,
    WAITLIST_KV: {} as KVNamespace,
    FOUNDING_CAP: foundingCap,
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
    GITHUB_ISSUES_TOKEN: "",
  } satisfies Env;
}

const ctx = {
  waitUntil: (p: Promise<unknown>) => {
    void p;
  },
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

function request(): Request {
  return new Request("https://soundbuddy.online/api/stripe/founding-count");
}

describe("countFoundingKeys", () => {
  it("returns 0 for an empty KV", async () => {
    const { kv } = makeKv([]);
    expect(await countFoundingKeys(kv)).toBe(0);
  });

  it("counts only sess: prefixed keys, ignoring other prefixes", async () => {
    const { kv } = makeKv([
      sessionRecordKey("cs_1"),
      sessionRecordKey("cs_2"),
      "evt:123",
      "sub:456",
      "refund:789",
    ]);
    expect(await countFoundingKeys(kv)).toBe(2);
  });

  it("follows the cursor across multiple list() pages", async () => {
    const keys = Array.from({ length: 5 }, (_, i) => sessionRecordKey(`cs_${i}`));
    const { kv, list } = makeKv(keys, 2);
    expect(await countFoundingKeys(kv)).toBe(5);
    expect(list).toHaveBeenCalledTimes(3);
  });
});

describe("handleFoundingCount", () => {
  it("returns sold/cap/remaining derived from KV on an empty store", async () => {
    const { kv } = makeKv([]);
    const { cache } = makeCache();
    const env = makeEnv(kv);

    const res = await handleFoundingCount(request(), env, ctx, { cache });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sold: 0, cap: 300, remaining: 300 });
  });

  it("derives sold/remaining from minted sess: records", async () => {
    const { kv } = makeKv([
      sessionRecordKey("cs_1"),
      sessionRecordKey("cs_2"),
      sessionRecordKey("cs_3"),
      "evt:should-not-count",
    ]);
    const { cache } = makeCache();
    const env = makeEnv(kv);

    const res = await handleFoundingCount(request(), env, ctx, { cache });

    expect(await res.json()).toEqual({ sold: 3, cap: 300, remaining: 297 });
  });

  it("floors remaining at 0 when sold exceeds cap", async () => {
    const keys = Array.from({ length: 5 }, (_, i) => sessionRecordKey(`cs_${i}`));
    const { kv } = makeKv(keys);
    const { cache } = makeCache();
    const env = makeEnv(kv, "3");

    const res = await handleFoundingCount(request(), env, ctx, { cache });

    expect(await res.json()).toEqual({ sold: 5, cap: 3, remaining: 0 });
  });

  it("degrades to cap 0 (not NaN) on an unparseable FOUNDING_CAP", async () => {
    const { kv } = makeKv([]);
    const { cache } = makeCache();
    const env = makeEnv(kv, "");

    const res = await handleFoundingCount(request(), env, ctx, { cache });

    expect(await res.json()).toEqual({ sold: 0, cap: 0, remaining: 0 });
  });

  it("sets a 60s public Cache-Control header", async () => {
    const { kv } = makeKv([]);
    const { cache } = makeCache();
    const env = makeEnv(kv);

    const res = await handleFoundingCount(request(), env, ctx, { cache });

    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
  });

  it("serves a cache hit without calling KV list again", async () => {
    const { kv, list } = makeKv([sessionRecordKey("cs_1")]);
    const { cache } = makeCache();
    const env = makeEnv(kv);

    const first = await handleFoundingCount(request(), env, ctx, { cache });
    expect(await first.json()).toEqual({ sold: 1, cap: 300, remaining: 299 });
    expect(list).toHaveBeenCalledTimes(1);

    const second = await handleFoundingCount(request(), env, ctx, { cache });
    expect(await second.json()).toEqual({ sold: 1, cap: 300, remaining: 299 });
    expect(list).toHaveBeenCalledTimes(1);
  });
});
