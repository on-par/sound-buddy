# Sandbox end-to-end test plan (#1169)

This plan exercises the full checkout → webhook → mint → email → `/activate` →
app-verify flow together against the Stripe **test-mode** sandbox (provisioned
2026-07-08), for both the subscription and founding-lifetime paths, before the
#56 live-mode cutover. **Test mode only — no live-mode execution or cutover
decision is part of this plan.**

## Preconditions

Complete the one-time setup in [`sandbox-e2e.md`](./sandbox-e2e.md) first:

- `.env.local` at the repo root with `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `RESEND_API_KEY`, `WORKER_BASE_URL`, and `LICENSE_PUBLIC_KEY` (the production
  key), plus the optional `SANDBOX_SEED_SESSION_ID` /
  `SANDBOX_SEED_FOUNDING_SESSION_ID` seeds.
- A running Worker: `cd worker && npm run dev`.
- The sandbox artifacts provisioned: the `sound_buddy_pro_monthly` price and
  the `sound_buddy_founding_lifetime` Payment Link (capped at 300 completed
  sessions).

**Security:** never paste `.env.local` values, raw webhook bodies, email
addresses, or minted `SB1.` keys into a PR, chat, or log (see
`sandbox-e2e.md` §5).

## The end-to-end flow under test

- **Checkout** — buyer completes Stripe's hosted Checkout with test card
  `4242 4242 4242 4242`; a `cs_...` Checkout Session id results.
- **Webhook** — Stripe delivers the completion event to the Worker at
  `POST /api/stripe/webhook` (subscription: `invoice.paid`; founding:
  `checkout.session.completed`). Signature is verified before any side effect.
- **Mint** — the Worker signs an `SB1.` license key (subscription vs
  lifetime).
- **Email** — the license key is emailed to the buyer within ~1 minute
  (Resend).
- **/activate** — the buyer lands on `soundbuddy.online/activate?session_id=…`;
  the self-contained page polls `GET /api/license` and shows the key
  (`worker/src/handlers/activate.ts`).
- **App verification** — the buyer pastes the key into **Sound Buddy →
  Settings → License**; the app validates it against the embedded production
  public key (`app/electron/license.ts`) and unlocks Pro.

## Delivery mechanisms (how the webhook leg is driven)

- **Automated (default):** `npm run test:e2e:sandbox` — the harness builds
  real Stripe objects via the API and POSTs constructed, validly-signed
  webhook events straight to the Worker (no public URL / dashboard endpoint
  needed). This is what proves the webhook → mint → verify legs headlessly.
- **Manual CLI alternative:** a human may instead forward real Stripe events
  with `stripe listen --forward-to localhost:8787/api/stripe/webhook` and
  `stripe trigger checkout.session.completed` to exercise a genuine
  dashboard-emitted event. Hosted Checkout completion, the `/activate`
  browser render, and the app paste are inherently manual — Stripe has no API
  to "pay" a hosted Checkout Session (design note #2 in
  `src/e2e/sandbox.e2e.test.ts`).

## Subscription path — ordered steps

1. Complete hosted subscription Checkout with `4242`; capture `cs_...` → set
   `SANDBOX_SEED_SESSION_ID`. *(Manual; see `sandbox-e2e.md` §2.)*
2. Completion event reaches the Worker and is accepted. *(Automated:
   "Scenario: Initial purchase happy path" → "mints a subscription key via a
   real invoice.paid webhook delivery" — webhook returns `200 {received:
   true}`. Manual alt: `stripe trigger`/`stripe listen`.)*
3. Worker mints a subscription `SB1.` key. *(Automated: same scenario, plus
   "GET /api/license returns a signature-valid pro key for a seeded paid
   session" — `200 {key}`, `key` starts `SB1.`.)*
4. License email delivered ~1 min. *(Automated best-effort via
   `findLicenseEmail`; degrades to a logged SKIP on a send-only Resend key —
   then `GET /api/license` is the authoritative delivery proof. Manual alt:
   check the inbox.)*
5. Buyer opens `/activate?session_id=…`; page shows the key. *(Manual browser
   check — page served by `handleActivate`; polls `GET /api/license`.)*
6. Paste key into Sound Buddy → Settings → License; app unlocks Pro. *(Manual
   app check. Automated proxy: `verifyKey` asserts `tier=pro`,
   `status=valid`, `kind=subscription`.)*

## Founding path — ordered steps

1. Complete the founding Payment Link (payment mode) with `4242`; capture
   `cs_...` → set `SANDBOX_SEED_FOUNDING_SESSION_ID`. *(Manual.)*
2. `checkout.session.completed` reaches the Worker. *(Automated: "Scenario:
   Founding purchase and cap" → "mints a lifetime key via a constructed
   checkout.session.completed webhook" — `200 {received: true}`.)*
3. Worker mints a **lifetime** key. *(Automated: "GET /api/license returns a
   lifetime key for a seeded paid founding session".)*
4. Email delivered. *(As subscription step 4.)*
5. `/activate` renders the key. *(Manual browser.)*
6. Paste into app; unlocks Pro **lifetime**. *(Manual. Automated proxy:
   `verifyKey` asserts `tier=pro`, `kind=lifetime`, `expiresAt` undefined.)*
7. Founding cap sanity: the Payment Link's `completed_sessions.limit` is 300.
   *(Automated: "the founding Payment Link's completed_sessions cap matches
   FOUNDING_CAP".)*

## Results — Subscription path

| # | Step | Verified by | Expected | Result | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | Complete hosted subscription Checkout | Manual | `cs_...` session id captured | PENDING | |
| 2 | Completion event reaches the Worker | Automated: "Scenario: Initial purchase happy path" → "mints a subscription key via a real invoice.paid webhook delivery" | `200 {received: true}` | PENDING | |
| 3 | Worker mints a subscription key | Automated: "GET /api/license returns a signature-valid pro key for a seeded paid session" | `200 {key}`, key starts `SB1.` | PENDING | |
| 4 | License email delivered ~1 min | Automated (best-effort) via `findLicenseEmail`; `GET /api/license` is authoritative | Email received or SKIP logged | PENDING | |
| 5 | `/activate` shows the key | Manual browser check | Key rendered on page | PENDING | |
| 6 | App unlocks Pro | Manual app check; automated proxy `verifyKey` | `tier=pro`, `status=valid`, `kind=subscription` | PENDING | |

## Results — Founding path

| # | Step | Verified by | Expected | Result | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | Complete founding Payment Link Checkout | Manual | `cs_...` session id captured | PENDING | |
| 2 | `checkout.session.completed` reaches the Worker | Automated: "Scenario: Founding purchase and cap" → "mints a lifetime key via a constructed checkout.session.completed webhook" | `200 {received: true}` | PENDING | |
| 3 | Worker mints a lifetime key | Automated: "GET /api/license returns a lifetime key for a seeded paid founding session" | `200 {key}`, key starts `SB1.` | PENDING | |
| 4 | License email delivered | Automated (best-effort) via `findLicenseEmail`; `GET /api/license` is authoritative | Email received or SKIP logged | PENDING | |
| 5 | `/activate` shows the key | Manual browser check | Key rendered on page | PENDING | |
| 6 | App unlocks Pro lifetime | Manual app check; automated proxy `verifyKey` | `tier=pro`, `kind=lifetime`, `expiresAt` undefined | PENDING | |
| 7 | Founding cap sanity | Automated: "the founding Payment Link's completed_sessions cap matches FOUNDING_CAP" | `completed_sessions.limit === 300` | PENDING | |

**Legend:** `PASS` / `FAIL` / `SKIP (seed not provided / send-only Resend key)`.
Replace `PENDING` with the observed outcome during a real run. A `FAIL` is
recorded here and its fix is tracked as a follow-up in its originating story —
this plan is not the place to fix bugs it uncovers.

## Recording & sign-off

1. Start the Worker (`cd worker && npm run dev`).
2. Seed a Checkout Session for each path (see "Preconditions" and
   `sandbox-e2e.md` §2).
3. Run `cd worker && npm run test:e2e:sandbox` and record the automated
   steps' outcomes above.
4. Perform the manual `/activate` and app-paste legs and record their
   outcomes.
5. Paste only the vitest **summary line** into any PR or notes — never full
   output. A failed assertion can print raw values, so treat all failure
   output as sensitive and redact before sharing.

This plan is executed by a human with sandbox access. The factory needs
Patrick's explicit go-ahead before anything touching the Stripe launch moves
forward.
