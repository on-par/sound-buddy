# electron-builder 26 packaging verification ships as an operator runbook plus two new release gates, not as CI

- Status: Accepted
- Date: 2026-08-28

## Context

#1226 asks for proof that packaging, Developer ID signing and notarization still work after
the Electron 31→44 / electron-builder 24→26 upgrade (#1227). None of that is reachable from
CI or from an autonomous agent: a signed build needs a Developer ID private key in a
keychain, notarization needs a live Apple submission with stored credentials, and the
"launches from /Applications with no Gatekeeper prompt and completes one analysis" criterion
needs a human at a Mac. The repo already has a precedent for this shape — #1187 pinned the
signing pipeline's acceptance criteria as static assertions over scripts/release.sh and
app/electron-builder.yml, and worker/docs/live-purchase-verification-plan.md carries the
human-only half of a gate as an ordered runbook.

Reviewing the pipeline against #1226's acceptance criteria surfaced two gaps that no test
covers. First, parseSpctlAssessment accepts any output containing an `accepted` line, so a
build that is Developer ID signed but never notarized (`source=Developer ID`) passes the
Gatekeeper gate in scripts/release.sh — exactly the failure mode a toolchain upgrade that
silently skipped notarization would produce, and exactly what AC1's
`source=Notarized Developer ID` requirement is aimed at. Second, scripts/release.sh checks
only that electron-builder generated latest-mac.yml; nothing compares its contents to the
artifacts of the same build, so an electron-builder 26 change to the feed's file naming or
sha512 encoding would only be discovered by users' updaters after publication (the #625
space-vs-dot artifactName bug in a new costume).

## Decision

#1226 ships as three things, and the human-run build is deliberately not automated.

docs/electron-builder-26-packaging-verification.md is the operator runbook: an ordered,
one-time procedure mapping each of the four acceptance criteria to an exact command and a
fillable PASS/FAIL row, with a section for recording any electron-builder 26 configuration
change the run required, and a blocking rule that the first public release on the new
toolchain does not cut until every row reads PASS.

parseSpctlAssessment gains a `source` field and rejects an assessment whose `source=` line is
present but is not `Notarized Developer ID`. Both scripts/release.sh Gatekeeper gates (the
.app and the .dmg) inherit the stricter rule. An output with no `source=` line keeps today's
behavior, so a future change to spctl's output format degrades to the old check rather than
blocking every release.

packages/shared/src/update-feed.ts checks the locally generated latest-mac.yml against the
artifacts of the same build — version, known file names, no space in any url, base64 sha512
match, byte-size match — and scripts/release.sh runs it in Phase A, before any push or
GitHub release. Publishing is never required to prove the updater feed is internally
consistent.

## Consequences

Positive: the two mechanically-checkable acceptance criteria stop being one-time human
observations and become gates that fail on every future release build, so the next toolchain
bump cannot silently ship an unnotarized app or a feed whose sha512 no updater will accept.
Both gates run in Phase A, so a failure costs a rebuild, never a bad public release. The
human-only criteria stay written down in one place with an explicit blocking rule instead of
living in an issue thread.

Negative: #1226 cannot be closed by merging this PR — a human must still run the signed
build and fill in the runbook's table, and the runbook is the record of that. The stricter
spctl gate is a new way for a release to fail; if Apple rewords the source line to something
else that still means notarized, scripts/release.sh will block until the constant is
updated. The latest-mac.yml parser is a small purpose-built line parser, not a general YAML
parser, so a genuinely different feed shape from a future electron-builder needs the parser
updated alongside it.

## References

- [Issue #1226 — verify packaging, signing and notarization under electron-builder 26](https://github.com/on-par/sound-buddy/issues/1226)
- [Issue #1227 — Electron 31 -> 44, electron-builder 24 -> 26 upgrade](https://github.com/on-par/sound-buddy/pull/1227)
- [docs/signing-and-notarization.md](https://github.com/on-par/sound-buddy/blob/main/docs/signing-and-notarization.md)
