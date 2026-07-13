# Sound Buddy — Launch Plan: First Paying Customer by July 31, 2026

**Written:** 2026-07-11 · **Owner:** Patrick (human gates) + AI agents (everything else)
**Goal:** ≥1 stranger pays real money by July 31. Stretch: 5–10 founding customers.
**Tracking:** GitHub milestone `First Paying Customer (Jul 31)` — every work item is an issue.

Inputs: launch-readiness code audit + channel research (2026-07-11, subagent reports), round-2
market research (2026-07-11), `docs/revenue-model.md`, tracker state as of #282.

---

## 1. Strategic verdict

**The product is launchable and the market gap is real. The binding constraint is not
engineering — it is (a) ~6 human provisioning actions and (b) distribution execution that
has not started.** Every engineering item on the critical path is hours, not days.

### Market fit, honestly assessed

- **The white space is legibility, not measurement.** REW is free but demands DSP literacy;
  Smaart is ~$1,299 and aimed at pros. Nobody sells "is this good, and what do I do about
  it on my console" to volunteers. Sound Buddy is a **coaching/feedback product**, not a
  measurement product — it competes for the *training* budget, not the *test-gear* budget.
- **The budget line already exists.** MxU charges churches $99–$349/month for volunteer
  training. That is proof churches fund "make our volunteers better." Sound Buddy delivers
  an automated slice of that value at 1/15th–1/40th the price. (Position MxU as category
  proof, never as a measurement-price comparison — see #260.)
- **The wedge pain is volunteer ramp-up:** 6–12 months before a volunteer mixes solo;
  inconsistency and lack of feedback drive burnout (ChurchTechArts, ProSoundWeb, Behind
  The Mixer all independently). Instant, consistent, non-judgmental feedback attacks the
  stated cause. This is the story to tell in every channel.
- **Category validation:** Mixing Station ($5–15, 1M+ installs) proves this exact audience
  pays small money for a focused third-party tool that respects their workflow.
- **Honest constraints:** macOS-26/Apple-Silicon-only cuts addressable reach (Windows holds
  ~56% of the broader audio-production market; no church-specific data). Not fixable in 20
  days — target Mac-owning techs explicitly and move on. Grade credibility is the other
  standing risk: one experienced tech publicly dunking on a miscalibrated grade in a 65k+
  member Facebook group is the nightmare scenario. Mitigations shipped (why-this-grade,
  targets, determinism harness); frame launch posts as "built with church techs, feedback
  wanted," never "perfect grader."

### Offer strategy: lead with Founding Lifetime ($199)

Church purchasing reality (researched): petty-cash/single-approver reimbursement for
purchases under ~$200–300 is standard church financial policy. A volunteer can expense
$199 once far more easily than committing the church to a recurring line item that needs
annual budget re-justification. Therefore through July:

- **Hero offer = $199 Founding Lifetime, capped at 300** (mechanic already shipped:
  #111/#120). Cap = urgency + bounded cannibalization (revenue-model.md).
- $9/mo and $79/yr stay visible as anchors that make $199 read as the obvious deal.
- **The trial IS the product's aha:** free analysis of *your own* service recording, 14-day
  offline Pro trial with zero server interaction (verified working today). Every post and
  email sells the free first analysis, not the purchase.

---

## 2. Critical path (from the code audit)

The purchase flow is fully wired app-side; only placeholder strings and un-provisioned
infrastructure remain. Earliest realistic pay date: **Jul 14–15 unsigned / Jul 17–20
signed.** Either clears Jul 31 — *if* the human gates start immediately.

### Human gates (Patrick only — ordered by lead time, start all this weekend)

| # | Gate | Lead time | Unblocks |
|---|---|---|---|
| H-A | **Apple Developer enrollment** ($99, org verification 24–48h+) | Longest — start first | #53 signing/notarization |
| H-B | **Stripe live mode** + create products/prices/payment links ($9/$79/$199 w/ 300-cap) | Hours–days (business verification) | #116, site founding CTA |
| H-C | **Resend domain verification** (SPF/DKIM DNS on soundbuddy.online) | Minutes–hours + propagation | license email #114, dunning #118 |
| H-D | **Cloudflare prod deploy**: LICENSE_KV namespace, 4 secrets, `npm run deploy` | ~2h | entire worker |
| H-E | **Ed25519 keypair ceremony** (`scripts/license-keygen.mjs`): private → worker secret, public → app | <1h, must be done carefully | #115 |
| H-F | **One manual live purchase → activate dry run** (real card, emailed SB1 key, packaged build) | 30 min | Public launch gate |

**H-F is the single most important non-obvious step.** The key-mismatch failure mode
(app's embedded public key ≠ worker's live signing key) silently rejects every real
license while all tests stay green. One real end-to-end purchase substitutes for the
missing automation (#139/#140) for a first-customer goal. **Do not point strangers at the
checkout until H-F passes.**

### Signing decision

Signed launch (~Jul 17–20) is strongly preferred: macOS Sequoia+ removed right-click→Open,
so unsigned means walking every skeptical volunteer through System Settings → "Open
Anyway" at the moment of highest intent. Fallback if Apple drags: unsigned launch with a
corrected install walkthrough (note: `release.sh` release notes still say right-click→Open
— outdated and must be fixed either way).

---

## 3. Distribution plan (from channel research)

Concentrated, identifiable channels. Creator lead times run 1–3 weeks — **outreach emails
are the most time-critical action of the entire plan and go out by Mon Jul 13.**

| Priority | Channel | Action | Why |
|---|---|---|---|
| 1 | **Church Sound Podcast / Attaway Audio** (James Attaway) + **Behind The Mixer** (Chris Huff) | Personal email by Jul 13: free founding license, offer honest look/demo | Podcast already runs vendor sponsors (DiGiCo, Shure) — proven receptive; single highest-leverage lever |
| 2 | **Church Sound & Media Techs** FB group (~65–78k) | Join now, read rules, DM admins for permission; build-in-public story post w/ free-analysis angle, Tue–Thu window | Largest exact-fit audience; permission-first or it gets deleted |
| 3 | **Gearspace New Product Alert** | Email press desk w/ images+links | Documented, explicit vendor-can-post process — cleanest channel found |
| 4 | **ProSoundWeb Church Sound forum** | Intro thread under real name | High-intent, technical, credible |
| 5 | **Church Production Magazine** | Pitch review (info@churchproduction.com) | Standing review category; longer lead, seeds August |
| 6 | Church Tech Discord + faith.tools directory | Join/participate; submit listing | Low effort, background credibility |
| — | r/livesound, r/churchtech, Planning Center forums | Skip for launch | Self-promo bans / don't exist / wrong audience |

**Conversion math (sanity check, not a promise):** 500–2,000 landing visitors if FB post +
one creator mention land → 10–20% try the free analysis (the offer *is* the trial) →
50–300 analyses → 5–15% buy founding within window → **~5–30 paying customers; low end
achievable on the FB post alone.** Failure modes actively managed: FB rules block post
(fallbacks: Gearspace/forums/creators), Gatekeeper friction (signing or walkthrough),
creator non-response inside window (email day 1, not day 10).

---

## 4. 20-day schedule

**Phase 0 — Provision (Jul 11–13, this weekend)**
Patrick: start H-A + H-B immediately; H-C/H-D/H-E as they unblock.
AI: fix release.sh install copy, #260 MxU correction, draft all outreach emails + FB/forum
posts, storyboard demo video, launch-assets issue work begins.

**Phase 1 — Wire & verify (Jul 14–18)**
AI: #116 + #115 swaps the moment H-B/H-E land; worker deployed; #140/#141 verification;
#53 pipeline wiring when Apple approves; ship #259 (vs-last-time delta — the retention
hook the paid card already promises) and #263 (surface save-as-target-curve).
Patrick: H-F manual live dry run — **launch gate**. Send creator emails Jul 13–14.
Site: founding-hero emphasis pass on pricing section.

**Phase 2 — Launch & iterate (Jul 19–31)**
Public posts in Tue–Thu windows (primary: Jul 21–23). Daily funnel check (Stripe dashboard
+ release download counts + Cloudflare analytics — no GA, consistent with privacy brand).
AI iterates same-day on any observed funnel blocker; follow-ups to creators/press; beta
teams (#72) personally invited to founding offer. If zero conversions by Jul 27: direct
1:1 outreach to every free-analysis user via the feedback channel + consider extending
founding window messaging (cap stays).

---

## 5. AI leverage map (100% AI-driven execution)

- **Claude Max 20x (primary):** `factory` / `auto-ship-it` skills drive every launch-blocking
  code issue to merged PR (#115, #116, #140, #141, #53 wiring, #259, #260, #263); Fable
  session (this one) owns strategy, review gates, and daily launch-window ops; subagents
  (opus/sonnet) produce outreach drafts, launch copy, demo-video script, and post-launch
  funnel analysis.
- **ChatGPT plan:** Codex CLI second-opinion reviews on the licensing-critical diffs
  (`codex` skill) — cheap adversarial check on the one path where a silent bug costs real
  customers' money.
- **Ollama:** dogfood the in-app "AI Engineer" narrative with llama3.2 before recording the
  demo video — the "works with the AI you already have" claim gets shown, not told.
- **Human-only:** the six H-gates, the live dry run, and hitting Send on community posts
  under Patrick's real name (per forum norms and basic authenticity).

## 6. Risk register (ranked)

1. **Key mismatch silently rejects real licenses** → H-F manual dry run is a hard launch gate.
2. **Apple enrollment drags past Jul 18** → unsigned fallback: corrected walkthrough + 30-sec
   install GIF; signing ships as v-next update (updater already checks releases).
3. **Distribution window whiffs** (no creator response, FB post blocked) → 6 parallel
   channels; emails sent day 1; Gearspace NPA is permission-guaranteed.
4. **Grade credibility attack in public thread** → humble framing, why-this-grade breakdown
   shipped, respond-fast posture during launch week (AI drafts, Patrick posts).
5. **Stripe live verification delay** → start H-B this weekend; nothing else on the payment
   path has external lead time.

---

*Issue map: milestone `First Paying Customer (Jul 31)`. Human gates tracked in the launch
runbook issue; code blockers are the existing #115/#116/#140/#141/#53 plus launch-asset and
outreach-execution issues filed 2026-07-11.*
