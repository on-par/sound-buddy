# Distribution outreach plan

Canonical plan for reaching church audio engineers, tracked per
[#1195](https://github.com/on-par/sound-buddy/issues/1195). Per the CFO review, the
primary launch bottleneck is **product and distribution reach, not price** — this doc
sets a tracked target of **200 engineers reaching the report-card moment** and names
the channels, messaging, and schedule to get there. It is the distribution sibling of
[`docs/revenue-metrics.md`](revenue-metrics.md) (#1194): revenue is read from Stripe,
outreach engagement is read from the landing site's existing analytics.

Out of scope: paid advertising spend, a CRM or lead-tracking system, and hiring sales
or marketing staff.

## The report-card moment (what we're tracking)

The **report-card moment** is the point where an engineer first sees a Sound Buddy
report card — a graded reading of their own mix. It's the landing page's aha moment:
the instant a vague "the vocals felt buried" turns into a specific, actionable grade.

Progress toward the target is counted from the site's existing **Cloudflare Web
Analytics** — cookieless, sets no cookies, no cross-site tracking (see
[`site/src/pages/privacy.astro`](../site/src/pages/privacy.astro) and
[`site/public/_headers`](../site/public/_headers)). No new tooling, CRM, or app-side
telemetry is added:

- **Primary countable proxy:** visits to **`/browser`** (Browser Lite) — the
  in-browser analyzer where a visitor produces an actual graded reading without
  installing anything.
- **Supporting signals:** views of the landing page's **`#report-card`** showcase
  section, and clicks on the **"Grade last Sunday's mix"** primary CTA.

**Target: 200 engineers reaching the report-card moment.**

The running count is reviewed on the same **weekly** cadence as
[`docs/revenue-metrics.md`](revenue-metrics.md), as a leading indicator ahead of paid
conversion — engineers who hit the report-card moment are the pool that later
converts to paid. This reuses analytics the site already ships; there is no CRM, no
new telemetry pipeline, and no app-side tracking involved.

## Outreach channels

Specific communities and events where church FOH volunteers and worship sound
engineers already gather. These are targets for outreach, not secured placements or
partnerships.

| Channel type | Where | Why they're there | Primary ask |
|---|---|---|---|
| **Online forums** | ProSoundWeb (Church Sound / LAB forums), Gearspace live-sound forum | Long-running technical communities where church and live-sound engineers troubleshoot mixes and gear | Link to the landing page / Browser Lite as a free way to get a second opinion on last Sunday's mix |
| **Reddit** | r/livesound, r/churchtech | Active, opinionated communities of working sound engineers, many church-affiliated | Same — free Browser Lite trial, no install |
| **Facebook groups** | Church Production groups, Behringer X32 / Midas M32 user groups, Worship Sound Guys and similar church FOH-volunteer groups | Console-specific groups map directly to Sound Buddy's M32/X32 support; general church-production groups reach volunteer and part-time engineers | Peer-to-peer post sharing the report-card first win |
| **Denominational & AV networks** | Church-tech-director networks, denominational AV/media groups, MxU (Church Production community), church tech-director roundtables | These networks reach the people who own the console and the Sunday mix across many congregations at once | Introduce the tool via a trusted network voice; link to landing page |
| **Trade shows / conferences** | NAMM, InfoComm, WFX (Worship Facilities Expo), regional church-tech gatherings | In-person reach to engineers and church-tech buyers who attend industry events | Demo Browser Lite live; hand out the landing page link |

## Outreach messaging

Reusable copy for outreach, all pointing back to the landing page and leading with
the report-card first win. Keep claims consistent with what the site actually offers
— nothing promised here that the app doesn't do.

**Short post/comment variant** (forums, Facebook groups):

> Ever walk out after a service wondering if the mix was actually good, or just
> familiar? Sound Buddy grades last Sunday's recording and tells you exactly what to
> fix before next Sunday — muddy low-mids, buried vocals, harsh 3-5k, whatever it is.
> Built for M32/X32 rigs. There's a free **Browser Lite** version that runs the
> analysis right in your browser, no install — and everything stays local, your audio
> never leaves your machine. Worth a look: [landing page link] — **Grade last
> Sunday's mix**.

**Longer variant** (newsletter / network intro):

> A lot of church sound teams are running on gut feel and Sunday-to-Sunday memory —
> there's no easy way to know if this week's mix was actually better than last
> week's, or just different. Sound Buddy is a small tool built for exactly that gap:
> it analyzes a recording of your service and hands back a report card — a clear,
> specific read on what's working and what to fix, tuned for Midas M32 / Behringer
> X32 rigs. Everything runs locally; your audio never leaves your machine, and the AI
> narrative (if you use it) is powered by your own local or personal API key, never
> ours. You can try the analysis for free right now with **Browser Lite** — no
> install, runs in the browser — at [landing page link].

**Per-channel adaptation note:** Lead with the value, not the pitch — the report-card
moment should read as a genuinely useful answer to a problem these communities
already talk about, not an ad. Respect each community's self-promotion rules (many
forums and groups require disclosure or restrict promotional posts to specific
threads/days — check first). Keep tone peer-to-peer: write like a sound engineer
sharing a tool that helped, not a vendor pitching a product.

## Rollout schedule

Phased in relative weeks from kickoff, not calendar-locked — timing shifts based on
weekly analytics review against the 200 target.

| Phase | Timing | Activities | Primary channels |
|---|---|---|---|
| Phase 0 — Prep | Week 0 | Finalize messaging variants, confirm landing page CTAs/links are live, verify the Cloudflare Web Analytics views for `/browser` and `#report-card` are reachable for the weekly review | — |
| Phase 1 — Soft launch | Weeks 1–2 | Post short-variant messaging in forums, Reddit communities, and Facebook groups; gather early feedback and adjust copy | ProSoundWeb, Gearspace, r/livesound, r/churchtech, Facebook church-production and console-specific groups |
| Phase 2 — Network intros | Weeks 3–5 | Longer-variant intros through denominational and AV networks; pitch newsletter mentions | Church-tech-director networks, denominational AV/media groups, MxU |
| Phase 3 — Event presence | Weeks 6+ (aligned to event calendars) | Live Browser Lite demos, handouts with the landing page link | NAMM, InfoComm, WFX, regional church-tech gatherings |
| Ongoing | Weekly, continuous | Content follow-ups in active channels; weekly Cloudflare Web Analytics review against the 200 target, feeding the same weekly cadence as `docs/revenue-metrics.md` | All channels above |

Outreach continues, with phase mix adjusted at each weekly review, until the
200-engineer report-card-moment target is met.

Public launch posts in this schedule are held on any #285 live-mode launch
gate failure, per
[`worker/docs/live-launch-gate-failure-policy.md`](../worker/docs/live-launch-gate-failure-policy.md)
— no new public post goes out until the failure is resolved and its P0 issue
is filed.
