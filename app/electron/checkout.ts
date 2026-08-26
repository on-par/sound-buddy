// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Upgrade-checkout deep links (#58, #56, #1164). The in-app "Start for $9/mo" /
// "Best value $79/yr" / Founding lifetime CTAs open a hosted Stripe Checkout /
// Payment Link in the user's browser — Sound Buddy never handles card data.
// Since #56 the resolved link also carries the customer's `prefilled_email`
// when one is known, so a lapsed subscriber re-upgrading from the momentum
// card lands in Stripe with their address already filled in. Each SKU's URL
// is resolved solely from its own env var, injected at build time by the
// live-provisioning runbook (worker/docs/live-provisioning.md) — there is no
// baked-in placeholder default, so a missing/misconfigured URL fails loudly
// (see checkoutUrl) instead of silently opening a broken link.
//
// Kept as a pure mapping (plan → URL) so it's unit-testable without launching a
// browser; main.ts wires it to shell.openExternal behind the 'open-checkout' IPC.

export type CheckoutPlan = 'monthly' | 'annual' | 'founding';

/** Stripe Payment Link pre-fill query parameter (Payment Links accept prefilled_email). */
const PREFILLED_EMAIL_PARAM = 'prefilled_email';

// Per-SKU env var naming the live Stripe Payment Link URL. Injected at build
// time (worker/docs/live-provisioning.md §8) — never baked into source.
const CHECKOUT_URL_ENV_VARS: Record<CheckoutPlan, string> = {
  monthly: 'SOUND_BUDDY_CHECKOUT_MONTHLY_URL',
  annual: 'SOUND_BUDDY_CHECKOUT_ANNUAL_URL',
  founding: 'SOUND_BUDDY_CHECKOUT_FOUNDING_URL',
};

/** Normalizes an unknown/undefined plan string to a known SKU, defaulting to monthly (the low-friction entry). */
function normalizePlan(plan: string | undefined): CheckoutPlan {
  if (plan === 'annual') return 'annual';
  if (plan === 'founding') return 'founding';
  return 'monthly';
}

/**
 * Resolve the checkout URL for a plan. Each SKU's URL comes solely from its
 * own env var (see CHECKOUT_URL_ENV_VARS) — when it is missing or
 * blank/whitespace, this throws an actionable Error naming the env var and
 * pointing at the provisioning runbook, rather than opening a broken or
 * placeholder link. When `email` is a non-blank string it is appended as
 * Stripe's `prefilled_email` query parameter (handled with `new URL`, so a
 * base that already carries a query gets a clean `&` append). A
 * blank/undefined email leaves the URL untouched.
 */
export function checkoutUrl(
  plan: string | undefined,
  email?: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const key = normalizePlan(plan);
  const envVar = CHECKOUT_URL_ENV_VARS[key];
  const configured = env[envVar];
  const base = typeof configured === 'string' ? configured.trim() : '';

  if (!base) {
    throw new Error(
      `Checkout is not configured for the ${key} plan. Set ${envVar} to the live Stripe Payment Link and rebuild (see worker/docs/live-provisioning.md §8).`
    );
  }

  const trimmed = typeof email === 'string' ? email.trim() : '';
  if (!trimmed) return base;

  const url = new URL(base);
  url.searchParams.set(PREFILLED_EMAIL_PARAM, trimmed);
  return url.toString();
}
