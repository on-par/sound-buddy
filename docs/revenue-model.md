# Sound Buddy — Year-One Revenue Model

**Status:** Agreed consensus from the #sound-buddy-dev GTM discussion, 2026-07-04.
**Owner:** Patrick Robinson (product owner / financial lead).
**Purpose:** The financial reference for the MVP launch. Every decision about pricing,
gating, and distribution should be checkable against this document.

Related: [#63 GTM epic](https://github.com/on-par/sound-buddy/issues/63) ·
[#66 revenue metrics + targets](https://github.com/on-par/sound-buddy/issues/66)

---

## Pricing

| Plan | Price | Who it's for |
|------|-------|--------------|
| Monthly | **$9/month** | The impulse buy — low-friction entry, below a Spotify family plan |
| Annual | **$79/year** | The church budget buy — maps to the annual expense cycle; saves $29 vs monthly (~3 months free) |

**Rationale and anchors:**

- **Anchored against MxU ($99–$349/month)** — Sound Buddy's cheapest tier is roughly
  1/15th of theirs. We are priced for the volunteer/small-church market MxU doesn't serve.
- **Dual pricing is deliberate.** Monthly captures hesitant buyers who won't commit $79
  up front; annual captures churches that budget yearly. Both serve real, distinct
  buying behaviors (see principle 4 below).
- Ship the agreed prices first; a pricing experimentation framework is explicitly out of
  scope for year one.
- **Not yet modeled: the Lifetime / Founding License SKU (#90).** The app's license
  validation already supports a `lifetime` key kind as a limited launch mechanic, but it
  has no agreed price and no treatment in the scenarios, refund reserve, or MRR formula
  below (which values lifetime sales at $0). Price it and fold it into this model before
  it ships.

## Cost structure

| Cost | Amount | Notes |
|------|--------|-------|
| AI inference | **$0** | User-supplied — local Ollama or the user's own API key via `pi`. The app never proxies AI requests. |
| Hosting | **$0** | GitHub releases for distribution, GitHub Pages for the landing page |
| Server infrastructure | **$0** | Desktop app, no backend |
| Stripe processing | 2.9% + $0.30/transaction | Plus ~0.5% Stripe Tax where registered |
| Apple Developer account | $99/year | Total, not per user |

- **Marginal cost per paid user: ~$2.60/year** for an annual buyer (the Stripe fee on a
  $79 purchase). A monthly subscriber costs more: 12 × (2.9% × $9 + $0.30) ≈
  **$6.73/year**, i.e. ~94% margin on the $9 tier.
- **Gross margin: ~96%** on annual, ~94% on monthly.

Zero inference cost is a **structural pricing moat**, not just a feature: competitors
who serve inference have costs that scale with usage; ours don't. That is why we can
sit at 1/15th of MxU's price and still run a ~96% margin.

## Merchant of record and US sales tax

- **Stripe is a payment processor, not a merchant of record.** We are the merchant of
  record and are responsible for US sales tax.
- At US-first launch we are **below economic nexus** (~$100k revenue or 200 transactions
  per state) in every state, so this is near-zero work today.
- **Plan:** enable Stripe Tax (~0.5%/transaction) and register per-state as we cross
  nexus thresholds.
- **Revisit a merchant-of-record provider (e.g. Paddle)** if/when we sell
  internationally or hit meaningful scale. (Paddle was evaluated and set aside — see
  closed #57.)

## Revenue scenarios (year one)

| Scenario | Downloads | Conv. rate | Paid users | Gross | Net |
|----------|-----------|-----------|------------|-------|-----|
| Conservative | 2,500 | 5% | 125 | $9,875 | ~$9,551 |
| Base case | 2,500 | 7% | 175 | $13,825 (mixed) | ~$13,180 |
| Optimistic | 5,000 | 7% | 350 | $27,650 | ~$26,744 |

- "Mixed" in the base case = 125 annual + 50 monthly-annualized. Monthly churn is
  modeled at 30% by month 6 with 4.2 average months of retention.
- The optimistic scenario models **all 350 users at the annual price** (350 × $79 =
  $27,650); it is not the base-case mix scaled up. Applying the base case's
  annual/monthly ratio to 350 users would give a materially lower gross.
- Net = gross minus Stripe fees (~$2.59 per annual transaction; 2.9% + $0.30 per
  monthly transaction).

## Conversion assumptions and targets

Metric definitions, data sources, and review cadence live in #66
(`docs/revenue-metrics.md` once that lands). The model assumes:

- **Downloads:** 500 in the first 90 days; 2,500 in the first year (5,000 optimistic).
- **Trial activation:** ~60% of downloads actually open the app (no telemetry — this is
  an estimate, not a measurement).
- **Conversion rate:** ≥5% conservative, ≥7% base/optimistic.
- **Conversion floor: 3%.** Sustained conversion below 3% signals a product/messaging
  problem — investigate the report-card → upgrade flow, **not** the price.
- **Churn signal:** >5% monthly churn on monthly subscriptions = investigate product
  value.

## Month-by-month targets (year one)

MRR targets ramp to the milestones agreed in #66: **$500 by month 3, $1,500 by
month 6, $3,000 by month 12.** The intermediate months below are interpolated from
those milestones — they are pacing guides, not commitments.

| Month | MRR target | Notes |
|-------|-----------|-------|
| 1 | $100 | Launch month — outreach to the first 200 engineers (#67) |
| 2 | $250 | |
| 3 | $500 | **#66 milestone** — ~500 downloads by now |
| 4 | $800 | |
| 5 | $1,150 | |
| 6 | $1,500 | **#66 milestone** — monthly-cohort churn stabilizes (~30%) |
| 7 | $1,750 | |
| 8 | $2,000 | |
| 9 | $2,250 | |
| 10 | $2,500 | |
| 11 | $2,750 | |
| 12 | $3,000 | **#66 milestone** — ~2,500 downloads cumulative |

MRR is computed as (monthly active × $9) + (annual active × $79 / 12), per #66.

**Reconciliation note:** the #66 MRR milestones are stretch targets relative to the
scenario table — at both ends of the year:

- **Month 3:** 500 downloads × 7% conversion = ~35 paid users, which yields at most
  ~$315 MRR (all-monthly) or ~$230 (all-annual). The $500 milestone is not reachable
  under the doc's own funnel assumptions; missing it at month 3 is **not** by itself
  the sub-3%-conversion signal that triggers the funnel investigation.
- **Month 12:** even the optimistic scenario (350 paid users) implies roughly
  $2,300–$2,550 MRR at year end depending on mix; $3,000 requires beating the
  optimistic case on downloads or conversion.

Treat the milestone column as the stretch goal and the base case (~$1,300 MRR at
month 12) as the plan-of-record floor. If actuals track the base case, that is on plan.

## Key financial principles

1. **The report card is the funnel, not the product.** Gate recurring-use features,
   never the acquisition engine.
2. **"Bring your own AI" is a feature, not a limitation.** It is a pricing moat —
   competitors who serve inference have costs that scale with usage; ours don't.
3. **Privacy is a sales advantage in the church market.** "No audio data leaves your
   machine" is word-of-mouth distribution we don't pay for.
4. **Annual = the church buy, monthly = the impulse buy.** Both options stay; they
   serve different buying behaviors.
5. **Option A gating.** Unlock UI features; the user supplies the AI. Never eat
   inference cost.

## Refund policy and reserve

- **30-day full refund, no questions asked.**
- **Reserve: 5% of gross revenue** held against refunds.
- Expected refund rate: **<5%**, based on comparable indie Mac apps.

## Known inconsistencies to reconcile

The figures above are recorded verbatim from the 2026-07-04 consensus. Recomputing the
model from its own stated assumptions surfaces contradictions that need an explicit
decision (owner: Patrick) rather than a silent rewrite:

1. **Base-case gross vs monthly retention.** $13,825 values all 175 users at
   $79/year (175 × $79), but the stated 4.2-month average retention prices the 50
   monthly users at ~$37.80 each (50 × $9 × 4.2 ≈ $1,890, not $3,950). Honoring the
   retention assumption gives ~$11,765 gross.
2. **The churn assumption is not internally coherent.** 30% *monthly* churn implies
   ~3.3 average months of retention; 30% *cumulative by month 6* implies ~17 months.
   Neither reading produces the stated 4.2 months. Pick one definition.
3. **The churn alarm is below the modeled churn.** The >5%-monthly-churn signal
   (from #66) is permanently tripped by the model's own ~30% assumption — as written,
   the plan-of-record always alarms. The threshold or the assumption needs to move.
4. **Base-case net (~$13,180) is not reproducible** from the stated fee model
   (recomputed fees are ~$442–$570, implying net ~$13,255–$13,383). Document the fee
   derivation or adjust the figure.

## Caveats and boundaries

- All figures are **pre-sweat-equity**. Patrick's time is the largest hidden cost and
  is deliberately not modeled.
- The model assumes **no paid marketing**. If paid acquisition is added later, CAC must
  stay **under $15** to preserve unit economics at $9/month.
- Out of scope for this document: investor projections beyond year one, a detailed P&L,
  tax strategy beyond the merchant-of-record/nexus plan above, and pricing
  experimentation.
