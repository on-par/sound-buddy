// Pure preflight check shared by check-founding-checkout.mjs and its tests
// (#1528). No I/O, no process.exit — mirrors the lib/pricing-invariants.mjs
// and lib/site-mode-invariants.mjs seams.

import { PLACEHOLDER_FOUNDING_URL } from './live-parity.mjs';

export const FOUNDING_CHECKOUT_ENV_VAR = 'PUBLIC_FOUNDING_CHECKOUT_URL';

const STRIPE_PAYMENT_LINK_HOST = 'buy.stripe.com';
const RUNBOOK = 'worker/docs/live-provisioning.md §8';

function remediation(reason) {
  return (
    `${reason} Paste the Founding Stripe Payment Link (https://${STRIPE_PAYMENT_LINK_HOST}/…) into the site ` +
    `build env (Cloudflare Workers Builds → Variables) and redeploy — see ${RUNBOOK}.`
  );
}

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

  const value = env[FOUNDING_CHECKOUT_ENV_VAR]?.trim() ?? '';

  if (!value) {
    return [
      remediation(
        `${FOUNDING_CHECKOUT_ENV_VAR} is not set, but PUBLIC_SITE_MODE=live would publish the $199 Founding "Become a Founding Member" button.`,
      ),
    ];
  }

  if (value === PLACEHOLDER_FOUNDING_URL) {
    return [
      remediation(
        `${FOUNDING_CHECKOUT_ENV_VAR} is still the placeholder link ("${value}") and must be replaced by the real Founding Stripe Payment Link.`,
      ),
    ];
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    return [remediation(`${FOUNDING_CHECKOUT_ENV_VAR} ("${value}") is not a valid URL.`)];
  }

  if (url.protocol !== 'https:' || url.host !== STRIPE_PAYMENT_LINK_HOST || url.username || url.password) {
    return [
      remediation(
        `${FOUNDING_CHECKOUT_ENV_VAR} ("${value}") must be an https://${STRIPE_PAYMENT_LINK_HOST}/… Stripe Payment Link.`,
      ),
    ];
  }

  return [];
}
