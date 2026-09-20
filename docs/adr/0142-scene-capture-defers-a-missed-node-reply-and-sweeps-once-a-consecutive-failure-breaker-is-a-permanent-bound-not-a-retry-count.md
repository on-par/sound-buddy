# Scene capture defers a missed `/node` reply and sweeps once; a consecutive-failure breaker is a permanent bound, not a retry count

- Status: Accepted
- Date: 2026-09-20

## Context

#1490: **Capture scene** aborted at `/config/auxlink` with only 1 of 2103 paths captured, because
`captureSceneFromConsole` (`app/electron/ipc/console-scene-capture.ts`) threw on the very first
`/node` path that exhausted its retry budget, wasting the whole ~23s walk on one missed reply.
`docs/discovery/1490-m32r-node-walk-timeout.md` documents the leading theory: this console model
silently refuses a 5th concurrent OSC client (ADR-0063/ADR-0079), and with the Console panel's
`/status` heartbeat, channel-state poll, and `/meters` subscription renewal already occupying three
slots, a capture walk racing against that background traffic only has to lose one query to a transient
4th/5th-client collision to hit exactly this failure shape — a miss early in a long walk, not a
cumulative rate limit that would show up near the end. ADR-0071's own negative-consequences section
anticipated this: "a future partial-recovery mode (re-query only the gaps) would be a real improvement
but must still never write an incomplete file."

Two things still needed deciding that raising the per-query timeout alone would not settle. First,
what a single miss should do to the rest of the 2103-path walk — abort immediately (today's behavior,
proven too fragile), or continue and reconcile later. Second, given that some real desks (powered off,
wrong IP, genuinely dead) will legitimately never answer, how to keep that failure mode bounded in
time rather than turning "continue past misses" into a multi-minute hang while the walk exhausts a
raised retry budget against every one of 2103 paths.

## Decision

A miss during the walk is **deferred, not fatal**: `captureSceneFromConsole` keeps walking the full
2103-path table, collecting failed paths into a list instead of throwing. Once the table is exhausted,
if any paths were deferred, the walk pauses for one settle interval (`SWEEP_SETTLE_PAUSE_MS`, giving a
contended client slot a chance to free up) and then re-queries exactly the deferred paths once, on an
escalated budget (`SWEEP_QUERY_TIMEOUT_MS` / `SWEEP_QUERY_MAX_RETRIES`, both larger than the walk's own
`WALK_QUERY_TIMEOUT_MS` / `WALK_QUERY_MAX_RETRIES`). Only after that single sweep does an unrecovered
path become fatal. This is "defer-and-sweep": one pass to build the table, one reconciliation pass for
the gaps, never more.

That still leaves a genuinely dead console able to force a full walk-plus-sweep of every path before
failing. `scene-capture-retry.ts` — a pure module with no sockets, Electron, or timers — owns a
**consecutive-failure breaker**: if `CONSECUTIVE_FAILURE_BREAKER_LIMIT` (4) misses land back-to-back
with no success between them, or the deferred list reaches `DEFERRED_PATH_CAP` (12) even without a
consecutive run, the walk aborts immediately with the same wording the operator has always seen. Four
consecutive misses at the walk budget (500ms x5 attempts = 2.5s each) bounds a dead-console failure at
~10s, instead of the ~87 minutes a full 2103-path exhaustion at the escalated budget would take. This
breaker is a **permanent architectural bound**, not a "how many times do we retry a request" counter —
it exists specifically so "continue past a miss" can never regress into "hang indefinitely against a
console that will never answer."

`buildSceneCaptureFailureMessage` in the same module is the one place that builds the operator-facing
failure string, used both when the breaker trips mid-walk and when the post-sweep table is still
incomplete — preserving the exact wording (failing path, captured count, total) that existed before
this change. `assembleSceneFile` (`packages/console/src/scene-capture.ts`, ADR-0071) is untouched and
remains the only place a capture becomes text: the caller only reaches it once every path already has
a line, so the all-or-nothing guarantee holds exactly as before.

Deliberately **out of scope**: reusing one socket across the whole walk instead of one per query. That
is plausibly the more complete fix under the client-cap theory (fewer ephemeral ports registering with
the desk per second), but it changes `queryConsole` in `console-connection.ts`, which the heartbeat,
identity fetch, and channel-state poll all share — a change with a much larger blast radius than this
capture-only fix, and it belongs in its own issue once the discovery doc's experiments have more signal
on whether client-cap contention or something else is the dominant cause.

## Consequences

Positive: a single transient miss — the failure mode #1490 actually reported — no longer costs the
whole ~23s walk; the operator only sees a failure when the desk (or the specific path) is genuinely
unresponsive across both the walk and the escalated sweep. The breaker keeps that failure fast (~10s
consecutive, bounded for scattered misses too) instead of trading "aborts too eagerly" for "hangs too
long." The retry policy is a pure, directly-unit-tested module with no sockets or timers, so the
breaker/cap/message logic is exercised without any dgram mocking. `.scn` writes stay provably
all-or-nothing — this change touches nothing between "every path has a line" and "write the file."

Negative: a capture that hits several genuinely-dead paths now takes longer to fail than before (up to
one walk-budget pass plus one settle pause plus one sweep-budget pass over the deferred set, versus
today's immediate abort on the first miss) — an intentional trade against the previous failure's cost
(discarding a clean 2100+/2103 walk over one flaky reply). The consecutive-failure breaker and deferred
cap are fixed constants tuned from this one desk's measured behavior (RTT p95 7.9ms / max 93.3ms); a
console with materially different latency characteristics may need those retuned, which is exactly what
the discovery doc's falsifying experiments are positioned to inform. The settle pause's duration is a
best-effort guess at how long a contended client slot needs to free up under the four-client-cap
theory, not a measured value — it is deliberately exposed as an injectable dependency
(`SceneCaptureWalkDeps.wait`) rather than a hardcoded `setTimeout` so it can be tuned or replaced
without touching the walk/sweep control flow.

## References

- [Issue #1490](https://github.com/on-par/sound-buddy/issues/1490)
- [Discovery: why `/config/auxlink` timed out](../discovery/1490-m32r-node-walk-timeout.md)
- [ADR-0071 — Scene capture emits a generated, fixture-pinned node-path table and refuses to write a partial .scn](0071-scene-capture-emits-a-generated-fixture-pinned-node-path-table-and-refuses-to-write-a-partial-scn.md)
- [ADR-0063 — Silent four-client cap refusal is detected via absence of /meters frames, not absence of /xremote pushes](0063-silent-four-client-cap-refusal-is-detected-via-absence-of-meters-frames-not-absence-of-xremote-pushes.md)
- [ADR-0079 — Console degraded states are one derived link state; the four-client refusal reads as "meters unavailable", never "offline"](0079-console-degraded-states-are-one-derived-link-state-pushed-on-the-existing-live-state-channel-and-the-four-client-refusal-reads-as-meters-unavailable-never-offline.md)
- [ADR-0127 — A visual-verification result record carries no open pending cells; sign-off is attributed and residual manual work is scoped separately](0127-a-visual-verification-result-record-carries-no-open-pending-cells-sign-off-is-attributed-and-residual-manual-work-is-scoped-separately.md)
