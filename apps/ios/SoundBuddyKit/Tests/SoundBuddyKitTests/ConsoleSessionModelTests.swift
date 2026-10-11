import Foundation
import Testing
@testable import SoundBuddyKit

private let foh = ConsoleIdentity(name: "FOH", model: "M32R")

/// Records effects in the order the model forwards them, and a fake clock
/// the test advances by hand — no real timers or sockets anywhere here.
private final class Recorder {
    var effects: [ConsoleSessionEffect] = []
    var clock: TimeInterval = 0

    func perform(_ effect: ConsoleSessionEffect) {
        effects.append(effect)
    }
}

@Suite struct ConsoleSessionModelTests {
    @Test func sendForwardsEffectsInOrderAndUpdatesPublishedState() {
        let recorder = Recorder()
        let model = ConsoleSessionModel(now: { recorder.clock }, perform: recorder.perform)

        #expect(model.phase == .idle)
        #expect(model.isStale == false)
        #expect(model.statusMessage == nil)

        recorder.clock = 0
        model.send(.connect(foh))

        #expect(recorder.effects == [.openSocket, .sendXInfo])
        #expect(model.phase == .connecting)
        #expect(model.statusMessage == "Connecting…")

        recorder.effects.removeAll()
        recorder.clock = 0.1
        model.send(.identityReceived(foh))
        #expect(recorder.effects == [.sendXRemote, .requestFullResync])
        #expect(model.phase == .syncing)

        recorder.effects.removeAll()
        recorder.clock = 0.2
        model.send(.syncCompleted)
        #expect(recorder.effects.isEmpty)
        #expect(model.phase == .live)
        #expect(model.statusMessage == nil)
        #expect(model.isStale == false)
    }

    @Test func isStaleReflectsSnapshotAfterBackgrounding() {
        let recorder = Recorder()
        let model = ConsoleSessionModel(now: { recorder.clock }, perform: recorder.perform)

        model.send(.connect(foh))
        model.send(.identityReceived(foh))
        model.send(.syncCompleted)
        #expect(model.isStale == false)

        recorder.clock = 10
        model.send(.enteredBackground)
        #expect(model.phase == .suspended)
        #expect(model.isStale == true)
        #expect(model.statusMessage == "Refreshing console values…")
    }

    @Test func noEffectsAreForwardedForANoOpEvent() {
        let recorder = Recorder()
        let model = ConsoleSessionModel(now: { recorder.clock }, perform: recorder.perform)

        model.send(.statusReply) // idle, socket closed: no-op
        #expect(recorder.effects.isEmpty)
        #expect(model.phase == .idle)
    }
}
