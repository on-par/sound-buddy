import Foundation
import Testing
@testable import SoundBuddyKit

private let foh = ConsoleIdentity(name: "FOH", model: "M32R")

/// Records effects in order; a fake clock the test advances by hand.
private final class Recorder {
    var effects: [ConsoleSessionEffect] = []
    var clock: TimeInterval = 0

    func perform(_ effect: ConsoleSessionEffect) {
        effects.append(effect)
    }
}

/// A fake clock plus a datagram-capturing, decoding recorder, copied from
/// `ConsoleEQWriterTests`' `EQRecorder` (file-private there).
private final class EQRecorder {
    var clock: TimeInterval = 0
    var datagrams: [(sentAt: TimeInterval, message: OSCMessage)] = []

    func perform(_ effect: ConsoleSessionEffect) {}

    func sendDatagram(_ data: Data) {
        guard let message = try? OSCCodec.decode(data) else {
            Issue.record("writer sent an undecodable datagram")
            return
        }
        datagrams.append((sentAt: clock, message: message))
    }
}

@Suite struct ConsoleConsentTests {
    // MARK: - ConsoleConsentStore

    @Test func aFreshStoreIsNotGrantedAndConnectStepShowsTheConsentSheet() {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let store = ConsoleConsentStore(defaults: defaults)

        #expect(store.isGranted == false)
        #expect(store.connectStep() == .showConsentSheet)
    }

    @Test func grantPersistsAcrossStoreInstancesAndConnectStepProceeds() {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let storeA = ConsoleConsentStore(defaults: defaults)
        storeA.grant()

        let storeB = ConsoleConsentStore(defaults: defaults)
        #expect(storeB.isGranted)
        #expect(storeB.connectStep() == .proceed)
    }

    @Test func revokePersistsFalse() {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let storeA = ConsoleConsentStore(defaults: defaults)
        storeA.grant()
        storeA.revoke()

        let storeB = ConsoleConsentStore(defaults: defaults)
        #expect(storeB.isGranted == false)
        #expect(storeB.connectStep() == .showConsentSheet)
    }

    // MARK: - ConsoleSessionModel gating

    @Test func aSessionModelWithoutConsentSendsNoPacketOnConnect() {
        let recorder = Recorder()
        let eqRecorder = EQRecorder()
        let model = ConsoleSessionModel(
            now: { recorder.clock },
            isConsentGranted: { false },
            perform: recorder.perform,
            sendDatagram: eqRecorder.sendDatagram
        )

        model.send(.connect(foh))
        #expect(recorder.effects.isEmpty)
        #expect(model.phase == .idle)

        model.send(.tick)
        #expect(recorder.effects.isEmpty)

        #expect(model.arm() == nil)
    }

    @Test func consentGateDropsDatagramsFromAnArmedWriterAfterConsentFlipsOff() throws {
        let recorder = Recorder()
        let eqRecorder = EQRecorder()
        var consentGranted = true
        let model = ConsoleSessionModel(
            now: { recorder.clock },
            isConsentGranted: { consentGranted },
            perform: recorder.perform,
            sendDatagram: eqRecorder.sendDatagram
        )

        model.send(.connect(foh))
        model.send(.identityReceived(foh))
        model.send(.syncCompleted)
        guard let writer = model.arm() else {
            fatalError("expected arm() to return a writer once live")
        }
        writer.recordSnapshot(ConsoleEQ.flat(for: .channel(1)))

        consentGranted = false
        try writer.submit(.gain(band: 1, db: 3, gestureStartDb: 0), on: .channel(1))
        recorder.clock += 1
        writer.tick()

        #expect(eqRecorder.datagrams.isEmpty)
    }

    @Test func revokingMidSessionForwardsOnlyCloseSocket() {
        let recorder = Recorder()
        var consentGranted = true
        let model = ConsoleSessionModel(
            now: { recorder.clock },
            isConsentGranted: { consentGranted },
            perform: recorder.perform
        )

        model.send(.connect(foh))
        model.send(.identityReceived(foh))
        model.send(.syncCompleted)
        model.arm()
        recorder.effects.removeAll()

        consentGranted = false
        model.consentRevoked()

        #expect(recorder.effects == [.closeSocket])
        #expect(model.phase == .idle)
        #expect(model.isArmed == false)
        #expect(model.eqWriter == nil)
    }

    @Test func consentRevokedClosesALiveSessionAndDisarmsTheWriter() {
        let recorder = Recorder()
        let model = ConsoleSessionModel(
            now: { recorder.clock },
            isConsentGranted: { true },
            perform: recorder.perform
        )

        model.send(.connect(foh))
        model.send(.identityReceived(foh))
        model.send(.syncCompleted)
        model.arm()
        recorder.effects.removeAll()

        model.consentRevoked()

        #expect(recorder.effects == [.closeSocket])
        #expect(model.phase == .idle)
        #expect(model.eqWriter == nil)
    }

    // MARK: - Info.plist

    @Test func infoPlistDeclaresNSLocalNetworkUsageDescriptionWithTheConsentCopy() throws {
        let plistURL = TestPaths.iosRoot.appending(path: "SoundBuddy/Info.plist")
        let data = try Data(contentsOf: plistURL)
        let plist = try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]

        #expect(plist?["NSLocalNetworkUsageDescription"] as? String == ConsoleConsentCopy.localNetworkUsageDescription)
    }

    // MARK: - Copy

    @Test func consentCopyNamesReadsAndEQOnlyWrites() {
        #expect(ConsoleConsentCopy.reads.contains("names"))
        #expect(ConsoleConsentCopy.reads.contains("EQ"))
        #expect(ConsoleConsentCopy.reads.contains("levels"))
        #expect(ConsoleConsentCopy.writes.contains("EQ"))
        #expect(ConsoleConsentCopy.writes.contains("Arm"))
        #expect(ConsoleConsentCopy.localNetworkUsageDescription.contains("EQ"))
        #expect(ConsoleConsentCopy.localNetworkUsageDescription.contains("arm"))
    }
}
