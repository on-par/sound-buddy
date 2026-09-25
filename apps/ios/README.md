# Sound Buddy for iPhone (P0 scaffold)

A standalone iPhone app: the built-in mic feeds a live 7-band spectrum, with EQ
coaching from the same rules the Mac uses. All analysis runs on the phone. No
audio leaves the device, and the app has no upload path. The LAN companion
(phone ↔ Mac) is parked. For that reason the app has no local-network
entitlement and no Bonjour keys.

This is a scaffold, not an App Store build. There is no signing, TestFlight,
or notarization yet.

## Layout

| Path | What it is |
| --- | --- |
| `SoundBuddy/` | App target: SwiftUI views (`AnalyzeView`), the AVAudioEngine mic adapter (`MicCapture`), `Info.plist` (mic usage text), assets. |
| `SoundBuddyKit/` | Local SwiftPM package with all testable logic: band table, `SampleRingBuffer`, Accelerate `SpectrumAnalyzer`, `BandDeviationCoach`, `AnalyzeModel`, Codable contract models. |
| `Contracts/` | Shared JSON contracts (`IdealCurve`, `CoachingEvent`): JSON Schemas and examples that both Mac and iOS can read. |
| `project.yml` | XcodeGen spec. This is the source of truth for `SoundBuddy.xcodeproj`. |
| `SoundBuddy.xcodeproj` | Generated from `project.yml` and checked in, so you can open it without installing XcodeGen. |
| `scripts/` | `swift-test.sh`, the contract validator, and the spectrum parity fixture generator (plus their Python tests). |

## Open in Xcode

1. Install Xcode (iOS 17+ SDK). If you have not accepted the license yet, run
   `sudo xcodebuild -license accept`.
2. Open `apps/ios/SoundBuddy.xcodeproj`. Xcode resolves the local
   `SoundBuddyKit` package on its own.
3. Select the **SoundBuddy** scheme and an iPhone Simulator.

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
2. Tap **Start listening**. The first time, iOS asks for microphone access.
   Allow it.
3. The Simulator uses your Mac's default input. Play music or speak near the
   Mac. The seven bars move, and each band shows a dB reading.
4. Play something tonally lopsided, such as a bass-heavy track. Within a
   second, up to three coaching cards appear. An example: "Bass is 6.2 dB over
   the target. Try a gentle cut around 60-250 Hz."
5. Check that the **Phone mic estimate** badge is always visible.
6. Tap **Stop**. The bars freeze and the mic indicator goes off.
7. To test the denied path, run `xcrun simctl privacy booted revoke microphone
   com.soundbuddy.ios` and tap **Start listening** again. The screen tells you
   to turn access on in Settings and shows an **Open Settings** button.

## Tests

The kit's tests use swift-testing and run on a Mac without a simulator:

```bash
apps/ios/scripts/swift-test.sh      # = swift test in SoundBuddyKit
```

If Xcode is not usable (for example, the license is not accepted yet), the
script falls back to the Command Line Tools. In Xcode, **Product › Test** on
the SoundBuddy scheme runs the same tests.

Contract and parity-fixture checks (Python 3; install `jsonschema`, `numpy`,
and `soundfile`):

```bash
python apps/ios/scripts/validate_contracts.py
(cd apps/ios/scripts && python test_validate_contracts.py && python test_make_spectrum_parity_fixture.py)
```

If you change `packages/audio-engine/scripts/spectrum.py`, regenerate the
parity fixture with `python apps/ios/scripts/make_spectrum_parity_fixture.py`.
CI does not catch drift here. `test_make_spectrum_parity_fixture.py` catches
it, but only when you run it locally.

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
