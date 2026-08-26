# App checkout URLs are env-only and fail loudly; no baked placeholder fallback

- Status: Accepted
- Date: 2026-08-26

## Context

app/electron/checkout.ts previously carried a DEFAULT_URLS placeholder map
and deliberately never threw — an unknown or unconfigured plan fell back to
the monthly placeholder link so a mis-wired CTA "still lands the user
somewhere." That silent fallback is wrong for launch: worker/docs/live-
provisioning.md §8 requires the real live-mode Payment Links to be injected
via build env (SOUND_BUDDY_CHECKOUT_*_URL) and forbids baking them into
checkout.ts, and issue #1164 requires a missing URL configuration to fail
loudly rather than open a broken/blank link. The app also needs a third SKU
(founding lifetime) alongside monthly/annual.

## Decision

checkoutUrl resolves each of the three SKUs (monthly, annual, founding)
solely from its own env var — SOUND_BUDDY_CHECKOUT_MONTHLY_URL,
_ANNUAL_URL, _FOUNDING_URL — with no baked placeholder default. An
unknown/undefined plan normalizes to monthly. When the selected SKU's env
var is missing or blank, checkoutUrl throws an actionable Error naming the
missing env var and the provisioning runbook. The single caller (the
open-checkout IPC handler in main.ts) catches that throw, logs it, and
surfaces it via dialog.showErrorBox instead of opening a link. Baking real
Payment Link URLs into checkout.ts remains forbidden.

## Consequences

Positive: misconfiguration surfaces immediately and visibly at launch
instead of dead-ending users on a dead placeholder link; the source tree
never carries live URLs; adding a SKU is a one-line env-var-map entry.
Negative: a build that forgets to wire the env vars has non-functional
upgrade CTAs (mitigated by the loud dialog and the release runbook
checklist); local dev must set the env vars to exercise the CTA path.

## References

- [worker/docs/live-provisioning.md §8 (build-env wiring)](worker/docs/live-provisioning.md)
- [Issue](https://github.com/on-par/sound-buddy/issues/1164)
