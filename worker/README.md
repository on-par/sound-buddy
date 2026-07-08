# sound-buddy-api (Cloudflare Worker)

Dedicated, isolated Worker for Sound Buddy's Stripe / licensing endpoints
(part of the Stripe launch epic, #123). It is deliberately **separate from the
marketing site** (`site/`, which stays assets-only) so payment and licensing
logic has its own home, deploy, and blast radius.

This package is MIT-licensed like everything outside `app/` — no proprietary
header required.

## Status

Scaffold (#107): routing and config only. The health check is implemented; the
Stripe webhook, license, and activation routes are declared and return `501`
until later stories fill them in.

## Routes

| Method | Path                   | Status                             |
| ------ | ---------------------- | ---------------------------------- |
| GET    | `/api/stripe/health`   | `200` — liveness probe             |
| POST   | `/api/stripe/webhook`  | `501` — placeholder (later story)  |
| GET    | `/api/license`         | `501` — placeholder (later story)  |
| GET    | `/activate`            | `501` — placeholder (later story)  |
| _any_  | anything else          | `404`                              |

A known path with the wrong method returns `405` with an `Allow` header.

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
