# e471 Feedback, crash reporting, and privacy-safe telemetry: completion record

Issue #471 is a tracking epic, not a feature. Its deliverable is a launch-ready feedback and
learning loop: users can send feedback from inside the app, opt into crash reporting that only
captures after consent, opt into privacy-safe usage telemetry, all through a worker ingestion
endpoint — with no recordings, secrets, church names, or private content leaving the machine
except what a user explicitly shares, and a release cut once the loop is complete. Every
acceptance criterion is already satisfied by the five sub-issues (#475, #472, #473, #474, #476),
all of which shipped as squash-merged PRs and are closed `COMPLETED` on GitHub, with their
squash-merge commits in this tree's history. Per binding ADR-0018, an epic whose criteria are met
by accumulated work is closed by a repo-homed completion record that asserts every criterion from
the checkout and maps each story to its PR and feature files — there is no residual feature code
to build. This record is that closing evidence.

## Shipped stories

Titles are the actual GitHub issue titles, read verbatim from `gh issue view`. State is as of
2026-08-14, read from `gh issue view`. Closing PR hashes are the squash-merge commits reproduced
from this checkout's history by the git command in the Verification section. The two earliest
commits (`b9c6954`, `08c2641`) predate the `(#issue) (#PR)` message-suffix convention and carry
only the issue number — their PR numbers are sourced from `gh pr view`, not the commit message.

| Story | Actual GitHub title | Merged PR | Feature files in this tree |
|-------|--------------------|-----------|---------------------------|
| #475 | Add worker ingestion endpoint for feedback, crash, and telemetry events | [#477](https://github.com/on-par/sound-buddy/pull/477) (`b9c6954`) | `worker/src/handlers/ingest.ts` (`validateIngestEvent`, `redactText`, `redactIngestEvent`, `handleIngestEvent`, `TELEMETRY_EVENT_NAMES`, `SENSITIVE_FIELD_NAMES`, per-type `ALLOWED_FIELDS`, per-IP rate limit, 90-day `EVENTS_KV` TTL), `worker/src/handlers/ingest.test.ts`, `worker/src/index.ts` (`POST /api/ingest` route), `worker/src/index.test.ts`, `worker/wrangler.jsonc` (`EVENTS_KV` binding) |
| #472 | Add in-app feedback channel with safe diagnostic context | [#486](https://github.com/on-par/sound-buddy/pull/486) (`08c2641`) | `app/electron/feedback.ts` (`submitFeedback`, `redactFeedbackText`, `ingestUrl`, `FEEDBACK_CATEGORIES`, `revealDiagnosticLog`, `openFeedback`), `app/electron/feedback.test.ts`, `app/electron/main.ts` (`open-feedback` / `submit-feedback` IPC handlers), `app/electron/ipc/api.ts` (`FeedbackSubmission`, `SubmitFeedbackResult`), `app/electron/preload.ts` (feedback bridge), `app/renderer/feedback-form-state.js` (+ test), `app/renderer/src/FeedbackDialog.tsx` + `app/renderer/src/stores/feedbackDialogStore.ts` (the dialog, ported to React by TD-001 slice 6f, #704 — see Discrepancies), `app/renderer/index.html` (`#feedback-dialog-island`) |
| #473 | Add opt-in crash reporting with redacted crash payloads | [#491](https://github.com/on-par/sound-buddy/pull/491) (`ab60ebf`) | `app/electron/crash-reporting.ts` (`captureMainError`, `submitCrashPayload`, `buildCrashPayload`, `handleRendererErrorReport`, `flushPendingCrashReport`, `redactCrashText`, `recordAppEvent` breadcrumbs), `app/electron/crash-reporting.test.ts`, `app/electron/logger.ts` (`CrashSink`, `setCrashSink`), `app/electron/settings.ts` (`crashReportingEnabled`, default false), `app/electron/main.ts` (`setCrashSink` wiring, `report-renderer-error` IPC, `flushPendingCrashReport`), `app/renderer/src/crash-hooks.ts` (`serializeRendererError`, `installCrashHooks`) + test, `app/renderer/src/SettingsPanel.tsx` (`#crash-reporting-toggle`; originally `app/renderer/index.html`, moved by the #747 Settings-panel React migration — see Discrepancies) |
| #474 | Add privacy-safe usage telemetry with explicit opt-in | [#492](https://github.com/on-par/sound-buddy/pull/492) (`e61d880`) | `app/electron/telemetry.ts` (`TELEMETRY_EVENTS` allowlist, `recordTelemetryEvent`, `flushTelemetry`, `getOrCreateInstallId`, `coarseTimestamp`, `clearTelemetryState`), `app/electron/telemetry.test.ts`, `app/electron/settings.ts` (`usageSignalEnabled`, default false), `app/electron/main.ts` (`record-app-event` IPC, `app_opened`), `app/electron/ipc/analysis.ts` (`analysis_started`/`analysis_completed`), `app/electron/ipc/settings.ts` (`report_exported`), `app/renderer/src/ReportCardIsland.tsx` (`report_viewed`), `app/renderer/src/SettingsPanel.tsx` (`#usage-signal-toggle`; originally `app/renderer/index.html`, moved by the #747 Settings-panel React migration — see Discrepancies) |
| #476 | Cut a release after feedback, crash reporting, and telemetry slices ship | [#494](https://github.com/on-par/sound-buddy/pull/494) (`acbb54d`) | `scripts/release.sh` (feeds `RELEASE_HIGHLIGHTS.md` into `gh release create --notes` via `buildReleaseNotes`), `packages/shared/src/install-instructions.ts` (`buildReleaseNotes` highlights param) + test, `RELEASE_HIGHLIGHTS.md`; the actual cut followed as **v0.8.6** (tag `be657c3`, 2026-07-22) whose published notes list the three slices |

## Acceptance-criteria checklist

Each epic criterion is asserted from this checkout with its evidence.

- [x] **A user can opt in or out of data sharing from inside the app.** → Settings →
      General (`app/renderer/src/SettingsPanel.tsx`) renders `#usage-signal-toggle` ("Share
      anonymous usage counts") and `#crash-reporting-toggle` ("Send crash reports"), each OFF by
      default with plain-copy notes (`#usage-signal-note`, `#crash-reporting-note`) stating exactly
      what is and is never sent. `app/electron/settings.ts` defines `usageSignalEnabled` and
      `crashReportingEnabled` with `default: false` and boolean `sanitizePatch`, persisted through
      the update-settings IPC; turning telemetry off calls `clearTelemetryState` (telemetry.ts)
      which empties the queue and deletes the anonymous install-id so a later opt-in starts fresh
      (`app/electron/ipc/settings.ts:89`, asserted by `ipc/settings.test.ts`).
- [x] **A user can send feedback from inside the app.** → Help ▸ "Send Feedback…" (`main.ts`)
      opens `FeedbackDialog.tsx` (state in `feedbackDialogStore.ts` / `feedback-form-state.js`);
      Send calls `submitFeedback` (`app/electron/feedback.ts`), which revalidates, attaches the safe
      diagnostic summary (app version / macOS version / platform) from an explicit allowlist,
      redacts the message, and POSTs to the #475 endpoint. User-initiated only — never on a timer.
- [x] **Crash reports are captured only after the user opts in.** → `crash-reporting.ts` gates
      every capture/submit path (`captureMainError`, `submitCrashPayload`, `handleRendererErrorReport`,
      `flushPendingCrashReport`) on `crashReportingEnabled` (default false). Renderer errors are
      serialized by `crash-hooks.ts` (`serializeRendererError`, `installCrashHooks`) and bridged over
      the `report-renderer-error` IPC; main-process crashes come from the logger `CrashSink`. With the
      setting off, nothing is captured, persisted, or sent.
- [x] **Usage events are privacy-safe and schema-validated, with redaction rules for private
      content.** → telemetry.ts records only `TELEMETRY_EVENTS` (the documented 7-name allowlist:
      `app_opened`, `analysis_started`, `analysis_completed`, `report_viewed`, `report_exported`,
      `browser_lite_used`, `feedback_sent`), timestamps at hour precision (`coarseTimestamp`), and a
      random install/session id; the worker `validateIngestEvent` enforces a per-type key allowlist,
      a `SENSITIVE_FIELD_NAMES` deny list (`email`, `licenseKey`, `path`, …), the
      `TELEMETRY_EVENT_NAMES` allowlist, and field bounds; `redactIngestEvent`/`redactText` (server,
      authoritative) and `redactFeedbackText`/`redactCrashText` (client, defense-in-depth) remove
      emails, license strings, and macOS home paths; crash stacks are further reduced to basenames.
      No `props` field may carry a deny-listed key.
- [x] **Maintainers can receive and review the submitted feedback, crash, and telemetry events.** →
      `POST /api/ingest` (`worker/src/index.ts`) → `handleIngestEvent` (`worker/src/handlers/ingest.ts`)
      validates, redacts, and stores each event as `ingest:<type>:<receivedAt>:<id>` in `EVENTS_KV`
      (bound in `worker/wrangler.jsonc`) with a 90-day TTL, rate-limited per client IP. Review is
      direct KV access — the epic's "Storage/admin review can start simple before a full dashboard";
      the full admin dashboard is out of scope.
- [x] **A release cut ships after the feedback/crash/telemetry loop is complete.** → #476 (PR #494,
      `acbb54d`) landed the release-notes plumbing (release.sh feeds `RELEASE_HIGHLIGHTS.md` into the
      cut), and the cut itself shipped as **v0.8.6** (tag `be657c3`, 2026-07-22) whose published
      release notes ("What's new") explicitly list in-app feedback, opt-in crash reporting, and opt-in
      usage telemetry.

## Governing-condition evidence

The epic's Verification lines, asserted from this checkout:

- **"Each child story is a vertical slice with one user-visible or operator-visible outcome."** →
  #472 (visible Send Feedback dialog + submission), #473 (opt-in crash capture + upload), #474
  (opt-in telemetry recording + flush), #475 (operator-visible ingest endpoint receiving/storing
  events), #476 (release cut).
- **"Consent, payload schemas, redaction rules, and upload behavior are covered by automated
  tests."** → `worker/src/handlers/ingest.test.ts` (schema allow/deny lists, redaction, rate
  limit, TTL storage), `worker/src/index.test.ts`, `app/electron/feedback.test.ts`,
  `app/electron/crash-reporting.test.ts`, `app/electron/telemetry.test.ts`,
  `app/renderer/src/crash-hooks.test.ts`, `app/renderer/feedback-form-state.test.ts`,
  `app/electron/ipc/analysis.test.ts` and `app/electron/ipc/settings.test.ts` (telemetry event
  assertions, including the `clearTelemetryState` opt-out), plus settings/main/preload tests
  asserting the gates.
- **"Audio analysis behavior is unchanged by the feedback/crash/telemetry loop."** → the five PRs
  touch no `packages/audio-engine` code, `stream.py`, `spectrum.py`, or the capture engine; the
  telemetry hooks are additive IPC handler entry/exit calls only (`app/electron/ipc/analysis.ts`
  adds `recordTelemetryEvent` on start/complete), and the `record-app-event` IPC drops anything
  outside the allowlist.

## Discrepancies / evolution notes

Mirroring e383's "Transcript swap note" and e410's "Discrepancies documented", the following are
recorded honestly rather than papered over:

- **No transcript swap.** The epic's "In scope" list is prose without per-story numbers; the story
  numbers map 1:1 to #475/#472/#473/#474/#476 in the order given, and each actual issue title
  matches its description — no swap. Note the epic's prose orders feedback, crash, telemetry,
  ingestion, release; the actual merge order was ingestion (#475, 2026-07-16) → feedback (#472,
  2026-07-17) → crash (#473) → telemetry (#474) → release plumbing (#476) — the only "out of
  order" slice is ingestion, which shipped first as the receiving side, exactly as its issue's
  INVEST note anticipates ("Server-side endpoint can be implemented before all app clients are
  wired").
- **Early squash commits carry only the issue number.** `b9c6954` and `08c2641` predate the
  `(#issue) (#PR)` suffix convention, so their messages cite only #475 and #472; the PR numbers
  (#477, #486) are sourced from `gh pr view`, not the commit message.
- **The release-cut story and the cut itself are two steps.** #476's PR (2026-07-17) added the
  release-notes highlights plumbing; the actual cut followed as v0.8.6 (2026-07-22), whose notes
  advertise the three slices. Recorded so the criterion is not misattributed to #476 alone.
- **The telemetry allowlist is seven names, not eight.** `TELEMETRY_EVENTS`
  (`app/electron/telemetry.ts`) and the worker's `TELEMETRY_EVENT_NAMES` both list seven event
  names (see the checklist); the planned record's "8-name allowlist" figure did not match the
  checkout, so the verified count is recorded instead.
- **Post-ship evolutions that preserve the criteria.** The feedback dialog moved into React
  (TD-001 slice 6f, #704) — `FeedbackDialog.tsx` + `feedbackDialogStore.ts` replace the original
  `inline-app.js` wiring but keep the same `submit-feedback` IPC and store contract; and the
  `SettingsPanel.tsx` React migration (#747) preserved the two consent toggles and their
  default-off semantics (they originally landed in `app/renderer/index.html` and now live in
  `app/renderer/src/SettingsPanel.tsx`). None change the consent/schema/redaction guarantees.

## Verification

Run from this checkout (all green as of 2026-08-14):

- `git log --all --oneline | grep -E '\(#(472|473|474|475|494)\)'` — reproduces all five merged
  PR numbers with the exact short hashes cited above: `acbb54d` (#494), `e61d880` (#492), `ab60ebf`
  (#491), `08c2641` (#486), `b9c6954` (#477). The same grep also surfaces the pre-squash branch
  commits `9772dc8`, `f029d47`, `ea931b9` from earlier factory runs carrying the same issue
  numbers — expected, they are not the squash-merge commits the record cites. `b9c6954` and
  `08c2641` carry only the issue number (pre-`(#PR)`-suffix convention); their PR numbers come from
  `gh pr view`.
- `git merge-base --is-ancestor b9c6954 HEAD && git merge-base --is-ancestor 08c2641 HEAD && git
  merge-base --is-ancestor ab60ebf HEAD && git merge-base --is-ancestor e61d880 HEAD && git
  merge-base --is-ancestor acbb54d HEAD` — each squash-merge commit reports ancestor-of-HEAD,
  proving all five story PRs are in this tree's history.
- `for i in 472 473 474 475 476; do gh issue view $i --json number,state,stateReason; done` — all
  five report `CLOSED` with `stateReason: COMPLETED`, matching the table's State column; each issue
  body is a vertical slice referencing the loop.
- `gh issue view 471 --json state,title` — `OPEN` with title "Epic: Feedback, crash reporting, and
  privacy-safe telemetry" before this PR; the PR's `Closes #471` body line is what closes it.
- `gh release view v0.8.6 -R on-par/sound-buddy-releases --json body` — the published release notes
  carry a "What's new" section explicitly listing in-app feedback, opt-in crash reporting, and
  opt-in usage telemetry — the evidence for the release-cut criterion.
- `./scripts/verify.sh --fast` — passes on the accumulated tree. The diff is doc-only, so compile,
  lint, tests, and the coverage ratchet are untouched.
