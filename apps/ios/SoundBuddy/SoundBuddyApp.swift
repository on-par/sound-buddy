import SoundBuddyKit
import SwiftUI
import UIKit

@main
struct SoundBuddyApp: App {
    @State private var model = AnalyzeModel(
        permission: SystemMicPermission(),
        source: MicCapture(),
        target: IdealCurveLibrary.liveDefault()
    )
    @State private var keepAwake = KeepAwakeController(timer: UIApplication.shared)

    var body: some Scene {
        WindowGroup {
            AnalyzeView(model: model, keepAwake: keepAwake)
        }
    }
}
