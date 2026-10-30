import SoundBuddyKit
import StoreKit
import SwiftUI
import UIKit

/// Lets `channelSetupRecheck`'s `isEnabled` closure (built once in `init`,
/// before `self` is fully initialized) see `featureFlags` update once the
/// async `.task` resolves the real store environment (#1796) — a plain
/// `@State` read isn't available that early.
private final class ConsoleFeatureFlagBox {
    var isEnabled = false
}

@main
struct SoundBuddyApp: App {
    @State private var model: AnalyzeModel
    @State private var micInputs: MicInputController
    @State private var keepAwake = KeepAwakeController(timer: UIApplication.shared)
    /// nil until the heartbeat/session slice (#1667) wires a live
    /// `ConsoleSessionReducer` in; the chip stays hidden without one.
    @State private var console: ConsoleTargetModel?
    @State private var featureFlags: FeatureFlags
    @State private var consoleConsent: ConsoleConsentStore
    /// Drives the manual-IP / last-known-console connect sheet (#1666).
    @State private var consoleStore: ConsoleStore
    @State private var consoleConnectOpen = false
    /// Drives "Discover channel setup" (#1781).
    @State private var channelSetupFlow: ChannelSetupFlow
    @State private var channelSetupOpen = false
    /// One saved setup per console (#1794).
    @State private var channelSetupStore: ChannelSetupStore
    /// Re-checks the saved setup against the desk on every reconnect (#1796).
    @State private var channelSetupRecheck: ChannelSetupRecheck
    /// Settings > Console (beta)'s saved-setup list, Redo setup and Forget
    /// this console (#1797).
    @State private var channelSetupSettings: ChannelSetupSettingsModel
    private let consoleFlagBox = ConsoleFeatureFlagBox()

    init() {
        // #1772: Absolute became the default; reset build 14's stored
        // Relative once, before any @AppStorage reads it.
        RTAViewMode.migrateToAbsoluteDefault(in: .standard)
        // One controller shared by capture (applies the choice) and Settings
        // (lists and changes it).
        let inputs = MicInputController(session: SystemMicInputSession())
        _micInputs = State(initialValue: inputs)
        let consent = ConsoleConsentStore()
        _consoleConsent = State(initialValue: consent)
        let store = ConsoleStore(
            transport: ConsoleNWTransport(),
            currentWiFi: WiFiInterfaceReader.current,
            isConsentGranted: { consent.isGranted },
            defaults: .standard
        )
        _consoleStore = State(initialValue: store)
        _channelSetupFlow = State(initialValue: ChannelSetupFlow(store: store, consent: consent))
        let setupStore = ChannelSetupStore()
        _channelSetupStore = State(initialValue: setupStore)
        // The flag box, not a captured `featureFlags` snapshot, so the
        // recheck's `isEnabled` sees the real flag once `.task` resolves it
        // (see `ConsoleFeatureFlagBox`'s own doc comment).
        let flagBox = consoleFlagBox
        let resolvedFlags = FeatureFlags.resolve(Self.launchEnvironment(store: nil))
        flagBox.isEnabled = resolvedFlags.isEnabled(.console)
        let recheck = ChannelSetupRecheck(store: store, setupStore: setupStore, isEnabled: { flagBox.isEnabled })
        _channelSetupRecheck = State(initialValue: recheck)
        _channelSetupSettings = State(initialValue: ChannelSetupSettingsModel(setupStore: setupStore, forget: { recheck.forget($0) }))
        var target = IdealCurveLibrary.liveDefault()
        var targetIsAuto = true
        // Demo sources replace the mic entirely: MicCapture (and its
        // AVAudioEngine) is only built when no demo is requested, so a demo
        // launch never touches the microphone or raises the record prompt.
        var demoSource: LiveAudioSource?
        #if DEBUG
        if CoachingDemoSource.isRequested(by: ProcessInfo.processInfo.arguments) {
            demoSource = CoachingDemoSource(target: target)
        }
        if SpeechBedDemoSource.isRequested(by: ProcessInfo.processInfo.arguments) {
            demoSource = SpeechBedDemoSource()
        }
        // #1740: real noise through the real analyzer, against the target it
        // should track once #1726's bandwidth correction is drawn. The test
        // target is pinned (not auto) so the program classifier can't swap it.
        if let color = TestNoiseDemo.color(from: ProcessInfo.processInfo.arguments) {
            demoSource = TestNoiseSource(color: color)
            target = TestNoiseDemo.target(for: color)
            targetIsAuto = false
        }
        #endif
        var permission: MicPermission = SystemMicPermission()
        #if DEBUG
        // Simulator proofs: demo sources (and -skipMicPrompt) never show the
        // record-permission alert over the screen being captured.
        if DebugLaunchOptions.skipsMicPermissionPrompt(ProcessInfo.processInfo.arguments) {
            permission = PreGrantedMicPermission()
        }
        #endif
        let source: LiveAudioSource = demoSource ?? MicCapture(inputs: inputs)
        let analyze = AnalyzeModel(
            permission: permission,
            source: source,
            target: target,
            targetIsAuto: targetIsAuto
        )
        #if DEBUG
        TargetEditDemo.apply(ProcessInfo.processInfo.arguments, to: analyze)
        #endif
        _model = State(initialValue: analyze)

        #if DEBUG
        if let demo = ConsoleDemoSeed.fromLaunchArguments(ProcessInfo.processInfo.arguments) {
            _console = State(initialValue: demo)
            // DEBUG-only fixture seed so the demo can be screenshotted without
            // tapping through the consent sheet; the Release grant path is
            // only ConsoleConsentView's Allow button.
            let demoConsent = ConsoleConsentStore(defaults: UserDefaults(suiteName: "consoleDemo") ?? .standard)
            demoConsent.grant()
            _consoleConsent = State(initialValue: demoConsent)
        }
        #endif

        #if DEBUG
        // `-channelSetupFixture spike|synthetic` (#1793): opens "Discover
        // channel setup" straight into the review screen, with no desk and no
        // consent tap, for Simulator screenshots of both layouts. Granting
        // consent in a throwaway UserDefaults suite (never `.standard`) keeps
        // this from ever marking the real app as consented. The console
        // feature flag is left alone: the sheet opens directly below, so the
        // flag-gated Settings row isn't on the path.
        if let fixture = ChannelSetupFixture.requested(by: ProcessInfo.processInfo.arguments, isDebugBuild: Self.isDebugBuild) {
            let fixtureDefaults = UserDefaults(suiteName: "channelSetupFixture") ?? .standard
            let fixtureConsent = ConsoleConsentStore(defaults: fixtureDefaults)
            fixtureConsent.grant()
            let fixtureStore = ConsoleStore(
                transport: ConsoleNWTransport(),
                currentWiFi: WiFiInterfaceReader.current,
                isConsentGranted: { fixtureConsent.isGranted },
                defaults: fixtureDefaults
            )
            let fixtureFlow = ChannelSetupFlow(store: fixtureStore, consent: fixtureConsent)
            fixtureFlow.loadFixture(fixture)
            _channelSetupFlow = State(initialValue: fixtureFlow)
            _channelSetupOpen = State(initialValue: true)
        }
        #endif

        #if DEBUG
        // `-channelSetupRecheckFixture spike|synthetic` (#1796): seeds the
        // Analyze banner through `ChannelSetupRecheck.evaluate` with ch 3
        // renamed — no desk, no transport call — for Simulator screenshots of
        // the "1 channel changed" banner and its filtered Review. A
        // throwaway UserDefaults suite (never `.standard`) keeps this from
        // ever marking the real app as having a saved setup.
        if let flagIndex = ProcessInfo.processInfo.arguments.firstIndex(of: "-channelSetupRecheckFixture"), Self.isDebugBuild,
           flagIndex + 1 < ProcessInfo.processInfo.arguments.count,
           let recheckFixture = ChannelSetupFixture(rawValue: ProcessInfo.processInfo.arguments[flagIndex + 1]) {
            let fixtureDefaults = UserDefaults(suiteName: "channelSetupRecheckFixture") ?? .standard
            let fixtureConsent = ConsoleConsentStore(defaults: fixtureDefaults)
            fixtureConsent.grant()
            let fixtureConsoleStore = ConsoleStore(
                transport: ConsoleNWTransport(),
                currentWiFi: WiFiInterfaceReader.current,
                isConsentGranted: { fixtureConsent.isGranted },
                defaults: fixtureDefaults
            )
            let fixtureSetupStore = ChannelSetupStore(defaults: fixtureDefaults)
            let unedited = recheckFixture.readResult()
            var seedReview = ChannelSetupReview(
                console: ConsoleIdentity(recheckFixture.xInfo), inventory: unedited.inventory,
                guesses: unedited.guesses, roomMicCandidates: unedited.roomMicCandidates
            )
            seedReview.confirmAll()
            if let seedSetup = seedReview.done(confirmedAt: Date()) {
                try? fixtureSetupStore.save(seedSetup, ipHint: recheckFixture.xInfo.ip)
                let fixtureRecheck = ChannelSetupRecheck(store: fixtureConsoleStore, setupStore: fixtureSetupStore, isEnabled: { true })
                let saved = SavedChannelSetup(setup: seedSetup, ipHint: recheckFixture.xInfo.ip)
                let renamedID = ConsoleStripID(kind: .ch, number: 3)
                fixtureRecheck.evaluate(saved, info: recheckFixture.xInfo, read: recheckFixture.readResult(renaming: renamedID, to: "Guest Vocal"))
                _channelSetupRecheck = State(initialValue: fixtureRecheck)
            }
        }
        #endif

        #if DEBUG
        // `-channelSetupSettingsFixture spike|synthetic` (#1797): seeds
        // Settings > Console (beta)'s Channel setup block with one saved
        // setup — no desk, no transport call — for Simulator screenshots of
        // the saved-setup row and its Forget confirmation. Combine with
        // `-openSettings` to land straight on the sheet. A throwaway
        // UserDefaults suite (never `.standard`) keeps this from ever
        // marking the real app as having a saved setup.
        if let flagIndex = ProcessInfo.processInfo.arguments.firstIndex(of: "-channelSetupSettingsFixture"), Self.isDebugBuild,
           flagIndex + 1 < ProcessInfo.processInfo.arguments.count,
           let settingsFixture = ChannelSetupFixture(rawValue: ProcessInfo.processInfo.arguments[flagIndex + 1]) {
            let fixtureDefaults = UserDefaults(suiteName: "channelSetupSettingsFixture") ?? .standard
            let fixtureConsent = ConsoleConsentStore(defaults: fixtureDefaults)
            fixtureConsent.grant()
            let fixtureConsoleStore = ConsoleStore(
                transport: ConsoleNWTransport(),
                currentWiFi: WiFiInterfaceReader.current,
                isConsentGranted: { fixtureConsent.isGranted },
                defaults: fixtureDefaults
            )
            let fixtureSetupStore = ChannelSetupStore(defaults: fixtureDefaults)
            let read = settingsFixture.readResult()
            var seedReview = ChannelSetupReview(
                console: ConsoleIdentity(settingsFixture.xInfo), inventory: read.inventory,
                guesses: read.guesses, roomMicCandidates: read.roomMicCandidates
            )
            seedReview.confirmAll()
            if let seedSetup = seedReview.done(confirmedAt: Date()) {
                try? fixtureSetupStore.save(seedSetup, ipHint: settingsFixture.xInfo.ip)
                let fixtureRecheck = ChannelSetupRecheck(store: fixtureConsoleStore, setupStore: fixtureSetupStore, isEnabled: { true })
                _consoleConsent = State(initialValue: fixtureConsent)
                _channelSetupRecheck = State(initialValue: fixtureRecheck)
                _channelSetupSettings = State(initialValue: ChannelSetupSettingsModel(setupStore: fixtureSetupStore, forget: { fixtureRecheck.forget($0) }))
            }
        }
        #endif

        _featureFlags = State(initialValue: resolvedFlags)
    }

    var body: some Scene {
        WindowGroup {
            AnalyzeView(
                model: model,
                keepAwake: keepAwake,
                micInputs: micInputs,
                console: console,
                featureFlags: featureFlags,
                consoleConsent: consoleConsent,
                onConsoleConsentRevoked: {
                    // The heartbeat/session slice (#1667) will also call
                    // ConsoleSessionModel.consentRevoked() here once a live
                    // session model exists.
                    console = nil
                    consoleStore.disconnect()
                    channelSetupRecheck.reset()
                },
                onConsoleConnect: {
                    consoleConnectOpen = true
                },
                onDiscoverChannelSetup: openChannelSetup,
                channelSetupBanner: featureFlags.isEnabled(.console) ? channelSetupRecheck.banner : nil,
                onReviewChannelSetup: {
                    guard case let .needsReview(info, read, diff) = channelSetupRecheck.state else { return }
                    channelSetupFlow.beginRecheckReview(info: info, read: read, diff: diff)
                    channelSetupOpen = true
                },
                channelSetups: channelSetupSettings,
                onRedoChannelSetup: openChannelSetup
            )
            .task {
                let store = await Self.storeEnvironment()
                let resolved = FeatureFlags.resolve(Self.launchEnvironment(store: store))
                featureFlags = resolved
                consoleFlagBox.isEnabled = resolved.isEnabled(.console)
            }
            .onChange(of: consoleStore.phase) { old, new in
                if let info = ChannelSetupRecheck.connectedInfo(from: old, to: new), !channelSetupOpen {
                    Task { await channelSetupRecheck.connected(info) }
                }
            }
            .sheet(isPresented: $consoleConnectOpen) {
                ConsoleConnectView(store: consoleStore) { consoleConnectOpen = false }
            }
            .sheet(isPresented: $channelSetupOpen) {
                ChannelSetupFlowView(
                    flow: channelSetupFlow,
                    onDismiss: { channelSetupOpen = false },
                    onConfirmed: {
                        channelSetupRecheck.adopt($0, ipHint: consoleStore.savedConsole?.ip)
                        channelSetupSettings.refresh()
                    }
                )
            }
        }
    }

    /// "Discover channel setup" (#1781) and Settings' "Redo setup" (#1797)
    /// share this: drop any in-flight recheck, restart the flow fresh, and
    /// open it.
    private func openChannelSetup() {
        channelSetupRecheck.cancel()
        channelSetupFlow.restart()
        channelSetupOpen = true
    }

    private static func launchEnvironment(store: StoreEnvironment?) -> FeatureFlagEnvironment {
        FeatureFlagEnvironment(
            isDebugBuild: isDebugBuild,
            storeEnvironment: store,
            launchArguments: ProcessInfo.processInfo.arguments
        )
    }

    private static var isDebugBuild: Bool {
        #if DEBUG
        true
        #else
        false
        #endif
    }

    /// TestFlight and the App Store ship the same binary (ADR-0161 §8), so
    /// this is the only way to tell a TestFlight install apart from a
    /// production one. Any throw or unverified result keeps flags off.
    private static func storeEnvironment() async -> StoreEnvironment? {
        guard let result = try? await AppTransaction.shared, case .verified(let transaction) = result else {
            return nil
        }
        return StoreEnvironment(rawValue: transaction.environment.rawValue)
    }
}

#if DEBUG
/// `-consoleDemo live|reconnecting|degraded|offline`: seeds a fixture
/// `ConsoleTargetModel` so the chip states and the picker can be
/// screenshotted on the simulator. Compiles out of Release, so App Store
/// builds never carry it.
private enum ConsoleDemoSeed {
    // Real example lines from packages/console/src/capture-2026-08-16.scn,
    // plus an inverted color not in that capture.
    private static let fixtureLines = [
        "/main/st/config \"\" 66 WH",
        "/ch/01/config \"\" 1 MG 1",
        "/ch/02/config \"Vox 1\" 1 MG 2",
        "/ch/03/config \"Vox 2\" 1 MG 3",
        "/ch/04/config \"Pastor\" 1 RDi 4",
        "/ch/05/config \"Acoustic\" 1 GN 5",
        "/ch/06/config \"Keys\" 1 BL 6",
        // Main LR EQ (#1669), in ConsoleEQNodeTests' line format, so the
        // read-only EQ panel shows a populated curve and band list by
        // default.
        "/main/st/eq ON",
        "/main/st/eq/1 LShv 79.6 +2.00 0.7",
        "/main/st/eq/2 PEQ 320.0 -3.00 1.4",
        "/main/st/eq/3 PEQ 1k00 +1.50 2.0",
        "/main/st/eq/4 PEQ 2k50 -2.00 1.0",
        "/main/st/eq/5 PEQ 6k30 +2.50 1.6",
        "/main/st/eq/6 HShv 10k00 -1.00 0.7",
        // Channel 2 EQ (#1669), for screenshots once a channel is selected.
        "/ch/02/preamp +0.0 OFF ON 18 100",
        "/ch/02/eq ON",
        "/ch/02/eq/1 PEQ 120.0 +2.00 1.2",
        "/ch/02/eq/2 PEQ 600.0 -3.50 1.8",
        "/ch/02/eq/3 PEQ 3k00 +1.00 2.2",
        "/ch/02/eq/4 HShv 8k00 +2.50 0.7",
    ]

    static func fromLaunchArguments(_ arguments: [String]) -> ConsoleTargetModel? {
        guard let flagIndex = arguments.firstIndex(of: "-consoleDemo"), flagIndex + 1 < arguments.count else {
            return nil
        }
        guard let phase = phase(named: arguments[flagIndex + 1]) else { return nil }

        // Non-nil for any non-reserved suite name.
        let defaults = UserDefaults(suiteName: "consoleDemo") ?? .standard
        let demo = ConsoleTargetModel(defaults: defaults)
        demo.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        for line in fixtureLines {
            demo.ingest(nodeLine: line)
        }
        demo.phase = phase
        return demo
    }

    private static func phase(named name: String) -> ConsoleSessionPhase? {
        switch name {
        case "live": return .live
        case "reconnecting": return .reconnecting
        case "degraded": return .liveDegraded
        case "offline": return .noNetwork
        default: return nil
        }
    }
}
#endif

#if DEBUG
/// `-targetEditDemo [presetId]`: opens Analyze already in target-edit mode
/// and, when a preset id follows (for example `worship-room`), selects that
/// pill, so simulator proof of the preset row needs no taps (#1725).
/// Compiles out of Release, like `-coachingDemo`.
private enum TargetEditDemo {
    @MainActor
    static func apply(_ arguments: [String], to model: AnalyzeModel) {
        guard let flagIndex = arguments.firstIndex(of: "-targetEditDemo") else { return }
        model.beginTargetEdit()
        guard flagIndex + 1 < arguments.count,
              let preset = TargetCurvePreset.all.first(where: { $0.id == arguments[flagIndex + 1] })
        else { return }
        model.selectTargetPreset(preset)
    }
}

/// `-coachingDemo`: replaces the mic with a synthetic, fluctuating reading
/// stream so the coaching stack can be recorded on a simulator with no audio
/// input (#1700, #1715). It loops a 60 s script:
///
/// - 0-30 s, a problem mix: Bass runs hot and Presence low, and the two trade
///   which is worse every ~1.5 s (raw deltas swing across the 4 dB enter
///   threshold), so tips appear only after the dwell, hold well past 8 s,
///   and never reorder. Low-mid spikes for 1.5 s every 7 s, too briefly to
///   earn a tip.
/// - 30-60 s, the mix is fixed: every band sits near the target with a
///   little jitter, the tips clear after the exit dwell, and the calm
///   'Mix is on target' state shows.
///
/// Compiles out of Release, like `-consoleDemo`.
@MainActor
private final class CoachingDemoSource: LiveAudioSource {
    static func isRequested(by arguments: [String]) -> Bool {
        arguments.contains("-coachingDemo")
    }

    static let loopSeconds = 60.0
    static let problemSeconds = 30.0
    private static let readingsPerSecond = 20.0
    private static let baseDb = -30.0
    private let targets: [Band: Double]
    private let rtaBands: [Band]
    private var task: Task<Void, Never>?

    init(target: IdealCurve) {
        targets = target.bandTargets
        rtaBands = RTALayout.standard.bands.map { Band.containing(hz: $0.centerHz) ?? .brilliance }
    }

    func start(onReading: @escaping @MainActor (SpectrumReading) -> Void) throws {
        stop()
        let interval = Duration.seconds(1 / Self.readingsPerSecond)
        let started = Date()
        task = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: interval)
                guard let self else { return }
                onReading(self.reading(at: Date().timeIntervalSince(started)))
            }
        }
    }

    func stop() {
        task?.cancel()
        task = nil
    }

    /// Offsets from the target (dB) at `t` seconds into the demo.
    private func offsets(at t: Double) -> [Band: Double] {
        let phase = t.truncatingRemainder(dividingBy: Self.loopSeconds)
        guard phase < Self.problemSeconds else {
            return [.mid: 0.8 * sin(t * 2.3), .bass: 0.6 * sin(t * 1.7)]
        }
        let swap = sin(t * .pi / 1.5) // flips sign every 1.5 s
        var result: [Band: Double] = [
            .bass: 7 + 4 * swap,
            .presence: -(7 - 4 * swap),
        ]
        if phase.truncatingRemainder(dividingBy: 7) > 5.5 {
            result[.lowMid] = 9
        }
        return result
    }

    private func reading(at t: Double) -> SpectrumReading {
        let offsets = offsets(at: t)
        var db: [Band: Double] = [:]
        for band in Band.allCases {
            let jitter = 0.4 * sin(t * 7.3 + Double(Band.allCases.firstIndex(of: band) ?? 0))
            db[band] = Self.baseDb + (targets[band] ?? 0) + (offsets[band] ?? 0) + jitter
        }
        let rta = rtaBands.enumerated().map { index, band in
            (db[band] ?? Self.baseDb) - 6 + 1.5 * sin(t * 11 + Double(index) * 0.7)
        }
        return SpectrumReading(bands: BandLevels(db: db), rtaDb: rta, overallDb: -18)
    }
}
#endif

#if DEBUG
/// `-speechBedDemo`: replaces the mic with a synthetic speech-over-underscore
/// reading stream (#1702) so the Speech + bed state can be recorded on a
/// simulator with no audio input. A voice talks at ~4 syllables per second
/// with a phrase pause every 3.2 s over a quiet pad. Each reading carries
/// ProgramFeatures shaped like the real analyzer's for that moment (voice
/// band heavy on the words, the pad's low end in the gaps), and the real
/// classifier and tracker decide the state. Against the speech curve the
/// pad's sub-bass, bass and air read +10 to +14 dB hot and the voice is a
/// little thin in the mids, so in Speech + bed only the Mid tip shows.
///
/// Compiles out of Release, like `-coachingDemo`.
@MainActor
private final class SpeechBedDemoSource: LiveAudioSource {
    static func isRequested(by arguments: [String]) -> Bool {
        arguments.contains("-speechBedDemo")
    }

    private static let readingsPerSecond = 20.0
    private static let baseDb = -40.0
    private static let offsets: [Band: Double] = [.subBass: 14, .bass: 12, .brilliance: 10, .mid: -7]
    private let targets: [Band: Double]
    private let rtaBands: [Band]
    private var task: Task<Void, Never>?

    init() {
        let speech = try? IdealCurveLibrary.builtIn(id: IdealCurveLibrary.speechPodcastId)
        targets = speech?.bandTargets ?? [:]
        rtaBands = RTALayout.standard.bands.map { Band.containing(hz: $0.centerHz) ?? .brilliance }
    }

    func start(onReading: @escaping @MainActor (SpectrumReading) -> Void) throws {
        stop()
        let interval = Duration.seconds(1 / Self.readingsPerSecond)
        let started = Date()
        task = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: interval)
                guard let self else { return }
                onReading(self.reading(at: Date().timeIntervalSince(started)))
            }
        }
    }

    func stop() {
        task?.cancel()
        task = nil
    }

    /// Syllable envelope in dB (0 = peak), nil between words and phrases.
    private static func voiceDb(at t: Double) -> Double? {
        if t.truncatingRemainder(dividingBy: 3.2) > 2.6 { return nil }
        if t.truncatingRemainder(dividingBy: 0.25) > 0.17 { return nil }
        return -6 * (0.5 + 0.5 * sin(t * 5.3))
    }

    private func reading(at t: Double) -> SpectrumReading {
        let voice = Self.voiceDb(at: t)
        let features = voice.map { envelope in
            ProgramFeatures(
                speechBandFraction: 0.9, subFraction: 0.025, airFraction: 0.002,
                centroidHz: 3_000, flatness: 0.001, levelDb: -29 + envelope
            )
        } ?? ProgramFeatures(
            speechBandFraction: 0.1, subFraction: 0.6, airFraction: 0.05,
            centroidHz: 700, flatness: 0.001, levelDb: -50 + 1.5 * sin(t * 0.4)
        )
        var db: [Band: Double] = [:]
        for band in Band.allCases {
            let jitter = 0.4 * sin(t * 7.3 + Double(Band.allCases.firstIndex(of: band) ?? 0))
            db[band] = Self.baseDb + (targets[band] ?? 0) + (Self.offsets[band] ?? 0) + jitter
        }
        let rta = rtaBands.enumerated().map { index, band in
            (db[band] ?? Self.baseDb) - 6 + 1.5 * sin(t * 11 + Double(index) * 0.7)
        }
        return SpectrumReading(bands: BandLevels(db: db), rtaDb: rta, overallDb: features.levelDb, programFeatures: features)
    }
}
#endif

#if DEBUG
/// `-testNoise [pink|white]` (#1740): seeded pink or white noise at about
/// -20 dBFS, generated in-process and run through the real SpectrumAnalyzer
/// (the same 1/6-octave band sums the mic path uses), so the RTA shows what
/// real noise looks like with #1726's bandwidth correction. Pink pairs with a
/// -3 dB/oct target and white with flat; both should read level with the
/// line. Never touches the mic. Compiles out of Release.
@MainActor
private final class TestNoiseSource: LiveAudioSource {
    private static let sampleRate = 48_000.0
    private static let readingsPerSecond = 20.0
    private var generator: TestNoiseGenerator
    private var analyzer: SpectrumAnalyzer?
    private var task: Task<Void, Never>?

    init(color: TestNoiseColor) {
        generator = TestNoiseGenerator(color: color, seed: 1740)
    }

    func start(onReading: @escaping @MainActor (SpectrumReading) -> Void) throws {
        stop()
        analyzer = try SpectrumAnalyzer(sampleRate: Self.sampleRate)
        let interval = Duration.seconds(1 / Self.readingsPerSecond)
        task = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: interval)
                guard let self else { return }
                if let reading = self.nextReading() { onReading(reading) }
            }
        }
    }

    private func nextReading() -> SpectrumReading? {
        guard let analyzer else { return nil }
        return try? analyzer.analyze(generator.next(count: analyzer.fftSize))
    }

    func stop() {
        task?.cancel()
        task = nil
    }
}
#endif
