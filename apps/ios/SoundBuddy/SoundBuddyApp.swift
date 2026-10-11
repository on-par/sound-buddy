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
