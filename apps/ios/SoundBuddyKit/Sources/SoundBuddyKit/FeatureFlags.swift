import Foundation

/// Mirrors `app/electron/feature-flags.ts` (ADR-0148) per ADR-0161 §8: every
/// flag defaults to off, is resolved once at launch, is never persisted
/// (no UserDefaults / AppStorage), and has no user-facing toggle. iOS has
/// only the `console` id today; new ids are added to `FeatureFlagId` in one
/// line.
public enum FeatureFlagId: String, CaseIterable, Sendable {
    /// Settings > "Console (beta)" and, in later slices, the M32/X32 console link.
    case console
}

/// Where StoreKit says this binary was installed from. Raw values match
/// `AppStore.Environment.rawValue` ("Production", "Sandbox", "Xcode"),
/// since TestFlight and the App Store ship the same binary and are told
/// apart only through this environment.
public enum StoreEnvironment: Equatable, Sendable {
    case production
    case sandbox
    case xcode

    /// Case-insensitive; unknown or empty raw values (e.g. a future
    /// StoreKit case, or `""`) map to nil, which `resolve` treats as "not
    /// TestFlight".
    public init?(rawValue: String) {
        switch rawValue.lowercased() {
        case "production": self = .production
        case "sandbox": self = .sandbox
        case "xcode": self = .xcode
        default: return nil
        }
    }
}

/// The inputs `FeatureFlags.resolve` needs, injected so the resolver stays
/// pure and testable without StoreKit or a real process environment.
public struct FeatureFlagEnvironment: Equatable, Sendable {
    public let isDebugBuild: Bool
    public let storeEnvironment: StoreEnvironment?
    public let launchArguments: [String]

    public init(isDebugBuild: Bool, storeEnvironment: StoreEnvironment?, launchArguments: [String]) {
        self.isDebugBuild = isDebugBuild
        self.storeEnvironment = storeEnvironment
        self.launchArguments = launchArguments
    }
}

/// An immutable, resolved set of flags. Only `resolve`, `override`, `allOff`
/// and `allOn` can produce a value, so there is no setter anywhere that
/// could persist or toggle one.
public struct FeatureFlags: Equatable, Sendable {
    /// Launch argument UI tests use: `-soundBuddyFeatures all|none|<id,id>`.
    public static let launchArgument = "-soundBuddyFeatures"
    private static let allToken = "all"
    private static let noneToken = "none"

    private let enabled: Set<FeatureFlagId>

    private init(enabled: Set<FeatureFlagId>) {
        self.enabled = enabled
    }

    public static let allOff = FeatureFlags(enabled: [])
    public static let allOn = FeatureFlags(enabled: Set(FeatureFlagId.allCases))

    public func isEnabled(_ id: FeatureFlagId) -> Bool {
        switch id {
        case .console: return enabled.contains(.console)
        }
    }

    /// `nil` when `launchArgument` is absent or is the last argument with no
    /// value, which falls through to the build/store rules in `resolve`.
    public static func override(fromLaunchArguments arguments: [String]) -> FeatureFlags? {
        guard let flagIndex = arguments.firstIndex(of: launchArgument), flagIndex + 1 < arguments.count else {
            return nil
        }
        let tokens = Set(
            arguments[flagIndex + 1]
                .lowercased()
                .split(whereSeparator: { $0 == "," || $0.isWhitespace })
                .map(String.init)
        )
        if tokens.isEmpty || tokens.contains(noneToken) {
            return .allOff
        }
        if tokens.contains(allToken) {
            return .allOn
        }
        return FeatureFlags(enabled: Set(FeatureFlagId.allCases.filter { tokens.contains($0.rawValue.lowercased()) }))
    }

    /// Precedence: a well-formed launch-argument override wins outright;
    /// otherwise Debug turns everything on; otherwise a sandbox (TestFlight)
    /// store environment turns everything on; otherwise everything is off
    /// (production, xcode, or no store environment yet).
    public static func resolve(_ environment: FeatureFlagEnvironment) -> FeatureFlags {
        if let override = override(fromLaunchArguments: environment.launchArguments) {
            return override
        }
        if environment.isDebugBuild {
            return .allOn
        }
        if environment.storeEnvironment == .sandbox {
            return .allOn
        }
        return .allOff
    }
}

/// Settings copy for the flag-gated "Console (beta)" section.
public enum ConsoleSettingsCopy {
    public static let sectionTitle = "Console (beta)"
    public static let footer = "Console features for testers. Access is granted only from the connect screen; this section can only revoke it."
}
