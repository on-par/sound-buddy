import SoundBuddyKit
import SwiftUI
import UIKit

@main
struct SoundBuddyApp: App {
    @State private var model: AnalyzeModel
    @State private var micInputs: MicInputController
    @State private var keepAwake = KeepAwakeController(timer: UIApplication.shared)

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
    }

    var body: some Scene {
        WindowGroup {
            AnalyzeView(model: model, keepAwake: keepAwake, micInputs: micInputs)
        }
    }
}
