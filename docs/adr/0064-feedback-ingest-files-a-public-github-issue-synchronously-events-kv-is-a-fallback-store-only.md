# Feedback ingest files a public GitHub issue synchronously; EVENTS_KV is a fallback store only

- Status: Accepted
- Date: 2026-08-18

## Context

`POST /api/ingest` (#475) has always written feedback, crash, and telemetry events into
`EVENTS_KV` behind a 90-day TTL. Nobody reads that namespace, so user feedback — the one
event type with a human on the other end — has been invisible since it shipped. Epic #927
routes it to the team's real work queue: GitHub issues on `on-par/sound-buddy`, using the
fine-grained `GITHUB_ISSUES_TOKEN` provisioned in #929 (scoped to that one repo,
`issues:write` only, and expiring — so a rejected token must be a handled path, never an
assertion).

Three forces shaped the design. First, `/api/ingest` is unauthenticated: its only bounds
are body size, per-IP rate limiting, and strict schemas. Making feedback publicly visible
turns junk submissions from "wasted KV bytes" into "spam on a public repo", so the
submission path needs a stricter gate than the shared 30-requests-per-60s bucket. Second,
the desktop app is a fire-and-forget client — an ingest failure surfaces to the user as a
generic error and the message is gone — so a GitHub outage must never lose an event.
Third, `on-par/sound-buddy` is a PUBLIC repository, which turns the issue body into a
publication surface: anything written there is world-readable forever, including the
deliberately-consented `contactEmail` reply address the redaction pipeline otherwise
leaves intact precisely because it was never meant to leave the team.

## Decision

For `type: "feedback"` events, `handleIngestEvent` calls `createFeedbackIssue` (a thin
wrapper in `worker/src/github-issues.ts` around a POST to
`https://api.github.com/repos/on-par/sound-buddy/issues`, with an injectable `fetch` and a
bounded timeout) synchronously in the request path, after redaction. On a 2xx response the
handler returns 202 and performs no `ingest:*` `EVENTS_KV.put` for that event. On any other
outcome — non-2xx, thrown/aborted fetch, or an unset `GITHUB_ISSUES_TOKEN`, which short-
circuits before any network call — it logs an outcome-and-status-only line and falls
through to the pre-existing `EVENTS_KV.put`, still answering 202. `EVENTS_KV` is therefore
demoted to a fallback store for feedback; GitHub is the system of record.

Feedback gets its own rate-limit bucket, `rl:ingest:feedback:<ip>`, capped at one
submission per 60-second window, checked after validation identifies the type and before
any GitHub call or event write. The shared `rl:ingest:<ip>` bucket keeps its 30-request cap
for all types, so crash and telemetry are unaffected by the stricter feedback gate.
`validateIngestEvent` rejects a feedback message shorter than 10 characters after trimming.

The issue body carries only the redacted message, category, appVersion, osVersion,
platform, and receivedAt. It never carries `contactEmail`. When a submission includes one,
the handler additionally writes the event to `EVENTS_KV` so the reply address is retained
somewhere non-public.

## Consequences

Positive: feedback lands where the team already works, with no new dashboard to build. No
event can be lost — every GitHub failure mode, including an expired token, degrades to
exactly the behaviour that shipped in #475, and a deploy that never provisions
`GITHUB_ISSUES_TOKEN` keeps working unchanged. The pure `buildFeedbackIssue` keeps title
and body formatting unit-testable with no network. A public repo means submitters can
watch their own feedback get triaged.

Negative: a feedback submission now costs a synchronous outbound request, adding latency to
`/api/ingest`. Feedback lives in two places depending on outcome, so any future reader must
check both. One-per-minute is strict enough to reject a legitimate second thought typed
immediately after the first — the user sees a 429 and must wait. And most consequentially,
the destination is public: the in-app dialog copy must disclose that before this path can
be considered honest to users, which is story 4 of epic #927 and does not land in this PR.
Reversing the destination is a one-constant change (`GITHUB_ISSUES_REPO`); reversing the
publication of already-filed issues is not.

## References

- [Issue #930 — Route feedback ingest events to GitHub Issues](https://github.com/on-par/sound-buddy/issues/930)
- [Issue #929 — GITHUB_ISSUES_TOKEN provisioning](https://github.com/on-par/sound-buddy/issues/929)
- [GitHub REST API — Create an issue](https://docs.github.com/en/rest/issues/issues#create-an-issue)
