// Sandbox e2e config loader (#121) — manual/local launch gate only, never a
// CI dependency (see sandbox.e2e.test.ts's file-level doc for the full design
// rationale).
//
// Reads sandbox config from `process.env` ONLY. This module never reads or
// imports `.env.local` directly — `scripts/e2e-sandbox.mjs` (invoked via
// `node --env-file=.env.local`) is what loads that file into the process
// environment before this module's exports are ever used. Never log any
// value read here.

/** Non-secret sandbox object ids from the epic's "Sandbox artifacts" table
 * (provisioned 2026-07-08), overridable via env for a different sandbox. */
const DEFAULT_MONTHLY_PRICE_ID = "price_1Tqxh0ASt3LJWmaOwO4v8ZEs";
const DEFAULT_ANNUAL_PRICE_ID = "price_1Tqxh0ASt3LJWmaOipY3Rfoe";
const DEFAULT_FOUNDING_PRICE_ID = "price_1Tqxh0ASt3LJWmaOvV7Lph0F";
const DEFAULT_FOUNDING_PAYMENT_LINK_ID = "plink_1TqxhKASt3LJWmaOMsHauxwd";
const DEFAULT_FOUNDING_CAP = 300;

/** The secret/config vars required for the suite to run at all. */
const REQUIRED_VARS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "WORKER_BASE_URL",
  "LICENSE_PUBLIC_KEY",
] as const;

export interface SandboxConfig {
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  resendApiKey: string;
  workerBaseUrl: string;
  licensePublicKeyPem: string;
  monthlyPriceId: string;
  annualPriceId: string;
  foundingPriceId: string;
  foundingPaymentLinkId: string;
  foundingCap: number;
  /** Checkout Session id for a subscription-mode purchase a human has already
   * completed (4242) in the sandbox. Optional — gates the scenarios that need
   * a real signed key (see file-level doc); unset scenarios log a SKIP. */
  seedSubscriptionSessionId?: string;
  /** Checkout Session id for a founding (payment-mode) purchase a human has
   * already completed (4242) in the sandbox. Optional, same reasoning. */
  seedFoundingSessionId?: string;
}

/** True only when every required secret/config var is present. Gates the
 * whole suite via `describe.skipIf` in sandbox.e2e.test.ts — no sandbox env,
 * no run, and CI (which sets none of these) always skips. */
export function hasSandboxEnv(): boolean {
  return REQUIRED_VARS.every((name) => Boolean(process.env[name]));
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`sandbox e2e: missing required env var ${name}`);
  }
  return value;
}

/** Read the sandbox config from `process.env`. Throws if a required var is
 * missing — callers must gate on {@link hasSandboxEnv} first (the suite does,
 * via `describe.skipIf`). */
export function loadSandboxConfig(): SandboxConfig {
  return {
    stripeSecretKey: requireEnv("STRIPE_SECRET_KEY"),
    stripeWebhookSecret: requireEnv("STRIPE_WEBHOOK_SECRET"),
    resendApiKey: requireEnv("RESEND_API_KEY"),
    workerBaseUrl: requireEnv("WORKER_BASE_URL"),
    licensePublicKeyPem: requireEnv("LICENSE_PUBLIC_KEY"),
    monthlyPriceId: process.env.SANDBOX_MONTHLY_PRICE_ID || DEFAULT_MONTHLY_PRICE_ID,
    annualPriceId: process.env.SANDBOX_ANNUAL_PRICE_ID || DEFAULT_ANNUAL_PRICE_ID,
    foundingPriceId: process.env.SANDBOX_FOUNDING_PRICE_ID || DEFAULT_FOUNDING_PRICE_ID,
    foundingPaymentLinkId:
      process.env.SANDBOX_FOUNDING_PAYMENT_LINK_ID || DEFAULT_FOUNDING_PAYMENT_LINK_ID,
    foundingCap: Number(process.env.FOUNDING_CAP) || DEFAULT_FOUNDING_CAP,
    seedSubscriptionSessionId: process.env.SANDBOX_SEED_SESSION_ID || undefined,
    seedFoundingSessionId: process.env.SANDBOX_SEED_FOUNDING_SESSION_ID || undefined,
  };
}
