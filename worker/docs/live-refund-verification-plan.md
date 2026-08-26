# Live-mode refund verification (#1217)

This is the **real live-mode** refund gate, decomposed from #285. It is run
**once**, by a human with live Stripe access and Patrick's explicit
go-ahead — it refunds the **one real charge** created by
[`live-purchase-verification-plan.md`](./live-purchase-verification-plan.md)
(#1216). It exercises the one thing no test or sandbox can: a real
`charge.refunded` event against the live Worker, proving it does not disturb
the license already activated in a packaged (non-dev) build.

## Security

Never paste `.env.local` values, Worker secrets, raw webhook bodies, buyer
email, the `cs_...`/`ch_...` ids beyond what's needed, or a minted `SB1.` key
into this doc, a PR, chat, or logs — same posture as
[`sandbox-e2e.md`](./sandbox-e2e.md) §5. The handler itself follows the same
rule: it logs event ids, charge ids, and outcomes only — never the payload,
email, or KV values.

## Gate / preconditions

This gate begins **only** after
[`live-purchase-verification-plan.md`](./live-purchase-verification-plan.md)
(#1216) has completed with a real charge and an activated license in a
packaged build. If #1216 has not completed, **stop**.

Additional preconditions:

- The #1216 purchase was completed and its `SB1.` key is **already
  activated** in a packaged (non-dev) build, with Pro-only UI visible — this
  is the state whose survival is being verified.
- The live Worker is deployed with live secrets and its logs are reachable
  via `wrangler tail` (run from `worker/`), and `LICENSE_KV` is inspectable
  via `wrangler kv key get`.
- You have the `ch_...` charge id (or the `cs_...`/payment from #1216) needed
  to locate the charge in the Stripe **Live** dashboard.

## The behavior under test

Grounded in `worker/src/handlers/charge-refunded.ts`:

- Stripe delivers `charge.refunded` to the live Worker
  `POST /api/stripe/webhook`; the signature is verified before any side
  effect, and per-event idempotency (`evt:<id>`) is owned by the webhook
  dispatcher, so a replay never double-records.
- `handleChargeRefunded` writes a single KV entry under `refund:<charge_id>`
  in `LICENSE_KV` — a `RefundRecord` (`chargeId`, `amountRefunded`,
  `currency`, optional `reason`/`email`, `followUp: true`, `refundedAt`) —
  and logs `charge.refunded <event.id>: recorded refund for <charge.id>
  (follow-up)`.
- It takes **no entitlement action**: no key is minted, mutated, or revoked.
  Offline lifetime keys cannot be revoked after refund (Decision 3 gap),
  bounded by the 300 founding cap. Therefore the previously activated license
  is **expected to stay valid and Pro-unlocked** — that is the expected
  behavior this runbook's acceptance criteria refer to.

## Ordered steps

1. Confirm #1216 completed with an activated license in the packaged build;
   if not, **stop**.
2. In the Stripe **Live** dashboard, open the #1216 charge and issue a full
   refund. Do not paste card data or secrets anywhere.
3. In a terminal at `worker/`, tail the live Worker logs (`wrangler tail`)
   and confirm the line `charge.refunded <event.id>: recorded refund for
   <charge.id> (follow-up)` appears.
4. Confirm the refund record exists:
   `wrangler kv key get --binding LICENSE_KV refund:<charge_id>` returns a
   JSON `RefundRecord` with `followUp: true` (do not paste any email field
   from it into the doc/PR).
5. Reopen the packaged build → Settings → License and confirm the previously
   activated license is **still valid** and Pro-only UI is still visible and
   usable — i.e. no revocation or corruption occurred.

## Results

| # | Acceptance criterion | Verified by | Expected | Result | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | Refund is recorded | Manual refund in the Stripe Live dashboard | `charge.refunded` logged and a `refund:<charge_id>` KV record with `followUp: true` | PENDING | |
| 2 | License state unaffected | Reopening the packaged build | Previously activated license still valid, Pro features still unlocked (state change, if any, matches the no-entitlement-action behavior documented above) | PENDING | |

Legend: `PASS` / `FAIL`. Replace `PENDING` with the observed outcome during
the real run. A `FAIL` here is a gate failure — record it, then follow
[`live-launch-gate-failure-policy.md`](./live-launch-gate-failure-policy.md):
hold all public launch posts and file a P0 issue before any retry. This
runbook is not the place to fix bugs it uncovers.

## Recording & sign-off

The human executes this with Patrick's explicit go-ahead and records only
non-sensitive outcomes — never the key, card, or secrets.

Out of scope:

- Performing the original purchase (covered by #1216).
- Automating the refund step.
- Testing refunds for charges other than this test charge.

Cross-links: [`live-purchase-verification-plan.md`](./live-purchase-verification-plan.md),
[`live-mode-prerequisites-checklist.md`](./live-mode-prerequisites-checklist.md),
[`live-provisioning.md`](./live-provisioning.md),
[`sandbox-e2e-test-plan.md`](./sandbox-e2e-test-plan.md),
[`live-launch-gate-failure-policy.md`](./live-launch-gate-failure-policy.md).
