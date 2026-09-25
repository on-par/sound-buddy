import SoundBuddyKit
import SwiftUI

@main
struct SoundBuddyApp: App {
    @State private var model = AnalyzeModel(permission: SystemMicPermission(), source: MicCapture())

    var body: some Scene {
        WindowGroup {
            AnalyzeView(model: model)
        }
    }
}
