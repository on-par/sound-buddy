import Foundation

/// Anything with an idle-timer switch. UIApplication conforms in the app
/// target; tests use a fake, so nothing here needs UIKit.
@MainActor
public protocol IdleTimerControlling: AnyObject {
    var isIdleTimerDisabled: Bool { get set }
}

/// Keeps the phone from auto-locking while Analyze is in the foreground
/// (#1584). The idle timer is disabled only when the user's preference is on
/// AND the scene is active — leaving the foreground always hands it back.
public enum KeepAwakePolicy {
    /// UserDefaults / @AppStorage key for the persisted preference.
    public static let defaultsKey = "keepAwakeWhileAnalyzing"
    /// On by default: a phone left on a stand mid-service shouldn't lock.
    public static let defaultValue = true

    public static let accessibilityLabel = "Keep screen awake while analyzing"

    public static func shouldDisableIdleTimer(keepAwake: Bool, isSceneActive: Bool) -> Bool {
        keepAwake && isSceneActive
    }

    /// The stored preference, falling back to `defaultValue` when never set.
    public static func keepAwake(in defaults: UserDefaults) -> Bool {
        defaults.object(forKey: defaultsKey) as? Bool ?? defaultValue
    }

    public static func accessibilityValue(keepAwake: Bool) -> String {
        keepAwake ? "On" : "Off"
    }
}

/// Applies KeepAwakePolicy to an injected idle timer.
@MainActor
public final class KeepAwakeController {
    private let timer: IdleTimerControlling

    public init(timer: IdleTimerControlling) {
        self.timer = timer
    }

    public func apply(keepAwake: Bool, isSceneActive: Bool) {
        timer.isIdleTimerDisabled = KeepAwakePolicy.shouldDisableIdleTimer(
            keepAwake: keepAwake,
            isSceneActive: isSceneActive
        )
    }

    /// Unconditionally restores normal auto-lock (view gone, app leaving).
    public func release() {
        timer.isIdleTimerDisabled = false
    }
}
