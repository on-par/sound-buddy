// `GET /api/stripe/founding-count` (#1170) — live founding-license sold count
// for the marketing site's Founding tier display.
//
// SECURITY (normative): counts KV key names only via `list()`. Never reads or
// logs a `sess:` record's value (email, key hash) — the response exposes only
// aggregate counts.

import { json } from "../http";
import { SESSION_RECORD_PREFIX } from "./checkout-completed";
import type { Env } from "../index";

/** Edge-cache TTL for the founding count — bounds KV reads to ~1/min per edge. */
export const FOUNDING_COUNT_CACHE_SECONDS = 60;

/** Injectable cache seam so tests never depend on the Workers `caches` global. */
export interface FoundingCountDeps {
  cache?: Pick<Cache, "match" | "put">;
}

/* c8 ignore start -- caches.default is a Workers-only global; tests inject deps.cache */
function defaultCache(): Pick<Cache, "match" | "put"> {
  return caches.default;
}
/* c8 ignore stop */

/** Count minted founding session records by paging LICENSE_KV list() over the
 *  `sess:` prefix. Counts key names only — never reads (or logs) values. */
export async function countFoundingKeys(kv: KVNamespace): Promise<number> {
  let count = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = await kv.list({
      prefix: SESSION_RECORD_PREFIX,
      ...(cursor ? { cursor } : {}),
    });
    count += page.keys.length;
    if (page.list_complete) return count;
    cursor = page.cursor;
  }
}

/** GET /api/stripe/founding-count → { sold, cap, remaining }. Cache-first so a
 *  burst of page loads shares one KV count per TTL window. */
export async function handleFoundingCount(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  deps: FoundingCountDeps = {},
): Promise<Response> {
  const cache = deps.cache ?? defaultCache();
  const cacheKey = new Request(new URL(request.url).toString(), { method: "GET" });

  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const sold = await countFoundingKeys(env.LICENSE_KV);
  const parsedCap = Number.parseInt(env.FOUNDING_CAP, 10);
  const cap = Number.isFinite(parsedCap) && parsedCap >= 0 ? parsedCap : 0;
  const remaining = Math.max(0, cap - sold);

  const response = json(
    { sold, cap, remaining },
    200,
    { "cache-control": `public, max-age=${FOUNDING_COUNT_CACHE_SECONDS}` },
  );
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
