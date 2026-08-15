# Waitlist email provisioning runbook (#609): Resend + required API keys

The human-provisioning steps for the waitlist confirmation email (#639) and
Resend Audience sync (#640) — `RESEND_API_KEY`, the verified sending domain for
`soundbuddy.online`, the sender identity, the audience id, and the manual
signup→email verification. Everything the code needs is already shipped and
tested; this runbook is the single source of truth for the remaining
out-of-band steps of #609. Each section maps to a line in the final checklist.

> The shared Stripe/Resend provisioning steps (KV ids, `wrangler secret put`
> patterns, Resend domain verification, `.env.local` / `.dev.vars`) live in
> `worker/docs/live-provisioning.md` — §6 (Cloudflare Worker bindings & secrets)
> and §7 (Resend). This runbook references those instead of duplicating them.

## 0. Status / what already ships in code

The waitlist email flow is fully implemented and merged. Nothing in the code
needs to be written — only provisioned:

| Issue | What ships | Where | Merged as |
| --- | --- | --- | --- |
| #599 | `POST /api/waitlist` route + `WAITLIST_KV` storage (validate → rate-limit → redact → store) | `worker/src/handlers/waitlist.ts` | `ec6f3f9` (PR #605) |
| #639 | Confirmation email `sendWaitlistConfirmationEmail` / `buildWaitlistConfirmationEmail` | `worker/src/delivery.ts` | `192fcff` (PR #644) |
| #640 | Resend Audience upsert `syncWaitlistContact` | `worker/src/delivery.ts` | `192fcff` (PR #644) |
| #641 | Waitlist consent copy + privacy-policy section | `site/src/components/WaitlistHome.astro`, `site/src/pages/privacy.astro` | `192fcff` (PR #644) |
| #642 | Beta-invite path `GET /api/waitlist/invitees` + `POST /api/waitlist/invite` | `worker/src/handlers/waitlist-invite.ts` | `98e8ef9` (PR #684) |

Evidence, from the squash-merge commits on `main`:

```bash
git log --oneline --grep='waitlist confirmation email'   # 192fcff
git log --oneline --grep='#599'                          # ec6f3f9
git log --oneline --grep='#642'                          # 98e8ef9
```

The confirmation email now carries `reply_to = SUPPORT_EMAIL` (added when #609
closed), so the copy's "Just reply" lands in the monitored support inbox rather
than defaulting to the from address. Delivery is **best-effort by design**: a
missing key, a Resend 500, or a thrown fetch is logged (outcome only — never
emails or payloads) and resolved `{ ok: false }`; the signup's KV row is the
source of truth, the sends go through `ctx.waitUntil`, and no Resend failure
can turn a stored signup into a user-visible error.

## 1. Secret: `RESEND_API_KEY`

The Worker reads `env.RESEND_API_KEY` for all Resend sends (license, dunning,
waitlist confirmation, audience sync). It is a **secret** and must only ever be
provisioned with `wrangler secret put` — never committed:

```bash
cd worker
wrangler secret put RESEND_API_KEY     # re_test_... first (test), then re_... (live)
```

Rules (normative):
- Use a **test** key (`re_test_...`) while pointing at the Resend test domain,
  then a **live** key (`re_...`) for production sends.
- `RESEND_API_KEY` may appear **by name** (this runbook, the `Env` interface in
  `worker/src/index.ts`, test fixtures) but **never as a value** — see the
  no-secret-in-repo scan in §7.
- The shared `wrangler secret put` pattern (paste when prompted, never into the
  repo) is in `worker/docs/live-provisioning.md` §6.

## 2. Verified sending domain

Resend requires the domain it sends from to be verified (SPF + DKIM), or the
emails bounce or land in spam. The DNS layer for `soundbuddy.online` is already
present per the 2026-07-21 issue audit comment — this step confirms and aligns
the records Resend needs:

1. In the Resend dashboard, add **`soundbuddy.online`** as a sending domain.
2. Add the two records Resend provides to the `soundbuddy.online` zone:
   - **SPF**: an `include:send.soundbuddy.online` TXT record on
     `soundbuddy.online` (resend-mail.org's include) — do not overwrite an
     existing `v=spf1 ...` line, merge the includes.
   - **DKIM**: the `resend._domainkey` TXT record (Resend's `dkim.soundbuddy.online`
     selector) on `soundbuddy.online`.
3. Confirm Resend shows **"Verified"** for the domain before sending live.
4. Align the existing `_dmarc.soundbuddy.online` record to a **monitored
   `p=none`** policy first, then tighten to `p=quarantine`/`p=reject` only once
   DKIM alignment is observed passing in real mail (§6).
5. Sanity-check the published records:
   ```bash
   dig +short TXT soundbuddy.online
   dig +short TXT resend._domainkey.soundbuddy.online
   ```

The same domain verification also covers `hello@soundbuddy.online` and
`support@soundbuddy.online` (both send from `soundbuddy.online`) — see
`worker/docs/live-provisioning.md` §7.

## 3. Sender identity + reply-to inbox

Two vars drive the confirmation email's envelope:

- **`FROM_EMAIL = hello@soundbuddy.online`** — the transactional sender, already
  set in `worker/wrangler.jsonc` `vars`. Must be a verified address on the
  verified domain (§2).
- **`SUPPORT_EMAIL = support@soundbuddy.online`** — already set in
  `worker/wrangler.jsonc` `vars`. The confirmation email's **`reply_to`** targets
  this address, and the copy's "Just reply, or write support@soundbuddy.online"
  points at it too.

`support@soundbuddy.online` must be a **real, monitored inbox** (mailbox or a
forwarding rule to a watched address) — confirm the MX/forwarding actually
delivers before trusting "Just reply":

```bash
dig +short MX soundbuddy.online
```

If the inbox does not receive mail, the "Just reply" promise in the
confirmation email is broken even though the email itself sends fine.

## 4. Audience id (optional)

The Audience sync (#640) mirrors every signup into a Resend Audience so
broadcasts, unsubscribe handling, and bounce processing live with the email
vendor. This is **optional and safe to skip**: `WAITLIST_AUDIENCE_ID` unset or
empty means the sync is skipped and logged, never failing a signup.

1. In the Resend dashboard, **Audiences → Create audience** (e.g.
   "Sound Buddy waitlist").
2. Copy the audience id (`<aud_...>`) into `worker/wrangler.jsonc` `vars`:
   ```jsonc
   "WAITLIST_AUDIENCE_ID": "aud_...",
   ```
3. Deploy (`npm run deploy`). The id is **not a secret** — it is inert without
   `RESEND_API_KEY` — so it lives in `vars`, not `wrangler secret put`.

## 5. Local dev (documented without a real value)

Local development needs the key by name; it never needs a real value committed.
The `.env.local` file is gitignored (`.gitignore` has `.env.local`):

```
# repo root .env.local — gitignored, never committed, never shared
RESEND_API_KEY=re_test_<paste your sandbox test key>
```

A `re_test_<...>` **placeholder** documents the shape without shipping a real
key. `wrangler dev` instead reads `worker/.dev.vars` (also gitignored via
`.env.*.local` — confirm it stays out of git):

```
# worker/.dev.vars — gitignored; paste your real test Resend key here
RESEND_API_KEY=re_test_<...>
```

For `wrangler dev` the dev server is pointed at the sandbox account — see the
"Sandbox e2e (manual gate)" prerequisites in `worker/README.md`, which use the
same `.env.local` + `.dev.vars` pair, and `worker/docs/sandbox-e2e.md` §1.
Without any key set, the worker still accepts signups (200 + stored row) and
logs `waitlist confirmation: RESEND_API_KEY not configured`.

## 6. Manual verification (signup → email)

This is the issue's Verification section — a human step, never a CI test:

1. Serve the marketing site waitlist form (`site/`) and submit a real address.
   The form posts to `POST /api/waitlist` (`worker/src/handlers/waitlist.ts`).
   Confirm the response is `200 { status: "ok" }`.
2. Confirm the confirmation email arrives at the submitted address, from
   **`hello@soundbuddy.online`** (verified domain, §2) with subject
   `You're on the Sound Buddy waitlist`, and that replying routes to
   **`support@soundbuddy.online`** (the `reply_to`, §3).
3. In the Resend dashboard **Logs/Send log**, confirm the send shows
   **Delivered** (not bounced).
4. Send a copy to an external mailbox and inspect the raw headers for aligned
   **SPF / DKIM / DMARC** — the mailcheck recommendation from the 2026-07-21
   issue audit comment. If DKIM is not aligned, fix the §2 records before
   tightening DMARC.

## 7. No-secret-in-repo scan

Run these after provisioning to prove no real Resend value landed in git:

```bash
# Only the gitleaks-allowlisted fixture placeholder may match — no re_... value.
git grep -nE 're_(test|live)_[A-Za-z0-9]{6,}'
# Allowlisted false positives only (see the allowlists in .gitleaks.toml).
gitleaks detect
```

Expected: the grep returns only `re_test_unused` (allowlisted in
`.gitleaks.toml`); `gitleaks detect` is clean. If any real `re_...` value shows
up, remove it from the repo immediately — it is a live credential.

## Checklist

Every line maps to an #609 acceptance criterion or in-scope bullet; the section
in parens is where to do it.

- [ ] Confirmation email + Audience sync confirmed merged in code (issue→PR→file map, §0)
- [ ] Confirmation email carries `reply_to = SUPPORT_EMAIL` (§0, §3)
- [ ] `RESEND_API_KEY` set via `wrangler secret put` — test `re_test_...` then live `re_...` (§1)
- [ ] `RESEND_API_KEY` never committed; may appear only by name (§1, §7)
- [ ] Resend domain `soundbuddy.online` verified: SPF include `send.soundbuddy.online` + `resend._domainkey` DKIM (§2)
- [ ] `_dmarc.soundbuddy.online` aligned with a monitored `p=none` before tightening (§2)
- [ ] `FROM_EMAIL = hello@soundbuddy.online` verified sender on the domain (§3)
- [ ] `SUPPORT_EMAIL = support@soundbuddy.online` is a real, monitored inbox; MX/forwarding delivers (§3)
- [ ] `WAITLIST_AUDIENCE_ID` set in `worker/wrangler.jsonc` `vars` (optional; empty = sync skipped + logged) (§4)
- [ ] Local dev documents `RESEND_API_KEY` by name only — gitignored `.env.local` template + `worker/.dev.vars` placeholder (§5)
- [ ] Manual signup→email verification: form 200, email from `hello@soundbuddy.online`, reply goes to `support@soundbuddy.online`, Resend log Delivered, external mailbox shows aligned SPF/DKIM/DMARC (§6)
- [ ] No-secret-in-repo scan clean: `git grep` shows only `re_test_unused`; `gitleaks detect` clean (§7)
