import Foundation
import Observation

/// Every user-facing string for console consent (#1665), named so the sheet,
/// Settings and the Info.plist test share one source. ADR-0161 §8: the copy
/// must name reads and EQ-only writes.
public enum ConsoleConsentCopy {
    public static let connectTitle = "Connect to your X32/M32"
    public static let sheetTitle = "Connect to your console"
    public static let readsHeading = "What Sound Buddy reads"
    public static let reads = "Channel names, EQ settings and levels from your X32 or M32."
    public static let writesHeading = "What Sound Buddy can change"
    public static let writes = "EQ only, and only after you Arm it. Faders, mutes, routing and scenes are never touched."
    public static let localNetworkNote = "Next, iOS will ask to find devices on your local network. Allow it so Sound Buddy can reach the console."
    public static let allowButton = "Allow access"
    public static let cancelButton = "Not now"
    public static let revokeButton = "Revoke access"
    public static let grantedStatus = "Access allowed"
    public static let revokeFooter = "Revoking disconnects from the console. To connect again, tap Connect and allow access on the next screen."
    public static let localNetworkUsageDescription =
        "Sound Buddy connects to your X32 or M32 on this network to read channel names, EQ and levels, and changes EQ only when you arm it."
}

/// What tapping "Connect to your X32/M32" does next.
public enum ConsoleConnectStep: Equatable, Sendable {
    case showConsentSheet
    case proceed
}

/// Persisted console-network consent (ADR-0006 semantics on iOS, ADR-0161
/// §8). `grant()` is called only from `ConsoleConsentView`'s Allow button;
/// Settings calls only `revoke()`. Same injected-UserDefaults idiom as
/// `MicInputController`.
@Observable
public final class ConsoleConsentStore {
    public static let defaultsKey = "consoleNetworkConsentGranted"
    public private(set) var isGranted: Bool
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        isGranted = defaults.bool(forKey: Self.defaultsKey) // missing key -> false
    }

    public func connectStep() -> ConsoleConnectStep { isGranted ? .proceed : .showConsentSheet }

    public func grant() {
        isGranted = true
        defaults.set(true, forKey: Self.defaultsKey)
    }

    public func revoke() {
        isGranted = false
        defaults.set(false, forKey: Self.defaultsKey)
    }
}
