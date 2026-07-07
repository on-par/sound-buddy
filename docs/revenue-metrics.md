# Sound Buddy — Revenue Metrics

**Status:** MVP measurement plan. Operationalizes the financial reference in
[`revenue-model.md`](./revenue-model.md).
**Owner:** Patrick Robinson (product owner / financial lead).
**Purpose:** When the first payments come in, this is the answer to "how is Sound Buddy
doing financially?" — the five numbers to watch, where they come from, what the targets
are, and when to act.

Related: [#66 revenue metrics + targets](https://github.com/on-par/sound-buddy/issues/66) ·
[#63 GTM epic](https://github.com/on-par/sound-buddy/issues/63) ·
[#56 Stripe integration](https://github.com/on-par/sound-buddy/issues/56)

> **Before publishing:** Patrick to review and adjust the targets below. The numbers are
> carried over verbatim from the 2026-07-04 GTM consensus recorded in `revenue-model.md`.

---

## How we measure (and what we deliberately don't)

All data comes from **two external sources only: Stripe and GitHub.** There is **no
in-app telemetry, no usage tracking, and no custom analytics dashboard.** This is a
deliberate product decision, not a gap — "no audio data leaves your machine" is the
privacy-first positioning that drives word-of-mouth in the church market, and it applies
to usage data too. The Stripe dashboard plus the GitHub releases page are sufficient for
MVP.

Two consequences worth stating up front:

- **Trial activation is estimated, never measured.** We do not know how many people who
  download actually open the app. We infer it (see the metric below).
- **The app has no time-boxed trial.** It ships as a **free tier that fully works
  unlicensed**, with Pro features (e.g. the AI narrative, #54) gated behind a license
  key. "Trial activation" here means *first meaningful use of the free app*, not the
  start of a 14-day countdown — there is no such countdown in the license code.

---

## The five metrics

### 1. Downloads
- **What:** Total GitHub release downloads — the top-of-funnel proxy.
- **Source:** The public releases repo,
  [`on-par/sound-buddy-releases`](https://github.com/on-par/sound-buddy-releases/releases) —
  per-asset download counts via the release page or the GitHub releases API
  (`GET /repos/on-par/sound-buddy-releases/releases`, sum `assets[].download_count`).
- **Target:** **500 in the first 90 days; 2,500 in the first year** (5,000 optimistic).

### 2. Trial activations
- **What:** Estimated first launches of the app — people who downloaded *and* actually
  opened it. The middle of the funnel.
- **Source:** **Estimated, not measured** (no telemetry). Downloads × assumed activation
  rate. We assume **~60% of downloads open the app** (i.e. a ~40% bounce), consistent
  with `revenue-model.md`.
- **Target:** Derived from Downloads — ~300 activations in the first 90 days, ~1,500 in
  the first year at the 60% assumption. Treat as a modelling input, not a KPI to hit
  directly; the levers are Downloads (metric 1) and Conversion rate (metric 4).

### 3. Paid conversions
- **What:** Active paid subscriptions — monthly + annual.
- **Source:** **Stripe dashboard → active subscriptions count.** Read the monthly and
  annual counts separately; the split feeds MRR (metric 5) and the churn signal below.
- **Target:** 125 paid users at year one (conservative, 5% conversion) rising to 175
  (base, 7%) — see the scenario table in `revenue-model.md`. The
  [Lifetime / Founding License SKU (#90)](https://github.com/on-par/sound-buddy/issues/90)
  is **not** counted here and is valued at $0 in the model until it is priced.

### 4. Conversion rate
- **What:** Paid subscriptions ÷ estimated trial activations.
- **Source:** Metric 3 (Stripe) ÷ metric 2 (estimate). Because the denominator is an
  estimate, treat this as directional, not precise.
- **Target:** **≥5% conservative, ≥7% optimistic.**
- **Floor: 3%.** Sustained conversion below 3% is a **product/messaging** signal, not a
  pricing one. **Action (see the acceptance criteria):** if conversion stays below 3%
  for **two consecutive weeks**, investigate the **report card → upgrade flow**, *not*
  the price. The report card is the funnel; the price is already anchored at 1/15th of
  MxU and is not the constraint.

### 5. MRR (Monthly Recurring Revenue)
- **What:** Normalized monthly revenue across both plans.
- **Formula:** `(monthly active × $9) + (annual active × $79 / 12)`.
- **Source:** **Stripe dashboard** (the active-subscription split from metric 3, priced).
- **Targets:** **$500/mo by month 3, $1,500/mo by month 6, $3,000/mo by month 12.**

> **These MRR milestones are stretch targets, not the plan-of-record floor.**
> `revenue-model.md` reconciles them against the funnel math and shows the $500 month-3
> milestone is not reachable under the doc's own download/conversion assumptions, and
> that $3,000 at month 12 requires beating the optimistic scenario. Missing the month-3
> milestone is **not**, by itself, the sub-3%-conversion signal that triggers a funnel
> investigation. If actuals track the base case (~$1,300 MRR at month 12), that is on
> plan. See "Month-by-month targets" in `revenue-model.md`.

---

## Targets and thresholds at a glance

| Metric | Source | Target | Threshold / action |
|--------|--------|--------|--------------------|
| Downloads | GitHub releases | 500 in 90d · 2,500 in year 1 | Below pace → widen top-of-funnel (outreach #67) |
| Trial activations | Estimated (downloads × ~60%) | ~300 in 90d · ~1,500 in year 1 | Not a direct KPI — a modelling input |
| Paid conversions | Stripe active subs | 125 (5%) → 175 (7%) year 1 | Tracks against scenarios in `revenue-model.md` |
| Conversion rate | Stripe subs ÷ est. activations | ≥5% (≥7% optimistic) | **<3% for 2 weeks → investigate report-card → upgrade flow, not price** |
| MRR | Stripe (both plans, priced) | $500 (m3) · $1,500 (m6) · $3,000 (m12) | Milestones are stretch; base case ~$1,300 at m12 is the floor |

### Churn signal
- **Watch:** Monthly churn on **monthly** subscriptions (Stripe → cancellations ÷ active
  monthly subs). Annual churn is only observable at renewal.
- **Signal: >5% monthly churn = investigate product value.** Benchmark: Planning Center
  (a comparable church-market tool) runs <5% monthly churn; exceeding it means the
  product is not sticking.
- **Known tension:** `revenue-model.md` models ~30% monthly churn on the monthly cohort,
  which sits *above* this 5% alarm — so on the model's own assumptions the alarm is
  always tripped. This is an open reconciliation item (owner: Patrick): either the
  threshold or the modelled churn assumption needs to move before the signal is
  actionable. Do not treat a fresh-cohort churn reading above 5% as a fire drill until
  that is resolved.

---

## Review cadence

- **Weekly for the first 30 days post-launch.** Read all five metrics off Stripe +
  GitHub; watch for the conversion floor and early churn.
- **Monthly thereafter.** Same five metrics; compare MRR against the month-by-month
  pacing guide in `revenue-model.md` and re-assess targets quarterly.

---

## Out of scope (MVP)

Deliberately not built — revisit only with a concrete need:

- **In-app telemetry / usage tracking** — violates the privacy-first positioning.
- **Custom analytics dashboard** — the Stripe dashboard is sufficient for MVP.
- **Email drip / marketing-automation analytics** — defer to marketing tooling.
- **A/B test measurement infrastructure** — no pricing experimentation in year one.
- **Cohort analysis** — defer until >100 paid users, when cohorts become meaningful.
