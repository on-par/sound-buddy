# Native Swift Mac app: migration plan

Plan for moving the Pro Mac app from Electron to native Swift. It is governed by
[ADR-0162](../adr/0162-the-mac-app-moves-from-electron-to-a-native-swiftui-macos-target-on-soundbuddykit-with-a-swift-engine-developer-id-and-sparkle-and-an-in-place-bridge-release.md).
Where this plan and the ADR disagree, the ADR wins.

Status: proposal for Patrick's review. No issues have been filed from it. The slice list in
section 7 is written to be filed later, one issue per slice.

Every claim below points at code on `main` as of 2026-10-11 (`60adf96`). Anything the code
cannot answer is listed under [Open questions](#8-open-questions) instead of guessed.

## 1. What exists today

### 1.1 Electron app (`app/`)

| Area | Where | Notes |
| --- | --- | --- |
| Packaging | `app/electron-builder.yml` | `appId: com.soundbuddy.app`, productName "Sound Buddy", arm64 zip and DMG, `minimumSystemVersion: "26.0"`, hardened runtime. |
| Version | `app/package.json` | 0.9.15, Electron 44, electron-builder 26, electron-updater 6.8. |
| Main process | `app/electron/` | 62 `ipc.invoke` channels in `preload.ts`. Handlers in `app/electron/ipc/`. |
| Renderer | `app/renderer/src/` | React plus older `app/renderer/*.js` state modules. Analyze is the default tab (`mode-switch.ts`). |
| Live and Listen | `app/electron/ipc/measurement-source.ts`, `live-capture.ts`, `python-stream.ts` | Each stream is one `stream.py` child process emitting NDJSON (ADR-0010). |
| Record | `app/electron/ipc/record-take.ts` | Main and Measurement on two dedicated `stream.py` processes (ADR-0160). |
| File analysis | `app/electron/ipc/analysis.ts`, `run-analysis.ts` | Calls `analyzeAudio` from the bundled audio-engine CJS build. |
| Grading | `app/renderer/grading.js`, `grading.golden.json` | Letter grade and score. A golden test already exists. |
| Report export | `app/renderer/src/report-export.ts` | PNG export that must carry no metadata chunks. |
| File types | `app/electron/ipc/audio-files.ts` | `AUDIO_EXTENSIONS`: wav, aif, aiff, flac, mp3, m4a, mp4, mov, caf. |
| Feature flags | `app/electron/feature-flags.ts` | Env-only `SOUND_BUDDY_FEATURES`, default off, never persisted (ADR-0148). Ids: reportCard, directory, session, console, buildGuide, ringOut. |
| Licensing | `app/electron/license.ts`, `packages/license-policy/` | SB1 keys, Ed25519, embedded key list (ADR-0016), 14-day trial, `PRO_FEATURES` gate. |
| Checkout | `app/electron/checkout.ts` | monthly, annual and founding Stripe URLs, env-baked at build (ADR-0093). |
| Updates | `app/electron/auto-updater.ts`, `updater.ts` | electron-updater against `latest-mac.yml` in `on-par/sound-buddy-releases`. `autoDownload = false`, `autoInstallOnAppQuit = true`. |
| Console | `packages/console/`, `app/electron/ipc/console*.ts` | Read-only X32/M32 OSC (ADR-0060, ADR-0075), behind the `console` flag. |

### 1.2 Python and native-tool engine (`packages/audio-engine/`)

- `scripts/spectrum.py` (443 lines): loads audio with `soundfile`, falling back to an ffmpeg
  subprocess for m4a and aac, and downmixes to mono float32. Centered, zero-padded STFT with
  `N_FFT = 4096`, `HOP = 1024` and a periodic Hann window. Outputs the 7 legacy bands, a
  48-point log curve (`curve_from_power`, 20 Hz to 20 kHz), up to 24 time frames, each
  classified as speech, music or silence, plus segments, `content_type`, spectral centroid and
  85% rolloff (on a separate 2048/512 STFT) and dynamic range.
- `scripts/stream.py` (852 lines): `sounddevice` capture. Device by name or index. The
  channel grammar is `N` for a mono strip and `N-M` for a stereo pair. Meter ticks every 0.1 s
  over a 0.2 s window, heavier windows every `window_secs`, and peaks for the DAW lanes.
  `--record` writes one interleaved WAV. `--session-dir` writes one 24-bit PCM stem per armed
  strip plus `session.json`.
- `scripts/playback.py`, `scripts/waveform_peaks.py`: soundcheck playback and DAW peaks. These
  are only used by surfaces behind the `session` flag.
- `src/analyze/orchestrate.ts`: runs `sox stat`, `ffprobe`, `spectrum.py` and ffmpeg
  `ebur128` in parallel.
- `src/analyze/rules.ts`, `*-narrative.ts`, `rule-narrative.ts`: harshness, gate, phase and gain
  rules and their deterministic narrative templates (ADR-0027, ADR-0028).
- Dependencies: numpy, soundfile and sounddevice only (`scripts/requirements.txt`, ADR-0015).
- `app/build/afterPack.js` bundles sox, ffprobe/ffmpeg with their dylibs and a relocatable
  Python. That is why `app/build/entitlements.mac.plist` carries `allow-jit`,
  `allow-unsigned-executable-memory` and `disable-library-validation`, and why
  `electron-builder.yml` needs a long `signIgnore` list.

### 1.3 iOS app and SoundBuddyKit (`apps/ios/`)

- `project.yml` (XcodeGen): iOS 17, `com.soundbuddy.ios`, universal iPhone and iPad, Swift 6.
- `SoundBuddyKit/Package.swift`: platforms `.iOS(.v17), .macOS(.v14)`. Sources import only
  Foundation, Observation and Accelerate, so the kit already compiles for macOS. `swift test`
  runs on a Mac (`scripts/swift-test.sh`).
- Native today:
  - `SpectrumAnalyzer.swift`: vDSP real FFT, periodic Hann, 7-band energy, RTA grid levels,
    overall level, and classification inputs. Its parity with `spectrum.py` is single-frame
    only, at 0.05 dB (`SpectrumAnalyzerTests.swift`, fixture from
    `scripts/make_spectrum_parity_fixture.py`). The file carries
    `TODO(parity)` for the centered STFT with hop averaging and for the 48-point curve.
  - `RTA.swift`: about 60 bands at 1/6 octave, display only.
  - `BandDeviationCoach`, `CoachingDeltaSmoother`, `CoachingStabilizer`, `BandCoachingCopy`:
    7-band coaching, the same rules as the Mac.
  - `ProgramContentClassifier`, `ProgramModeTracker`: speech/music detection with hysteresis.
  - `IdealCurveLibrary`, `Contracts/IdealCurve.swift`, `Resources/IdealCurves/*.json`:
    ideal-curve.v1 (ADR-0154).
  - `TargetCurveEditor`, `TargetCurveHandles`, `TargetCurvePreset`: curve editing (ADR-0155).
    The custom target is session-only (`sessionCustomTarget` in `AnalyzeModel.swift`) and is not
    persisted.
  - `SampleRingBuffer`, `LiveInputFormat`, `MicInput` (picker policy, but
    `AVAudioSession`-shaped: port UID plus data source).
  - `AnalyzeModel`: the screen model. Capture enters through `protocol LiveAudioSource`.
  - `AnalyzeLayout`: portrait, landscape and iPad layout.
  - `Console/`: `OSCCodec`, `ReadOnlyOSCGuard`, `ConsoleSessionReducer`, `ConsoleSessionModel`,
    `ConsoleEQ*`, `ConsoleEQWriter` with its allowlist (ADR-0161). There is no UDP transport yet
    (#1666 is open) and no feature-flag registry yet (#1662 is open).
- App target `SoundBuddy/`: `AnalyzeView` (imports UIKit), `MicCapture` (AVAudioSession and
  AVAudioEngine), `RTAView` (uses `UIImpactFeedbackGenerator`), `EQCurveView`,
  `ConsoleEQPanel`, `ConsoleChip`, `ConsoleTargetPickerView`.
- Not in iOS: recording, file analysis, reports, grading, licensing, persistence of custom
  curves.
- CI: `.github/workflows/ios.yml` runs on Ubuntu and cannot compile Swift. It validates
  contracts, project settings and the TestFlight distributor. `ci.yml` ignores `apps/ios/**`.

### 1.4 Release, signing and update feeds

- `.github/workflows/release.yml` runs on `macos-14` on a `v*` tag. It imports the Developer
  ID certificate into a temporary keychain, builds the zip and DMG with
  `-c.mac.notarize=true` (APPLE_ID, app-specific password, team ID), verifies with
  `codesign --verify --deep --strict`, `stapler validate` and `spctl --assess` for both app and
  DMG, then runs `scripts/ci-update-feed.mjs` and `scripts/ci-release-manifest.mjs`. It
  publishes the DMG, zip, `latest-mac.yml` and `latest.json` as a draft release in
  `on-par/sound-buddy-releases` and promotes it last (ADR-0095).
- Update feed in use: electron-updater's GitHub provider reading `latest-mac.yml`
  (`publish:` block in `electron-builder.yml`). Its Mac path installs the downloaded zip through
  Electron's built-in Squirrel.Mac.
- `latest.json` (ADR-0002) at
  `https://github.com/on-par/sound-buddy-releases/releases/latest/download/latest.json` feeds
  the site download button.
- **Sparkle is not used anywhere in the repo today.** A search for `sparkle` and `appcast`
  finds only an EQ tip string and an icon name. Sparkle is new work in this plan.

### 1.5 Where Electron keeps user data

| Data | Location | Format | Source |
| --- | --- | --- | --- |
| Settings | `~/Library/Application Support/SoundBuddy/settings.json` | JSON `AppSettings` (idealProfile, customIdealProfiles, storageDir, rigs, activeRigId, measurementDeviceName, splCalibrationOffsetDb, gradingProfile, gradingRubric, consoleNetworkConsentGranted and more) | `app/electron/settings.ts` `settingsPath()`, `app/electron/ipc/api.ts` |
| License and trial | same folder, `license.json` | JSON with the SB1 key and `trialStartedAt` | `app/electron/license.ts` |
| Install id, pending crash | same folder | small files | `telemetry.ts`, `crash-reporting.ts` |
| Waveform peaks cache | under userData | cache | `preload.ts` comment (ADR-0004) |
| Logs | `~/Library/Logs/SoundBuddy` | text | `logger.ts`, `app.setName('SoundBuddy')` in `main.ts` |
| Recordings and takes | `storageDir`, default `~/Music/Sound Buddy` | `sound-buddy-<stamp>/main/01-main.wav`, `measurement/01-measurement.wav`, `session.json` | ADR-0160, `stream.py` |
| Analysis history | `<record dir>/history/*.json` | one `AnalysisSummary` JSON per analysis | `app/electron/ipc/analysis.ts` `historyDir()`, `storage.ts` |
| Renderer localStorage | Chromium storage under userData | keys such as `sb-build-order-v1`, `sb-ringout-profiles-v1`, `sb-pass-mode-v1` | `app/renderer/build-order-state.js`, `feedback-ringout-state.js`, `pass-mode-state.js` |

The folder name comes from `app.setName('SoundBuddy')` together with the path documented in
`license.ts`. Slice M01 confirms it on a real install before the importer depends on it.

## 2. Target architecture

### 2.1 Options

| | Native macOS target (recommended) | Mac Catalyst | One multiplatform target |
| --- | --- | --- | --- |
| Audio devices | Full Core Audio HAL: list every device, open a chosen device by ID, open two devices at once for Main and Measurement, read the channel count of wide interfaces. | Starts from the iOS `AVAudioSession` route model, which has no "open this device by ID" or "open two devices" concept. Reaching the HAL from Catalyst is awkward. | Same as native on the Mac slice, but `#if os(macOS)` spreads through one target. |
| Menu bar, windows, Settings | AppKit menus, `Settings` scene, multiple windows, `MenuBarExtra`. | iPad idioms: menus and windows are limited and look like iPad. | Works, but every scene needs platform conditionals. |
| Sparkle | Supported: Sparkle 2 is an AppKit framework. | Not a supported Sparkle configuration. It needs an AppKit bridge bundle. | Works on the Mac slice, but the framework has to be excluded from iOS builds. |
| Bundle ID | `com.soundbuddy.app`, required for the bridge (section 4). | Defaults to `maccatalyst.` plus the iOS ID unless overridden. | One target, so per-SDK bundle ID overrides. Easy to get wrong. |
| Entitlements and signing | Developer ID, hardened runtime, `audio-input`. Separate from iOS. | Mixed iOS and Mac entitlements. | One target with two distribution methods (App Store for iOS, Developer ID for Mac). |
| Code sharing | Through SoundBuddyKit plus a shared SwiftUI library. Views that are already platform-neutral move once. | Highest share of UI code, but the iOS UI is phone and tablet first. | Same share as native, inside one target. |
| Release flows | iOS `testflight.sh` is untouched. Mac gets its own release workflow. | Changes the iOS project in ways that affect TestFlight. | Changes the iOS target that TestFlight build 11 ships from. |

### 2.2 Recommendation

Add a native macOS app target, `SoundBuddyMac`, to `apps/ios/project.yml`. It depends on
SoundBuddyKit plus a new shared SwiftUI library product, working name `SoundBuddyUI`, inside
the kit package.

- **SoundBuddyKit** (no UI, no AVFoundation session code): all DSP, models, coaching, curves,
  contracts, console logic, the new engine pieces from section 3, licensing and settings
  models. It stays testable with `swift test` on macOS.
- **SoundBuddyUI**: `RTAView`, `EQCurveView`, `ConsoleEQPanel` and the other views that have
  no UIKit dependency, moved out of `apps/ios/SoundBuddy/`. Haptics (`UIImpactFeedbackGenerator`
  in `RTAView`) go behind a small platform protocol.
- **iOS target** keeps `AnalyzeView`, `MicCapture`, `IdleTimer` and the
  `AVAudioSession` code.
- **Mac target** adds `CoreAudioCapture` (implements `LiveAudioSource`), a Core Audio
  device catalog, the Record writer, the Mac window, menu and Settings scenes, Sparkle, and
  Mac entitlements (hardened runtime, `com.apple.security.device.audio-input`). It drops the
  three Electron and Python exceptions.
- Deployment target macOS 26 on Apple Silicon, the same floor as Electron today.
- The directory stays `apps/ios` for now. Renaming it to `apps/apple` would touch CI path
  filters (`ci.yml` `paths-ignore`, `ios.yml` `paths`), the TestFlight scripts and docs, so it
  is an open question, not part of slice F01.

## 3. Audio engine

### 3.1 Options

1. **Port to Swift with Accelerate/vDSP (recommended).** The kit already does live FFT, band
   energy, the RTA, classification and coaching natively. What is missing is the offline
   pipeline: centered STFT averaging, the 48-point curve, frames and segments, scalar
   features, decode, sox stats, EBU R128, rules, narratives and grading.
2. **Keep Python, sox and ffmpeg as a helper process.** This is the fastest route to file
   analysis parity, but the native app would then still bundle Python and the media tools,
   keep the hardened-runtime exceptions and the large bundle (epic e656 works to shrink it to 400 MB), keep the
   NDJSON-over-stdout seam for live audio, and fail the Mac App Store sandbox if that path is
   ever wanted. It also leaves two live engines: Swift on iOS and Python on the Mac.
3. **Hybrid: live in Swift, file analysis in a helper until ported.** This avoids nothing,
   because Electron already is that fallback during the side-by-side period (section 5). A
   temporary helper would be signed, bundled and tested once only to be thrown away.

### 3.2 Recommendation

Port everything the hedgehog surfaces use, and bundle no helper. Until a surface is ported,
Electron covers it.

| Piece | Today | Swift replacement |
| --- | --- | --- |
| Live capture | `stream.py` + sounddevice, one process per device | `CoreAudioCapture` (AUHAL or AVAudioEngine per device; spike S02 picks one) feeding `SampleRingBuffer` |
| Live meters, RTA, coaching | `stream.py` meter ticks, renderer coaching | `SpectrumAnalyzer`, `RTALayout`, `BandDeviationCoach` and the rest (exist) |
| Decode | soundfile, ffmpeg fallback | `AVAudioFile`, or `AVAssetReader` for mp4 and mov, downmixed to mono float32 like `_load_audio` |
| File metadata | ffprobe | `AVAudioFile` and `AVAsset` properties (only fields the UI reads) |
| STFT, bands, 48-point curve | `spectrum.py` `_stft_mag`, `compute_band_energy`, `curve_from_power` | Extend `SpectrumAnalyzer` with a centered STFT and hop averaging |
| Frames, classes, segments | `classify_chunk`, `smooth_classes`, `build_segments`, `summarize_content` | Swift port, reusing `ProgramContentClassifier` where the rules match |
| Centroid, rolloff, dynamic range | `spectrum.py` 2048/512 STFT, `compute_dynamic_range` | Swift port |
| Level stats | `sox stat` (`SoxStats` in `src/types.ts`) | Swift port of only the fields read downstream |
| Loudness | ffmpeg `ebur128` (integrated LUFS, LRA, true peak) | Swift ITU-R BS.1770 / EBU R128 implementation |
| Rules and narratives | `src/analyze/rules.ts`, `*-narrative.ts` | Swift port |
| Grading | `app/renderer/grading.js` | Swift port |
| Record | `stream.py --session-dir`, 24-bit WAV, `session.json` | `AVAudioFile` writer off the real-time thread, same layout and manifest |

The Python engine stays: it is the parity oracle, `packages/cli` uses it, and Electron uses it
until retirement.

### 3.3 Parity tests

This follows the pattern the repo already uses. `make_spectrum_parity_fixture.py` pins the
Swift FFT to `spectrum.py`, and `test_spectrum.py` kept librosa-parity tests while librosa
was removed (#662, #665).

**Fixtures.** A generator (slice P01) extends `make_spectrum_parity_fixture.py` into a corpus:

- Synthetic signals, generated from fixed seeds and committed: single and multi-tone sines,
  pink and white noise, a silence-to-tone step, a clipped sine, a DC offset, a stereo file with
  different channels, and speech-like and music-like band mixes that exercise every
  `classify_chunk` branch.
- Sample rates 44.1, 48 and 96 kHz. Lengths from 0.5 s up to 60 s. The long-file case is
  generated at test time from a seed, not committed.
- One real short recording only if Patrick provides one he is happy to make public, because
  the repo is public.
- For each input, the generator writes the full `spectrum.py` JSON, the `sox stat` and
  `ffprobe` fields, ffmpeg `ebur128` output, and `analyzeAudio` plus rules, narratives and
  grade output from the TypeScript code (run with node). Each fixture records the tool versions
  that produced it.

**Tolerances** (starting points; slice P01 records the measured float32 noise floor and may
tighten them):

| Metric | Tolerance |
| --- | --- |
| 7-band energy | 0.05 dB (the existing `toleranceDb`) |
| 48-point curve, each point | 0.1 dB |
| Frame RMS | 0.1 dB |
| Spectral centroid, rolloff | 0.5% relative |
| Dynamic range | 0.1 dB |
| Peak and RMS dBFS | 0.01 dB |
| Integrated loudness | 0.1 LU against ffmpeg, and within EBU Tech 3341 limits on its test signals |
| Loudness range | 0.1 LU against ffmpeg, and within EBU Tech 3342 limits |
| True peak | 0.2 dB |
| Frame class, `content_type` | exact on fixtures. A frame sitting on a threshold must be marked in the fixture and is allowed to flip. |
| Segment boundaries | within one frame |
| Rule hits, narrative text | exact |
| Grade letter | exact. Score within 0.5 |

**CI.**

- Linux (Ubuntu, in `ci.yml` next to the existing Python tests): regenerate every fixture
  from Python and TypeScript, and fail if the committed fixtures differ. This catches a Python
  or TS change that would silently move the oracle.
- macOS: `swift test` for SoundBuddyKit against the committed fixtures, plus
  `xcodebuild build` for the Mac target. It starts informational, like `ios.yml`, and becomes
  a required check before the beta ships to anyone outside the team. A macOS runner budget is an
  open question.
- The Swift DSP stays on Accelerate, so it does not run on Linux. That is acceptable: Linux
  proves the oracle, macOS proves the port.

## 4. Distribution, signing and licensing

### 4.1 Can existing Electron installs get the native app?

What the code shows:

- Installed apps check `latest-mac.yml` in the latest release of
  `on-par/sound-buddy-releases` (`electron-builder.yml` `publish:`, `auto-updater.ts`).
- The user clicks Download in the update banner, and the update installs on quit or through
  `quitAndInstall(false, true)`.
- On macOS, electron-updater gives the zip to Electron's built-in Squirrel.Mac, which replaces
  the bundle in place. Squirrel.Mac only accepts a bundle whose code signature satisfies the
  running app's designated requirement. For a Developer ID app that is the bundle ID plus the
  team's certificate.

So a native app with `CFBundleIdentifier = com.soundbuddy.app`, signed and notarized by the
same Developer ID team, zipped with the expected `Sound.Buddy-<version>-arm64-mac.zip` name,
and listed in a `latest-mac.yml` with a correct sha512 and a version above 0.9.x should
install over Electron through the existing banner. This is the bridge release. It follows from
how the pieces work, but nobody has tried it, so slice S01 proves it on a real 0.9.15 install,
and on an older 0.9.x if one is still around, before anything else depends on it.

After the bridge:

- The native app embeds Sparkle 2 with an EdDSA public key and an `SUFeedURL` appcast. The
  recommended location is `https://github.com/on-par/sound-buddy-releases/releases/latest/download/appcast.xml`,
  next to `latest.json` (open question: GitHub releases or the site).
- Every native release keeps writing `latest-mac.yml` and the zip, so an Electron install that
  has not launched for months still reaches the bridge. It also keeps writing `latest.json`, so
  the site download button keeps working. `scripts/ci-update-feed.mjs` already validates
  `latest-mac.yml` and is reused.
- Fallback if S01 fails: ship one last Electron release whose update banner links to the
  native DMG download, and keep the native app on a different path. Users then move manually.

### 4.2 Developer ID plus Sparkle compared with the Mac App Store

| | Developer ID + notarization + Sparkle (recommended) | Mac App Store |
| --- | --- | --- |
| Existing users | Bridge release swaps the app in place (4.1). | No path from a Developer ID install. Users must find and buy or re-download in the store. Settings must be re-imported across the sandbox. |
| Sandbox | Not sandboxed. Reads Electron's files in `~/Library/Application Support/SoundBuddy` and the recordings folder directly. | Sandboxed. Needs user-granted access (security-scoped bookmarks) for Electron's files and any custom `storageDir`, plus entitlements for the Music folder, microphone and local network (console OSC). |
| Pricing and payments | Stripe Payment Links stay (`checkout.ts`, worker mint). Founding $199 nets about $193 after Stripe's standard card fee. | Digital unlocks must use in-app purchase. Founding becomes a non-consumable IAP. Apple keeps 15% under the Small Business Program, or 30%: $169.15 or $139.30 net on $199. |
| License keys | SB1 keys keep working. Port verification to CryptoKit (Curve25519 signing keys) against `packages/license-policy/src/golden-vectors.ts`. | A Stripe-bought key can only unlock the MAS build if the same unlock is also sold as IAP (multiplatform services rule), so StoreKit and SB1 would run side by side. |
| Subscriptions | Stripe monthly and annual, refreshed by `license-refresh.ts`. | Auto-renewable IAP subscriptions, with App Store Server Notifications needed in the worker. |
| Review and cadence | Notarization only, minutes. Release whenever CI is green. | App Review on every release, plus review of the console OSC write path's messaging if it ever reaches the Mac. |
| Discovery | Site, outreach and church tech communities. | Store search. |
| Release tooling | Extends `release.yml` and ADR-0095. | New `xcodebuild` export to App Store Connect, much like the iOS `testflight.sh`. |

**Recommendation: Developer ID + notarization + Sparkle.** It is the only option that keeps
existing users on one install. It keeps the Founding $199 SKU and the Stripe-minted key flow
as they are, with no commission and no review gate. A Mac App Store listing can come later as
an extra channel with its own IAP SKUs, once the native app is stable. That needs its own
decision.

### 4.3 Effect on Pro packaging

- Free stays a browser product (`site/`, `worker/`, ADR-0147, ADR-0152). Nothing here
  changes it.
- Pro is the native Mac app. Its feature set is the #1518 lock: one Analyze tab with live and
  file analysis, customizable EQ curves, channel listening, and Record with Main and Measurement.
- `PRO_FEATURES` in `license.ts` today is `saved-rigs`, `live-monitoring`,
  `virtual-soundcheck`, `ai-narrative` and `custom-eq-curves`. The Swift port carries over only
  the ids that hedgehog surfaces use, mirrored by a drift test the way the TS ids are mirrored
  today.
- Trial semantics (14 days, `trialStartedAt` stored locally, keys outrank the trial) carry over
  unchanged. Migrating `license.json` (section 5.3) means a migrated user never gets a second
  trial and never loses a key.
- Founding $199 remains the first paid SKU. The native app opens the same env-baked checkout
  URLs (ADR-0093).

### 4.4 Native release pipeline

A new workflow, or a new job in `release.yml`, does the following:

1. `xcodebuild archive` for `SoundBuddyMac`, then export with the `developer-id` method,
   using the existing Developer ID certificate in a temporary keychain (the same steps as
   today).
2. Notarize with `notarytool` (existing APPLE_ID and app-specific password secrets, or an App
   Store Connect API key), then staple the app and DMG.
3. Run the same verification `release.yml` runs today: `codesign --verify --deep --strict`,
   `stapler validate`, and `spctl --assess` for the app and DMG.
4. Zip as `Sound.Buddy-<version>-arm64-mac.zip`. Generate `latest-mac.yml` (sha512, size,
   file name) and check it with `scripts/ci-update-feed.mjs`. Write `latest.json` with
   `scripts/ci-release-manifest.mjs`.
5. Sign the zip with Sparkle's `sign_update` (new secret: the Sparkle EdDSA private key) and
   generate `appcast.xml`.
6. Publish as a draft and promote last (ADR-0095).

The runner must have Xcode with the macOS 26 SDK. `release.yml` pins `macos-14` today, so the
native job may need a newer image (open question).

## 5. Strangler order and cutover

### 5.1 Phases

| Phase | What ships | Who sees it |
| --- | --- | --- |
| 0. Spikes | S01 bridge proof, S02 Core Audio multi-device capture, S03 signed, notarized and Sparkle-updated "hello" app from CI | Nobody |
| 1. Foundation | Mac target, shared UI library, Swift flag registry, macOS CI | Developers |
| 2. Live Analyze | Device picker, live RTA, coaching, channel listening, 48-point curve, SPL offset | Beta |
| 3. File Analyze and reports | Swift engine parity, file drop on the Analyze tab, results and grade, history, PNG export | Beta |
| 4. Record | Main and Measurement takes, mono or stereo, in the same folder layout | Beta |
| 5. Pro plumbing | Licensing and trial, checkout, persisted custom curves, settings import | Beta |
| 6. GA and bridge | Native `com.soundbuddy.app` published through the bridge, site DMG switches | Everyone |
| 7. Retire Electron | `app/` leaves CI. Feeds stay pointed at native | Everyone |

Phases 2 to 5 can overlap once phase 1 is done. Phase 3 is the long pole.

### 5.2 Side by side

- The beta is "Sound Buddy Beta", bundle ID `com.soundbuddy.app.beta` (working name),
  installed as its own app next to Electron, with its own Sparkle beta feed. The separate ID
  keeps LaunchServices, the microphone permission and preferences apart from Electron.
- Electron keeps shipping fixes from `app/`. Once phase 2 is in beta, new hedgehog features
  land in SoundBuddyKit first and are not added to Electron unless a release needs them.
- Feature flags: the Swift registry mirrors ADR-0148 (default off, resolved at launch, never
  persisted, no user toggle) and is shared with iOS (#1662). The Mac resolves it from
  `SOUND_BUDDY_FEATURES`, as Electron does, plus Debug builds. Flags here gate the native
  surfaces that are not finished yet. The flagged Electron workspaces are not ported (ADR-0162
  decision 7).

### 5.3 User data and settings migration

| Data | Beta (side by side) | GA (in place) |
| --- | --- | --- |
| `settings.json` | Import on first launch into the beta's own store. Never write Electron's file. | Adopt the file in place. Read and write the same JSON shape with a Codable mirror of `AppSettings` that keeps unknown keys on write, so rolling back to Electron still works. |
| `license.json` | Read to show the tier. Never write. | Adopt in place, same shape. |
| `customIdealProfiles` | Imported with settings. Shape is `CustomIdealProfile` in `ipc/api.ts` (48-point `freqs` and `dbOffsets`). Convert to ideal-curve.v1 in memory only. | Same, written back in the Electron shape. |
| Recordings and takes | Read from `storageDir` (default `~/Music/Sound Buddy`). New takes use the ADR-0160 layout. | Same folder, nothing moves. |
| History JSON | Read `<record dir>/history/*.json` with the same `AnalysisSummary` guard as `storage.ts`. Write new records in the same shape. | Same. |
| Rigs, channel labels, groups | Imported. Only the fields Record and channel listening use are acted on. | Same, preserved on write. |
| Waveform peaks cache | Not migrated. Regenerated if a future surface needs it. | Same. |
| Renderer localStorage (build guide, ring out, pass mode) | Not migrated. These belong to flagged surfaces that are not ported. | Same. |
| Logs, install id | New log location under the new app name. Keep the install id so telemetry, which is opt-in, does not double count. | Same. |
| Microphone permission | New prompt (different bundle ID). | Possibly kept, because the bundle ID and team match. Unproven, so onboarding handles a fresh prompt either way. |

### 5.4 Retiring Electron

Retire when all of these hold:

1. Every "Must" row in the parity matrix (section 6) is green in the native app, with parity
   CI passing on three consecutive native releases.
2. S01's bridge has been proven on real installs, and the first bridge release has been out
   for at least 30 days without a rollback.
3. Patrick has run at least four real services on the native app (live Analyze and Record)
   without falling back to Electron.
4. The crash rate on native is no worse than on Electron, from the existing opt-in crash
   reporting (`crash-reporting.ts`).
5. At least 60 days have passed since GA.

Then: stop Electron releases, tag the last Electron commit, remove `app/` jobs from `ci.yml`
and `release.yml`, and keep publishing `latest-mac.yml` that points at the native zip for at
least 12 more months. `packages/audio-engine` stays as the parity oracle and for the CLI until
a separate decision.

### 5.5 Riskiest pieces

| Risk | Why it is risky | Mitigation |
| --- | --- | --- |
| Audio device I/O | Today `stream.py` opens devices by name or index through PortAudio, often a multi-channel board interface and a USB measurement mic at once (ADR-0160). On the Mac, AVAudioEngine's input node follows the system default unless the device is set on its audio unit, and two devices mean two engines or AUHAL units on two clocks. Hot-plug and sample-rate changes have to be handled. | Spike S02 before slice L01. Keep device choice behind a pure Swift policy with a fake HAL in tests, as `MicInputPolicy` does on iOS. Identify devices by UID, and match by name as Electron does (`measurementDeviceName`). Show a clear error for a missing device. |
| Latency and CPU | The live path moves from a child process with 0.1 s JSON ticks to in-process real-time code, where a slow tap callback drops audio. | Do no allocation or locking on the real-time thread. Copy into `SampleRingBuffer` and analyze on a separate queue. Slice L02's acceptance includes measured input-to-draw latency and CPU at 48 kHz with a wide multi-channel device. |
| Record | Long takes, disk-full, device unplug mid-take, two clocks (ADR-0160 already accepts unaligned stems), and 24-bit WAV correctness. | Write on a non-real-time thread from a ring buffer. Run a 3-hour soak test and an unplug test. Check that WAVs read back in Python with `soundfile` and analyze through Electron. Keep `session.json` byte-compatible. |
| File analysis performance and memory | Electron streams through separate tools in parallel. A naive Swift port could load a 2-hour 48 kHz file into memory several times. | Decode once and stream chunks into every analyzer. Gate on `packages/audio-engine/scripts/benchmark.mjs` inputs (90 to 120 minute services, under the #126 five-minute target), and require the native app to be no slower than Electron on the same machine. |
| Parity drift | Two implementations will exist until retirement. | Linux regenerates fixtures, macOS checks Swift, and both fail on drift (section 3.3). Any rule or grade change lands with updated fixtures in the same PR. |
| Sparkle and bridge migration | If the bridge fails, existing users are stranded on Electron. A bad appcast or a lost EdDSA key breaks updates. | S01 first. Fallback banner release (4.1). Keep the EdDSA private key as a CI secret with an offline backup. Promote releases only after feed checks (ADR-0095), extended to `appcast.xml`. |
| Microphone permission | Permission may reset at the swap, so the first Sunday after an update could start with a prompt. | Onboarding handles the denied and undetermined states with clear copy, as iOS does. The bridge release notes say a prompt may appear. |
| Scope creep | The flagged Electron surfaces are large (the Session DAW alone is many ADRs). | Decision 7: not ported. Anything extra needs a new decision. |

## 6. Feature parity matrix

Effort: S is about one small PR, M is one PR touching several files, L is several PRs. Must
means required before GA.

| Feature | Electron today | SoundBuddyKit today | Gap for the Mac | Effort | Priority |
| --- | --- | --- | --- | --- | --- |
| Live Analyze (RTA + coaching) | `measurement-source.ts` runs `stream.py`. 48-point curve and 7-band coaching in the renderer (`analyze-live-eq.ts`, `AnalyzeLiveEqPanel.tsx`). | `SpectrumAnalyzer`, `RTALayout`, `BandDeviationCoach`, smoothing and stabilizer, `ProgramModeTracker`, `AnalyzeModel`, `RTAView`. | Core Audio capture through `LiveAudioSource`, a device picker, Mac layout, the 48-point curve port (the Mac target overlay uses it). | M | Must |
| Channel listening | One in-memory channel. Switching restarts the stream (ADR-0151). | None (iOS picks a mic, not a channel). | Channel picker for wide devices with the same semantics: not persisted, stop then start. | S | Must |
| Analyze file (one tab) | Drop or open file, `analyze-file`, `analyzeAudio` (sox, ffprobe, `spectrum.py`, ebur128), cancel. | Single-frame FFT only. | Decode, STFT, curve, frames, segments, scalar features, level stats, EBU R128, progress and cancel. | L | Must |
| File reports | Results on Analyze (`AnalyzeResultsPanel.tsx`), rules and narratives, grading (`grading.js`), troubleshooting, PNG export (`report-export.ts`), history (`storage.ts`). The Report Card workspace sits behind the `reportCard` flag. | None. | Rules, narratives and grading ports. Results view, PNG export without metadata, history read and write. | L | Must |
| Record (Main + Measurement, mono or stereo) | `record-take.ts`: two `stream.py` processes, `N` or `N-M` channel picks, 24-bit stems, `session.json`, never touches Listen. | None. | Multi-device capture, a WAV writer, channel picks, the take folder and manifest, error reporting. | M to L | Must |
| Customizable EQ curves | Curve editor (`CurveEditorDialog.tsx`), Pro-gated write (ADR-0150), stored in `settings.json`. | Editor, handles, presets, ideal-curve.v1. Not persisted. | Persist in the `CustomIdealProfile` shape, Pro gate, list and manage curves. | M | Must |
| Licensing and trial | `license.ts`, `license-policy`, `checkout.ts`, `license-refresh.ts`. | None. | CryptoKit SB1 verify with golden vectors, trial, activation UI, checkout links, refresh. | M | Must |
| Updates | electron-updater banner. | n/a | Sparkle 2 with the standard UI, beta and stable feeds. | M | Must |
| Settings import | `settings.json` and `license.json` in userData. | `UserDefaults` for small iOS prefs. | Codable mirror that keeps unknown keys, importer, in-place adoption at GA. | M | Must |
| SPL estimate and calibration | `splCalibrationOffsetDb`, `SplCalibrationPanel.tsx`. | Fixed phone offset (ADR-0158). | Use the stored offset on the Mac. | S | Should |
| Console EQ | Read-only workspace behind the `console` flag (`packages/console`, `ConsolePanel.tsx`). | OSC codec, guard, session reducer, EQ model, armed writer, panel (no transport yet). | Wait for #1666 transport, then a Mac panel behind the flag. Mac writes would need their own decision, because ADR-0161 keeps Mac read-only. | M | Later |
| Onboarding, what's new, feedback, crash, usage signal | `OnboardingDialog.tsx`, `WhatsNewBanner.tsx`, `feedback.ts`, `crash-reporting.ts`, `telemetry.ts`. | None. | Port the minimum: microphone permission onboarding, feedback to the existing worker endpoint, opt-in crash and usage signal. | M | Should |
| Session DAW, soundcheck playback, Directory, Ring Out, Build Guide, Report Card workspace | Behind flags (ADR-0148). | None. | Not ported (ADR-0162 decision 7). | none | Out |

## 7. Slice list (not filed)

Each slice is meant to become one factory issue with `Closes #N`, TDD, and its own acceptance
criteria. Sizes are S, M or L as in section 6. Nothing here has been filed.

### Phase 0: spikes

**S01. Prove the bridge release.** Size M. Depends on nothing.
- Build a minimal native SwiftUI app with `CFBundleIdentifier = com.soundbuddy.app`, version
  0.99.0 or higher, signed with the team's Developer ID, notarized and stapled.
- Publish it with a matching `latest-mac.yml` and zip to a staging feed. The feed must not be
  the public releases repo.
- AC: an installed Electron 0.9.15 shows the update banner, downloads, installs, and relaunches
  as the native app in the same `/Applications` path with no Gatekeeper prompt. The log records
  whether the microphone permission survived. A written note records the exact feed setup so
  D03 can repeat it. If it fails, the note records why and the fallback in 4.1 is chosen.

**S02. Core Audio multi-device capture spike.** Size M. Depends on nothing.
- AC: list input devices with UID, name and channel count. Open two devices at once (a
  multi-channel interface and a USB mic). Pick channel `N` or pair `N-M` from the wide one.
  Survive unplug and replug and a sample-rate change. Report input-to-callback latency and CPU
  at 48 kHz. The note recommends AUHAL or AVAudioEngine with numbers.

**S03. Signed, notarized, Sparkle-updated hello app from CI.** Size M. Depends on nothing.
- AC: a `workflow_dispatch` job archives a hello Mac app, exports Developer ID, notarizes,
  staples, passes the same `codesign`, `stapler` and `spctl` checks as `release.yml`, signs
  the zip for Sparkle, and writes `appcast.xml`. Version N updates itself to N+1 from a staging
  appcast. No secret is printed. The temporary keychain is deleted.

### Phase 1: foundation

**F01. Add the `SoundBuddyMac` target.** Size S. Depends on nothing (S03 informs signing).
- AC: `project.yml` declares a macOS 26, arm64, SwiftUI app target that links SoundBuddyKit.
  The bundle ID is `com.soundbuddy.app.beta` for now. Hardened runtime and `audio-input`
  entitlements are set, and `NSMicrophoneUsageDescription` is present. `xcodegen generate` is
  committed. The iOS target and the TestFlight scripts are unchanged and `ios.yml` stays green.

**F02. Extract shared SwiftUI into `SoundBuddyUI`.** Size M. Depends on F01.
- AC: `RTAView`, `EQCurveView`, `ConsoleEQPanel`, `ConsoleChip` and `ConsoleTargetPickerView`
  move into a library product. Haptics go behind a protocol. The iOS app builds and looks the
  same (screenshots before and after on iPhone and iPad). The Mac target renders `RTAView` with
  fake data.

**F03. macOS CI job.** Size S. Depends on F01.
- AC: on PRs touching `apps/ios/**`, a macOS job runs `scripts/swift-test.sh` and
  `xcodebuild build` for both targets. It is informational at first. The runner and Xcode
  versions are pinned and documented.

**F04. Swift feature-flag registry.** Size S. Depends on nothing. Coordinate with #1662.
- AC: a SoundBuddyKit registry with ADR-0148 semantics (default off, launch-time only, never
  persisted, unknown tokens ignored, `all` token). It resolves from `SOUND_BUDDY_FEATURES` on
  macOS. Tests mirror `feature-flags.test.ts` cases.

### Phase 2: live Analyze

**L01. Core Audio device catalog and picker.** Size M. Depends on S02 and F01.
- AC: a pure policy with a fake HAL in tests. Devices are listed with UID, name and channel
  count. The choice is stored by UID and falls back to a name match, then to the system
  default. Hot-plug updates the list. A missing device shows an actionable error.

**L02. `CoreAudioCapture` and live Analyze on the Mac.** Size M. Depends on L01 and F02.
- AC: implements `LiveAudioSource`. The RTA, target and coaching run from the chosen device.
  No allocation on the real-time thread (checked by test or instrumentation). Measured latency
  and CPU at 48 kHz are recorded in the PR. Analyze starts listening when the tab opens, as on
  Electron and iOS.

**L03. Channel listening.** Size S. Depends on L02.
- AC: one channel selected at a time, in memory only, defaulting to channel 0. Switching stops
  the old stream before starting the new one (ADR-0151). Tests prove no state from the old
  channel remains.

**L04. 48-point curve, live.** Size M. Depends on P02.
- AC: the live curve uses the ported `curve_from_power` grid. The ideal-curve overlay is
  level-matched on the 48-point grid as Electron does (`liveTargetDb`). Parity fixtures pass.

**L05. SPL calibration offset.** Size S. Depends on L02 and M01.
- AC: the imported `splCalibrationOffsetDb` drives the level readout. Uncalibrated copy appears
  when it is unset.

### Phase 3: Swift engine and file Analyze

**P01. Golden fixture generator and drift job.** Size M. Depends on nothing.
- AC: extends `make_spectrum_parity_fixture.py` to the corpus in 3.3, with outputs from
  `spectrum.py`, sox, ffprobe, ebur128 and the TS rules and grading. A Linux CI step regenerates
  the fixtures and fails on diff. Tool versions are recorded. The measured float32 noise floor
  is written into the tolerance table.

**P02. Centered STFT, bands and 48-point curve.** Size M. Depends on P01.
- AC: Swift matches `_stft_mag` framing, `compute_band_energy` and `curve_from_power` within
  tolerance on every fixture. The `TODO(parity)` in `SpectrumAnalyzer.swift` is resolved.

**P03. Frames, classes, segments, content type.** Size M. Depends on P02.
- AC: matches `classify_chunk`, `smooth_classes`, `build_segments` and `summarize_content`
  within tolerance. States whether `ProgramContentClassifier` is reused or kept separate, and
  why.

**P04. Centroid, rolloff, dynamic range.** Size S. Depends on P02.
- AC: matches the 2048/512 scalar STFT and `compute_dynamic_range` within tolerance.

**P05. Decode and metadata.** Size M. Depends on nothing.
- AC: every `AUDIO_EXTENSIONS` type decodes to mono float32 at the native rate (AVAssetReader
  for mp4 and mov). Undecodable files fail with an actionable message. Metadata covers the
  fields the results UI reads. Streaming decode is used, so a 2-hour file is never held whole.

**P06. Level stats.** Size S. Depends on P05.
- AC: lists which `SoxStats` fields are read downstream and ports only those. Matches sox
  within tolerance on fixtures, including clipping detection.

**P07. EBU R128 loudness.** Size M. Depends on P05.
- AC: integrated loudness, LRA and true peak match ffmpeg within tolerance and pass the EBU
  Tech 3341 and 3342 test signals the slice generates. Silent input returns the same sentinel
  values `ebur128.ts` parses (`-inf`).

**P08. Rules and narratives.** Size M. Depends on P02 to P07.
- AC: Swift `rules.ts` and narrative templates give exact rule hits and text on the TS-generated
  fixtures.

**P09. Grading.** Size S. Depends on P08.
- AC: passes `app/renderer/grading.golden.json` exactly (letter) and within 0.5 (score).

**P10. Performance gate.** Size S. Depends on P02 to P07.
- AC: on the `benchmark.mjs` inputs (stereo, 1 to 120 minutes), native analysis is no slower
  than Electron on the same Mac and finishes a 120-minute file in under 5 minutes. Peak memory
  is recorded.

**A01. File drop on the Analyze tab.** Size M. Depends on P05 and P02.
- AC: one Analyze tab holds both live and file. Drop or open a file, see progress and cancel.
  While a file analyzes, live listening behaves as it does on Electron today. The slice
  writes down what that is before changing anything.

**A02. Results and report on Analyze.** Size M. Depends on P08 and P09.
- AC: the grade, bands against target, top fixes and troubleshooting match Electron's
  `AnalyzeResultsPanel` for the same fixture file (screenshot comparison in the PR).

**A03. History.** Size S. Depends on A02 and M01.
- AC: writes one `AnalysisSummary` JSON per analysis to `<record dir>/history` in the Electron
  shape. Reads both Electron and native records. Corrupt files are skipped.

**A04. Report PNG export.** Size S. Depends on A02.
- AC: the exported PNG has none of the chunk types in `PNG_METADATA_CHUNK_TYPES`, and the
  filename avoids PII as `report-export.ts` does.

### Phase 4: Record

**R01. Record a Main and Measurement take.** Size M. Depends on L01 and S02.
- AC: the Record button records Main and Measurement, each mono `N` or stereo `N-M`, defaulting
  as ADR-0160 does. It writes `sound-buddy-<stamp>/main/01-main.wav` and
  `measurement/01-measurement.wav` as 24-bit PCM plus `session.json` in the `stream.py` shape.
  It never stops or changes Listen. A missing device refuses to start with an actionable error.
  Stop reports each stem, and names any source that wrote nothing.

**R02. Record robustness.** Size M. Depends on R01.
- AC: a 3-hour soak with no dropped buffers. Unplugging a device mid-take keeps the other stem
  and reports the failure. Low disk space is handled. Stems open in Python `soundfile` and
  analyze in Electron and native.

### Phase 5: Pro plumbing and migration

**M01. Settings and license import.** Size M. Depends on F01.
- AC: confirms the real userData path on a real install. The Codable mirror of `AppSettings`
  keeps unknown keys on round trip. The beta imports read-only into its own store. GA adopts the
  files in place. Tests cover a missing file, corrupt JSON, and old and new settings shapes.

**M02. Rollback safety.** Size S. Depends on M01.
- AC: a settings file written by the native app loads in Electron 0.9.15 with every value
  intact (scripted test using `settings.ts` sanitizers).

**LIC01. SB1 verification and trial.** Size M. Depends on nothing.
- AC: CryptoKit Ed25519 verification over the embedded key list (ADR-0016). Passes every case
  in `packages/license-policy/src/golden-vectors.ts`. Trial and grace logic matches `license.ts`
  tests. `isEntitled` gates only the ported Pro ids. No network call on launch.

**LIC02. Activation, checkout and refresh.** Size S. Depends on LIC01.
- AC: paste and activate a key, remove a key, and open checkout for monthly, annual and
  founding with env-baked URLs that fail loudly when unset (ADR-0093). Refresh behaves like
  `license-refresh.ts`.

**C01. Persisted custom EQ curves.** Size M. Depends on M01 and LIC01.
- AC: create, rename, delete and select curves in the `CustomIdealProfile` shape. Writes are
  Pro-gated and reads and selection stay free (ADR-0150). Curves made in Electron show up, and
  curves made in native show up in Electron.

### Phase 6: distribution and GA

**D01. Native release workflow.** Size M. Depends on S03 and F01.
- AC: implements 4.4 end to end on a tag. Draft first, promote last. `latest-mac.yml`,
  `latest.json` and `appcast.xml` are all verified before promote.

**D02. Beta channel.** Size S. Depends on D01.
- AC: "Sound Buddy Beta" (`com.soundbuddy.app.beta`) installs next to Electron and updates
  from a beta appcast.

**D03. Bridge release.** Size M. Depends on S01, D01 and every Must row.
- AC: the native build with `com.soundbuddy.app` publishes with `latest-mac.yml`, zip, DMG,
  `latest.json` and `appcast.xml`. A real Electron 0.9.15 install updates in place. The site
  download button serves the native DMG. The release notes mention the possible microphone
  prompt.

**O01. Onboarding, feedback, crash and usage signal.** Size M. Depends on L02.
- AC: microphone permission onboarding for undetermined and denied states. Feedback posts to the
  existing worker endpoint. Crash reporting and the usage signal stay opt-in with Electron's
  defaults.

### Phase 7: retire Electron

**X01. Retire Electron.** Size S. Depends on the criteria in 5.4.
- AC: the last Electron commit is tagged. `app/` jobs leave `ci.yml` and `release.yml`. Native
  releases keep publishing `latest-mac.yml` for 12 months. A short record of the retirement
  sits in `docs/adr`.

### Later

**CE01. Console EQ on the Mac (read-only).** Size M. Depends on #1666 and F02.
- AC: behind the `console` flag, the Mac shows the kit's console EQ panel read-only, with consent
  per ADR-0006. Writes stay off on the Mac until a separate decision.

## 8. Open questions

1. **Mac bundle ID during beta.** `com.soundbuddy.app.beta` is a working name. Patrick to
   confirm.
2. **Bridge proof.** Does Squirrel.Mac accept the native bundle? Does the microphone grant
   survive? S01 answers both. Also: is there a way to point an installed Electron build at a
   staging feed, or does S01 need a staging releases repo? `auto-updater.ts` has no feed
   override today.
3. **Sparkle feed host.** GitHub releases (`latest/download/appcast.xml`) or the site.
4. **macOS CI budget.** `ios.yml` notes that no macOS runner is budgeted for Swift. Parity and
   Mac builds need one before the beta goes past the team. `release.yml` also pins `macos-14`,
   which may not have the macOS 26 SDK.
5. **Directory name.** Keep `apps/ios` or rename to `apps/apple`, and when.
6. **Pro feature list on the site.** `site/src/lib/packaging-copy.ts` lists "Record up to 32
   channels", but the product lock and ADR-0160 scope Record to Main and Measurement. This plan
   follows the lock. The site copy should be checked separately.
7. **`SoxStats` fields in use.** Which fields reach the UI, rules or grade? P06 lists them
   before porting.
8. **Real test recording.** Is there a short recording Patrick is willing to publish as a
   fixture? The repo is public.
9. **Flagged surfaces.** Does anyone rely on a flagged Electron workspace (Session DAW,
   soundcheck playback, Ring Out, Build Guide, Directory, console workspace) enough to need it
   ported before Electron retires?
10. **Usage measurement for retirement.** The usage signal is opt-in, so the share of users on
    native cannot be measured exactly. The retirement criteria in 5.4 avoid depending on it.
    Patrick may want a different bar.
11. **Mac console writes.** ADR-0161 keeps the Mac read-only. Whether the native Mac should get
    the iOS armed EQ writer needs its own decision.
12. **Store rules.** If a Mac App Store SKU is considered later, the payment and link-out rules
    current at that time need checking. They have changed by region in recent years.
