# Live-mode site builds fail closed without a real Founding Payment Link

- Status: Accepted
- Date: 2026-09-25

## Context

site/src/lib/founding-urgency.ts resolves the Founding $199 CTA from
PUBLIC_FOUNDING_CHECKOUT_URL and silently falls back to a placeholder
buy.stripe.com link when it is unset. That fallback is load-bearing for the
#602 live-parity golden and the #560 isCheckoutLive gate, but on a real
deploy it means the paid Founding CTA can go live pointing at a dead link
with nothing telling the operator. The desktop app already fails closed on
missing checkout URLs (ADR-0093); #1528 requires the same for the site's
deploy config without churning the parity guarantees.

## Decision

The site's `npm run build` runs a `prebuild` preflight
(scripts/check-founding-checkout.mjs → checkFoundingCheckoutConfig in
scripts/lib/founding-checkout-config.mjs). When PUBLIC_SITE_MODE resolves to
live, the build exits non-zero with an operator message unless
PUBLIC_FOUNDING_CHECKOUT_URL is an https URL on buy.stripe.com, without
credentials, and not the placeholder. Test-mode (/test_) links are accepted
so test-mode deploys and CI can build. Waitlist mode is never gated. The
placeholder fallback in foundingCheckoutUrl stays, reachable only from direct
`npx astro build` invocations (parity/site-mode checks) and waitlist builds.
Any future deploy-facing site build path must go through `npm run build` or
call the same preflight.

## Consequences

Positive: a live deploy can no longer silently ship a placeholder Founding
link; the live-parity golden and #560 gate are untouched; the check is a pure
function with colocated tests. Negative: the guard lives in an npm lifecycle
hook, so a build command that bypasses `npm run build` bypasses it; CI must
carry a synthetic test-mode link; the site accepts test-mode links, so
swapping to the live link remains a runbook checklist item rather than an
enforced check.

## References

- [Issue](https://github.com/on-par/sound-buddy/issues/1528)
- [ADR-0093 app checkout URLs are env-only and fail loudly](docs/adr/0093-app-checkout-urls-are-env-only-and-fail-loudly-no-baked-placeholder-fallback.md)
