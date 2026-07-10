// Stripe / licensing API Worker (#107) — routing & config scaffold.
//
// This is the foundation the Stripe launch epic (#123) builds on: health check,
// webhook (#108), and the license fetch + activation page (#112) are wired up
// here.
//
// SECURITY (normative — 2026-07-08 keypair review): never log private key
// material, signed `SB1.` license strings, webhook payload bodies, or KV values.
// `wrangler tail` / Logpush capture logs. Log event ids/types and outcomes only.

import { json } from "./http";
import { handleStripeWebhook } from "./webhook";
import { handleGetLicense } from "./handlers/license";
import { handleRefreshLicense } from "./handlers/license-refresh";
import { handleActivate } from "./handlers/activate";

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
  /**
   * Stripe REST API key `sk_…` / `rk_…` (secret; H4, `wrangler secret put`).
   * Used by the `invoice.paid` handler (#110) to expand the customer /
   * subscription when the webhook payload lacks an email or period end. Never
   * logged.
   */
  STRIPE_SECRET_KEY: string;
  /**
   * Ed25519 license signing key, pkcs8 PEM (secret; H3/H4, `wrangler secret
   * put`). Imported non-extractable via `importSigningKey` (#109); the PEM must
   * not be referenced after import and is never logged.
   */
  LICENSE_SIGNING_PRIVATE_KEY: string;
  /**
   * Signing-key id stamped into every minted key's `kid` claim (#109). Purely
   * informational — the app verifies against its embedded public key and never
   * gates on `kid` — but stable so keys can be traced to a signing key and a
   * future rotation stays auditable. Non-secret; set in wrangler `vars`.
   */
  LICENSE_SIGNING_KID: string;
  /**
   * Ed25519 license verify key, spki PEM (#113) — the same public key embedded
   * in the app. Public keys are not secret; set in wrangler `vars`, not via
   * `wrangler secret put`. Used by `/api/license/refresh` to verify a
   * presented key's signature before any KV/Stripe lookup.
   */
  LICENSE_PUBLIC_KEY: string;
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

// Exact-path routes. Kept as a flat table so later stories append their own
// handlers without touching the dispatcher below.
const routes: Route[] = [
  { method: "GET", path: "/api/stripe/health", handler: health },
  { method: "POST", path: "/api/stripe/webhook", handler: handleStripeWebhook },
  { method: "GET", path: "/api/license", handler: handleGetLicense },
  { method: "POST", path: "/api/license/refresh", handler: handleRefreshLicense },
  { method: "GET", path: "/activate", handler: handleActivate },
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
