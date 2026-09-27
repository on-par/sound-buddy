import Foundation
import Testing
@testable import SoundBuddyKit

@MainActor
private final class FakeIdleTimer: IdleTimerControlling {
    var isIdleTimerDisabled: Bool

    init(disabled: Bool = false) { isIdleTimerDisabled = disabled }
}

@Suite("KeepAwake")
struct KeepAwakeTests {
    @Test(
        "shouldDisableIdleTimer only when kept awake and active",
        arguments: [
            (true, true, true),
            (true, false, false),
            (false, true, false),
            (false, false, false),
        ]
    )
    func policy(keepAwake: Bool, isSceneActive: Bool, expected: Bool) {
        #expect(KeepAwakePolicy.shouldDisableIdleTimer(keepAwake: keepAwake, isSceneActive: isSceneActive) == expected)
    }

    @Test("preference defaults to keep awake when never set")
    func defaultsToOn() throws {
        let suite = "KeepAwakeTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        #expect(KeepAwakePolicy.keepAwake(in: defaults) == true)
    }

    @Test("stored preference persists through UserDefaults")
    func persisted() throws {
        let suite = "KeepAwakeTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set(false, forKey: KeepAwakePolicy.defaultsKey)
        #expect(KeepAwakePolicy.keepAwake(in: defaults) == false)
        defaults.set(true, forKey: KeepAwakePolicy.defaultsKey)
        #expect(KeepAwakePolicy.keepAwake(in: defaults) == true)
    }

    @Test("controller applies the policy as the scene goes active, background, and back")
    @MainActor
    func sceneTransitions() {
        let timer = FakeIdleTimer()
        let controller = KeepAwakeController(timer: timer)

        controller.apply(keepAwake: true, isSceneActive: true)
        #expect(timer.isIdleTimerDisabled == true)

        controller.apply(keepAwake: true, isSceneActive: false)
        #expect(timer.isIdleTimerDisabled == false)

        controller.apply(keepAwake: true, isSceneActive: true)
        #expect(timer.isIdleTimerDisabled == true)
    }

    @Test("turning the preference off while active restores the idle timer")
    @MainActor
    func preferenceOff() {
        let timer = FakeIdleTimer()
        let controller = KeepAwakeController(timer: timer)

        controller.apply(keepAwake: true, isSceneActive: true)
        controller.apply(keepAwake: false, isSceneActive: true)
        #expect(timer.isIdleTimerDisabled == false)

        controller.apply(keepAwake: true, isSceneActive: true)
        #expect(timer.isIdleTimerDisabled == true)
    }

    @Test("release always re-enables the idle timer")
    @MainActor
    func release() {
        let timer = FakeIdleTimer(disabled: true)
        let controller = KeepAwakeController(timer: timer)

        controller.release()
        #expect(timer.isIdleTimerDisabled == false)
    }

    @Test("accessibility value reflects the preference")
    func accessibilityValue() {
        #expect(KeepAwakePolicy.accessibilityValue(keepAwake: true) == "On")
        #expect(KeepAwakePolicy.accessibilityValue(keepAwake: false) == "Off")
        #expect(KeepAwakePolicy.accessibilityLabel == "Keep screen awake while analyzing")
    }
}
