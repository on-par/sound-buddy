// Pure preflight check shared by check-founding-checkout.mjs and its tests
// (#1528). No I/O, no process.exit — mirrors the lib/pricing-invariants.mjs
// and lib/site-mode-invariants.mjs seams.

import { PLACEHOLDER_FOUNDING_URL } from './live-parity.mjs';

export const FOUNDING_CHECKOUT_ENV_VAR = 'PUBLIC_FOUNDING_CHECKOUT_URL';

const STRIPE_PAYMENT_LINK_HOST = 'buy.stripe.com';
const RUNBOOK = 'worker/docs/live-provisioning.md §8';

/**
 * Preflight the live-mode Founding checkout config. Live-mode `npm run
 * build` refuses to ship a $199 "Become a Founding Member" CTA that points
 * at a dead link (#1528) — this mirrors the app's fail-closed packaging gate
 * (ADR-0093) for the site's deploy path.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string[]} human-readable problems (empty === OK)
 */
export function checkFoundingCheckoutConfig(env) {
  // Same fail-safe rule as site/src/lib/site-mode.ts resolveSiteMode — .mjs
  // scripts can't import the .ts lib, so this mirrors it by value.
  if (env.PUBLIC_SITE_MODE?.trim() !== 'live') return [];

  const problems = [];
  for (const [name, placeholder] of [
    [FOUNDING_CHECKOUT_ENV_VAR, PLACEHOLDER_FOUNDING_URL],
    ['PUBLIC_PRO_MONTHLY_CHECKOUT_URL', 'https://buy.stripe.com/sound-buddy-pro-monthly'],
    ['PUBLIC_PRO_ANNUAL_CHECKOUT_URL', 'https://buy.stripe.com/sound-buddy-pro-annual'],
  ]) {
    const value = env[name]?.trim() ?? '';
    let url;
    try { url = new URL(value); } catch {}
    if (!value || value === placeholder || !url || url.protocol !== 'https:' || url.host !== STRIPE_PAYMENT_LINK_HOST || url.username || url.password || url.pathname === '/') {
      problems.push(`${name} is missing, a placeholder, or invalid. Set ${name} to its real https://buy.stripe.com Payment Link in the site build environment; see ${RUNBOOK}.`);
    }
  }
  return problems;
}
