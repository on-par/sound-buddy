# Live-mode prerequisites checklist (#1215)

This checklist gates the #285 manual live-purchase test (decomposed from
#285). It is run **once**, by a human with Stripe and Cloudflare access,
**immediately before** the purchase gate begins. Its only job is to confirm
three prerequisites are actually in place before a real customer charge is
made — it does not perform the purchase, automate the check, or provision
anything that's missing.

Cross-link: the runbook that provisions these prerequisites is
[`worker/docs/live-provisioning.md`](./live-provisioning.md) (§5, §6, §10).

**Security:** never paste secrets, `.env.local` values, or minted `SB1.` keys
into this doc, a PR, or chat — same posture as
[`sandbox-e2e.md`](./sandbox-e2e.md) §5.

## Prerequisite 1 — Live-mode Stripe configuration is provisioned

**Source of truth:** the Stripe dashboard in **Live** mode on the dedicated
account `acct_1Tv0wcF8DNgPKMma`, plus the deployed live Worker secrets
(live-provisioning.md §0, §10).

**How to confirm:**
- The dashboard "Test mode" toggle is **off**, and the three Products/Prices
  (`sound_buddy_pro_monthly`, `sound_buddy_pro_annual`,
  `sound_buddy_founding_lifetime`) and three Payment Links exist in Live, with
  the Founding link capped at 300 completed sessions (matching
  `FOUNDING_CAP` in `worker/wrangler.jsonc`) — live-provisioning.md §10 steps
  2–3.
- The live webhook is registered at
  `https://soundbuddy.online/api/stripe/webhook` (§10 step 3), and the Worker
  carries the **live** `STRIPE_SECRET_KEY` (`sk_live_...`) and live
  `STRIPE_WEBHOOK_SECRET` (`whsec_...`) — confirm the secrets exist with
  `cd worker && wrangler secret list` (§10 step 4). Do **not** print secret
  values.

## Prerequisite 2 — Production Ed25519 signing key ceremony is complete

**Source of truth:** the Worker deployment config for the live signing key
(live-provisioning.md §5, §6).

**How to confirm:**
- `LICENSE_SIGNING_PRIVATE_KEY` is set as a deployed Worker secret
  (`cd worker && wrangler secret list` shows it) and is the private half of
  the embedded public key — do not echo it.
- `worker/wrangler.jsonc` declares `LICENSE_SIGNING_KID` = `sb-sign-2026-08`
  and `LICENSE_PUBLIC_KEY` = the production SPKI body
  (`MCowBQYDK2VwAyEAE3n7W2BjebrXMomCqgbA3ozIrfij8ahQB7Q/kHJVA7c=`).
- Roundtrip proof (private ↔ public match): the sign-then-verify check in
  live-provisioning.md §6 step 2 — mint an `SB1.` key with
  `scripts/license-keygen.mjs sign … --kid sb-sign-2026-08` and verify it
  against `$HOME/SoundBuddy-keys/license-pub.pem`.

## Prerequisite 3 — Embedded public key + license-verification changes are merged to the packaged-build branch

**Source of truth:** git log on the branch the release build is cut from
(normally `main`).

**How to confirm:**
- `app/electron/license.ts`'s `EMBEDDED_PUBLIC_KEY_PEM` (line 54, used by
  `createPublicKey` at line 110) is the **production** key body, not the
  retired DEV key — the same base64 as `wrangler.jsonc`'s
  `LICENSE_PUBLIC_KEY`.
- The regression guard is present and green:
  `app/electron/license.test.ts` → "the embedded key is the production key,
  not the retired DEV key (#564)". Command:
  `cd app && npx vitest run electron/license.test.ts`.
- `git log --oneline main -- app/electron/license.ts worker/wrangler.jsonc`
  shows the #564 key-embedding commit is merged into the build branch (not
  only on a feature branch). The packaged build must be cut from a branch
  that contains this commit — do not invent a commit SHA here; run the `git
  log` command above to locate the actual merged commit.

## Results

| # | Prerequisite | Source of truth | How confirmed | Status | Notes |
|---|---|---|---|---|---|
| 1 | Live-mode Stripe configuration is provisioned | Stripe dashboard (Live mode, `acct_1Tv0wcF8DNgPKMma`) + live Worker secrets | `wrangler secret list`; dashboard Products/Prices/Payment Links/webhook | PENDING | |
| 2 | Production Ed25519 signing key ceremony is complete | Worker deployment config (`wrangler.jsonc`, deployed secrets) | `wrangler secret list`; sign/verify roundtrip (§6 step 2) | PENDING | |
| 3 | Embedded public key + license-verification changes are merged to the packaged-build branch | git log on the build branch; `license.test.ts` regression guard | `git log`; `npx vitest run electron/license.test.ts` | PENDING | |

Legend: `CONFIRMED` — verified against its source of truth. `MISSING` —
verified absent or not yet in place. Replace `PENDING` with the observed
outcome during a real run.

## Blocking rule + sign-off

The #285 purchase gate begins **only** when all three rows above read
`CONFIRMED`. Any `MISSING` row **blocks** the gate — do not start the manual
purchase. Instead, flag the missing item as a follow-up in its originating
story:

- Live-mode Stripe missing → `worker/docs/live-provisioning.md` §10 (#564).
- Signing-key custody missing → `worker/docs/live-provisioning.md` §5/§6
  (#564).
- Embedded-key merge missing → the #564 key-embedding PR.

This checklist does not fix or provision a missing prerequisite — it only
records status and stops the gate. Executed by a human, and the factory needs
Patrick's explicit go-ahead before anything touching the Stripe launch moves.
