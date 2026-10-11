import SoundBuddyKit
import SwiftUI
import UIKit

@main
struct SoundBuddyApp: App {
    @State private var model: AnalyzeModel
    @State private var micInputs: MicInputController
    @State private var keepAwake = KeepAwakeController(timer: UIApplication.shared)
    /// nil until #1662 (flag), #1665 (consent) and #1666 (transport/connect)
    /// wire a real console model in; the chip stays hidden without one.
    @State private var console: ConsoleTargetModel?
    @State private var consoleFlagEnabled = false
    @State private var consoleConsentGranted = false

    init() {
        // One controller shared by capture (applies the choice) and Settings
        // (lists and changes it).
        let inputs = MicInputController(session: SystemMicInputSession())
        _micInputs = State(initialValue: inputs)
        _model = State(initialValue: AnalyzeModel(
            permission: SystemMicPermission(),
            source: MicCapture(inputs: inputs),
            target: IdealCurveLibrary.liveDefault()
        ))

        #if DEBUG
        if let demo = ConsoleDemoSeed.fromLaunchArguments(ProcessInfo.processInfo.arguments) {
            _console = State(initialValue: demo)
            _consoleFlagEnabled = State(initialValue: true)
            _consoleConsentGranted = State(initialValue: true)
        }
        #endif
    }

    var body: some Scene {
        WindowGroup {
            AnalyzeView(
                model: model,
                keepAwake: keepAwake,
                micInputs: micInputs,
                console: console,
                consoleFlagEnabled: consoleFlagEnabled,
                consoleConsentGranted: consoleConsentGranted
            )
        }
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
