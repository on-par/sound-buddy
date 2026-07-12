// Worker + Stripe test helpers for the sandbox e2e suite (#121).
//
// SECURITY (normative — mirrors the Worker's own logging rule, see
// src/index.ts / src/license-sign.ts): never log a minted `SB1.` string, key
// material, email addresses, `.env.local` values, or raw webhook payload
// bodies. Log outcomes (status codes, ids, pass/fail) only.

import Stripe from "stripe";
import {
  importVerifyKey,
  verifyLicenseKey,
  verifySignedPayload,
  type LicensePayload,
  type VerifyResult,
} from "../license-sign";
import type { SandboxConfig } from "./env";

/** Build the Stripe test client the same way the Worker does (see
 * `defaultStripe` in src/handlers/invoice-paid.ts / license.ts). */
export function buildSandboxStripeClient(config: SandboxConfig): Stripe {
  return new Stripe(config.stripeSecretKey, {
    httpClient: Stripe.createFetchHttpClient(),
  });
}

/** Safety rail: throws if `obj.livemode` is true. Call this on the first
 * Stripe object created or read in every scenario — this harness must never
 * observe, let alone act on, a live-mode object. */
export function assertTestMode(obj: { livemode?: boolean | null }): void {
  if (obj.livemode) {
    throw new Error(
      "sandbox e2e: SAFETY ABORT — a LIVEMODE Stripe object was observed. Refusing to continue.",
    );
  }
}

export interface WorkerClient {
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
  getLicense: (sessionId: string) => Promise<Response>;
  refresh: (key: string) => Promise<Response>;
  postWebhook: (body: string, signature: string) => Promise<Response>;
  health: () => Promise<Response>;
}

/** Build a small fetch wrapper scoped to `WORKER_BASE_URL`. */
export function makeWorkerClient(config: SandboxConfig): WorkerClient {
  const fetchPath = (path: string, init?: RequestInit): Promise<Response> =>
    fetch(new URL(path, config.workerBaseUrl), init);

  return {
    fetch: fetchPath,
    getLicense: (sessionId) =>
      fetchPath(`/api/license?session_id=${encodeURIComponent(sessionId)}`),
    refresh: (key) =>
      fetchPath("/api/license/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      }),
    postWebhook: (body, signature) =>
      fetchPath("/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": signature },
        body,
      }),
    health: () => fetchPath("/api/stripe/health"),
  };
}

/** Verify a returned `SB1.` key against the sandbox's public key and resolve
 * its tier/status as of `now` — a thin wrapper over `verifyLicenseKey` so
 * scenarios don't each re-import the signing module. */
export async function verifyKey(
  config: SandboxConfig,
  key: string,
  now?: Date,
): Promise<VerifyResult> {
  const publicKey = await importVerifyKey(config.licensePublicKeyPem);
  return verifyLicenseKey(key, publicKey, now);
}

/** Verify a returned `SB1.` key and return its full decoded payload (incl.
 * `sub`/`kid`/`jti`) — used where a scenario needs the Stripe subscription id
 * baked into the key, which {@link verifyKey}'s VerifyResult omits. */
export async function verifyKeyPayload(
  config: SandboxConfig,
  key: string,
): Promise<LicensePayload | null> {
  const publicKey = await importVerifyKey(config.licensePublicKeyPem);
  return verifySignedPayload(key, publicKey);
}

/** Build a signed Stripe webhook envelope around `dataObject`, exactly the
 * shape `handleStripeWebhook` verifies (see worker/test/invoice-paid.test.ts
 * for the same pattern). This is the deterministic delivery path used
 * throughout this suite — see the file-level design note in
 * sandbox.e2e.test.ts for why the suite prefers constructed-signed-webhooks
 * over depending on a registered Stripe webhook endpoint. */
export function signedWebhook(
  stripe: Stripe,
  config: SandboxConfig,
  eventId: string,
  eventType: string,
  dataObject: unknown,
): { body: string; signature: string } {
  const body = JSON.stringify({
    id: eventId,
    object: "event",
    type: eventType,
    data: { object: dataObject },
    created: Math.floor(Date.now() / 1000),
    livemode: false,
  });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: config.stripeWebhookSecret,
  });
  return { body, signature };
}

export interface PollOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

/** Poll `fn` until it resolves truthy or `timeoutMs` elapses, then return that
 * value — used for "within ~1 minute" / eventual-consistency assertions
 * (webhook mint racing GET /api/license, Resend delivery, test-clock
 * advancement). Throws on timeout. */
export async function pollUntil<T>(
  fn: () => Promise<T | undefined | null | false>,
  { timeoutMs = 60_000, intervalMs = 2_000 }: PollOptions = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await fn();
    if (result) return result;
    if (Date.now() >= deadline) {
      throw new Error(`pollUntil: timed out after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export interface FoundLicenseEmail {
  subject: string;
  /** The `SB1.` key parsed out of the email body, when found. */
  key?: string;
}

/** Look up the most recent license email sent to `to` via the Resend API and
 * try to pull the `SB1.` key out of its body.
 *
 * Per MEMORY, Resend send-only test keys 401 on list/read endpoints — that is
 * expected, not an error condition, so a 401/403 degrades gracefully to a
 * logged SKIP (`null`) rather than failing the scenario. Callers must treat
 * `null` as "unverifiable via email, not proof of non-delivery" and fall back
 * to `GET /api/license` as the authoritative delivery assertion (per spec).
 * Never logs `to` or any email content. */
export async function findLicenseEmail(
  config: SandboxConfig,
  to: string,
): Promise<FoundLicenseEmail | null> {
  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails?limit=20", {
      headers: { Authorization: `Bearer ${config.resendApiKey}` },
    });
  } catch {
    console.log("sandbox e2e: Resend list-emails request failed — SKIP email-content check");
    return null;
  }

  if (res.status === 401 || res.status === 403) {
    console.log(
      "sandbox e2e: Resend API key cannot list emails (send-only key, expected per MEMORY) — SKIP email-content check, relying on GET /api/license as the delivery proof",
    );
    return null;
  }
  if (!res.ok) {
    console.log(`sandbox e2e: Resend list emails failed (${res.status}) — SKIP email-content check`);
    return null;
  }

  const data = (await res.json()) as {
    data?: Array<{ to?: string[]; subject?: string; text?: string; html?: string }>;
  };
  const match = data.data?.find((email) => email.to?.includes(to));
  if (!match) return null;

  const body = match.text ?? match.html ?? "";
  const keyMatch = /SB1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.exec(body);
  return { subject: match.subject ?? "", key: keyMatch?.[0] };
}
