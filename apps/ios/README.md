# Sound Buddy for iPhone (P0 scaffold)

A standalone iPhone app: the built-in mic feeds an always-on, console-style
RTA (1/6-octave bars, 20 Hz-20 kHz, dBFS), with EQ coaching from the same
7-band rules the Mac uses. All analysis runs on the phone. No
audio leaves the device, and the app has no upload path. The LAN companion
(phone ↔ Mac) is parked. For that reason the app has no local-network
entitlement and no Bonjour keys.

See [TestFlight](#testflight) below for the one-command upload-and-distribute
step; there is no notarization (that's Mac-only).

## Layout

| Path | What it is |
| --- | --- |
| `SoundBuddy/` | App target: SwiftUI views (`AnalyzeView`), the AVAudioEngine mic adapter (`MicCapture`), `Info.plist` (mic usage text), assets. |
| `SoundBuddyKit/` | Local SwiftPM package with all testable logic: band table, `SampleRingBuffer`, Accelerate `SpectrumAnalyzer`, `BandDeviationCoach`, `AnalyzeModel`, Codable contract models, and the bundled ideal-EQ curves (`IdealCurveLibrary`, `Resources/IdealCurves/*.json`). |
| `Contracts/` | Shared JSON contracts (`IdealCurve`, `CoachingEvent`): JSON Schemas and examples that both Mac and iOS can read. |
| `project.yml` | XcodeGen spec. This is the source of truth for `SoundBuddy.xcodeproj`. |
| `SoundBuddy.xcodeproj` | Generated from `project.yml` and checked in, so you can open it without installing XcodeGen. |
| `scripts/` | `swift-test.sh`, the contract validator, the spectrum parity fixture generator, the icon generator (plus their Python tests), and the TestFlight upload/distribution scripts (`testflight.sh`, `asc-distribute.mjs`). |

## Open in Xcode

1. Install Xcode (iOS 17+ SDK). If you have not accepted the license yet, run
   `sudo xcodebuild -license accept`.
2. Open `apps/ios/SoundBuddy.xcodeproj`. Xcode resolves the local
   `SoundBuddyKit` package on its own.
3. Select the **SoundBuddy** scheme and an iPhone or iPad Simulator.

If you add or remove files under `SoundBuddy/`, or edit `project.yml`,
regenerate the project and commit the result:

```bash
brew install xcodegen
cd apps/ios && xcodegen generate
```

Do not hand-edit `project.pbxproj`. The next `xcodegen generate` overwrites
your changes.

To run on a physical iPhone, set your own team under **Signing &
Capabilities**. The project sets no team on purpose.

## Simulator smoke test

1. Run the **SoundBuddy** scheme (⌘R) on an iPhone Simulator.
2. The app starts listening by itself. It has no Start or Stop button. The
   first time, iOS asks for microphone access. Allow it. The header shows the
   Sound Buddy mark and name, with "Analyze · Listening" beneath.
3. The Simulator uses your Mac's default input. Play music or speak near the
   Mac. The RTA bars move, and white peak ticks hold above them for a moment.
   Lows glow green to orange as they get hot; mids and highs are cyan to blue.
   A dashed white target line rides on top of the bars, tracks the material's
   level, and keeps its shape as the level changes. Under the RTA,
   "Target · Worship – Full Band (auto)" shows with a matching dashed swatch.
4. Play something tonally lopsided, such as a bass-heavy track. Within a
   second, up to three coaching cards appear. An example: "Bass is 6.2 dB over
   the target. Try a gentle cut around 60-250 Hz." The cards update in place
   about once a second.
5. Tap the gear. Settings shows **Keep screen awake** and a **Microphone**
   section: the input in use, **System default** plus each available input
   (built-in data sources and connected mics), and the honesty footnote
   "Level is an uncalibrated estimate, not dBA." Pick an input: listening
   restarts on it, and the choice survives a relaunch while that input is
   still connected. When it is gone, Settings falls back to System default.
   The Analyze header has no mic badge.
6. The header level shows a large number with a tiny "dB" unit. It is an
   unweighted SPL estimate (overall dBFS + 103 dB), not dBA. A
   quiet room reads low; speaking or playing music raises it toward
   handheld-meter levels.
7. Go to the Home Screen. The app releases the mic (P0 has no background
   audio). Open the app again: it resumes listening by itself.
8. Rotate the Simulator (⌘→). The RTA fills the screen, and the Listening
   indicator, the dB estimate, the settings gear and Target legend stay
   visible. A "Coaching" handle sits at the bottom, and tapping it or swiping
   it up shows the same cards. Rotating back (⌘←) restores the portrait
   layout, and "Listening" never flickers to "Starting microphone…".
9. To test the denied path, run `xcrun simctl privacy booted revoke microphone
   com.soundbuddy.ios` and relaunch. The screen tells you to turn access on in
   Settings and shows an **Open Settings** button. After you allow access and
   return, listening starts.
10. Tap the Target legend (or the pencil). An **Editing target** chip with
    Cancel and Done takes the legend's place under the RTA. The RTA does not
    move and no new screen is pushed; the header still shows the listening
    indicator. The dashed target line turns solid, and white handles appear on
    it. Touching one gives a haptic (on a device) and dragging it reshapes the
    curve into a smooth spline around the handle, redrawing on every movement.
    Drag a handle past the top or bottom of the grid — it stops exactly at the
    ceiling or floor line rather than leaving the plot. Cancel or Done puts the
    legend back, returns the line to dashed, and hides the handles.
11. While still in edit mode, a row of **Flat / Music / Worship
    Classic / Worship Full Band** pills sits under the chip. Tapping one snaps the solid target
    line to that curve and highlights the pill. Dragging a handle afterwards
    reshapes the curve from that new baseline and un-highlights the pill.
    Cancel restores the pre-edit target, and the RTA does not move when edit
    mode opens or closes.
12. Play lopsided material until coaching cards and problem-marker pulses
    appear, then tap the Target legend to enter edit mode. Drag a handle or
    tap a preset pill: the coaching cards and pulses stop updating and hold
    their last values, no matter how long you keep editing. Tap Done — the
    cards refresh within about a second against the edited curve, and the
    legend now reads "Target · Custom". Repeat and tap Cancel instead — the
    cards refresh within about a second against the original curve, as if the
    edit never happened.
13. Rotate to landscape, play lopsided material until the problem-marker
    pulses show, and open the Coaching peek. Tap the Target legend to enter
    edit mode: the peek closes and the pulses vanish, and the Editing chip,
    preset pills and handles are fully unobstructed. The Coaching handle stays
    in place (the RTA does not move) but is dimmed and does not respond to tap
    or swipe. Tap Done or Cancel — the pulses return and the peek opens and
    closes by tap and swipe exactly as before.

## iPad pass

Run on **iPad Pro 13-inch (M4)** and **iPad mini**. The app is universal, so
check it runs natively rather than in the iPhone compatibility window:

1. Launch the app. It fills the whole screen with no black bars and no
   compatibility window border.
2. While Analyze is listening, rotate through all four orientations
   (portrait, landscape left, upside-down portrait, landscape right).
   "Listening" never flickers and there is no restart or permission re-prompt.
   Landscape (in any rotation) shows the big RTA on the left, about 70% of
   the width and nearly the full height, with the Coaching cards inline in a
   column on the right and no Coaching peek (#1659). With a console linked
   (Debug, chip visible), the right column widens to about 36% and shows the
   read-only console EQ panel (#1669) on top with the Coaching cards
   scrolling beneath it; the RTA keeps the rest (about 64%). Portrait (either way up)
   shows the brand header, an RTA that grows to fill the height, and the
   Coaching cards directly under it with no empty band below.
3. In either orientation, tap the Target legend. The Editing chip and preset
   pills appear under the RTA, the problem-marker pulses hide and the
   Coaching cards freeze, and the RTA does not move or resize. Done or Cancel
   puts everything back without moving the RTA.
4. Tap the gear. The Settings sheet presents (a form sheet on iPad is
   expected), the microphone picker and **Keep screen awake** toggle work,
   and dismissing it returns to Analyze, still listening.
5. Put the app in Split View at roughly 1/3 width — Analyze shows the
   iPhone portrait layout (fixed-height RTA). A short, wide Stage Manager
   window shows the iPhone landscape layout with the Coaching peek. In both
   cases nothing is clipped: header, RTA and Coaching all stay fully visible.
   The thresholds live in `AnalyzeLayout` (`regularMinWidth`,
   `wideMinWidth`, `wideMinHeight`).
6. iPhone is unchanged: no upside-down orientation, same layouts, same RTA
   position rules.

## TestFlight

`apps/ios/scripts/testflight.sh` is a one-command upload-and-distribute step
for the Mac Mini: it archives the SoundBuddy scheme, exports and uploads with
the App Store Connect API key via `xcodebuild`, then calls
`asc-distribute.mjs` to wait for processing, clear "Missing Export
Compliance" if App Store Connect still asks, set What to Test, add the build
to every configured tester group, and submit beta app review when external
testing needs it.

**Prerequisites** (one-time, in App Store Connect):
- Xcode 15.3+ (for the `app-store-connect` export method) and Node 20+.
- An App Store Connect API key with the **App Manager** role.
- The internal and external tester groups you want to ship to, and Beta App
  Review contact information under **TestFlight > Test Information**.

**Signing (#1696):** the script signs **manually** with the existing App
Store distribution profile and never creates certificates or profiles. The
defaults live in the `signing` block of `apps/ios/testflight.config.json`:

| Key | Default |
| --- | --- |
| `teamId` | `Q7LB49TPBS` |
| `provisioningProfile` | `Sound Buddy iOS App Store` |
| `identity` | `Apple Distribution: On PAR Dev, LLC (Q7LB49TPBS)` |
| `keychain` | `~/Library/Keychains/soundbuddy-build.keychain-db` |

Override them per run with `--team`, `--profile`, `--identity` and
`--keychain` (or the `DEVELOPMENT_TEAM` and `TESTFLIGHT_SIGNING_KEYCHAIN` env
vars). The keychain is passed to codesign explicitly
(`OTHER_CODE_SIGN_FLAGS=--keychain <path>`), and the profile reaches only the
app target through `SOUNDBUDDY_PROVISIONING_PROFILE` (see `project.yml`; the
SoundBuddyKit package targets reject a provisioning profile). Before
archiving, a read-only preflight checks that the identity is in that
keychain, the profile is installed, and the keychain is **unlocked**. The
script never unlocks it: unlock the build keychain yourself first, or the run
stops at the preflight instead of hanging on a codesign password prompt.

Xcode's automatic provisioning updates (`-allowProvisioningUpdates`,
automatic signing) are off unless you pass `--allow-provisioning-updates`.
Only use that flag when you mean to let Xcode create or change certificates
and profiles in the team.

**Env vars:**
- `ASC_KEY_ID`, `ASC_ISSUER_ID`: from the API key you create in **Users and
  Access > Integrations**.
- `ASC_KEY_PATH`: path to the downloaded `.p8` private key, or
  `ASC_KEYCHAIN_SERVICE`: the name of a generic-password keychain item on
  the Mini holding the key, read via `security find-generic-password`.
- Optional signing overrides: `DEVELOPMENT_TEAM` (team ID) and
  `TESTFLIGHT_SIGNING_KEYCHAIN` (build keychain path).
- Optional config overrides: `ASC_BUNDLE_ID`, `ASC_INTERNAL_GROUPS` and
  `ASC_EXTERNAL_GROUPS` (comma-separated group names), and
  `ASC_PROCESSING_TIMEOUT_SECONDS`.

Never commit the `.p8` key or echo these values; `.gitignore` already blocks
`*.p8` and `AuthKey_*`.

**Upload:**

```bash
apps/ios/scripts/testflight.sh [--build-number N] [--notes "What changed"]
```

The build number defaults to the latest App Store Connect build for this
version plus one.

**Dry run** (no writes, no archive, no upload):

```bash
apps/ios/scripts/testflight.sh --dry-run
```

prints the signing plan (style, team, profile, identity, keychain, and
whether provisioning updates are allowed), the exact `xcodebuild archive` and
`-exportArchive` commands with the API key values redacted, the generated
`ExportOptions.plist`, and the signing preflight. When the ASC env vars are
set it then prints the next build number and the read-only distribution plan
for the latest build already in App Store Connect. The distributor alone:

```bash
node apps/ios/scripts/asc-distribute.mjs --dry-run --version 0.1.0 --build-number N
```

**Local archive, no upload:** `testflight.sh --no-upload --build-number N`
archives and exports an `.ipa` with the same signing into
`$TMPDIR/soundbuddy-testflight-export` and skips the upload and distribution.

**Tester groups:** add or rename groups by editing
`apps/ios/testflight.config.json` (or the `ASC_*_GROUPS` env vars above). A
group name that doesn't exist yet in App Store Connect fails loudly, naming
the group — create it there first.

**Export compliance:** `project.yml` sets
`INFOPLIST_KEY_ITSAppUsesNonExemptEncryption: NO` (only OS-provided
HTTPS/standard crypto is used), guarded by
`scripts/test_export_compliance.py`. If a build still lands on "Missing
Export Compliance" in App Store Connect, the distributor fixes it
automatically on the next run.

**Key rotation:** create a new key in App Store Connect under **Users and
Access > Integrations**, store it in the Mini's keychain (or a path outside
the repo) and point `ASC_KEY_PATH`/`ASC_KEYCHAIN_SERVICE` at it, update
`ASC_KEY_ID`/`ASC_ISSUER_ID`, then revoke the old key.

**Tests:**

```bash
node --test apps/ios/scripts/asc-distribute.test.mjs
python3 -m unittest discover -s apps/ios/scripts -p 'test_*.py'
python3 apps/ios/scripts/test_testflight_signing.py   # signing plan + dry-run (#1696)
```

## Tests

The kit's tests use swift-testing and run on a Mac without a simulator:

```bash
apps/ios/scripts/swift-test.sh      # = swift test in SoundBuddyKit
```

If Xcode is not usable (for example, the license is not accepted yet), the
script falls back to the Command Line Tools. In Xcode, **Product › Test** on
the SoundBuddy scheme runs the same tests.

Contract, parity-fixture, and icon checks (Python 3; install `jsonschema`,
`numpy`, `soundfile`, and `Pillow`):

```bash
python apps/ios/scripts/validate_contracts.py
(cd apps/ios/scripts && python test_validate_contracts.py && python test_make_spectrum_parity_fixture.py && python test_make_ios_icons.py && python test_ios_device_family.py)
```

If you change `packages/audio-engine/scripts/spectrum.py`, regenerate the
parity fixture with `python apps/ios/scripts/make_spectrum_parity_fixture.py`.
CI does not catch drift here. `test_make_spectrum_parity_fixture.py` catches
it, but only when you run it locally.

The app icon and the header's `BrandMark` are generated from the Mac icon
(`app/build/icon.png`). If that icon changes, run
`python apps/ios/scripts/make_ios_icons.py`. `test_make_ios_icons.py` catches
drift, again only locally.

## CI: Swift does not compile on Linux

CI runs on Ubuntu. SoundBuddyKit imports Accelerate, and the app needs the iOS
SDK. Both are Apple-only, so **CI does not build or test any Swift code.**

- `.github/workflows/ios.yml` runs only when `apps/ios/**` changes. It
  validates the JSON contracts (schemas, examples, and the validator's own
  tests). It does not run `xcodebuild`. It is informational and is **not** a
  required check.
- `.github/workflows/ci.yml` (the Electron suite) ignores `apps/ios/**`. A
  change that touches only `apps/ios/**` does not start the Electron suite. Any
  change that also touches other paths runs the suite in full.

Before you push Swift changes, run `scripts/swift-test.sh` and do a Simulator
build yourself. A macOS runner for real `xcodebuild` CI can come later, after
someone budgets for it.
