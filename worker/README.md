# sound-buddy-api (Cloudflare Worker)

Dedicated, isolated Worker for Sound Buddy's Stripe / licensing endpoints
(part of the Stripe launch epic, #123). It is deliberately **separate from the
marketing site** (`site/`, which stays assets-only) so payment and licensing
logic has its own home, deploy, and blast radius.

This package is MIT-licensed like everything outside `app/` — no proprietary
header required.

## Status

Scaffold (#107), the Stripe webhook (#108), founding + subscription minting
(#110/#111), the sign-on-demand license fetch + activation page (#112), and
best-effort license email delivery (#114) are all implemented. A Stripe
sandbox end-to-end test harness (#121, manual/local gate) covers the full
purchase/renewal/cancel/founding/refund/hardening test plan.

## Routes

| Method | Path                   | Status                             |
| ------ | ---------------------- | ---------------------------------- |
| GET    | `/api/stripe/health`   | `200` — liveness probe             |
| POST   | `/api/stripe/webhook`  | `200` — verify + idempotency (#108)|
| GET    | `/api/license`         | `200`/`202`/`4xx`/`410`/`429` (#112) |
| GET    | `/activate`            | `200` — self-contained HTML (#112) |
| _any_  | anything else          | `404`                              |

A known path with the wrong method returns `405` with an `Allow` header.

## Webhook (`POST /api/stripe/webhook`)

Verifies the `Stripe-Signature` header asynchronously with Web Crypto
(`constructEventAsync` + `createSubtleCryptoProvider` — the Workers runtime has
no Node `crypto`), then de-duplicates events through KV so a replayed event never
double-mints a license:

- Missing signature header → `400` (no dispatch, no KV write).
- Bad signature / unparseable body → `400` (no dispatch, no KV write).
- First sight of `evt:<id>` → dispatch to the per-event handler, record a small
  marker in `LICENSE_KV` with a 30-day TTL, → `200`.
- Already-seen `evt:<id>` → `200` no-op (no dispatch).

Per-event handler bodies (license minting, subscription lifecycle, …) land in
downstream stories (#110/#111/#118/#119); this endpoint ships verification,
idempotency, and the dispatch skeleton. A handler that throws propagates as a
`500` so Stripe retries — the marker is written only after a handler returns.

## License fetch (`GET /api/license`) and activation page (`GET /activate`)

Sign-on-demand: entitlement is derived fresh from Stripe on every call (never
from the `sess:`/`sub:` KV records), and a fresh key is signed on every
successful call, so a buyer can fetch their key immediately after checkout —
even before the webhook above has landed.

`GET /api/license?session_id=<cs_…>`:

- Missing `session_id` → `400`.
- Rate-limited (per session id, best-effort) → `429`.
- Unknown/malformed session id, or a Stripe-side lookup error → `404`.
- Older than the 48h fetch window → `410`.
- Purchase still plausibly in flight → `202 { status: "pending" }`.
- Terminally not entitled → `402`.
- Paid/entitled → `200 { key }` — a freshly minted `SB1.` key.

`GET /activate?session_id=<cs_…>` renders a self-contained HTML page (no
external assets) whose inline script polls `/api/license` and shows the key,
a pending spinner, or an email-check fallback. No `session_id` renders the
fallback directly.

## Config & bindings

`wrangler.jsonc` declares:

- **Worker name** `sound-buddy-api` (distinct from the site's `sound-buddy`).
- **Routes** on `soundbuddy.online` for `/api/stripe/*`, `/api/license`,
  `/activate`.
- **KV** `LICENSE_KV` — namespace id is set out-of-band (H4); the checked-in
  value is a placeholder.
- **Vars** `FOUNDING_CAP`, `FROM_EMAIL`, `SUPPORT_EMAIL`,
  `CUSTOMER_PORTAL_URL`, `APP_ORIGIN`.

**Secrets** (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`LICENSE_SIGNING_PRIVATE_KEY`, `RESEND_API_KEY`) are **never** stored in this
repo — they are provisioned with `wrangler secret put` (H4).

Subscription and founding mints email the key via Resend after the key is
stored. Delivery is best-effort: a send failure is logged and never fails the
webhook; `/activate` remains the redundant key-delivery path.

### Security note (normative)

Never log private key material, signed `SB1.` license strings, webhook payload
bodies, or KV values — `wrangler tail` / Logpush capture logs. Log event
ids/types and outcomes only. (2026-07-08 keypair security review.)

## Develop

```bash
cd worker
npm ci
npm run dev        # wrangler dev (local)
npm run typecheck  # tsc --noEmit
npm test           # vitest
npm run verify     # typecheck + test
```

Deploy (`npm run deploy`) requires the real KV id, route zone, and secrets to be
wired first (H4).

## Sandbox e2e (manual gate)

`src/e2e/sandbox.e2e.test.ts` (#121) drives the full purchase / renewal /
cancel / founding / refund / webhook-hardening test plan against the **Stripe
test-mode sandbox** (provisioned 2026-07-08) and a running Worker. It is a
**manual/local launch gate**, mirroring the app's Playwright e2e that CI does
not run — `describe.skipIf` makes it an inert no-op skip whenever the sandbox
secrets are absent (always true in CI, so this is never a CI blocker), and a
real run once `.env.local` is loaded.

**Open question for Patrick:** should any part of this move into CI? Not
decided in #121 — flagged per the issue's "Assumption (pending sign-off)".

### Prerequisites

- `.env.local` (repo root, gitignored, never committed) with:
  - `STRIPE_SECRET_KEY` — sandbox test secret key (`sk_test_…`/`rk_test_…`)
  - `STRIPE_WEBHOOK_SECRET` — sandbox test webhook signing secret (`whsec_…`)
  - `RESEND_API_KEY` — sandbox test Resend key
  - `WORKER_BASE_URL` — where the Worker is reachable, e.g.
    `http://127.0.0.1:8787` for `wrangler dev`, or a preview deploy URL
  - `LICENSE_PUBLIC_KEY` — the sandbox signing key's spki PEM, so the harness
    can verify returned `SB1.` keys
  - Optional: `SANDBOX_SEED_SESSION_ID` / `SANDBOX_SEED_FOUNDING_SESSION_ID` —
    see "What's verified vs. what needs a manual seed" below
- A running Worker (`npm run dev`, or a preview deploy) pointed at the same
  sandbox account as the `.env.local` keys above.

### Run it

```bash
cd worker
npm run test:e2e:sandbox
```

### What's verified vs. what needs a manual seed

Every scenario drives the Worker via a **constructed, validly-signed webhook
event** POSTed directly to `/api/stripe/webhook`, built from real Stripe
objects (customer, subscription, invoice, charge) created through the API —
this avoids depending on a Stripe Dashboard webhook endpoint registration
pointed at this run's Worker (that needs a public URL — a human/DNS step, H5),
so the suite works against a bare `wrangler dev`.

Stripe's API has no way to programmatically "pay" a hosted Checkout Session —
that fundamentally requires a human on Stripe's own UI. Two legs need a REAL,
already-paid Checkout Session and are gated behind optional env vars:

- `GET /api/license?session_id=` returning `200 { key }` for a paid
  subscription — set `SANDBOX_SEED_SESSION_ID` to a `cs_…` id from a Checkout
  Session you complete once by hand (subscription mode, price
  `sound_buddy_pro_monthly`, card `4242 4242 4242 4242`). The "seamless
  refresh + cancellation" scenario reuses (and cancels) this same
  subscription — re-seed a fresh session id before re-running that scenario.
- `GET /api/license?session_id=` returning a lifetime key for the founding
  flow — set `SANDBOX_SEED_FOUNDING_SESSION_ID` similarly (payment mode,
  price `sound_buddy_founding_lifetime`).

Without those set, the corresponding `it`s report a skip and everything else
(mint via webhook, renewal via test clock, refresh rotation/supersede,
cancellation, refund, webhook hardening/replay, founding cap config, and the
decline/3DS/renewal-fail card paths) runs fully automated, no browser needed.

The founding cap (300 completed sessions) is verified by asserting the
Payment Link's `restrictions.completed_sessions.limit` via the Stripe API —
not by exhausting it with 300 real purchases.

Email delivery is asserted via `GET /api/license` (the authoritative check
per the acceptance criteria); the Resend API's list-emails check is
best-effort and degrades to a skip when the configured key is send-only (401
on read), which is the expected shape of the provisioned sandbox key.

### Security

Never log a minted `SB1.` string, key material, email addresses,
`.env.local` values, or raw webhook payload bodies — same rule as the rest of
this Worker (see the security note above). This suite touches **test mode
only**: every helper asserts `livemode === false` on the first Stripe object
it creates or reads and aborts the run if that ever fails.
