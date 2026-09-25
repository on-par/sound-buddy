# Privacy boundary is tier-split — Pro/desktop analysis stays on-device, Free web tier may upload for server analysis

- Status: Accepted
- Date: 2026-09-25

## Context

Since launch, Sound Buddy's core privacy claim was that audio analysis runs fully local. The
claim was written into CLAUDE.md, `.factory/constitution.md`, and the locked marketing phrase
"Your audio never leaves your machine". The product packaging locked on 2026-09-25 (#1518) adds
a Free tier that runs in the browser. It cannot bundle sox/ffmpeg/Python, so it must upload
audio to the worker/server for analysis. The factory's checkers enforce the constitution text,
so every Free-tier upload PR would fail on the unconditional local-only rule. Paying Pro/desktop
customers bought the on-device guarantee, and it must not erode.

## Decision

The privacy rule is split by tier. Pro/desktop (the Electron app under `app/` and the packages
it bundles) analyzes audio on-device. A Pro/desktop change that sends audio, file paths, or
recording content off the machine is still a hard fail regardless of tests. The Free web tier
may upload audio for analysis, and only on free-tier paths (`site/` and `worker/`). Checkers
must not cite the local-only rule against those paths. Marketing and product copy may not claim
globally that audio never leaves the machine; any such claim must be scoped to Pro/desktop.

## Consequences

Free-tier upload work under `site/` and `worker/` can ship without privacy-rule disputes. The
Pro/desktop guarantee stays a hard gate, and its scope is now explicit. Negatives: the privacy
story is now two stories, and copy must say which tier it means. The existing locked phrase in
`scripts/check-positioning.mjs` conflicts with the new marketing rule until the site copy
follow-up requalifies it. `worker/` now handles customer audio for Free users, so its retention
and handling become a privacy surface that future worker changes must treat carefully.

## References

- [Issue #1519 — Amend constitution for Free-tier uploads](https://github.com/on-par/sound-buddy/issues/1519)
- [Parent epic #1518](https://github.com/on-par/sound-buddy/issues/1518)
