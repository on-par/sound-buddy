import Foundation

/// Paths to repo files the tests read directly (shared contracts, the Mac
/// engine's band table, parity fixtures) — resolved from this file's location
/// so they work from `swift test` and from Xcode alike.
enum TestPaths {
    /// apps/ios/SoundBuddyKit/Tests/SoundBuddyKitTests
    static let testsDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    /// apps/ios
    static let iosRoot = testsDir.appending(path: "../../..").standardizedFileURL
    /// Repository root.
    static let repoRoot = iosRoot.appending(path: "../..").standardizedFileURL

    static func contractExample(_ name: String) -> URL {
        iosRoot.appending(path: "Contracts/examples/\(name)")
    }

    static func fixture(_ name: String) -> URL {
        testsDir.appending(path: "Fixtures/\(name)")
    }
}
