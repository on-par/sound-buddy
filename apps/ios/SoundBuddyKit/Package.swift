// swift-tools-version: 6.0
// SoundBuddyKit — the testable core of the iOS app: band table, ring buffer,
// Accelerate spectrum, shared JSON contract models, coaching rules, and the
// Analyze screen model. The app target (../SoundBuddy) only adds SwiftUI views
// and the AVAudioEngine mic adapter. `swift test` runs on a Mac with no
// simulator; nothing here compiles on Linux (Accelerate is Apple-only).
import PackageDescription

let package = Package(
    name: "SoundBuddyKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "SoundBuddyKit", targets: ["SoundBuddyKit"]),
    ],
    targets: [
        .target(name: "SoundBuddyKit"),
        .testTarget(
            name: "SoundBuddyKitTests",
            dependencies: ["SoundBuddyKit"],
            // Read via #filePath (see TestPaths), not bundled as resources.
            exclude: ["Fixtures"]
        ),
    ]
)
