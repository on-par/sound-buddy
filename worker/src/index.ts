// Stripe / licensing API Worker (#107) — routing & config scaffold.
//
// This is the foundation the Stripe launch epic (#123) builds on. Only the
// health check is implemented; the webhook, license and activation routes are
// declared here so later stories have a home, and currently answer 501.
//
// SECURITY (normative — 2026-07-08 keypair review): never log private key
// material, signed `SB1.` license strings, webhook payload bodies, or KV values.
// `wrangler tail` / Logpush capture logs. Log event ids/types and outcomes only.

import { json } from "./http";
import { handleStripeWebhook } from "./webhook";

/**
 * Environment bindings declared in wrangler.jsonc. Secret values
 * (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, LICENSE_SIGNING_PRIVATE_KEY,
 * RESEND_API_KEY) are injected out-of-band via `wrangler secret put` and are
 * added to this interface by the stories that consume them.
 */
export interface Env {
  /** KV namespace holding issued licenses / activation state. */
  LICENSE_KV: KVNamespace;
  /** Founding-license count cap (string; parse where used). */
  FOUNDING_CAP: string;
  /** Transactional email sender address. */
  FROM_EMAIL: string;
  /** Desktop app activation origin. */
  APP_ORIGIN: string;
  /** Stripe webhook signing secret `whsec_…` (secret; `wrangler secret put`). */
  STRIPE_WEBHOOK_SECRET: string;
}

type RouteHandler = (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
) => Response | Promise<Response>;

interface Route {
  method: string;
  path: string;
  handler: RouteHandler;
}

/** Liveness probe — no bindings, no secrets, always 200. */
const health: RouteHandler = () => json({ status: "ok", service: "sound-buddy-api" });

/**
 * Placeholder for routes whose behaviour is delivered by later stories. Kept as
 * a distinct 501 (rather than 404) so the route surface is discoverable and
 * integration tests can tell "not wired yet" apart from "no such route".
 */
const notImplemented: RouteHandler = () =>
  json({ error: "not_implemented" }, 501);

// Exact-path routes. Kept as a flat table so later stories append their own
// handlers without touching the dispatcher below.
const routes: Route[] = [
  { method: "GET", path: "/api/stripe/health", handler: health },
  { method: "POST", path: "/api/stripe/webhook", handler: handleStripeWebhook },
  { method: "GET", path: "/api/license", handler: notImplemented },
  { method: "GET", path: "/activate", handler: notImplemented },
];

export async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const { pathname } = new URL(request.url);

  const byPath = routes.filter((route) => route.path === pathname);
  if (byPath.length === 0) {
    return json({ error: "not_found" }, 404);
  }

  const route = byPath.find((r) => r.method === request.method);
  if (!route) {
    const allow = byPath.map((r) => r.method).join(", ");
    return json({ error: "method_not_allowed" }, 405, { allow });
  }

  return route.handler(request, env, ctx);
}

export default {
  fetch: handleRequest,
} satisfies ExportedHandler<Env>;
