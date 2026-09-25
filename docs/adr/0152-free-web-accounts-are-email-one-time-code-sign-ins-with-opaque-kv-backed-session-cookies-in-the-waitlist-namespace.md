# Free web accounts are email one-time-code sign-ins with opaque KV-backed session cookies in the waitlist namespace

- Status: Accepted
- Date: 2026-09-25

## Context

The 2026-09-25 product lock (#1518) makes the Free browser tier a signed-in product: upload +
analyze (#1526) and the 5/month cap are per account. No auth existed anywhere in site/ or worker/
to reuse. The site ships a strict `script-src 'self'` / `connect-src 'self'` CSP, the API worker
is reached same-origin via soundbuddy.online custom-domain routes, email already goes through
Resend, and the factory cannot provision new Cloudflare KV namespaces or secrets. SSO is out of
scope. The pending analyze action (a selected File object) must survive sign-in.

## Decision

Free web accounts sign in with a 6-digit one-time code emailed via Resend (POST /api/auth/start,
POST /api/auth/verify); there are no passwords, magic links, or third-party identity providers.
A successful verify issues a random 32-byte opaque token in an `sb_session` cookie (HttpOnly,
Secure, SameSite=Lax, Path=/api, 30-day Max-Age). The worker stores only SHA-256 hashes of codes
and tokens, in WAITLIST_KV under the `auth:otp:`, `auth:session:` and `rl:auth:` prefixes, with KV
expirationTtl as the sole expiry mechanism (code 10 minutes, session 30 days). `readSession` in
worker/src/handlers/auth.ts is the one function any Free-tier endpoint uses to decide who the
caller is; account identity is the lowercased email. /api/auth/start never reveals whether an
email has signed in before.

## Consequences

Positive: no new vendor, secret, CSP change, or KV provisioning; the user never leaves the page, so
the file they picked is analyzed right after sign-in; sessions are revocable by deleting a KV key.
Negative: KV is eventually consistent, so the attempt counter and rate limits are best-effort, not
a hard security boundary; the waitlist namespace now holds two concerns and any future list() over
it must stay prefix-scoped; there is no sliding renewal — a session ends 30 days after sign-in.
Moving to a dedicated namespace later is a key-prefix migration, not a protocol change.

## References

- [Issue #1525 — Free browser: auth gate](https://github.com/on-par/sound-buddy/issues/1525)
- [Epic #1518 — sellable wedge / product lock](https://github.com/on-par/sound-buddy/issues/1518)
