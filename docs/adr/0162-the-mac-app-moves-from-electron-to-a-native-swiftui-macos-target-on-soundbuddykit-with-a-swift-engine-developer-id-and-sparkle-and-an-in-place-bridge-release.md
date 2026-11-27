# The Mac app moves from Electron to a native SwiftUI macOS target on SoundBuddyKit, with a Swift engine, Developer ID and Sparkle, and an in-place bridge release

- Status: Proposed
- Date: 2026-10-11

## Context

Patrick wants the Pro Mac app moved from Electron to native Swift. The migration plan,
[docs/design/native-swift-mac-migration-plan.md](../design/native-swift-mac-migration-plan.md),
holds the evidence, parity matrix, risks and slice list. This record holds the decisions.

What exists today:

- **Electron app** (`app/`, version 0.9.15 in `app/package.json`). Electron 44 and
  electron-builder 26, `appId: com.soundbuddy.app`, productName "Sound Buddy", Apple Silicon
  only, macOS 26 minimum (`app/electron-builder.yml`). Main process in `app/electron/` (62
  invoke channels in `app/electron/preload.ts`), React renderer in `app/renderer/`.
- **Python engine** (`packages/audio-engine/scripts/`). `spectrum.py` does offline STFT
  analysis. `stream.py` does live capture through `sounddevice` (PortAudio), metering and WAV
  recording, one device per process. The file pipeline
  (`packages/audio-engine/src/analyze/orchestrate.ts`) also shells out to sox, ffprobe and
  ffmpeg's ebur128 filter. `app/build/afterPack.js` bundles sox, ffmpeg and a relocatable
  Python into the `.app`, which is why `app/build/entitlements.mac.plist` needs
  `disable-library-validation` and why signing has to skip thousands of resource files.
- **Updates** run through `electron-updater` (`app/electron/auto-updater.ts`) against the
  `latest-mac.yml` feed in the public `on-par/sound-buddy-releases` repo, plus the `latest.json`
  manifest (ADR-0002) that the site download button reads. **There is no Sparkle appcast
  anywhere in this repo today.** Sparkle would be new.
- **Signing**: `.github/workflows/release.yml` signs with a Developer ID Application
  certificate in a temporary keychain, notarizes and staples the app and DMG, verifies with
  `codesign`, `stapler` and `spctl`, checks the update feed, and publishes as a draft, then
  promotes it last (ADR-0095).
- **SoundBuddyKit** (`apps/ios/SoundBuddyKit`) already declares `.macOS(.v14)` in
  `Package.swift` and imports only Foundation, Observation and Accelerate. It has the vDSP
  `SpectrumAnalyzer` (single-frame parity with `spectrum.py`, pinned at 0.05 dB by
  `make_spectrum_parity_fixture.py`), the RTA grid, 7-band coaching with smoothing and
  stabilizing, speech/music program tracking, bundled ideal curves (ADR-0154), the target-curve
  editor, and the X32/M32 OSC codec, session reducer and armed EQ writer (ADR-0161). Capture
  enters through the `LiveAudioSource` protocol in `AnalyzeModel.swift`. The iOS app target
  (`apps/ios/SoundBuddy`) holds the SwiftUI views and the `AVAudioSession` mic adapter.
- **Product lock** (#1518, 2026-09-25 and 2026-10-04): Pro is the Mac app with one Analyze
  tab (live and file), customizable EQ curves and channel listening. Record is Main and
  Measurement only, each mono or stereo (ADR-0160). Non-hedgehog surfaces sit behind
  default-off flags (ADR-0148). Founding at $199 is the preferred first paid SKU, sold through
  Stripe Payment Links that mint SB1 Ed25519 license keys (ADR-0016, ADR-0093).

## Decision

1. **Architecture: a separate native macOS app target that shares SoundBuddyKit.** Add a
   SwiftUI macOS target (working name `SoundBuddyMac`) next to the iOS target in
   `apps/ios/project.yml`. Do not use Mac Catalyst. Do not fold both platforms into one
   multiplatform target. Move platform-neutral SwiftUI (RTA, EQ curve, console EQ panel) into a
   shared library product so both apps draw the same views. Platform code stays in each app
   target: `AVAudioSession` on iOS, a Core Audio device adapter that implements
   `LiveAudioSource` on macOS. Reasons: the Mac needs Core Audio device-by-device selection
   and two devices open at once (Main and Measurement), a menu bar, a Settings scene, normal
   windows, Developer ID entitlements and Sparkle. None of that applies to iOS. The Mac app must
   also keep the bundle ID `com.soundbuddy.app`, while iOS ships as `com.soundbuddy.ios`.
2. **Audio engine: port to Swift with Accelerate/vDSP. The native app bundles no Python, sox
   or ffmpeg.** Live capture, metering, file decode (AVFoundation), STFT analysis, loudness
   (EBU R128), the rules, the narratives and grading all move into SoundBuddyKit. The Python
   engine stays in the repo as the parity oracle and for the `buddy` CLI. It is not deleted by
   this decision.
3. **Parity is proven by golden fixtures generated from the current engine.** Python and the
   TypeScript analysis code generate fixtures. A Linux CI job regenerates them and fails on
   drift. A macOS CI job runs `swift test` against them with per-metric tolerances. No native
   surface ships to users until its parity tests pass. Tolerances are listed in the plan.
4. **Distribution: Developer ID, notarization and Sparkle 2, not the Mac App Store.** Keep
   selling through Stripe Payment Links and SB1 license keys, verified in Swift with CryptoKit
   against the same embedded key list. Revisit the Mac App Store later as a separate SKU, not as
   the main channel.
5. **Existing Electron users move by an in-place bridge release.** The first native GA build
   is signed by the same team with `CFBundleIdentifier` `com.soundbuddy.app` and a version
   above every 0.9.x. It is published to `on-par/sound-buddy-releases` with a `latest-mac.yml`
   and zip that electron-updater accepts. Installed Electron apps then download it and swap it in
   through their normal update banner. From then on, the native app updates through a Sparkle
   appcast published in the same releases repo. Every native release keeps publishing
   `latest-mac.yml` and `latest.json` until Electron is retired and a grace window has passed.
   Slice S01 must prove this path on a real install before any other distribution work depends
   on it.
6. **Cutover is strangler-style and side by side.** A "Sound Buddy Beta" build with its own
   bundle ID and Sparkle beta feed installs next to Electron. It imports Electron's settings,
   license and history read-only. Surfaces land in the order the plan gives: Live Analyze,
   then file Analyze and reports, then Record, then curves and licensing. Unfinished surfaces stay
   behind a Swift feature-flag registry that mirrors ADR-0148 (default off, launch-time only)
   and is shared with iOS (#1662). At GA, the native app adopts Electron's files in place, in the
   same JSON shapes, so a rollback to Electron still reads them.
7. **Non-hedgehog Electron surfaces are not ported.** That covers the Session DAW, soundcheck
   playback, Directory batch, Ring Out, Build Guide, the Report Card workspace and the Mac console
   workspace. They stay in Electron until it retires. Console EQ comes to the Mac later, through
   the SoundBuddyKit console code once its transport (#1666) exists.
8. **Electron retires on criteria, not a date.** The criteria are in the plan: every "Must"
   parity row green, the bridge proven, a run of real services on native, and a grace window
   after GA. After that, `app/` leaves CI and Electron gets no more releases.

## Consequences

Positive: one Swift codebase serves iPhone, iPad and Mac, and a fix in the kit reaches both.
The Mac bundle loses Python, sox and ffmpeg, so the hardened-runtime exceptions for JIT,
unsigned executable memory and library validation can go. Live capture runs in-process instead
of piping JSON lines from a child process every 100 ms. Existing users keep one app, one icon
and one update path. Pricing and license keys do not change, and there is no store commission.

Negative: this is a large port. The analysis logic (STFT, classification, loudness, rules,
narratives, grading) will exist in both TypeScript/Python and Swift until Electron retires, and
the parity fixtures are the only thing keeping the two in step. Mac CI will need macOS runners
for Swift, which `ios.yml` does not have today. Sparkle adds an EdDSA signing key as a new
release secret. The bridge depends on electron-updater and Squirrel.Mac accepting a bundle that
is not Electron. That is expected because the designated requirement (bundle ID plus team) is
unchanged, but it is unproven until S01 runs. If S01 fails, existing users need a manual
download, and the plan has a fallback. Whether macOS keeps the microphone permission across the
swap is also unproven, so onboarding must handle a fresh prompt. The flagged Electron surfaces
disappear for anyone who turned them on with `SOUND_BUDDY_FEATURES`.

## References

- [Migration plan](../design/native-swift-mac-migration-plan.md)
- [Issue #1518: Hedgehog launch product lock](https://github.com/on-par/sound-buddy/issues/1518)
- [Issue #1662: iOS feature-flag registry](https://github.com/on-par/sound-buddy/issues/1662)
- [Issue #1666: iOS console connect by manual IP](https://github.com/on-par/sound-buddy/issues/1666)
- ADR-0002: release manifest (`latest.json`)
- ADR-0015: audio-engine DSP stays numpy-only
- ADR-0016: license verification trusts an ordered list of Ed25519 keys
- ADR-0093: checkout URLs are env-only
- ADR-0095: CI publishes as draft, verifies the feed, promotes last
- ADR-0147: Pro/desktop analysis stays on-device
- ADR-0148: env-only feature-flag registry, default off
- ADR-0150: custom EQ curves persist through a Pro-gated write
- ADR-0151: Analyze listen channel is a single in-memory selection
- ADR-0154: iOS bundles the Mac ideal curves as ideal-curve.v1 JSON
- ADR-0160: Record is Main and Measurement only
- ADR-0161: iOS console EQ writes through an armed writer
