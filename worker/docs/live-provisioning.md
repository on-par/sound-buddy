# Live Stripe provisioning runbook (#564): take checkout test → live

A one-time, real-money, human-judgment task on the **dedicated Sound Buddy Stripe
account** `acct_1Tv0wcF8DNgPKMma` (On PAR Dev org): provision the Products, Prices,
Payment Links, webhook, Customer Portal, Worker secrets/bindings, Resend sender,
and live URL wiring that the already-shipped code reads. Everything downstream —
the webhook handlers, signed-key minting, Resend email delivery, the `/activate`
page, and the app's activation/Pro gating — is built, tested, and unchanged by
this step. This runbook is the single source of truth for the remaining human
steps of #564; each section maps to a line in the final checklist.

> **Two committable pieces of #564 are already done in the repo:** the production
> Ed25519 signing public key is installed in `app/electron/license.ts`
> (`EMBEDDED_PUBLIC_KEY_PEM`) and `worker/wrangler.jsonc` (`LICENSE_PUBLIC_KEY`,
> KID `sb-sign-2026-08`), replacing the retired DEV key, and a unit test pins that
> the DEV key is gone. This runbook covers everything that needs live credentials.

## 0. Account context & isolation

- Use only the dedicated account **`acct_1Tv0wcF8DNgPKMma`** (On PAR Dev org) for
  every Stripe step below — products, prices, links, webhook, secrets, portal,
  payouts.
- Keep it **isolated** from the consulting/Odoo account `acct_1TblkbFCwPak9879`:
  no shared webhook endpoints, API keys, or payout routing. The worker's webhook
  signature secret, the Stripe secret key, and the Resend key must all come from
  the Sound Buddy account/org, never cross-wired.
- Work in **Test mode** for the provisioning-and-verification phase (sections
  1–10), then replicate to Live (section 11). The dashboard toggle is
  "Test mode" on/off.

## 1. Products & Prices (Test mode, then copy to Live)

Create on `acct_1Tv0wcF8DNgPKMma` (dashboard.stripe.com/test/products):

1. Product **`Sound Buddy Pro`** with two recurring Prices — match the app's
   pricing copy (`app/renderer/upgrade-momentum.js`):
   - **$9.00 / month**, interval `month`, lookup_key **`sound_buddy_pro_monthly`**
   - **$79.00 / year**, interval `year`, lookup_key **`sound_buddy_pro_annual`**
2. Product **`Sound Buddy Founding Lifetime`** with one one-time Price:
   - **$199.00**, one-time (no recurring), lookup_key **`sound_buddy_founding_lifetime`**
3. Use `lookup_key` as the **stable handle** — the Worker maps entitlement by
   Checkout mode, not by price id, so re-provisioned sandboxes can rotate
   `price_...` ids without code changes.
4. Sanity check `dashboard.stripe.com/test/products` shows all three prices with
   their lookup keys. Note the `price_...` ids — the sandbox e2e reads its defaults
   from `worker/src/e2e/env.ts`; if these ids differ from those, set the
   `SANDBOX_MONTHLY_PRICE_ID` / `SANDBOX_ANNUAL_PRICE_ID` /
   `SANDBOX_FOUNDING_PRICE_ID` / `SANDBOX_FOUNDING_PAYMENT_LINK_ID` overrides (see
   `worker/docs/sandbox-e2e.md`).

> Out of scope (per the issue): Stripe Tax and per-state registration are deferred
> until economic nexus is crossed. Do not turn on Stripe Tax as part of this step.

## 2. Payment Links (3)

For each Price, **More** → **Create payment link**; keep the auto-generated
`https://buy.stripe.com/<id>` URL:

1. **Pro Monthly** — from `sound_buddy_pro_monthly`.
2. **Pro Annual** — from `sound_buddy_pro_annual`.
3. **Founding Lifetime** — from `sound_buddy_founding_lifetime`, with
   `restrictions.completed_sessions.limit = 300` (== `FOUNDING_CAP`,
   `site/src/lib/founding-urgency.ts` and `worker/wrangler.jsonc`).
   Only this link gets the cap; the Pro links need none.

All three set **after_completion → redirect** to
`https://soundbuddy.online/activate?session_id={CHECKOUT_SESSION_ID}` — the
Worker's `/activate` page polls `/api/license?session_id=` with that id (the
placeholder `https://buy.stripe.com/sound-buddy-...` URLs currently shipped in
`app/electron/checkout.ts` and `site/src/lib/founding-urgency.ts` are inert until
these real links exist).

Copy all three `buy.stripe.com/...` URLs. They are not secrets, but keep them out
of the repo — they are wired via release-build env (section 9), never committed.

## 3. Webhook endpoint

Register the endpoint so Stripe can push lifecycle events the worker handles
(`worker/src/webhook.ts`):

1. Dashboard → **Developers** → **Webhooks** → **Add endpoint**.
2. Endpoint URL: `https://soundbuddy.online/api/stripe/webhook`
   (matches the `soundbuddy.online/api/stripe/*` route in `worker/wrangler.jsonc`).
3. Events to send (exactly these six):
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.deleted`
   - `charge.refunded`
4. Create, then copy the signing secret `whsec_...` and store it — a **test**
   secret for test mode, a **live** secret for live mode:

   ```bash
   cd worker
   wrangler secret put STRIPE_WEBHOOK_SECRET
   ```

   The worker verifies every webhook signature against this secret (bad
   signatures are rejected `400`) and replays are deduplicated idempotently.

## 4. Customer Portal

In the Stripe Billing settings for `acct_1Tv0wcF8DNgPKMma`, **enable the Customer
Portal**. Then put its URL into the worker's non-secret vars in place of the
placeholder and deploy:

```bash
# worker/wrangler.jsonc → vars → CUSTOMER_PORTAL_URL
"vars": { ..., "CUSTOMER_PORTAL_URL": "https://billing.stripe.com/p/login/<...>" }
npm run deploy
```

The portal link is shown in every license email so a customer can cancel or
change plans; cancellation runs their key to expiry + grace (no revocation).

## 5. License signing keypair (custody)

The production Ed25519 keypair already exists and is partly installed by this PR.
Rules (normative):

- Keys live only at **`$HOME/SoundBuddy-keys/`** — `license-pub.pem` (SPKI PEM) and
  `license-priv.pem` (pkcs8 PEM, mode 0600). Never copy the private key into the
  repo, never `--force`, never echo either key into a log/terminal/PR, never
  commit anything under `$HOME/SoundBuddy-keys`.
- If a keypair already exists from a prior partial provisioning, **reuse it — do
  NOT generate a second one.** Generate only when none exists:
  ```bash
  # from the repo root; outdir is required and must sit outside any git tree
  node scripts/license-keygen.mjs gen "$HOME/SoundBuddy-keys"
  ```
  (`gen` refuses git working trees by design; never use `--force`.)
- The public half is already embedded — the same base64 body must appear in
  `app/electron/license.ts` `EMBEDDED_PUBLIC_KEY_PEM`, `worker/wrangler.jsonc`
  `LICENSE_PUBLIC_KEY`, and `$HOME/SoundBuddy-keys/license-pub.pem`. Sanity check:
  ```bash
  git diff app/electron/license.ts | grep 'MCowBQYDK2Vw'   # the new key body
  ```
- The **private half goes into the Worker only** via `wrangler secret put`
  (section 6). If it is ever lost, the swap must be redone: generate a new
  keypair, re-embed the new public key in `license.ts` + `wrangler.jsonc`, and
  bump `LICENSE_SIGNING_KID` (currently `sb-sign-2026-08`) — the app never gates
  on the KID, so a bump invalidates nothing.
- The **sandbox `.dev.vars` needs the same private key** so test-mode e2e signs
  with the production keypair (see `worker/docs/sandbox-e2e.md`).

## 6. Cloudflare Worker bindings & secrets

1. Confirm the KV namespace ids in `worker/wrangler.jsonc`
   (`LICENSE_KV` `bd8406528f484d1bb2a077e0a6cb8034`, `EVENTS_KV`
   `25bfac1831c44e38a22db0ea780ce127`, `WAITLIST_KV`
   `be250ecd5f9b427c859e8e451873e5b3`) are the real deployed namespaces for
   `sound-buddy-api`:
   ```bash
   cd worker
   wrangler kv namespace list
   ```
   If any id is missing/stale, create the namespace and replace the id in
   `wrangler.jsonc` **before** deploying.
2. Set the four secrets (each is `wrangler secret put <NAME>`, pasting the value
   when prompted — never into the repo):
   ```bash
   cd worker
   wrangler secret put STRIPE_SECRET_KEY            # sk_test_... then sk_live_...
   wrangler secret put STRIPE_WEBHOOK_SECRET        # whsec_... from section 3
   wrangler secret put LICENSE_SIGNING_PRIVATE_KEY  # paste $HOME/SoundBuddy-keys/license-priv.pem
   wrangler secret put RESEND_API_KEY               # re_... (transactional license emails)
   ```
   `LICENSE_SIGNING_PRIVATE_KEY` **must** be the private half of the key whose
   public half is embedded (section 5) — a mismatch makes the Worker mint keys
   that every shipped app rejects. Verify with the roundtrip check:
   ```bash
   node scripts/license-keygen.mjs sign "$HOME/SoundBuddy-keys/license-priv.pem" --kind lifetime --kid sb-sign-2026-08
   # then verify the SB1 key with the app: SOUND_BUDDY_LICENSE_PUBKEY=$HOME/SoundBuddy-keys/license-pub.pem ... 
   ```
3. Confirm the custom-domain routes in `wrangler.jsonc` cover
   `/api/stripe/*`, `/api/license`, `/api/license/refresh`, and `/activate`
   (they do — the four patterns are already declared; the zone id is wired at
   deploy time).
4. Deploy:
   ```bash
   npm run deploy
   ```

## 7. Resend

1. Create a live `re_...` API key (transactional, not broadcast) for the worker's
   `RESEND_API_KEY` (section 6).
2. Verify the sender domains in Resend for **`hello@soundbuddy.online`**
   (`FROM_EMAIL`) and **`support@soundbuddy.online`** (`SUPPORT_EMAIL`) — add the
   DNS records Resend provides (SPF/DKIM) and confirm domain verification.

## 8. Wire the live URLs (site + app build env)

The real Payment-Link URLs from section 2 are wired via **build env**, not
committed defaults — do **not** bake them into `app/electron/checkout.ts`
`DEFAULT_URLS` or `site/src/lib/founding-urgency.ts` `PLACEHOLDER_FOUNDING_URL`.
Replacing the placeholder would regress the site's `isCheckoutLive()` gate (#560),
which keys off `override !== placeholder`.

- **Site build env:** `PUBLIC_FOUNDING_CHECKOUT_URL` = the Founding Payment Link
  from section 2 (+ `PUBLIC_SITE_MODE=live` is already set in CI). This kills the
  HTTP-403 founding link live.
- **App release build env:** `SOUND_BUDDY_CHECKOUT_MONTHLY_URL` /
  `SOUND_BUDDY_CHECKOUT_ANNUAL_URL` = the two Pro Payment Links from section 2
  (the app resolves them via `app/electron/checkout.ts` env overrides first).

## 9. Verify in test mode

1. Create `.env.local` at the **repo root** (gitignored):
   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   RESEND_API_KEY=re_test_...
   WORKER_BASE_URL=http://127.0.0.1:8787
   LICENSE_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...the production key body...\n-----END PUBLIC KEY-----"
   ```
   `LICENSE_PUBLIC_KEY` must be the **production** key embedded in
   `app/electron/license.ts` / `wrangler.jsonc` (section 5) — never the retired
   DEV key — so the harness proves webhook → mint → app-verify with the real
   keypair. Never commit this file.
2. Create `worker/.dev.vars` with the same production private key
   (`LICENSE_SIGNING_PRIVATE_KEY`), `STRIPE_SECRET_KEY` (`sk_test_...`),
   `STRIPE_WEBHOOK_SECRET` (`whsec_...`), and `RESEND_API_KEY` (`re_test_...`).
3. Run the sandbox e2e (purchase / renewal / cancel / founding-cap / refund /
   webhook-hardening):
   ```bash
   cd worker
   npm run test:e2e:sandbox
   ```
4. Once a real test-minted key exists, run the app gate:
   ```bash
   cd app
   npm run test:e2e:stubbed -- purchase-path.spec.ts
   ```
   The two CTA scenarios assert the env-override URLs (now your links) are
   opened, and the #56 scenario asserts a lapsed-subscriber CTA carries
   `prefilled_email`.

## 10. Go live

1. **Activate the Stripe account** on `acct_1Tv0wcF8DNgPKMma`: business details
   + bank account for payouts (this is irreversible — real money).
2. **Replicate** the three Products/Prices and three Payment Links to **Live**
   mode (repeat sections 1–2 with the dashboard toggle off), keeping the same
   lookup keys, prices, the 300-completed-session cap on the Founding link, and
   the `/activate` redirect.
3. **Register the live webhook** (repeat section 3 with the live endpoint) and
   store its live `whsec_...`.
4. **Deploy the Worker with live secrets**: `wrangler secret put STRIPE_SECRET_KEY`
   (`sk_live_...`), `STRIPE_WEBHOOK_SECRET` (live `whsec_...`), the same
   `LICENSE_SIGNING_PRIVATE_KEY`, `RESEND_API_KEY` (live `re_...`), and the real
   `CUSTOMER_PORTAL_URL` from section 4; then `npm run deploy`.
5. **Swap the live URLs** (section 8): `PUBLIC_FOUNDING_CHECKOUT_URL` +
   `SOUND_BUDDY_CHECKOUT_MONTHLY_URL`/`_ANNUAL_URL` point at the live Payment
   Links; rebuild/redeploy the site and the app release build.
6. **Confirm the Founding link is payable and delivers a key**: complete a live
   $199 founding purchase, confirm the key email arrives and activates the app.
7. **Run one small/refunded live purchase** (e.g. the $9/mo link with a real card,
   then refund it) to prove the live webhook → mint → email → activation path.

## 11. Cleanup

- Delete the stray inert live product **`prod_UuqnncAFQmPFOC`** ("Sound Buddy
  Pro", no prices) created during setup — it is a duplicate shell of the real
  product and must not linger.
- Confirm no leftover placeholder Payment Links or test-only live products remain
  on `acct_1Tv0wcF8DNgPKMma`.

## Checklist

Every acceptance criterion of #564 maps to a line; the section in parens is where
to do it.

- [ ] Dedicated account `acct_1Tv0wcF8DNgPKMma` used throughout; isolated from `acct_1TblkbFCwPak9879` (§0)
- [ ] Product `Sound Buddy Pro` with `sound_buddy_pro_monthly` ($9/mo) and `sound_buddy_pro_annual` ($79/yr) prices (§1)
- [ ] Product `Sound Buddy Founding Lifetime` with one-time `sound_buddy_founding_lifetime` ($199) price (§1)
- [ ] Three Payment Links created; Founding link capped at 300 completed sessions (§2)
- [ ] All three links redirect after_completion to `https://soundbuddy.online/activate?session_id={CHECKOUT_SESSION_ID}` (§2)
- [ ] Webhook registered at `https://soundbuddy.online/api/stripe/webhook` with the six events (§3)
- [ ] `STRIPE_WEBHOOK_SECRET` set via `wrangler secret put` (test then live) (§3)
- [ ] Customer Portal enabled and `CUSTOMER_PORTAL_URL` set in `wrangler.jsonc` + deployed (§4)
- [ ] Production keypair in `$HOME/SoundBuddy-keys/`; private key never committed (§5)
- [ ] `LICENSE_SIGNING_PRIVATE_KEY` set via `wrangler secret put` from the production `license-priv.pem` (§6)
- [ ] KV namespace ids confirmed against `wrangler kv namespace list` (§6)
- [ ] `STRIPE_SECRET_KEY`, `LICENSE_SIGNING_PRIVATE_KEY`, `RESEND_API_KEY` set via `wrangler secret put` (§6)
- [ ] Routes confirmed for `/api/stripe/*`, `/api/license`, `/api/license/refresh`, `/activate`; `npm run deploy` (§6)
- [ ] Resend live key; `hello@` and `support@soundbuddy.online` domains verified (§7)
- [ ] `PUBLIC_FOUNDING_CHECKOUT_URL` = live Founding link; `PUBLIC_SITE_MODE=live` (§8)
- [ ] `SOUND_BUDDY_CHECKOUT_MONTHLY_URL` / `SOUND_BUDDY_CHECKOUT_ANNUAL_URL` = live Pro links in the app release build (§8)
- [ ] URLs stay env-driven — no Payment-Link URLs baked into `checkout.ts` or `founding-urgency.ts` (§8)
- [ ] `.env.local` + `worker/.dev.vars` carry the production key + `sk_test` secrets; sandbox e2e passes (§9)
- [ ] App purchase-path gate passes against a real test-minted key (§9)
- [ ] Stripe account activated (business + bank) (§10)
- [ ] Live products/prices/links replicated with same lookup keys + founding cap (§10)
- [ ] Live webhook registered; live secrets deployed (§10)
- [ ] Live Founding purchase delivers a key that activates the app (§10)
- [ ] One small/refunded live purchase proves the live webhook → mint → email path (§10)
- [ ] Stray live product `prod_UuqnncAFQmPFOC` deleted (§11)
