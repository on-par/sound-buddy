# Design reference: Ableton Live as the interaction model

Ableton Live is the interaction reference for Sound Buddy's UI: its familiarity,
density, and directness — aimed at objectively measuring and improving sound, not
authoring it. This is the product direction as of issue #669 (2026-07-23). It is a
reference for taste, not a machine-checked standard — nothing here is enforced by a
checker, lint rule, or CI step.

## What we borrow from Ableton

- **Panels, not dialogs.** The app is one persistent shell — header, mode tabs
  (`#mode-tabs`), and a `#workspace` of side panels plus a `#stage`. Analysis results
  dock beside the spectrum (`#stage`) rather than replacing the screen. Modal
  overlays are the exception, reserved for momentary choices (e.g. the source
  picker, #543).
- **Collapsible, foldable density.** Per-strip fold (`.live-ch-fold`, #40) and
  group-level collapse (`.live-group-fold`, #483) in the Live view. Collapsed
  headers keep a one-line summary so information density degrades gracefully
  instead of hiding information outright.
- **Dense, flat, small type, tight padding, 1px borders.** Body type is 14px
  (`--fs-body`), labels 12px (`--fs-label`), micro 11px (`--fs-micro`). Borders are
  1px hairlines in translucent white — `--border-subtle` at 5.5% alpha,
  `--border-default` at 9%. Controls come in three heights: `--control-h-sm` 28px,
  `--control-h` 36px, `--control-h-lg` 44px.
- **Color as signal, not decoration.** A dark neutral ramp (`--neutral-1000`
  through `--neutral-50`) carries the chrome. Color is reserved for meaning: gold
  (`--gold-500`) for brand/primary/focus, semantic good/check/issue
  (`--good-500`/`--check-500`/`--issue-500`), grade colors (`--grade-a` through
  `--grade-f`), the spectral band ramp (`--band-sub` through `--band-brilliance`),
  and meter states (`--meter-good`/`--meter-hot`/`--meter-clip`).
- **Monochrome iconography.** Icons inherit text color via `currentColor` — there
  is no multicolor icon set.
- **Direct manipulation with immediate feedback.** Fast motion tokens
  (`--dur-instant` 80ms, `--dur-fast` 120ms, `--dur-base` 180ms) drive transitions
  on controls and meters (`--transition-control`, `--transition-meter`).
  `prefers-reduced-motion` is respected throughout.
- **Distinct modes, one screen each.** The header mode tabs (`#mode-tabs`,
  `.mode-tab`) switch whole-screen modes the way Ableton switches between Session
  and Arrangement view — no nested navigation.

## What we deliberately do not borrow

- Ableton's browser hierarchy (the left-hand library tree) — Sound Buddy has no
  content library to browse.
- The device-chain metaphor — analysis is not a signal chain the user assembles.
- Anything that assumes the user is *authoring* — clip launching, editing,
  warping. Sound Buddy measures; it does not create.

## The tiebreaker

Where Ableton familiarity conflicts with measurement clarity, **measurement wins**.
Ableton lets the user decide what sounds good; Sound Buddy tells the user what is
good. That is the whole difference.

## Where the system lives

- `app/renderer/src/styles/tokens.css` — the token set (`:root` custom
  properties): neutral ramp, surfaces, borders, text tiers, King Midas gold
  primary, azure secondary, semantic/grade/band/meter colors, the Geist + Geist
  Mono type stack with its full size scale, spacing/control sizes, radius scale,
  elevation, and motion. Imported from the claude.ai/design "Sound Buddy macOS
  wireframe"; dark-first.
- `app/renderer/src/styles/app.css` — component styles consuming those tokens.

## Open questions

- Panels are collapsible but not user-resizable — `--panel-w` is a fixed 260px.
  Full "resizable everything" is direction, not current state.
- Dark-first only; no light theme tokens exist. Whether one is ever wanted is
  unresolved.
- The relationship between mode tabs and the report-card / Pro-gated modes
  (`.tab-lock`, `.tab-soon`) isn't described here — worth a follow-up if the
  gating pattern grows.

These are follow-up questions, not decisions made in this doc.
