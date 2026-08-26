# Live-mode purchase & activation verification (#1216)

This is the **real live-mode** purchase gate, decomposed from #285. It is run
**once**, by a human with live Stripe access and Patrick's explicit
go-ahead — it makes a **real customer charge**. It exercises the one thing no
test or sandbox can: a hosted Checkout payment activated in a **packaged
(non-dev) build**, which is the only way to catch a mismatch between the
production signing key and the app-embedded public key.

## Security

Never paste `.env.local` values, Worker secrets, raw webhook bodies, buyer
email, or a minted `SB1.` key into this doc, a PR, chat, or logs — same
posture as [`sandbox-e2e.md`](./sandbox-e2e.md) §5.

## Gate / preconditions

This gate begins **only** after
[`live-mode-prerequisites-checklist.md`](./live-mode-prerequisites-checklist.md)
(#1215) reads all three rows `CONFIRMED`. If any row is `MISSING`, **stop** —
do not charge a real card; see that checklist's "Blocking rule + sign-off"
section for the follow-up.

Additional preconditions:

- A **packaged, non-dev build** of the app is available, built from a branch
  that contains the #564 embedded-production-key commit, and built with the
  live checkout Payment Link URLs injected at build time
  (`SOUND_BUDDY_CHECKOUT_FOUNDING_URL` / `SOUND_BUDDY_CHECKOUT_ANNUAL_URL`,
  resolved by `checkoutUrl` in `app/electron/checkout.ts`; env-only, fails
  loudly per ADR-0093). The in-app checkout button opens the live Payment
  Link; alternatively the human may open the live Payment Link URL directly.
- The live Worker is deployed with live secrets, per the #1215 checklist.

## The flow under test

- **Checkout** — real card, live founding `payment` mode or annual
  `subscription` mode → `cs_...` Checkout Session id.
- **Webhook** — Stripe delivers `checkout.session.completed` (founding) or
  `invoice.paid` (annual) to the live Worker `POST /api/stripe/webhook`;
  signature verified before any side effect.
- **Mint** — the Worker signs an `SB1.` lifetime or subscription key.
- **Email** — Resend delivers the key to the buyer within ~1 minute.
- **Retrieve** — from the email, or the `/activate?session_id=…` page served
  by `worker/src/handlers/activate.ts`.
- **Activate in packaged build** — paste the key into Sound Buddy → Settings
  → License; the app validates it against the embedded production public key
  (`verifyLicenseKey` → `licensePublicKey` in `app/electron/license.ts`).
- **Pro unlock** — Pro-only UI is visible and usable.

## Ordered steps

1. Confirm the #1215 checklist is all `CONFIRMED`; if not, **stop** — do not
   charge a real card.
2. Open the live founding **or** annual Payment Link (via the packaged
   build's checkout button or the direct URL) and complete payment with a
   **real card**. Capture the `cs_...` id (do not paste card data anywhere).
3. Confirm the license email arrives from Resend containing an `SB1.` key.
4. Enter the `SB1.` key into the packaged build's Settings → License.
5. Confirm the build activates without error and Pro-only UI elements are
   visible and usable.

## Results

| # | Acceptance criterion | Verified by | Expected | Result | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | License email arrives | Manual — real card completes the live founding/annual Payment Link | Resend email containing an `SB1.` key received | PENDING | |
| 2 | Packaged build unlocks Pro | Manual — key entered into the packaged (non-dev) build | Build activates without error; Pro-only UI visible and usable | PENDING | |

Legend: `PASS` / `FAIL`. Replace `PENDING` with the observed outcome during
the real run. A `FAIL` is recorded here and its fix tracked as a follow-up in
its originating story — this runbook is not the place to fix bugs it
uncovers.

## Recording & sign-off

The human executes this with Patrick's explicit go-ahead and records only
non-sensitive outcomes — never the key, card, or secrets.

Out of scope:

- Refunding the charge.
- Automating this purchase flow.
- Verifying or provisioning prerequisites (covered by #1215 and
  [`live-provisioning.md`](./live-provisioning.md)).

Cross-links: [`live-mode-prerequisites-checklist.md`](./live-mode-prerequisites-checklist.md),
[`live-provisioning.md`](./live-provisioning.md),
[`sandbox-e2e-test-plan.md`](./sandbox-e2e-test-plan.md).
