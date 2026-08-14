# Live Stripe provisioning runbook (#56)

A one-time, real-money, human-judgment task: provision the two live Prices and
Payment Links, register the webhook, and wire the secrets/env the already-shipped
code reads. Everything downstream — the webhook handlers, signed-key minting,
Resend email delivery, the `/activate` page, and the app's activation/Pro gating —
is built, tested, and unchanged by this step. The sandbox equivalents already
exist (see `sandbox-e2e.md` and the epic's "Sandbox artifacts" section); this
doc flips the same shape into **live** mode.

Do this in Stripe **live mode** (dashboard toggle "Test mode" → off). The
app-side URLs stay placeholders until step 6.

## 1. Product + Prices

1. In the live dashboard open **Products** → **Add product**.
2. Name it `Sound Buddy Pro`.
3. Add two **recurring** Prices (one per subscription interval), exactly matching
   what the app's pricing copy advertises (`app/renderer/upgrade-momentum.js`):
   - **$9 / month**, interval `month`
   - **$79 / year**, interval `year`
4. Save. Note the two `price_...` ids — the webhook code keys entitlements off
   the subscription, not the price, so these are for reference only.

> Out of scope (per the issue): Stripe Tax and per-state registration are
> deferred until economic nexus is crossed. Do not turn on Stripe Tax in live
> mode as part of this step.

## 2. Payment Links

1. For each Price, **More** → **Create payment link**.
   - Leave the URL auto-generated: `https://buy.stripe.com/<id>`.
2. Copy both `buy.stripe.com/...` URLs. They are not secrets, but keep them out
   of the repo — they are wired via release-build env, not committed.
3. (Recommended) set a sane `restrictions.completed_sessions.limit` on the links
   if you want a purchase cap — the founding-license cap logic lives in the
   worker only for the legacy founding product; the Pro links need none.

## 3. Webhook endpoint

Register the endpoint so Stripe can push lifecycle events the worker handles
(`worker/src/webhook.ts`):

1. Dashboard → **Developers** → **Webhooks** → **Add endpoint**.
2. Endpoint URL: `https://soundbuddy.online/api/stripe/webhook`
   (matches the `soundbuddy.online/api/stripe/*` route in `worker/wrangler.jsonc`).
3. Events to send:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.deleted`
   - `charge.refunded`
4. Create, then copy the signing secret `whsec_...` and store it:

   ```bash
   cd worker
   wrangler secret put STRIPE_WEBHOOK_SECRET
   ```

   The worker verifies every webhook signature against this secret (bad
   signatures are rejected `400`) and replays are deduplicated idempotently.

## 4. Secrets

Set the remaining secrets once, if not already present in the live worker:

```bash
wrangler secret put STRIPE_SECRET_KEY     # sk_live_...
wrangler secret put RESEND_API_KEY        # re_... (transactional license emails)
```

`LICENSE_SIGNING_PRIVATE_KEY` must already be set — it is the Ed25519 keypair
whose public counterpart is embedded in the app and declared in
`wrangler.jsonc`'s `LICENSE_PUBLIC_KEY`. If it was ever rotated, re-check the app
build ships the matching public key before going live.

## 5. Customer Portal URL

In the live dashboard, **Settings** → **Billing** → **Customer Portal**, confirm
the portal is enabled, and put its URL in the worker's non-secret vars:

```bash
# worker/wrangler.jsonc → vars → CUSTOMER_PORTAL_URL
"vars": { ..., "CUSTOMER_PORTAL_URL": "https://billing.stripe.com/p/login/<...>" }
wrangler deploy
```

The portal link is shown in every license email so a customer can cancel or
change plans; cancellation runs their key to expiry + grace (no revocation).

## 6. Point the app at the live Payment Links

The app resolves the checkout URL from env overrides first
(`app/electron/checkout.ts`, keys `SOUND_BUDDY_CHECKOUT_MONTHLY_URL` /
`SOUND_BUDDY_CHECKOUT_ANNUAL_URL`). Set both to the Payment Link URLs from step 2
in the **release build** environment (release pipeline env or `electron-builder`
extraMetadata — wherever the shipped `.app` reads env from). The app appends
`?prefilled_email=<customer email>` itself for users whose license key carries an
email (#56); no server involvement, and a blank email means the plain link.

## 7. Verify end to end

1. `cd app && npm run test:e2e:stubbed -- purchase-path.spec.ts` — the two CTA
   scenarios assert the env-override URLs (now your live links) are opened, and
   the #56 scenario asserts a lapsed-subscriber CTA carries `prefilled_email`.
2. Run the sandbox e2e harness (`worker/docs/sandbox-e2e.md`) once more to prove
   webhook → mint → email still green against the live-shaped config.
3. From the release build, complete a real $9/mo checkout with a test card on a
   sandbox account first, then a live card on the live links — the key should
   arrive by email within the minute and paste into the app's license dialog.

## Checklist

- [ ] Product `Sound Buddy Pro` live with $9/mo and $79/yr recurring Prices
- [ ] One Payment Link per Price; both `buy.stripe.com/...` URLs captured
- [ ] Webhook registered at `https://soundbuddy.online/api/stripe/webhook` with the six events
- [ ] `STRIPE_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`, `RESEND_API_KEY` set via `wrangler secret put`
- [ ] `LICENSE_PUBLIC_KEY` matches the key embedded in the app build
- [ ] `CUSTOMER_PORTAL_URL` set in `wrangler.jsonc` vars and deployed
- [ ] `SOUND_BUDDY_CHECKOUT_MONTHLY_URL` / `SOUND_BUDDY_CHECKOUT_ANNUAL_URL` set in the release build env
- [ ] Live checkout → key email → app activation verified once with a real card
