---
product: sound-buddy
version: 1
checkers: []
enforced_on: [plan, build, check]
requireTests: true
---

# Sound Buddy Constitution

## Purpose

Sound Buddy is a Mac desktop application (Electron + React) for church audio
engineers. It analyzes recordings, generates report cards, recommends EQ
changes, captures live multi-channel audio from a Midas M32R/X32 console, and
supports virtual soundcheck playback. A Cloudflare Worker (`worker/`) handles
Stripe webhooks, offline license minting, and email delivery. The app is a paid
product — a change that damages a paying customer's trust is a failed change,
regardless of whether the tests pass.

## Standards

`CLAUDE.md` at the repo root is the authoritative standards body: TDD, the
coverage ratchet, test colocation, e2e settings, code quality, architecture,
quality gates, dispute rules, and non-goals all live there. Read it first. This
constitution adds only what CLAUDE.md does not cover.

### E2e environment contract

The factory leases each lane a dedicated port and injects `PORT`,
`FACTORY_APP_PORT`, `FACTORY_BASE_URL`, `FACTORY_HEADLESS=1` and
`PLAYWRIGHT_HEADLESS=1` into every build and check command run in the worktree.

- `app/playwright.config.ts` launches Electron directly — it has no `webServer`
  block and must not grow one. The port variables are irrelevant to it; do not
  add them to satisfy a generic rule.
- Headless remains the default. Never bake `--headed`, `--ui`, or `--debug`
  into an npm script or CI step.
- Specs that need real media tools (sox / ffprobe / python+numpy+scipy) or a
  packaged `.app` are listed in `MEDIA_SPECS` and are excluded under
  `SB_E2E_STUBBED_ONLY=1`. A new spec that needs those tools must be added to
  that list, or CI will fail on a box that does not have them.
- Full-screen first-run surfaces must be suppressible by env flag (see
  `SOUND_BUDDY_DISABLE_ONBOARDING`), or they will cover the UI and time out
  every existing spec.

### Licensing and dual-license structure

- `app/` is proprietary source-available under `app/LICENSE`. Everything
  outside `app/`, including all `packages/*`, is MIT.
- Every new source file under `app/` needs the proprietary header.
  `app/electron/licensing.test.ts` guards this — do not weaken that test to
  make a build pass.
- Never commit license signing keys, Stripe secrets, or Resend keys. Reference
  environment variable names in code; never read or echo their values.

### Paid-product safety

- Never ship a change that can revoke, corrupt, or fail-closed a valid
  customer license. License validation failures must degrade to the last known
  good state, not to locked-out.
- Audio analysis stays fully local. A change that sends audio, file paths, or
  recording content off the machine violates the product's core privacy claim
  and fails regardless of test status.
- The updater is check-only by design. Do not convert it to auto-install
  without an explicit issue authorizing it.

## Quality Gates

Beyond the three gates in CLAUDE.md (`compile`, `lint`, `tests`):

4. `./scripts/verify.sh --fast` is the minimum local gate for any renderer or
   Electron change; `./scripts/verify.sh --no-e2e` for anything touching the
   analysis pipeline or packaging.
5. Coverage floors are CI-calibrated and are a hard gate. A change may raise a
   floor; it may never lower one.

## Dispute Rules

CLAUDE.md's Dispute Rules govern. In addition:

- "The e2e suite is flaky" is not a dispute resolution. Root-cause the flake or
  quarantine the spec in the same PR with an issue link.
- A coverage floor may only be lowered in a PR that deletes the code it
  covered, and the boss must verify the deletion is correct.

## Non-Goals

- CLAUDE.md's Standards Non-Goals apply unchanged.
- This constitution does not govern the marketing site's visual design or copy
  (`site/`) — those are reviewed by a human, not a checker.
