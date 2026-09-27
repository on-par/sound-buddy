import SoundBuddyKit
#if canImport(UIKit)
import UIKit

/// The real idle-timer switch behind KeepAwakeController (#1584).
/// UIApplication already has `isIdleTimerDisabled`; this only declares it.
extension UIApplication: @retroactive IdleTimerControlling {}
#endif
