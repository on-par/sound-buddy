# Live Founding test purchase and refund

This uses one real $199 payment and consumes one of the 10 Founding seats. Use a controlled buyer email and a real card; keep the session ID and charge ID private. Stop and investigate any failed check before proceeding.

The live Payment Links are:

- [Founding Lifetime — $199](https://buy.stripe.com/eVq28refH1f46VadbYawo00)
- [Pro Monthly — $9/month](https://buy.stripe.com/28EcN52wZ2j86Vab3Qawo02)
- [Pro Annual — $79/year](https://buy.stripe.com/8x24gz6Nfe1Q1AQdbYawo01)

All three redirect to `https://soundbuddy.online/activate?session_id={CHECKOUT_SESSION_ID}`. The buyer sees a finalizing message, followed by a license key and copy button when ready. If polling fails or times out, the page asks the buyer to check email and contact support if needed.

For monthly and annual purchases, `checkout.session.completed` does not mint the subscription license; `invoice.paid` mints and emails a subscription key for the paid period. The activation page can also obtain a freshly signed subscription key on demand from `/api/license` using the session ID and Stripe subscription status, without waiting for the webhook.

1. Check the live Founding Payment Link is $199, one-time, and capped at 10 completed sessions. Read `GET /api/stripe/founding-count` and record `sold`, `cap`, and `remaining`. Pass: `cap` is 10 and a seat remains. Fail: stop if the link, cap, or count is wrong.
2. Make exactly one purchase through the Founding CTA. Pass: Stripe shows a paid $199 Checkout Session and charge. Fail: do not repeat the purchase; investigate the session and payment status.
3. Inspect live `POST /api/stripe/webhook` delivery in Stripe. The dispatcher handles `checkout.session.completed` and `checkout.session.async_payment_succeeded`; the latter applies to delayed payments. The paid payment-mode session triggers `checkout-completed.ts` to mint an Ed25519 lifetime key and store session metadata and a key hash in `LICENSE_KV`. `delivery.ts` sends the key by Resend email on a best-effort basis. Pass: the applicable event is delivered successfully and the license email arrives. Fail: inspect webhook and email delivery; a successful webhook alone does not prove email was sent.
4. Follow the buyer's `GET /activate?session_id=...` landing page. It polls `GET /api/license?session_id=...` for the key. Pass: a lifetime key appears. Fail: investigate the paid session and license endpoint without making a second purchase. Do not paste the key into logs or tickets.
5. Paste the key into the Mac app's license activation UI. The licensing IPC calls `activateLicense`, which verifies the signed lifetime key locally and unlocks Pro. Pass: the app reports an active lifetime license and Pro works. Fail: check the key and app signing public key. Lifetime activation works offline; automatic refresh skips lifetime keys. A manual refresh uses `POST /api/license/refresh` and is not needed to unlock the key.
6. Recheck `GET /api/stripe/founding-count` after the cache expires (up to 60 seconds). Pass: `sold` rises by one, `cap` remains 10, and `remaining` falls by one, assuming no other purchase. Fail: investigate session records and concurrent purchases.
7. In the live Stripe Dashboard, refund the test charge in full. Pass: Stripe shows the $199 refund and successfully delivers `charge.refunded`. The handler writes `refund:<charge_id>` with `followUp: true`; it records the refund only and does **not** revoke the offline lifetime key. Fail: investigate the refund or webhook delivery. The code provides a manual follow-up flag, not remote revocation; remove the test key from the test Mac using the app's license removal control and track follow-up operationally. The session record remains, so the founding count does not decrease on refund; confirm this after the cache expires.
