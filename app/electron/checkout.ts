// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Upgrade-checkout deep links (#58, #56). The in-app "Start for $9/mo" / "Best
// value $79/yr" CTAs open a hosted Stripe Checkout / Payment Link in the user's
// browser — Sound Buddy never handles card data. The real Price/Payment-Link
// URLs are provisioned in #56 (Stripe account + webhook → license email); until
// that lands, these are placeholder links, overridable per-environment so the
// wiring is testable and the URLs never get baked into the renderer.
//
// Kept as a pure mapping (plan → URL) so it's unit-testable without launching a
// browser; main.ts wires it to shell.openExternal behind the 'open-checkout' IPC.

export type CheckoutPlan = 'monthly' | 'annual';

// Placeholder Payment Links until #56 provisions the real Stripe Prices. Env
// overrides let a build point at staging/live links without a code change.
const DEFAULT_URLS: Record<CheckoutPlan, string> = {
  monthly: 'https://buy.stripe.com/sound-buddy-pro-monthly',
  annual: 'https://buy.stripe.com/sound-buddy-pro-annual',
};

/**
 * Resolve the checkout URL for a plan. Unknown/missing plans fall back to the
 * monthly link (the low-friction entry) rather than throwing — a mis-wired CTA
 * should still land the user somewhere they can subscribe, never dead-end.
 */
export function checkoutUrl(
  plan: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): string {
  const key: CheckoutPlan = plan === 'annual' ? 'annual' : 'monthly';
  const override =
    key === 'annual' ? env.SOUND_BUDDY_CHECKOUT_ANNUAL_URL : env.SOUND_BUDDY_CHECKOUT_MONTHLY_URL;
  return (override && override.trim()) || DEFAULT_URLS[key];
}
