import Foundation
import Testing
@testable import SoundBuddyKit

private let foh = ConsoleIdentity(name: "FOH", model: "M32R")

/// A fake clock plus a datagram-capturing, decoding recorder. `sendDatagram`
/// decodes immediately (the writer always hands it allowlisted, well-formed
/// bytes), so tests assert on the `OSCMessage` rather than raw bytes.
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

/// Drives a `ConsoleSessionModel` to `.live` and arms it, per the spec's
/// helper: `connect -> identityReceived -> syncCompleted`, then `arm()`.
private func armedWriter(_ recorder: EQRecorder) -> (ConsoleSessionModel, ConsoleEQWriter) {
    let model = ConsoleSessionModel(now: { recorder.clock }, perform: recorder.perform, sendDatagram: recorder.sendDatagram)
    model.send(.connect(foh))
    model.send(.identityReceived(foh))
    model.send(.syncCompleted)
    guard let writer = model.arm() else {
        fatalError("expected arm() to return a writer once live")
    }
    return (model, writer)
}

@Suite struct ConsoleEQWriterTests {
    @Test func nonEQAddressThrowsAndSendsNothing() {
        let recorder = EQRecorder()
        let (model, writer) = armedWriter(recorder)
        _ = model

        do {
            try writer.enqueue(OSCMessage("/ch/01/mix/fader", [.float(0.5)]))
            Issue.record("expected .notAllowlisted")
        } catch {
            #expect(error == .notAllowlisted("/ch/01/mix/fader"))
        }

        do {
            try writer.enqueue(OSCMessage("/-action/undopt", [.int(1)]))
            Issue.record("expected .notAllowlisted")
        } catch {
            #expect(error == .notAllowlisted("/-action/undopt"))
        }

        recorder.clock += 1
        writer.tick()

        #expect(recorder.datagrams.isEmpty)
        #expect(writer.hasPendingWrites == false)
    }

    @Test func gainDragIsLimitedToThreeDbFromGestureStart() throws {
        let recorder = EQRecorder()
        let (model, writer) = armedWriter(recorder)
        _ = model
        writer.recordSnapshot(ConsoleEQ.flat(for: .channel(1)))

        try writer.submit(.gain(band: 1, db: -9, gestureStartDb: -2), on: .channel(1))

        #expect(recorder.datagrams.count == 1)
        let message = recorder.datagrams[0].message
        #expect(message.address == "/ch/01/eq/1/g")
        guard case let .float(raw) = message.arguments.first else {
            Issue.record("expected a float argument")
            return
        }
        let db = ConsoleEQScale.gainDb(raw: Double(raw))
        #expect(abs(db - (-5)) < 1e-5)
    }

    @Test func gainIsClampedToConsoleRange() throws {
        let recorder = EQRecorder()
        let (model, writer) = armedWriter(recorder)
        _ = model
        writer.recordSnapshot(ConsoleEQ.flat(for: .channel(1)))

        try writer.submit(.gain(band: 1, db: 20, gestureStartDb: 14), on: .channel(1))

        guard case let .float(raw) = recorder.datagrams[0].message.arguments.first else {
            Issue.record("expected a float argument")
            return
        }
        let db = ConsoleEQScale.gainDb(raw: Double(raw))
        #expect(abs(db - 15) < 1e-5)
    }

    @Test func freqDragIsLimitedToOneOctave() throws {
        let recorder = EQRecorder()
        let (model, writer) = armedWriter(recorder)
        _ = model
        writer.recordSnapshot(ConsoleEQ.flat(for: .channel(1)))

        try writer.submit(.freq(band: 1, hz: 5000, gestureStartHz: 1000), on: .channel(1))
        guard case let .float(upRaw) = recorder.datagrams[0].message.arguments.first else {
            Issue.record("expected a float argument")
            return
        }
        let upHz = ConsoleEQScale.freqHz(raw: Double(upRaw))
        #expect(abs(upHz - 2000) / 2000 < 0.02)

        recorder.clock += 1
        try writer.submit(.freq(band: 1, hz: 200, gestureStartHz: 1000), on: .channel(1))
        guard case let .float(downRaw) = recorder.datagrams[1].message.arguments.first else {
            Issue.record("expected a float argument")
            return
        }
        let downHz = ConsoleEQScale.freqHz(raw: Double(downRaw))
        #expect(abs(downHz - 500) / 500 < 0.02)
    }

    @Test func bandEditLimitsGainAndFreqAgainstGestureStart() throws {
        let recorder = EQRecorder()
        let (model, writer) = armedWriter(recorder)
        _ = model
        writer.recordSnapshot(ConsoleEQ.flat(for: .mainLR))

        let gestureStart = ConsoleEQBand(type: .peaking, freqHz: 1000, gainDb: 0, q: 2)
        let requested = ConsoleEQBand(type: .lowShelf, freqHz: 5000, gainDb: 12, q: 3)
        try writer.submit(.band(2, requested, gestureStart: gestureStart), on: .mainLR)

        let message = recorder.datagrams[0].message
        #expect(message.address == "/main/st/eq/2")
        guard case let .int(typeRaw) = message.arguments[0],
              case let .float(freqRaw) = message.arguments[1],
              case let .float(gainRaw) = message.arguments[2],
              case let .float(qRaw) = message.arguments[3]
        else {
            Issue.record("expected ,ifff arguments")
            return
        }
        #expect(ConsoleEQBandType(rawValue: Int(typeRaw)) == .lowShelf)
        #expect(abs(ConsoleEQScale.freqHz(raw: Double(freqRaw)) - 2000) / 2000 < 0.02)
        #expect(abs(ConsoleEQScale.gainDb(raw: Double(gainRaw)) - 3) < 1e-5)
        #expect(abs(ConsoleEQScale.q(raw: Double(qRaw)) - 3) / 3 < 0.05)
    }

    @Test func qAndTypeAndEqOnEncodeQuantizedValues() throws {
        let recorder = EQRecorder()
        let (model, writer) = armedWriter(recorder)
        _ = model
        writer.recordSnapshot(ConsoleEQ.flat(for: .channel(3)))

        try writer.submit(.q(band: 2, q: 4), on: .channel(3))
        #expect(recorder.datagrams[0].message.address == "/ch/03/eq/2/q")
        guard case let .float(qRaw) = recorder.datagrams[0].message.arguments.first else {
            Issue.record("expected a float argument")
            return
        }
        #expect(abs(ConsoleEQScale.q(raw: Double(qRaw)) - 4) / 4 < 0.05)

        recorder.clock += 1
        try writer.submit(.type(band: 2, .highCut), on: .channel(3))
        #expect(recorder.datagrams[1].message.address == "/ch/03/eq/2/type")
        guard case let .int(typeRaw) = recorder.datagrams[1].message.arguments.first else {
            Issue.record("expected an int argument")
            return
        }
        #expect(ConsoleEQBandType(rawValue: Int(typeRaw)) == .highCut)

        recorder.clock += 1
        try writer.submit(.eqOn(true), on: .channel(3))
        #expect(recorder.datagrams[2].message.address == "/ch/03/eq/on")
        #expect(recorder.datagrams[2].message.arguments == [.int(1)])
    }

    @Test func rapidUpdatesCoalesceToTwentyPerSecondLastValueWins() throws {
        let recorder = EQRecorder()
        let (model, writer) = armedWriter(recorder)
        _ = model
        writer.recordSnapshot(ConsoleEQ.flat(for: .mainLR))

        for i in 0..<200 {
            recorder.clock = Double(i) * 0.005
            try writer.submit(.gain(band: 1, db: Double(i + 1) * 0.0125, gestureStartDb: 0), on: .mainLR)
        }

        recorder.clock = 1.05
        writer.tick()

        let withinFirstSecond = recorder.datagrams.filter { $0.sentAt < 1.0 }
        #expect(withinFirstSecond.count <= 20)
        #expect(recorder.datagrams.count <= 21)

        guard case let .float(lastRaw) = recorder.datagrams.last?.message.arguments.first else {
            Issue.record("expected a float argument")
            return
        }
        let expected = ConsoleEQScale.gainDb(raw: ConsoleEQScale.rawGain(db: 2.5))
        #expect(abs(ConsoleEQScale.gainDb(raw: Double(lastRaw)) - expected) < 1e-5)
        #expect(writer.hasPendingWrites == false)
    }

    @Test func pendingNeverExceedsDistinctAddresses() throws {
        let recorder = EQRecorder()
        let (model, writer) = armedWriter(recorder)
        _ = model
        writer.recordSnapshot(ConsoleEQ.flat(for: .channel(1)))

        // Prime `lastSentAt` so the rapid loop below lands inside one gate
        // window and never sends on its own.
        try writer.submit(.q(band: 2, q: 2.0), on: .channel(1))
        #expect(recorder.datagrams.count == 1)

        for i in 0..<50 {
            try writer.submit(.gain(band: 1, db: Double(i % 3), gestureStartDb: 0), on: .channel(1))
            try writer.submit(.freq(band: 1, hz: 1000 + Double(i), gestureStartHz: 1000), on: .channel(1))
        }
        #expect(recorder.datagrams.count == 1)
        #expect(writer.hasPendingWrites)

        recorder.clock += 1
        writer.tick()
        recorder.clock += 1
        writer.tick()

        #expect(recorder.datagrams.count == 3)
        #expect(writer.hasPendingWrites == false)
        #expect(Set(recorder.datagrams.map(\.message.address)) == [
            "/ch/01/eq/2/q", "/ch/01/eq/1/g", "/ch/01/eq/1/f",
        ])
    }

    @Test func writeBeforeSnapshotThrowsSnapshotMissing() {
        let recorder = EQRecorder()
        let (model, writer) = armedWriter(recorder)
        _ = model

        do {
            try writer.submit(.eqOn(true), on: .channel(5))
            Issue.record("expected .snapshotMissing")
        } catch {
            #expect(error == .snapshotMissing(.channel(5)))
        }
        #expect(recorder.datagrams.isEmpty)
    }

    @Test func firstSnapshotWins() throws {
        let recorder = EQRecorder()
        let (model, writer) = armedWriter(recorder)
        _ = model
        let first = ConsoleEQ.flat(for: .mainLR)
        var second = first
        second.bands[0] = ConsoleEQBand(type: .lowCut, freqHz: 200, gainDb: -6, q: 5)

        writer.recordSnapshot(first)
        #expect(writer.needsSnapshot(for: .mainLR) == false)
        writer.recordSnapshot(second)

        try writer.revertAll()
        while writer.hasPendingWrites {
            recorder.clock += 1
            writer.tick()
        }

        guard let band1 = recorder.datagrams.first(where: { $0.message.address == "/main/st/eq/1" })?.message,
              case let .int(typeRaw) = band1.arguments.first
        else {
            Issue.record("expected a /main/st/eq/1 datagram")
            return
        }
        #expect(ConsoleEQBandType(rawValue: Int(typeRaw)) == first.bands[0].type)
    }

    @Test func bandOutOfRangeThrows() {
        let recorder = EQRecorder()
        let (model, writer) = armedWriter(recorder)
        _ = model
        writer.recordSnapshot(ConsoleEQ.flat(for: .channel(1)))

        do {
            try writer.submit(.gain(band: 0, db: 0, gestureStartDb: 0), on: .channel(1))
            Issue.record("expected .bandOutOfRange")
        } catch {
            #expect(error == .bandOutOfRange(.channel(1), 0))
        }

        do {
            try writer.submit(.gain(band: 5, db: 0, gestureStartDb: 0), on: .channel(1))
            Issue.record("expected .bandOutOfRange")
        } catch {
            #expect(error == .bandOutOfRange(.channel(1), 5))
        }
        #expect(recorder.datagrams.isEmpty)
    }

    @Test func revertAllRestoresMainLRBand3Exactly() throws {
        let recorder = EQRecorder()
        let (model, writer) = armedWriter(recorder)
        _ = model

        var snapshot = ConsoleEQ.flat(for: .mainLR)
        snapshot.bands[2] = ConsoleEQBand(type: .peaking, freqHz: 315, gainDb: -2.5, q: 1.4)
        writer.recordSnapshot(snapshot)

        try writer.submit(.gain(band: 3, db: 4, gestureStartDb: -2.5), on: .mainLR)
        recorder.clock += 1
        try writer.submit(.freq(band: 3, hz: 800, gestureStartHz: 315), on: .mainLR)
        while writer.hasPendingWrites {
            recorder.clock += 1
            writer.tick()
        }

        try writer.revertAll()
        while writer.hasPendingWrites {
            recorder.clock += 1
            writer.tick()
        }

        let band3Datagrams = recorder.datagrams.filter { $0.message.address == "/main/st/eq/3" }
        #expect(band3Datagrams.count == 1)
        let expected: [OSCArgument] = [
            .int(Int32(ConsoleEQBandType.peaking.rawValue)),
            .float(Float(ConsoleEQScale.rawFreq(hz: 315))),
            .float(Float(ConsoleEQScale.rawGain(db: -2.5))),
            .float(Float(ConsoleEQScale.rawQ(1.4))),
        ]
        #expect(band3Datagrams[0].message.arguments == expected)

        let sentAddresses = Set(recorder.datagrams.map(\.message.address))
        let allBandAddresses = Set((1...6).map { "/main/st/eq/\($0)" })
        #expect(allBandAddresses.isSubset(of: sentAddresses))
        #expect(sentAddresses.contains("/main/st/eq/on"))
        #expect(writer.hasPendingWrites == false)
    }

    @Test func disarmedWriterThrowsAndDropsPending() throws {
        let recorder = EQRecorder()
        let (model, writer) = armedWriter(recorder)
        writer.recordSnapshot(ConsoleEQ.flat(for: .channel(2)))

        try writer.submit(.gain(band: 1, db: 1, gestureStartDb: 0), on: .channel(2))
        try writer.submit(.gain(band: 1, db: 2, gestureStartDb: 0), on: .channel(2))

        model.disarm()

        do {
            try writer.submit(.gain(band: 1, db: 3, gestureStartDb: 0), on: .channel(2))
            Issue.record("expected .disarmed")
        } catch {
            #expect(error == .disarmed)
        }

        do {
            try writer.revertAll()
            Issue.record("expected .disarmed")
        } catch {
            #expect(error == .disarmed)
        }

        let countBeforeTick = recorder.datagrams.count
        recorder.clock += 1
        writer.tick()
        #expect(recorder.datagrams.count == countBeforeTick)
        #expect(writer.hasPendingWrites == false)
    }
}
