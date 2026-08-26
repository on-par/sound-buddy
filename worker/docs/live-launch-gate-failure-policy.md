# Live-mode launch gate — failure-handling policy (#1218)

This is the failure-handling rule for the #285 live-mode launch gate, decomposed
from #285. It applies across all three gate runbooks —
[`live-mode-prerequisites-checklist.md`](./live-mode-prerequisites-checklist.md)
(#1215), [`live-purchase-verification-plan.md`](./live-purchase-verification-plan.md)
(#1216), and [`live-refund-verification-plan.md`](./live-refund-verification-plan.md)
(#1217). This gate is a **hard gate**: because a license-activation failure
directly affects paying customers, a failure at any step **stops the launch
process** — it is not logged as a follow-up note and left to continue.

**Security:** never paste secrets, `.env.local` values, minted `SB1.` keys,
buyer email, or raw webhook bodies into this doc, the P0 issue, a PR, or chat —
same posture as [`sandbox-e2e.md`](./sandbox-e2e.md) §5.

## What counts as a failure

- Any `MISSING` row in the #1215 prerequisites checklist Results table (see
  that doc's Legend).
- Any `FAIL` result in the #1216 or #1217 Results tables (see each doc's
  Legend).

## Rule 1 — Hold all public launch posts

When a failure is identified, **all public launch posts are held pending
resolution.** Public launch posts are tracked in
[`../../docs/distribution-outreach-plan.md`](../../docs/distribution-outreach-plan.md)
→ **"Rollout schedule"**, specifically **Phase 1 — Soft launch** onward
(forum, Reddit, and Facebook posts) and every later public phase. No new
public launch post goes out, and any in-progress phase pauses, until the
failure is resolved.

## Rule 2 — File a P0 issue before any retry

When the failure is documented, a **P0 issue describing the failure must be
filed before any retry** of the failed step. P0 is this repo's top priority
tier (as used in
`docs/epics/e410-hyper-critical-architecture-analysis-tech-debt-register.md`).
The issue names the failed step (which runbook + which acceptance criterion),
the observed outcome, and links back to #285 — following the same
non-sensitive-only recording posture as the gate runbooks: never paste keys,
card data, secrets, buyer email, or raw webhook bodies into the issue.

## Order of operations

1. Record the `FAIL`/`MISSING` in the failing runbook's Results table, as
   those docs already instruct.
2. Apply Rule 1 — hold all public launch posts.
3. Apply Rule 2 — file the P0 issue.
4. Only after the P0's fix has landed may the step be retried.

Diagnosing/fixing the underlying failure and performing the purchase/refund
steps themselves are out of scope here — they live in the gate runbooks and
the P0's own story.

## Cross-links

- [`live-mode-prerequisites-checklist.md`](./live-mode-prerequisites-checklist.md) (#1215)
- [`live-purchase-verification-plan.md`](./live-purchase-verification-plan.md) (#1216)
- [`live-refund-verification-plan.md`](./live-refund-verification-plan.md) (#1217)
- [`live-provisioning.md`](./live-provisioning.md)
- [`../../docs/distribution-outreach-plan.md`](../../docs/distribution-outreach-plan.md)
