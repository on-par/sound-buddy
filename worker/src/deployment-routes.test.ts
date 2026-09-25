import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { matchRoutes, parseRoutes } from "miniflare";
import { unstable_readConfig } from "wrangler";
import { expect, it } from "vitest";

// Use Cloudflare's own URL matcher: handler tests alone cannot detect a
// deployment route that sends Stripe's query-bearing redirect to the website.
const config = unstable_readConfig({
  config: join(dirname(fileURLToPath(import.meta.url)), "../wrangler.jsonc"),
});
const routes = parseRoutes(new Map([["licensing", (config.routes ?? []).map(
  (route: string | { pattern: string }) => typeof route === "string" ? route : route.pattern,
)]]));

it.each(["/activate", "/api/license"])(
  "routes Stripe's %s URL, including its checkout session, to licensing",
  (path) => {
    expect(matchRoutes(routes, new URL(
      `https://soundbuddy.online${path}?session_id=cs_live_example`,
    ))).toBe("licensing");
  },
);

// Free browser auth gate (#1525): the exact-match /api/waitlist pattern
// wouldn't cover these sub-paths, so this guards the wildcard route.
it.each(["/api/auth/start", "/api/auth/verify", "/api/auth/session"])(
  "routes %s to licensing",
  (path) => {
    expect(matchRoutes(routes, new URL(`https://soundbuddy.online${path}`))).toBe("licensing");
  },
);
