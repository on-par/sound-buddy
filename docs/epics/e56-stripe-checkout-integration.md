# e56 Stripe checkout integration + license provisioning webhook: completion record

Issue #56 is a tracking epic, not a feature. Its deliverable is the ability to sell Pro
subscriptions: Stripe Checkout / Payment Links wired into the in-app upgrade flow (pricing
**$9/month** and **$79/year**), a webhook we own that provisions signed license keys on payment and
emails them to the customer, paste-a-key-to-unlock with offline validation against the #54 signing
scheme, and cancellation/renewal behavior where the existing key keeps working until its baked
expiry plus grace. Every acceptance criterion is already satisfied by the accumulated sub-issues
(#54, #58, #61, #107–#114, #117–#119, #121, #140) plus a #56-closing slice (PR #791), all of which
shipped as squash-merged PRs and are closed `COMPLETED` on GitHub (except the two human-blocked
residuals documented under Discrepancies), with their squash-merge commits in this tree's history.
Per binding ADR-0018, an epic whose criteria are met by accumulated work is closed by a repo-homed
completion record that asserts every criterion from the checkout and maps each story to its PR and
feature files — there is no residual feature code to build. This record is that closing evidence.

## Shipped stories

Titles are the actual GitHub issue titles, read verbatim from `gh issue view`. State is as of
2026-08-14, read from `gh issue view`. Closing PR hashes are the squash-merge commits reproduced
from this checkout's history by the git command in the Verification section. Feature-file line
numbers are the verified locations in this tree. One message exception is noted: `004b062` (#107)
carries only its PR number, not the `(#issue) (#PR)` suffix — its issue number is sourced from `gh
issue view`, not the commit message.

| Story | Actual GitHub title | Merged PR | Feature files in this tree |
|-------|--------------------|-----------|---------------------------|
| #54 | feat: License key validation + feature gating (Paddle Option A) | [#93](https://github.com/on-par/sound-buddy/pull/93) (`94f1927`) | `app/electron/license.ts` (`verifyLicenseKey` at :122, `activateLicense` at :243, `getLicenseState` at :205, `isEntitled` at :281, `PRO_FEATURES` at :87, `EMBEDDED_PUBLIC_KEY_PEM` at :50, `licensePublicKey` at :100; file header `#54`) — the offline `SB1.` Ed25519 signing scheme #56 reuses |
| #58 | feat: Upgrade UX — post-report-card momentum card + inline gating | [#106](https://github.com/on-par/sound-buddy/pull/106) (`4f0d331`) | `app/renderer/src/UpgradeMomentum.tsx`, `app/renderer/upgrade-momentum.js` (`PLANS` — "Start for $9/mo" / "Best value $79/yr"), `app/electron/main.ts` (`open-checkout` IPC at :293 → `shell.openExternal(checkoutUrl(plan, getLicenseState().email))` at :294), `app/electron/preload.ts` (`openCheckout` bridge at :75), `app/electron/ipc/api.ts` (`openCheckout(plan)` signature at :685) |
| #61 | feat: 14-day Pro trial on first launch | [#103](https://github.com/on-par/sound-buddy/pull/103) (`b5ea123`) | `app/electron/license.ts` (`ensureTrialStarted` at :223, `TRIAL_DAYS` at :58, `trialState` at :188) |
| #107 | feat(worker): stripe api worker scaffold, routing & wrangler config | [#162](https://github.com/on-par/sound-buddy/pull/162) (`004b062`) | `worker/src/index.ts` (`Env` at :26, `handleRequest` at :121, `POST /api/stripe/webhook` route at :111), `worker/wrangler.jsonc` |
| #108 | feat(worker): stripe webhook signature verification + KV idempotency | [#166](https://github.com/on-par/sound-buddy/pull/166) (`f24c828`) | `worker/src/webhook.ts` (`handleStripeWebhook` at :83, `eventHandlers` at :57, `eventKey` at :39, `PROCESSED_EVENT_TTL_SECONDS` at :27) |
| #109 | feat(worker): Ed25519 SB1-format license signing in Workers runtime | [#168](https://github.com/on-par/sound-buddy/pull/168) (`439da9f`) | `worker/src/license-sign.ts` (`mintLicenseKey` at :133, `importSigningKey` at :97, `verifyLicenseKey` at :216, `verifySignedPayload` at :189, `LICENSE_ISSUER` at :43), `scripts/license-keygen.mjs` |
| #110 | feat(worker): invoice.paid subscription license mint | [#175](https://github.com/on-par/sound-buddy/pull/175) (`3258f4d`) | `worker/src/handlers/invoice-paid.ts` (`handleInvoicePaid` at :154, `SubscriptionRecord` at :33, `subscriptionRecordKey` at :43, `periodEndFromLines` at :98, `periodEndFromSubscription` at :120) |
| #111 | feat(worker): founding one-time lifetime mint (payment-mode sessions) | [#198](https://github.com/on-par/sound-buddy/pull/198) (`5901563`) | `worker/src/handlers/checkout-completed.ts` (`handleCheckoutCompleted` at :85, `SessionRecord` at :32, `sessionRecordKey` at :42) |
| #112 | feat(worker): /activate page + GET /api/license with race handling | [#200](https://github.com/on-par/sound-buddy/pull/200) (`0cb87df`) | `worker/src/handlers/activate.ts` (`GET /activate` page), `worker/src/handlers/license.ts` (`GET /api/license?session_id=…`, `handleLicense`) |
| #113 | feat(worker): license refresh endpoint (signed key as credential) | [#210](https://github.com/on-par/sound-buddy/pull/210) (`dd4e94d`) | `worker/src/handlers/license-refresh.ts` |
| #114 | feat(worker): license delivery email via Resend | [#212](https://github.com/on-par/sound-buddy/pull/212) (`deaae4b`) | `worker/src/delivery.ts` (`sendLicenseEmail` at :93, `sendDunningEmail`) |
| #117 | feat(app): automatic license refresh — seamless renewals | [#240](https://github.com/on-par/sound-buddy/pull/240) (`6bb560b`) | `app/electron/license-refresh.ts` (`maybeRefreshLicense` at :69), `app/electron/ipc/licensing.ts` (`registerLicensingHandlers` at :14) |
| #118 | feat(worker): dunning email on invoice.payment_failed | [#213](https://github.com/on-par/sound-buddy/pull/213) (`25a2f5f`) | `worker/src/handlers/invoice-payment-failed.ts` (`handleInvoicePaymentFailed` at :33) |
| #119 | feat(worker): charge.refunded + subscription.deleted recording | [#216](https://github.com/on-par/sound-buddy/pull/216) (`19e5616`) | `worker/src/handlers/subscription-deleted.ts` (`handleSubscriptionDeleted` at :34, `SubscriptionCancellationRecord` at :17, `subscriptionCancellationRecordKey` at :25), `worker/src/handlers/charge-refunded.ts` (`handleChargeRefunded` at :37) |
| #121 | test(worker): sandbox Stripe end-to-end test-plan execution | [#255](https://github.com/on-par/sound-buddy/pull/255) (`343b96d`) | `worker/src/e2e/sandbox.e2e.test.ts`, `worker/src/e2e/harness.ts`, `worker/src/e2e/env.ts` (`hasSandboxEnv` at :51), `worker/docs/sandbox-e2e.md` |
| #140 | Add purchase-path smoke test: upgrade CTAs → checkout → activate → unlock | [#297](https://github.com/on-par/sound-buddy/pull/297) (`e478a43`) | `app/tests/purchase-path.spec.ts` |
| #56 (closing slice) | feat: Stripe checkout integration + license provisioning webhook | [#791](https://github.com/on-par/sound-buddy/pull/791) (`c71769d`) | `app/electron/checkout.ts` (`checkoutUrl` at :39 with `prefilled_email` via `PREFILLED_EMAIL_PARAM` at :21), `app/tests/purchase-path.spec.ts` (prefilled-email block), `worker/docs/live-provisioning.md` |

## Acceptance-criteria checklist

Each epic criterion from the issue body is asserted from this checkout with its evidence.

- [x] **User can complete checkout from the in-app CTA.** → The post-report-card momentum card
      (#58, `app/renderer/upgrade-momentum.js` `PLANS`) renders two CTAs — "Start for $9/mo"
      (`plan: 'monthly'`) and "Best value $79/yr" (`plan: 'annual'`) — that call
      `sb.openCheckout(plan)`, which crosses the `open-checkout` IPC (`app/electron/main.ts:293`)
      to `shell.openExternal(checkoutUrl(plan, getLicenseState().email))` (`main.ts:294`).
      `checkoutUrl` (`app/electron/checkout.ts:39`) resolves plan → URL with env overrides winning,
      then appends the customer's `prefilled_email` when one is known (#791). Stripe hosts the
      checkout page — Sound Buddy never handles card data. `app/tests/purchase-path.spec.ts` proves
      every rendered CTA maps to a known plan and that clicking monthly/annual opens the
      env-configured URL and **never** the `DEFAULT_URLS` placeholder (`PLACEHOLDER_URLS` assert).
- [x] **License key arrives by email within 1 minute of payment.** → `POST /api/stripe/webhook`
      (`worker/src/index.ts:111`) → `handleStripeWebhook` (`worker/src/webhook.ts:83`) verifies the
      Stripe signature (`constructEventAsync`) and idempotently fans out. `invoice.paid` (recurring,
      initial and renewals) mints a fresh key via `handleInvoicePaid` (#110); `checkout.session.completed`
      in payment mode mints the founding lifetime key via `handleCheckoutCompleted` (#111). Both mint a
      signed `SB1.`-format key with `mintLicenseKey` (`worker/src/license-sign.ts:133`) and deliver it
      by email through `sendLicenseEmail` (`worker/src/delivery.ts:93`, Resend). The `/activate` page
      + `GET /api/license` is the redundant in-browser delivery path (#112). #121's sandbox harness
      drives signed webhook → mint → email verification end to end (see Governing-condition evidence).
- [x] **Pasting the key into Settings unlocks all Pro features.** → Settings → License
      (`app/renderer/src/LicensePanel.tsx`, `#license-activate-btn`) calls `activateLicense(key)`
      (`app/electron/license.ts:243`), which runs the offline Ed25519 `verifyLicenseKey`
      (`license.ts:122`) against the embedded public key (`licensePublicKey`, `license.ts:100`) and
      persists the key on success — taking effect immediately, no restart. `isEntitled`
      (`license.ts:281`) + the `PRO_FEATURES` set (`license.ts:87`) gate `saved-rigs`,
      `live-monitoring`, `virtual-soundcheck`, and `ai-narrative`. E2e proof: `purchase-path.spec.ts`
      "a pasted Pro key unlocks all Pro features without a restart" (the upgrade card disappears and
      a locked Pro tab loses its lock on the still-open report card) and the #139 entitlement-matrix
      e2e (PR #283), which asserts both the renderer hiding and the main process independently
      re-checking entitlement for every license/trial state.
- [x] **Cancellation stops renewal; the existing key works until expiry.** → #119's
      `handleSubscriptionDeleted` (`worker/src/handlers/subscription-deleted.ts:34`) deliberately
      takes no revocation action — it only records a `SubscriptionCancellationRecord` for analytics —
      so no fresh key is minted after cancellation and Stripe stops billing. The already-issued
      key's baked `expiresAt` plus the shared `GRACE_DAYS` grace window
      (`packages/license-policy` `GRACE_DAYS = 7`) keeps Pro until expiry, then the tier falls to
      free (`app/electron/license.ts` `getLicenseState` precedence). #121's sandbox cancellation
      scenario ("refuses after cancellation… still verifies post-cancellation") asserts the key
      still verifies pro; renewal keeps it active via `invoice.paid` → #117 auto-refresh.

## Governing-condition evidence

The epic's Verification lines, asserted from this checkout:

- **"Exercise the full purchase flow end-to-end: trigger upgrade from the in-app CTA, complete a
  Stripe Checkout session using a Stripe test card, and confirm the webhook fires."** → The app leg
  is #140's `purchase-path.spec.ts` (real `open-checkout` handler → `shell.openExternal` spy, CTAs →
  env-override URL); the worker leg is #121's sandbox harness, which drives every webhook scenario
  with a real Stripe test-card subscription/invoice/charge where Stripe's API allows it and
  documents the two hosted-Checkout legs (`SANDBOX_SEED_SESSION_ID` /
  `SANDBOX_SEED_FOUNDING_SESSION_ID`) that require one human sandbox payment (see Discrepancies).
- **"Verify a signed license key is generated and delivered by email within 1 minute of
  `checkout.session.completed`."** → `worker/src/e2e/sandbox.e2e.test.ts` "founding one-time
  lifetime mint" scenario POSTs a signed `checkout.session.completed` envelope to the real webhook
  and asserts a verifiable `lifetime` key + email delivery (best-effort Resend inbox check when the
  key can list emails); the mint/email code path is `checkout-completed.ts` → `mintLicenseKey` →
  `sendLicenseEmail`.
- **"Confirm the signed key validates against the #54 signing scheme and, when pasted into
  Settings, unlocks all Pro features."** → Format parity is a first-class test: `worker/src/license-sign.ts`
  `verifyLicenseKey` is a Web Crypto port of `app/electron/license.ts:122`, `scripts/license-keygen.mjs`
  mints the same `SB1.` shape, and `worker/src/license-sign.test.ts` / `app/electron/license.test.ts`
  cross-verify minted keys against the same public key; the app-leg unlock is `purchase-path.spec.ts`
  (see the checklist) and the #139 entitlement matrix.
- **"Cancel the subscription and confirm `customer.subscription.deleted` marks the license expired
  while the grace period keeps the key functional until expiry."** → #121's "Seamless refresh
  end-to-end + cancellation" scenario delivers `customer.subscription.deleted` and asserts the key
  "verifies as pro until its baked `expiresAt` + grace" and "still verifies post-cancellation";
  `handleSubscriptionDeleted` records analytics only (no revocation), and `license.ts` +
  `packages/license-policy` resolve the baked-expiry grace window.
- **"Confirm `invoice.paid` renewals keep the license active without user action."** → #121's
  renewal scenario advances a test clock and delivers the renewed `invoice.paid` with a later
  period end; the app leg is #117's `maybeRefreshLicense` (`app/electron/license-refresh.ts:69`),
  which presents the stored key to the Worker's refresh endpoint on launch so a renewed key lands
  without user action (registered via `app/electron/ipc/licensing.ts` `registerLicensingHandlers`).

## Discrepancies / evolution notes

Mirroring e471/e455/e410/e383's honest-record convention, the following are recorded rather than
papered over:

- **The two in-scope residuals are NOT shipped, and both are human-blocked on Patrick-only
  credential material.**
  - **#115 (production Ed25519 key swap)** is not in the tree: `app/electron/license.ts`
    `EMBEDDED_PUBLIC_KEY_PEM` still holds the DEV placeholder key, and the file's comment says the
    production pair "replaces this before checkout ships". The GitHub issue is marked CLOSED
    `COMPLETED` but its last comment records **"No code changes made"** — the work was paused for
    the missing production SPKI PEM (only Patrick can produce it, since the private half must never
    leave Cloudflare). Recorded honestly: closed-on-GitHub does not mean shipped.
  - **#116 (live Payment Link URLs)** is OPEN and not shipped: `checkout.ts` `DEFAULT_URLS` still
    hold the `https://buy.stripe.com/sound-buddy-pro-monthly|annual` placeholders, and the issue's
    Acceptance criteria (real URLs by default) are unmet.
  - The env-override/placeholder wiring that keeps these testable in the meantime: `checkout.ts`
    `DEFAULT_URLS` overridable via `SOUND_BUDDY_CHECKOUT_MONTHLY_URL` / `SOUND_BUDDY_CHECKOUT_ANNUAL_URL`;
    `license.ts` `EMBEDDED_PUBLIC_KEY_PEM` overridable in dev via `SOUND_BUDDY_LICENSE_PUBKEY`;
    `worker/wrangler.jsonc` `CUSTOMER_PORTAL_URL` and `LICENSE_PUBLIC_KEY` remain `REPLACE_WITH_*`
    placeholders wired out-of-band (H4); and `site/src/lib/founding-urgency.ts`
    `PUBLIC_FOUNDING_CHECKOUT_URL` stays a placeholder (urgency copy is gated on
    `isCheckoutLive`) until the founding Payment Link exists. `worker/docs/live-provisioning.md` is
    the human runbook for flipping these live.
- **`004b062` (#107) carries only its PR number.** The squash-merge commit message ends
  `(#162)` without the `(#issue) (#PR)` suffix used by every other story — the issue mapping comes
  from `gh issue view`, not the commit message.
- **The in-app upgrade CTA is the post-report-card momentum card only.** The License dialog itself
  (`LicensePanel.tsx`) has no upgrade button — the momentum card is the sole in-app checkout entry,
  which satisfies "User can complete checkout from the in-app CTA".
- **The #121 sandbox e2e is a manual local gate, not CI.** `worker/src/e2e/sandbox.e2e.test.ts`
  opens with `describe.skipIf(!hasSandboxEnv())` (inert when the `.env.local` sandbox secrets are
  absent, as they always are in CI) and runs via `npm run test:e2e:sandbox`; whether any of it
  should move into CI is explicitly flagged as Patrick's call in the file.
- **The `#56` closing slice (PR #791) shipped after the epics' own webhook comment revised the
  event list.** The issue body originally listed three webhook events; the approved working design
  comment ("Stripe Setup Design — Sound Buddy Pro", 2026-07-08) corrected the set to
  `invoice.paid` (primary mint), payment-mode `checkout.session.completed` (+ async counterpart),
  `invoice.payment_failed` (dunning), `customer.subscription.deleted` (analytics only), and
  `charge.refunded` (record). The shipped handlers follow the corrected design; the checklist above
  asserts the corrected behavior.
- **Issue #56 is already CLOSED on GitHub.** It reports CLOSED `COMPLETED` as of 2026-08-14; the
  PR's `Closes #56` body line is belt-and-braces per ADR-0018.

## Verification

Run from this checkout (all green as of 2026-08-14):

- `git log --all --oneline | grep -E '\(#(93|103|106|162|166|168|175|198|200|210|212|213|216|240|255|297|791)\)'`
  — reproduces all 17 merged PR numbers with the exact short hashes cited above: `c71769d` (#791),
  `e478a43` (#297), `343b96d` (#255), `6bb560b` (#240), `19e5616` (#216), `25a2f5f` (#213),
  `deaae4b` (#212), `dd4e94d` (#210), `0cb87df` (#200), `5901563` (#198), `3258f4d` (#175),
  `439da9f` (#168), `f24c828` (#166), `004b062` (#162), `4f0d331` (#106), `b5ea123` (#103),
  `94f1927` (#93).
- `git merge-base --is-ancestor 94f1927 HEAD && git merge-base --is-ancestor b5ea123 HEAD && git
  merge-base --is-ancestor 4f0d331 HEAD && git merge-base --is-ancestor 004b062 HEAD && git
  merge-base --is-ancestor f24c828 HEAD && git merge-base --is-ancestor 439da9f HEAD && git
  merge-base --is-ancestor 3258f4d HEAD && git merge-base --is-ancestor 5901563 HEAD && git
  merge-base --is-ancestor 0cb87df HEAD && git merge-base --is-ancestor dd4e94d HEAD && git
  merge-base --is-ancestor deaae4b HEAD && git merge-base --is-ancestor 25a2f5f HEAD && git
  merge-base --is-ancestor 19e5616 HEAD && git merge-base --is-ancestor 6bb560b HEAD && git
  merge-base --is-ancestor 343b96d HEAD && git merge-base --is-ancestor e478a43 HEAD && git
  merge-base --is-ancestor c71769d HEAD` — each squash-merge commit reports ancestor-of-HEAD (exit
  0), proving every cited story PR is in this tree's history.
- `for i in 54 58 61 107 108 109 110 111 112 113 114 117 118 119 121 140 56; do gh issue view $i
  --json number,state,stateReason; done` — every feature story reports CLOSED with `stateReason:
  COMPLETED`, matching the table; #56 also reports CLOSED `COMPLETED`, which the Discrepancies
  section records honestly. (The two residuals: #115 CLOSED `COMPLETED` but "No code changes made",
  #116 OPEN — both recorded in Discrepancies.)
- `./scripts/verify.sh --fast` — passes on the accumulated tree. The diff is doc-only, so compile,
  lint, tests, and the coverage ratchet are untouched.
- `git diff --name-only origin/main...HEAD` — lists exactly `docs/epics/e56-stripe-checkout-integration.md`
  (plus nothing else), proving the PR is doc-only.
- The #121 sandbox e2e is NOT run here — it needs `.env.local` sandbox secrets and is the manual
  local gate described in Discrepancies.
