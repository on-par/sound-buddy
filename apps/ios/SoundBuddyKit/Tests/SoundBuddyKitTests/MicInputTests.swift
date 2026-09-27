import Foundation
import Testing
@testable import SoundBuddyKit

@MainActor
private final class FakeMicSession: MicInputSession {
    var options: [MicInputOption]
    var activeID: String?
    var applied: [MicInputOption?] = []
    var failApply = false

    init(options: [MicInputOption], activeID: String? = nil) {
        self.options = options
        self.activeID = activeID
    }

    func availableOptions() -> [MicInputOption] { options }
    func activeOptionID() -> String? { activeID }

    func apply(_ option: MicInputOption?) throws {
        if failApply { throw ApplyFailure() }
        applied.append(option)
        activeID = option?.id
    }
}

private struct ApplyFailure: Error {}

private let bottom = MicInputOption(portUID: "Built-In Microphone", dataSourceID: 1, name: "iPhone Microphone (Bottom)")
private let front = MicInputOption(portUID: "Built-In Microphone", dataSourceID: 2, name: "iPhone Microphone (Front)")
private let usb = MicInputOption(portUID: "AppleUSBAudioEngine:Focusrite:1", dataSourceID: nil, name: "Scarlett Solo USB")

private func freshDefaults() throws -> (UserDefaults, String) {
    let suite = "MicInputTests.\(UUID().uuidString)"
    return (try #require(UserDefaults(suiteName: suite)), suite)
}

@Suite("MicInputPolicy")
struct MicInputPolicyTests {
    @Test("option id is the port UID, plus the data source when there is one")
    func optionIDs() {
        #expect(usb.id == "AppleUSBAudioEngine:Focusrite:1")
        #expect(bottom.id == "Built-In Microphone#1")
        #expect(front.id != bottom.id)
    }

    @Test("resolve keeps the preferred input while it is available")
    func resolvePreferred() {
        let id = MicInputPolicy.resolve(preferredID: usb.id, availableIDs: [bottom.id, usb.id], systemDefaultID: bottom.id)
        #expect(id == usb.id)
    }

    @Test("resolve falls back to the system default when the preferred input is gone")
    func resolveMissing() {
        let id = MicInputPolicy.resolve(preferredID: usb.id, availableIDs: [bottom.id, front.id], systemDefaultID: bottom.id)
        #expect(id == bottom.id)
    }

    @Test("resolve uses the system default when nothing is preferred")
    func resolveNoPreference() {
        #expect(MicInputPolicy.resolve(preferredID: nil, availableIDs: [bottom.id], systemDefaultID: bottom.id) == bottom.id)
        #expect(MicInputPolicy.resolve(preferredID: nil, availableIDs: [], systemDefaultID: nil) == nil)
    }

    @Test("preferred input id round-trips through UserDefaults and clears")
    func persistence() throws {
        let (defaults, suite) = try freshDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        #expect(MicInputPolicy.preferredID(in: defaults) == nil)
        MicInputPolicy.storePreferredID(usb.id, in: defaults)
        #expect(MicInputPolicy.preferredID(in: defaults) == usb.id)
        #expect(defaults.string(forKey: MicInputPolicy.defaultsKey) == usb.id)
        MicInputPolicy.storePreferredID(nil, in: defaults)
        #expect(MicInputPolicy.preferredID(in: defaults) == nil)
    }

    @Test("honesty footnote says uncalibrated estimate, not dBA, and never claims calibration")
    func honestyCopy() {
        let copy = MicInputPolicy.honestyFootnote
        #expect(copy.contains("uncalibrated estimate"))
        #expect(copy.contains("not dBA"))
        #expect(!copy.lowercased().contains("calibrated spl"))
    }

    @Test("row accessibility identifiers are stable and free of spaces and punctuation")
    func accessibilityIdentifiers() {
        #expect(MicInputPolicy.accessibilityIdentifier(for: bottom.id) == "settings.mic.built-in-microphone-1")
        #expect(MicInputPolicy.accessibilityIdentifier(for: usb.id) == "settings.mic.appleusbaudioengine-focusrite-1")
        #expect(MicInputPolicy.accessibilityIdentifier(for: nil) == "settings.mic.system-default")
    }

    @Test("row accessibility labels name the input and whether it is selected")
    func accessibilityLabels() {
        #expect(MicInputPolicy.accessibilityLabel(name: usb.name, isSelected: true) == "Scarlett Solo USB, selected")
        #expect(MicInputPolicy.accessibilityLabel(name: usb.name, isSelected: false) == "Scarlett Solo USB")
    }
}

@MainActor
@Suite("MicInputController")
struct MicInputControllerTests {
    @Test("refresh lists inputs and keeps a preference that is still present")
    func refreshKeepsPreference() throws {
        let (defaults, suite) = try freshDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        MicInputPolicy.storePreferredID(usb.id, in: defaults)
        let session = FakeMicSession(options: [bottom, usb], activeID: usb.id)
        let controller = MicInputController(session: session, defaults: defaults)

        controller.refresh()

        #expect(controller.options == [bottom, usb])
        #expect(controller.preferredID == usb.id)
        #expect(controller.activeID == usb.id)
        #expect(controller.activeName == usb.name)
    }

    @Test("refresh drops a preference whose input is gone and shows the system default")
    func refreshFallsBack() throws {
        let (defaults, suite) = try freshDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        MicInputPolicy.storePreferredID(usb.id, in: defaults)
        let session = FakeMicSession(options: [bottom, front], activeID: bottom.id)
        let controller = MicInputController(session: session, defaults: defaults)

        controller.refresh()

        #expect(controller.preferredID == nil)
        #expect(MicInputPolicy.preferredID(in: defaults) == nil, "a missing input's preference is cleared")
        #expect(controller.activeID == bottom.id)
        #expect(controller.activeName == bottom.name)
    }

    @Test("active name falls back to copy when the route is unknown")
    func unknownActiveName() throws {
        let (defaults, suite) = try freshDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let controller = MicInputController(session: FakeMicSession(options: []), defaults: defaults)
        controller.refresh()
        #expect(controller.activeID == nil)
        #expect(controller.activeName == MicInputPolicy.systemDefaultName)
    }

    @Test("select persists, applies to the session, and updates the selection")
    func select() throws {
        let (defaults, suite) = try freshDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let session = FakeMicSession(options: [bottom, usb], activeID: bottom.id)
        let controller = MicInputController(session: session, defaults: defaults)
        controller.refresh()

        controller.select(usb.id)

        #expect(session.applied == [usb])
        #expect(MicInputPolicy.preferredID(in: defaults) == usb.id)
        #expect(controller.preferredID == usb.id)
        #expect(controller.activeID == usb.id)
    }

    @Test("selecting the system default clears the preference")
    func selectSystemDefault() throws {
        let (defaults, suite) = try freshDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        MicInputPolicy.storePreferredID(usb.id, in: defaults)
        let session = FakeMicSession(options: [bottom, usb], activeID: usb.id)
        let controller = MicInputController(session: session, defaults: defaults)
        controller.refresh()

        controller.select(nil)

        #expect(session.applied == [nil])
        #expect(MicInputPolicy.preferredID(in: defaults) == nil)
        #expect(controller.preferredID == nil)
    }

    @Test("selecting an input that vanished falls back to the system default")
    func selectUnknown() throws {
        let (defaults, suite) = try freshDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let session = FakeMicSession(options: [bottom], activeID: bottom.id)
        let controller = MicInputController(session: session, defaults: defaults)
        controller.refresh()

        controller.select(usb.id)

        #expect(session.applied == [nil])
        #expect(controller.preferredID == nil)
        #expect(MicInputPolicy.preferredID(in: defaults) == nil)
    }

    @Test("a session that refuses the input leaves the system default in place")
    func selectApplyFails() throws {
        let (defaults, suite) = try freshDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        let session = FakeMicSession(options: [bottom, usb], activeID: bottom.id)
        session.failApply = true
        let controller = MicInputController(session: session, defaults: defaults)
        controller.refresh()

        controller.select(usb.id)

        #expect(controller.preferredID == nil)
        #expect(MicInputPolicy.preferredID(in: defaults) == nil)
        #expect(controller.activeID == bottom.id)
    }

    @Test("applyPreferred re-applies the stored input before capture starts")
    func applyPreferred() throws {
        let (defaults, suite) = try freshDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        MicInputPolicy.storePreferredID(usb.id, in: defaults)
        let session = FakeMicSession(options: [bottom, usb], activeID: bottom.id)
        let controller = MicInputController(session: session, defaults: defaults)

        controller.applyPreferred()

        #expect(session.applied == [usb])
        #expect(controller.activeID == usb.id)
    }

    @Test("applyPreferred with a missing input resets to the system default")
    func applyPreferredMissing() throws {
        let (defaults, suite) = try freshDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        MicInputPolicy.storePreferredID(usb.id, in: defaults)
        let session = FakeMicSession(options: [bottom], activeID: bottom.id)
        let controller = MicInputController(session: session, defaults: defaults)

        controller.applyPreferred()

        #expect(session.applied == [nil])
        #expect(controller.preferredID == nil)
        #expect(MicInputPolicy.preferredID(in: defaults) == nil)
    }

    @Test("applyPreferred tolerates a session that refuses the input")
    func applyPreferredFails() throws {
        let (defaults, suite) = try freshDefaults()
        defer { defaults.removePersistentDomain(forName: suite) }
        MicInputPolicy.storePreferredID(usb.id, in: defaults)
        let session = FakeMicSession(options: [bottom, usb], activeID: bottom.id)
        session.failApply = true
        let controller = MicInputController(session: session, defaults: defaults)

        controller.applyPreferred()

        #expect(controller.activeID == bottom.id)
        #expect(controller.preferredID == usb.id, "a transient refusal keeps the preference for next time")
    }
}
