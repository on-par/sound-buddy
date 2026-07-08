# sound-buddy-api (Cloudflare Worker)

Dedicated, isolated Worker for Sound Buddy's Stripe / licensing endpoints
(part of the Stripe launch epic, #123). It is deliberately **separate from the
marketing site** (`site/`, which stays assets-only) so payment and licensing
logic has its own home, deploy, and blast radius.

This package is MIT-licensed like everything outside `app/` — no proprietary
header required.

## Status

Scaffold (#107) plus the Stripe webhook (#108). The health check and the webhook
are implemented; the license and activation routes are declared and return `501`
until later stories fill them in.

## Routes

| Method | Path                   | Status                             |
| ------ | ---------------------- | ---------------------------------- |
| GET    | `/api/stripe/health`   | `200` — liveness probe             |
| POST   | `/api/stripe/webhook`  | `200` — verify + idempotency (#108)|
| GET    | `/api/license`         | `501` — placeholder (later story)  |
| GET    | `/activate`            | `501` — placeholder (later story)  |
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

## Config & bindings

`wrangler.jsonc` declares:

- **Worker name** `sound-buddy-api` (distinct from the site's `sound-buddy`).
- **Routes** on `soundbuddy.online` for `/api/stripe/*`, `/api/license`,
  `/activate`.
- **KV** `LICENSE_KV` — namespace id is set out-of-band (H4); the checked-in
  value is a placeholder.
- **Vars** `FOUNDING_CAP`, `FROM_EMAIL`, `APP_ORIGIN`.

**Secrets** (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`LICENSE_SIGNING_PRIVATE_KEY`, `RESEND_API_KEY`) are **never** stored in this
repo — they are provisioned with `wrangler secret put` (H4).

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
