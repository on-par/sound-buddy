# Sandbox e2e runbook (#121)

A checklist for running `test/e2e/sandbox.e2e.test.ts` against the Stripe test
sandbox. See `README.md`'s "Sandbox e2e (manual gate)" section for the full
design rationale — this doc is just the reproduction steps.

## 1. One-time setup

1. `cd worker && npm ci`.
2. Confirm the sandbox exists in test mode: `dashboard.stripe.com/test/products`
   should show `sound_buddy_pro_monthly`, `sound_buddy_pro_annual`,
   `sound_buddy_founding_lifetime`, and three Payment Links (Founding capped at
   300 completed sessions). If not, the epic's "Sandbox artifacts" section has
   the provisioning steps.
3. Create `.env.local` at the **repo root** (gitignored) with:
   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   RESEND_API_KEY=re_test_...
   WORKER_BASE_URL=http://127.0.0.1:8787
   LICENSE_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
   ```
   Never commit this file. Never paste its values into a chat, PR, or log.
4. In a separate terminal, start the Worker against the same sandbox account:
   `cd worker && npm run dev` (needs its own `.dev.vars` with
   `LICENSE_SIGNING_PRIVATE_KEY` etc. — see the main README's "Config &
   bindings" section).

## 2. (Optional) seed a real paid Checkout Session

Two scenarios need a REAL, already-paid Checkout Session — Stripe's API has no
way to complete one headlessly. Skip this section to run everything else.

1. In the sandbox dashboard, open the `sound_buddy_pro_monthly` Payment Link
   (or generate a Checkout Session via the API with `mode: "subscription"`,
   `price: price_1Tqxh0ASt3LJWmaOwO4v8ZEs`).
2. Complete checkout with `4242 4242 4242 4242`, any future expiry, any CVC.
3. Copy the resulting `cs_...` id (from the success URL or the Dashboard's
   Checkout Sessions list) into `.env.local` as `SANDBOX_SEED_SESSION_ID`.
4. Repeat with the founding Payment Link
   (`plink_1TqxhKASt3LJWmaOMsHauxwd`, one-time payment) for
   `SANDBOX_SEED_FOUNDING_SESSION_ID`.

The "seamless refresh + cancellation" scenario **cancels** the seeded
subscription — re-seed a fresh `SANDBOX_SEED_SESSION_ID` before re-running it.

## 3. Run

```bash
cd worker
npm run test:e2e:sandbox
```

## 4. Scenario → what runs

| Gherkin scenario | Harness behavior |
| --- | --- |
| Initial purchase happy path | Real customer + subscription + `invoice.paid` delivered via signed webhook; email-derived key verified if the Resend key allows listing. Seeded: `GET /api/license` returns a signature-valid pro key. |
| Renewal via test clock | Real test clock advanced +1 month on a fresh customer/subscription; renewed `invoice.paid` delivered via signed webhook; period end asserted to have advanced. |
| Seamless refresh end-to-end | (Seeded) refresh rotates the seed key, the superseded key is refused `403`, and a canceled subscription's key is refused `403`. |
| Cancellation | Same seeded scenario: `subscriptions.cancel` + a real `customer.subscription.deleted` webhook; the already-issued key still verifies pro afterward (no revocation). |
| Founding purchase and cap | Payment Link `restrictions.completed_sessions.limit` asserted against `FOUNDING_CAP` (no 300 real purchases). A constructed `checkout.session.completed` event proves the mint handler. Seeded: `GET /api/license` returns a lifetime key. |
| Refund | Real PaymentIntent + charge, refunded via the API, `charge.refunded` delivered via signed webhook; existing entitlement unaffected. |
| Webhook hardening | Bad signature → `400`. A replayed real event id → `200` both times, `duplicate: true` on the second. |
| Card decline / 3DS / renewal-fail | `4000...9995` never activates a subscription; `4000...3155` leaves it `incomplete`; `4000...0341`'s renewal failure is exercised via a constructed `invoice.payment_failed` event (dunning email, no mint). |

## 5. Capture the run

Paste only the terminal **summary line** (pass/fail counts) into the PR's
Testing section — never the full output. A *failed* assertion can still print
a raw value in its diff (e.g. if a `toBe`/`toMatch` check on a key ever
regresses back to comparing a raw string — the suite is written to compare
booleans instead specifically to avoid this, see the comments in
`sandbox.e2e.test.ts`), so treat any failure output as sensitive and redact
before sharing rather than assuming it's safe.
