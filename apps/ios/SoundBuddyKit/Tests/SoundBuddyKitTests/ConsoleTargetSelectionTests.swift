import Foundation
import Testing
@testable import SoundBuddyKit

private let captureConfigLines = [
    "/ch/01/config \"\" 1 MG 1",
    "/ch/02/config \"Vox 1\" 1 MG 2",
    "/ch/03/config \"Vox 2\" 1 MG 3",
    "/main/st/config \"\" 66 WH",
]

private let mainLREqLines = [
    "/main/st/eq ON",
    "/main/st/eq/1 LShv 80 +0.00 0.7",
    "/main/st/eq/2 PEQ 250 +0.00 1.4",
    "/main/st/eq/3 PEQ 1000 +0.00 2.0",
    "/main/st/eq/4 PEQ 2500 +0.00 1.0",
    "/main/st/eq/5 PEQ 8000 +0.00 3.0",
    "/main/st/eq/6 HShv 12000 +0.00 0.7",
]

private func freshDefaults() -> UserDefaults {
    // One suite per test, so stored picks never leak across tests.
    UserDefaults(suiteName: UUID().uuidString)!
}

@Suite struct ConsoleTargetSelectionTests {
    @Test func storageTokenRoundTrips() {
        #expect(ConsoleTargetMemory.target(storageToken: ConsoleTargetMemory.storageToken(for: .mainLR)) == .mainLR)
        for index in 1...ConsoleTargetCatalog.channelCount {
            let target = ConsoleEQTarget.channel(index)
            #expect(ConsoleTargetMemory.target(storageToken: ConsoleTargetMemory.storageToken(for: target)) == target)
        }
    }

    @Test func invalidStoredTokenFallsBackToMainLR() {
        let defaults = freshDefaults()
        let console = ConsoleIdentity(name: "FOH", model: "M32R")

        #expect(ConsoleTargetMemory.load(for: console, in: defaults) == .mainLR)

        defaults.set("garbage", forKey: ConsoleTargetMemory.key(for: console))
        #expect(ConsoleTargetMemory.load(for: console, in: defaults) == .mainLR)

        defaults.set("ch0", forKey: ConsoleTargetMemory.key(for: console))
        #expect(ConsoleTargetMemory.load(for: console, in: defaults) == .mainLR)

        defaults.set("ch33", forKey: ConsoleTargetMemory.key(for: console))
        #expect(ConsoleTargetMemory.load(for: console, in: defaults) == .mainLR)
    }

    @Test func mainLRFirstAndSelectedThen32DeskTiles() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        for line in captureConfigLines {
            model.ingest(nodeLine: line)
        }

        #expect(model.selected == .mainLR)
        #expect(model.catalog.labels.count == 33)
        #expect(model.catalog.labels[0].target == .mainLR)
        for index in 1...32 {
            #expect(model.catalog.labels[index].target == .channel(index))
        }
        #expect(model.catalog.label(for: .channel(2)).displayName == "Vox 1")
        #expect(model.catalog.label(for: .channel(2)).color == .magenta)
    }

    @Test func resyncAfterDeskRenameShowsNewName() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        model.ingest(nodeLine: "/ch/02/config \"Vox 1\" 1 MG 2")
        #expect(model.catalog.label(for: .channel(2)).displayName == "Vox 1")

        model.ingest(nodeLine: "/ch/02/config \"Pastor\" 1 GN 2")
        let label = model.catalog.label(for: .channel(2))
        #expect(label.displayName == "Pastor")
        #expect(label.color == .green)
    }

    @Test func rememberedTargetPerConsole() {
        let defaults = freshDefaults()
        let consoleA = ConsoleIdentity(name: "FOH", model: "M32R")
        let consoleB = ConsoleIdentity(name: "Monitors", model: "X32")

        let modelA = ConsoleTargetModel(defaults: defaults)
        modelA.consoleChanged(consoleA)
        modelA.select(.channel(5))

        let reloadedA = ConsoleTargetModel(defaults: defaults)
        reloadedA.consoleChanged(consoleA)
        #expect(reloadedA.selected == .channel(5))

        let modelB = ConsoleTargetModel(defaults: defaults)
        modelB.consoleChanged(consoleB)
        #expect(modelB.selected == .mainLR)
    }

    @Test func sameConsoleReconnectKeepsNames() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        let console = ConsoleIdentity(name: "FOH", model: "M32R")
        model.consoleChanged(console)
        model.ingest(nodeLine: "/ch/02/config \"Vox 1\" 1 MG 2")

        // Reconnecting to the same console (identity unchanged) must not
        // blank the catalog the next resync is about to refresh.
        model.consoleChanged(console)
        #expect(model.catalog.label(for: .channel(2)).displayName == "Vox 1")
    }

    @Test func differentConsoleResetsCatalog() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        model.ingest(nodeLine: "/ch/02/config \"Vox 1\" 1 MG 2")

        model.consoleChanged(ConsoleIdentity(name: "Monitors", model: "X32"))
        #expect(model.catalog.label(for: .channel(2)).displayName == "Ch 2")
    }

    @Test func selectWithoutConsoleDoesNotPersist() {
        let defaults = freshDefaults()
        let model = ConsoleTargetModel(defaults: defaults)
        model.select(.channel(7))
        #expect(model.selected == .channel(7))

        let console = ConsoleIdentity(name: "FOH", model: "M32R")
        #expect(ConsoleTargetMemory.load(for: console, in: defaults) == .mainLR)
    }

    @Test func selectIgnoresOutOfRangeTarget() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        model.select(.channel(33))
        #expect(model.selected == .mainLR)
    }

    @Test func chipTitleUsesModelAndDisplayName() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        #expect(model.chipTitle == nil)

        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        #expect(model.chipTitle == "M32R · Main LR")

        model.ingest(nodeLine: "/ch/02/config \"Vox 1\" 1 MG 2")
        model.select(.channel(2))
        #expect(model.chipTitle == "M32R · Vox 1")
    }

    @Test func band2GainPushUpdatesReadoutAndCurveImmediately() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        for line in mainLREqLines { model.ingest(nodeLine: line) }

        let before = model.eqPanel.curveDb
        model.ingest(push: OSCMessage("/main/st/eq/2/g", [.float(0.6)]))

        #expect(model.eqPanel.bandRows[1].gainText == "+3.0 dB")
        #expect(model.eqPanel.curveDb != before)
    }

    @Test func reconnectingKeepsLastValuesDimmedThenResyncRefreshes() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        for line in mainLREqLines { model.ingest(nodeLine: line) }
        model.phase = .live

        let liveRows = model.eqPanel.bandRows
        model.phase = .reconnecting
        #expect(model.eqPanel.bandRows == liveRows)
        #expect(model.eqPanel.isDimmed == true)
        #expect(model.eqPanel.statusPill == "Reconnecting…")

        model.ingest(nodeLine: "/main/st/eq/2 PEQ 250 +6.00 1.4")
        model.phase = .live
        #expect(model.eqPanel.bandRows[1].gainText == "+6.0 dB")
        #expect(model.eqPanel.isDimmed == false)
        #expect(model.eqPanel.statusPill == nil)
    }

    @Test func selectingAnotherTargetClearsEq() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        for line in mainLREqLines { model.ingest(nodeLine: line) }
        #expect(model.eq != nil)

        model.select(.channel(3))
        #expect(model.eq == nil)
    }

    @Test func differentConsoleClearsEqSameConsoleKeepsIt() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        let console = ConsoleIdentity(name: "FOH", model: "M32R")
        model.consoleChanged(console)
        for line in mainLREqLines { model.ingest(nodeLine: line) }
        #expect(model.eq != nil)

        model.consoleChanged(console)
        #expect(model.eq != nil)

        model.consoleChanged(ConsoleIdentity(name: "Monitors", model: "X32"))
        #expect(model.eq == nil)
    }

    @Test func pushForNonSelectedTargetIsIgnored() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        for line in mainLREqLines { model.ingest(nodeLine: line) }

        model.ingest(push: OSCMessage("/ch/02/eq/1/g", [.float(0.9)]))
        #expect(model.eqPanel.bandRows[0].gainText == "0.0 dB")
    }

    @Test func followDeskSelectDefaultsOff() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        #expect(model.followDeskSelect == false)
        #expect(model.deskSelectHint == nil)
    }

    @Test func followOnDeskSelectChannel7SwitchesPanelToChannel7() {
        let defaults = freshDefaults()
        let model = ConsoleTargetModel(defaults: defaults)
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        model.setFollowDeskSelect(true)

        model.ingest(push: OSCMessage("/-stat/selidx", [.int(6)]))

        #expect(model.selected == .channel(7))
        #expect(model.eqPanel.target == .channel(7))
        #expect(ConsoleTargetMemory.load(for: ConsoleIdentity(name: "FOH", model: "M32R"), in: defaults) == .channel(7))
    }

    @Test func followOnDeskSelectMainLRSelectsMainLR() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        model.select(.channel(2))
        model.setFollowDeskSelect(true)

        model.ingest(push: OSCMessage("/-stat/selidx", [.int(70)]))

        #expect(model.selected == .mainLR)
    }

    @Test func followOnDeskSelectBusKeepsTargetAndShowsNotSupportedHint() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        model.select(.channel(2))
        for line in ["/ch/02/eq ON", "/ch/02/eq/1 PEQ 250 +0.00 1.4", "/ch/02/eq/2 PEQ 1000 +0.00 2.0", "/ch/02/eq/3 PEQ 2500 +0.00 1.0", "/ch/02/eq/4 PEQ 8000 +0.00 3.0"] {
            model.ingest(nodeLine: line)
        }
        let eqBefore = model.eq
        model.setFollowDeskSelect(true)

        model.ingest(push: OSCMessage("/-stat/selidx", [.int(48)]))

        #expect(model.selected == .channel(2))
        #expect(model.eq == eqBefore)
        #expect(model.deskSelectHint == "Not supported yet")

        model.ingest(push: OSCMessage("/-stat/selidx", [.int(3)]))
        #expect(model.selected == .channel(4))
        #expect(model.deskSelectHint == nil)
    }

    @Test func followOffDeskSelectChangesNothing() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        model.select(.channel(2))
        for line in ["/ch/02/eq ON", "/ch/02/eq/1 PEQ 250 +0.00 1.4", "/ch/02/eq/2 PEQ 1000 +0.00 2.0", "/ch/02/eq/3 PEQ 2500 +0.00 1.0", "/ch/02/eq/4 PEQ 8000 +0.00 3.0"] {
            model.ingest(nodeLine: line)
        }
        let eqBefore = model.eq

        model.ingest(push: OSCMessage("/-stat/selidx", [.int(6)]))
        model.ingest(push: OSCMessage("/-stat/selidx", [.int(48)]))

        #expect(model.selected == .channel(2))
        #expect(model.eq == eqBefore)
        #expect(model.deskSelectHint == nil)
    }

    @Test func turningFollowOffClearsHint() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        model.setFollowDeskSelect(true)
        model.ingest(push: OSCMessage("/-stat/selidx", [.int(48)]))
        #expect(model.deskSelectHint == "Not supported yet")

        model.setFollowDeskSelect(false)
        #expect(model.deskSelectHint == nil)
    }

    @Test func manualSelectClearsHint() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        model.setFollowDeskSelect(true)
        model.ingest(push: OSCMessage("/-stat/selidx", [.int(48)]))
        #expect(model.deskSelectHint == "Not supported yet")

        model.select(.channel(5))
        #expect(model.deskSelectHint == nil)
    }

    @Test func consoleChangeClearsHint() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        model.setFollowDeskSelect(true)
        model.ingest(push: OSCMessage("/-stat/selidx", [.int(48)]))
        #expect(model.deskSelectHint == "Not supported yet")

        model.consoleChanged(ConsoleIdentity(name: "Monitors", model: "X32"))
        #expect(model.deskSelectHint == nil)
    }

    @Test func eqPushesStillFoldWithFollowOn() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        for line in mainLREqLines { model.ingest(nodeLine: line) }
        model.setFollowDeskSelect(true)

        model.ingest(push: OSCMessage("/main/st/eq/2/g", [.float(0.6)]))

        #expect(model.eqPanel.bandRows[1].gainText == "+3.0 dB")
    }

    private static func lowMidEvent(deviationDb: Double = 6) -> CoachingEvent {
        CoachingEvent(
            id: "lowMid", ruleType: .bandDeviation, severity: .suggestion, band: .lowMid,
            message: "test", data: ["deviationDb": .number(deviationDb)], source: .phoneMicEstimate, sessionTime: 0
        )
    }

    @Test func showCoachingSelectsMainLRAndPanelCarriesClampedGhostCut() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        model.select(.channel(2))

        model.showCoaching(Self.lowMidEvent())
        #expect(model.selected == .mainLR)

        for line in mainLREqLines { model.ingest(nodeLine: line) }

        let coaching = model.eqPanel.coaching
        #expect(coaching != nil)
        #expect((coaching?.band.gainDb ?? 0) >= -3.01)
        #expect((coaching?.band.gainDb ?? 0) < 0)
    }

    @Test func coachingSuggestionNilUntilMainLREqRead() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        model.select(.channel(2))
        model.showCoaching(Self.lowMidEvent())

        #expect(model.selected == .mainLR)
        #expect(model.eq == nil)
        #expect(model.eqPanel.coaching == nil)

        for line in mainLREqLines { model.ingest(nodeLine: line) }
        #expect(model.eqPanel.coaching != nil)
    }

    @Test func selectingAnotherTargetClearsCoaching() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        for line in mainLREqLines { model.ingest(nodeLine: line) }
        model.showCoaching(Self.lowMidEvent())
        #expect(model.coachingEvent != nil)

        model.select(.channel(3))
        #expect(model.coachingEvent == nil)
    }

    @Test func clearCoachingRemovesGhost() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        for line in mainLREqLines { model.ingest(nodeLine: line) }
        model.showCoaching(Self.lowMidEvent())
        #expect(model.eqPanel.coaching != nil)

        model.clearCoaching()
        #expect(model.coachingEvent == nil)
        #expect(model.eqPanel.coaching == nil)
    }

    @Test func consoleChangeClearsCoaching() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        for line in mainLREqLines { model.ingest(nodeLine: line) }
        model.showCoaching(Self.lowMidEvent())
        #expect(model.coachingEvent != nil)

        model.consoleChanged(ConsoleIdentity(name: "Monitors", model: "X32"))
        #expect(model.coachingEvent == nil)
    }

    // MARK: - Apply coaching (#1676)

    /// A fake clock plus a datagram-capturing, decoding recorder, copied from
    /// `ConsoleEQWriterTests` (its own is file-private there).
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

    /// Drives a `ConsoleSessionModel` to `.live` and arms it, copied from
    /// `ConsoleEQWriterTests` (its own is file-private there).
    private func armedWriter(_ recorder: EQRecorder) -> (ConsoleSessionModel, ConsoleEQWriter) {
        let identity = ConsoleIdentity(name: "FOH", model: "M32R")
        let model = ConsoleSessionModel(now: { recorder.clock }, isConsentGranted: { true }, perform: recorder.perform, sendDatagram: recorder.sendDatagram)
        model.send(.connect(identity))
        model.send(.identityReceived(identity))
        model.send(.syncCompleted)
        guard let writer = model.arm() else {
            fatalError("expected arm() to return a writer once live")
        }
        return (model, writer)
    }

    private static func applyEvent(deviationDb: Double = 3, band: Band = .lowMid) -> CoachingEvent {
        CoachingEvent(
            id: "apply", ruleType: .bandDeviation, severity: .suggestion, band: band,
            message: "test", data: ["deviationDb": .number(deviationDb)], source: .phoneMicEstimate, sessionTime: 0
        )
    }

    /// `sqrt(lowHz*highHz)` quantized to the console's own frequency grid —
    /// the same round trip `ConsoleCoachingMapper.suggestion` uses.
    private func quantizedCentreHz(_ band: Band) -> Double {
        let centre = (band.lowHz * band.highHz).squareRoot()
        return ConsoleEQScale.freqHz(raw: ConsoleEQScale.rawFreq(hz: centre))
    }

    /// Seeds a fresh `ConsoleTargetModel` on Main LR, live, with a showing
    /// `.lowMid` ghost on band 2 (250 Hz, free) — well inside one octave of
    /// band 2's 250 Hz, so Apply never hits the frequency limit here.
    private func modelReadyToApply() -> ConsoleTargetModel {
        let target = ConsoleTargetModel(defaults: freshDefaults())
        target.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        for line in mainLREqLines { target.ingest(nodeLine: line) }
        target.phase = .live
        target.showCoaching(Self.applyEvent())
        return target
    }

    @Test func applyCoachingWritesGhostBandToMainLRAndConfirms() throws {
        let recorder = EQRecorder()
        let (model, writer) = armedWriter(recorder)
        _ = model
        let target = modelReadyToApply()

        try target.applyCoaching(using: writer)

        #expect(recorder.datagrams.count == 1)
        let message = recorder.datagrams[0].message
        #expect(message.address == "/main/st/eq/2")
        guard case let .float(gainRaw) = message.arguments[2] else {
            Issue.record("expected a float gain argument")
            return
        }
        #expect(abs(Double(gainRaw) - ConsoleEQScale.rawGain(db: -3)) < 1e-5)

        let expectedFreqText = ConsoleEQPanelState.freqText(quantizedCentreHz(.lowMid))
        #expect(target.appliedCoaching?.bandIndex == 1)
        #expect(target.appliedCoaching?.confirmation == "Applied \u{2212}3 dB at \(expectedFreqText) on Main LR")
        #expect(abs((target.eq?.bands[1].gainDb ?? 0) - (-3)) < 1e-5)
        #expect(target.coachingEvent == nil)
    }

    @Test func applyCoachingRecordsMainLRSnapshotFirst() throws {
        let recorder = EQRecorder()
        let (model, writer) = armedWriter(recorder)
        _ = model
        let target = modelReadyToApply()

        #expect(writer.needsSnapshot(for: .mainLR) == true)
        try target.applyCoaching(using: writer)
        #expect(writer.needsSnapshot(for: .mainLR) == false)
    }

    @Test func applyCoachingWhileDisarmedSendsNothing() throws {
        let target = modelReadyToApply()
        let eqBefore = target.eq
        let coachingBefore = target.coachingEvent

        do {
            try target.applyCoaching(using: nil)
            Issue.record("expected .disarmed")
        } catch {
            #expect(error == .disarmed)
        }
        #expect(target.eq == eqBefore)
        #expect(target.coachingEvent == coachingBefore)
        #expect(target.appliedCoaching == nil)

        let recorder = EQRecorder()
        let (model, writer) = armedWriter(recorder)
        model.disarm()

        do {
            try target.applyCoaching(using: writer)
            Issue.record("expected .disarmed")
        } catch {
            #expect(error == .disarmed)
        }
        #expect(recorder.datagrams.isEmpty)
        #expect(target.eq == eqBefore)
        #expect(target.coachingEvent == coachingBefore)
        #expect(target.appliedCoaching == nil)
    }

    @Test func applyCoachingWithoutSuggestionIsNoOp() throws {
        let recorder = EQRecorder()
        let (model, writer) = armedWriter(recorder)
        _ = model
        let target = ConsoleTargetModel(defaults: freshDefaults())
        target.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        for line in mainLREqLines { target.ingest(nodeLine: line) }
        target.phase = .live

        // No coaching event showing at all.
        try target.applyCoaching(using: writer)
        #expect(recorder.datagrams.isEmpty)
        #expect(target.appliedCoaching == nil)

        // A coaching event is showing, but a channel is selected.
        target.showCoaching(Self.applyEvent())
        target.select(.channel(2))
        try target.applyCoaching(using: writer)
        #expect(recorder.datagrams.isEmpty)
        #expect(target.appliedCoaching == nil)
    }

    @Test func applyCoachingLimitsRetuneToOneOctave() throws {
        let recorder = EQRecorder()
        let (model, writer) = armedWriter(recorder)
        _ = model
        let target = ConsoleTargetModel(defaults: freshDefaults())
        target.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        for line in mainLREqLines { target.ingest(nodeLine: line) }
        target.phase = .live
        // subBass's centre (~35 Hz) is more than an octave below band 2's
        // 250 Hz, so the write lands at band 2's prior freq / 2 instead.
        target.showCoaching(Self.applyEvent(band: .subBass))

        try target.applyCoaching(using: writer)

        let message = recorder.datagrams[0].message
        #expect(message.address == "/main/st/eq/2")
        guard case let .float(freqRaw) = message.arguments[1] else {
            Issue.record("expected a float freq argument")
            return
        }
        let writtenHz = ConsoleEQScale.freqHz(raw: Double(freqRaw))
        #expect(abs(writtenHz - 125) / 125 < 0.02)
        #expect(target.appliedCoaching?.confirmation.contains(ConsoleEQPanelState.freqText(writtenHz)) == true)
    }

    @Test func undoAppliedCoachingRestoresPriorBand() throws {
        let recorder = EQRecorder()
        let (model, writer) = armedWriter(recorder)
        _ = model
        let target = modelReadyToApply()
        try target.applyCoaching(using: writer)
        let prior = try #require(target.appliedCoaching?.prior)

        recorder.clock += 1
        try target.undoAppliedCoaching(using: writer)
        while writer.hasPendingWrites {
            recorder.clock += 1
            writer.tick()
        }

        let lastMessage = try #require(recorder.datagrams.last?.message)
        #expect(lastMessage.address == "/main/st/eq/2")
        guard case let .float(gainRaw) = lastMessage.arguments[2] else {
            Issue.record("expected a float gain argument")
            return
        }
        #expect(abs(Double(gainRaw) - ConsoleEQScale.rawGain(db: prior.gainDb)) < 1e-5)
        #expect(target.eq?.bands[1] == prior)
        #expect(target.appliedCoaching == nil)
    }

    @Test func undoWhileDisarmedKeepsApplied() throws {
        let recorder = EQRecorder()
        let (model, writer) = armedWriter(recorder)
        let target = modelReadyToApply()
        try target.applyCoaching(using: writer)
        let appliedBefore = target.appliedCoaching

        model.disarm()
        do {
            try target.undoAppliedCoaching(using: writer)
            Issue.record("expected .disarmed")
        } catch {
            #expect(error == .disarmed)
        }
        #expect(target.appliedCoaching == appliedBefore)

        do {
            try target.undoAppliedCoaching(using: nil)
            Issue.record("expected .disarmed")
        } catch {
            #expect(error == .disarmed)
        }
        #expect(target.appliedCoaching == appliedBefore)
    }

    @Test func undoWithNothingAppliedIsNoOp() throws {
        let target = modelReadyToApply()
        #expect(target.appliedCoaching == nil)

        try target.undoAppliedCoaching(using: nil)
        #expect(target.appliedCoaching == nil)
    }

    @Test func consoleIdentityChangeClearsAppliedCoaching() throws {
        let recorder = EQRecorder()
        let (model, writer) = armedWriter(recorder)
        _ = model
        let target = modelReadyToApply()
        try target.applyCoaching(using: writer)
        #expect(target.appliedCoaching != nil)

        target.select(.channel(1))
        #expect(target.appliedCoaching != nil)

        target.consoleChanged(ConsoleIdentity(name: "Monitors", model: "X32"))
        #expect(target.appliedCoaching == nil)
    }
}
