# Revenue metrics and targets

Canonical reporting reference for launch revenue, tracked per
[#1194](https://github.com/on-par/sound-buddy/issues/1194). **Stripe's own dashboard and
reports are the single source of truth** — there is no custom analytics tooling and no
in-app telemetry for revenue. Every metric below is read directly from Stripe. For
background on how checkout, subscriptions, and license provisioning work, see
[`docs/epics/e56-stripe-checkout-integration.md`](epics/e56-stripe-checkout-integration.md).

## Metrics tracked

| Metric | Definition | Where in Stripe |
|---|---|---|
| Paid users | Count of customers with an active paid entitlement: active subscriptions plus any one-time/founding lifetime purchases. | Dashboard → **Billing → Subscriptions** for the active subscription count, plus **Payments** filtered to the founding product/price for one-time purchases. |
| MRR (Monthly Recurring Revenue) | Normalized monthly subscription revenue. | Dashboard → **Billing → Overview** (Stripe's built-in MRR metric). One-time/founding lifetime purchases are **not** MRR and are tracked separately as one-time revenue. |
| Refund rate | Refunded amount ÷ gross charged amount over the period. | Dashboard → **Payments → Refunds** (or **Reports** → financial reports refund totals). |
| Net revenue | Gross revenue minus refunds and Stripe processing fees over the period. | Dashboard → **Reports → Financial reports** (net volume / balance summary). The launch targets below apply a **5% refund reserve** on top of Stripe's own reported net. |

## Weekly review cadence

Run this checklist **weekly**, entirely from the Stripe dashboard — no custom tooling
required:

1. Open the Stripe Dashboard and set the date range to the last 7 days / month-to-date.
2. Record current **paid users** (active subscriptions + founding one-time purchases).
3. Record **MRR** from **Billing → Overview**.
4. Record **refund rate** from **Payments → Refunds**.
5. Record **net revenue** from **Reports → Financial reports**.
6. Compare against the target thresholds below and note whether the trajectory is on
   track for the 200-user and 500-user milestones.

## Targets

| Milestone | Paid users (per year) | Net revenue (at 5% refund reserve) |
|---|---|---|
| Milestone 1 | 200 paid users/yr | ≈ $15.3k net |
| Milestone 2 | 500 paid users/yr | ≈ $38.2k net |

Both figures are **net of a 5% refund reserve**. The implied net revenue per paid user
(~$76/yr) is what the weekly review compares actual net revenue against — for context,
plan prices are $9/mo and $79/yr (see the completion record linked above).
