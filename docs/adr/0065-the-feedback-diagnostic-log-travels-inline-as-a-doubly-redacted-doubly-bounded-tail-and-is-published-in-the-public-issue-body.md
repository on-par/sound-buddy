# The feedback diagnostic log travels inline as a doubly-redacted, doubly-bounded tail and is published in the public issue body

- Status: Accepted
- Date: 2026-08-18

## Context

Story 3 of epic #927 lets a user opt into attaching diagnostic context to a feedback
submission. Two constraints collide. First, ADR 0064 established that feedback ingest
files a synchronous GitHub issue on on-par/sound-buddy, which is a PUBLIC repository —
so anything embedded in the issue body is published, permanently and indexably, with no
credential required to read it. Second, the app's log file is unrotated, arbitrarily
large, and contains whatever the app and renderer wrote to it, including macOS home
paths and any email address or license string that happened to flow through an error
message. The ingest Worker also bounds any request body at 32KB before JSON.parse, so an
unbounded attachment would turn every opted-in submission into a 413.

The alternative shapes considered were uploading the log to object storage and linking
it (rejected as out of scope for this story and as a new privacy surface of its own),
and sending the whole log with server-side truncation (rejected because the raw content
would have already left the user's machine).

## Decision

The opt-in diagnostic log travels inline in the existing feedback JSON payload as a
`diagnosticLog` field, and it is bounded and redacted twice.

Client-side (app/electron/feedback.ts), the main process — never the renderer — reads at
most the last 64KB of `getLogFilePath()`, reduces it to the last 200 lines / 8000
characters via the pure `logTail()`, applies `redactFeedbackText()`, and re-applies
`logTail()` so the value that leaves the machine is provably within the cap even though
redaction placeholders can be longer than the text they replace. A missing or unreadable
log yields no field at all and never fails the submission.

Server-side (worker/src/handlers/ingest.ts), `diagnosticLog` is an allowlisted feedback
field bounded at 8192 characters, and `redactIngestEvent` re-redacts it with the same
`redactText` pass applied to `message` — the server redaction is authoritative, exactly
as it already is for the free-text message.

Any future path that attaches local log or file content to an outbound feedback or crash
payload must follow this same discipline: main-process read, pure bounded tail,
client-side redaction, server-side re-redaction, and a hard character cap enforced on
both sides. `contactEmail`'s existing carve-out is unchanged: an event carrying a reply
address is still stored privately in KV instead of being filed publicly.

## Consequences

Positive: the team gets real diagnostic context on triage without new infrastructure,
new storage, or a second outbound call. The size bound is enforced before the network
call, so an opted-in submission can never bounce with a 413. Redaction failure requires
both the client and server passes to miss the same pattern.

Negative: 200 lines is a small window — a slow-burn problem whose evidence scrolled past
will not be captured, and the user has no way to widen it. Redaction is regex-based and
therefore incomplete by construction: a novel secret format in the log would be
published to a public repository. The two regex passes (redactFeedbackText and
redactText) must stay byte-for-byte in sync, which is a standing drift hazard already
noted in both files' comments. Raising either cap requires changing two constants in two
packages together.

## References

- [Issue #931 — Attach a redacted diagnostic-log tail to feedback issue submissions](https://github.com/on-par/sound-buddy/issues/931)
- [ADR 0064 — Feedback ingest files a public GitHub issue synchronously](docs/adr/0064-feedback-ingest-files-a-public-github-issue-synchronously-events-kv-is-a-fallback-store-only.md)
