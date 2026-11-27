import Foundation
import Testing
@testable import SoundBuddyKit

private let tolerance = 1e-9
private let maxStepDb = 3.0

private let freeMainLR = ConsoleEQ.parse(nodeLines: [
    "/main/st/eq ON",
    "/main/st/eq/1 LShv 80 +0.00 0.7",
    "/main/st/eq/2 PEQ 250 +0.00 1.4",
    "/main/st/eq/3 PEQ 1000 +0.00 2.0",
    "/main/st/eq/4 PEQ 2500 +0.00 1.0",
    "/main/st/eq/5 PEQ 8000 +0.00 3.0",
    "/main/st/eq/6 HShv 12000 +0.00 0.7",
], for: .mainLR)

private let busyMainLR = ConsoleEQ.parse(nodeLines: [
    "/main/st/eq ON",
    "/main/st/eq/1 LShv 80 +0.00 0.7",
    "/main/st/eq/2 PEQ 250 +1.50 1.4",
    "/main/st/eq/3 PEQ 1000 -2.00 2.0",
    "/main/st/eq/4 PEQ 2500 +0.80 1.0",
    "/main/st/eq/5 PEQ 8000 -1.20 3.0",
    "/main/st/eq/6 HShv 12000 +0.00 0.7",
], for: .mainLR)

private func bandEvent(_ band: Band, deviation: Double) -> CoachingEvent {
    CoachingEvent(
        id: "band-deviation-\(band.rawValue)", ruleType: .bandDeviation, severity: .suggestion, band: band,
        message: "\(band.label) message", data: ["deviationDb": .number(deviation)], source: .phoneMicEstimate, sessionTime: 1
    )
}

private func armedWriter() -> ConsoleEQWriter {
    ConsoleEQWriter(now: { 0 }, isArmed: { true }, send: { _ in })
}

private let bass = bandEvent(.bass, deviation: 7)
private let lowMid = bandEvent(.lowMid, deviation: 4)
private let presence = bandEvent(.presence, deviation: -6.5)

private func model(
    events: [CoachingEvent] = [bass, lowMid, presence],
    selectedID: String? = nil,
    dismissedIDs: Set<String> = [],
    mainLR: ConsoleEQ? = nil,
    phase: ConsoleSessionPhase = .idle,
    writer: ConsoleEQWriter? = nil
) -> AgentModel {
    AgentModel(events: events, selectedID: selectedID, dismissedIDs: dismissedIDs, mainLR: mainLR, phase: phase, writer: writer)
}

@Suite("AgentModel selection")
struct AgentModelSelectionTests {
    @Test func noEventsSelectsNothing() {
        let agent = model(events: [])
        #expect(agent.selected == nil)
        #expect(agent.move == nil)
        #expect(agent.next == nil)
        #expect(agent.diagnosis == nil)
    }

    @Test func defaultsToTheFirstEvent() {
        let agent = model()
        #expect(agent.selected?.id == bass.id)
        #expect(agent.diagnosis == "Bass message")
    }

    @Test func keepsTheChosenEventWhileItIsPresent() {
        #expect(model(selectedID: presence.id).selected?.id == presence.id)
    }

    @Test func fallsBackToTheFirstUndismissedWhenTheChosenEventIsGone() {
        #expect(model(selectedID: "band-deviation-mid").selected?.id == bass.id)
        #expect(model(selectedID: "band-deviation-mid", dismissedIDs: [bass.id]).selected?.id == lowMid.id)
    }

    @Test func aDismissedChoiceIsNotSelected() {
        #expect(model(selectedID: bass.id, dismissedIDs: [bass.id]).selected?.id == lowMid.id)
    }

    @Test func everythingDismissedSelectsNothing() {
        let agent = model(dismissedIDs: [bass.id, lowMid.id, presence.id])
        #expect(agent.selected == nil)
        #expect(agent.next == nil)
    }

    @Test func nextIsTheFollowingUndismissedItemWrappingAround() {
        #expect(model().next?.id == lowMid.id)
        #expect(model(dismissedIDs: [lowMid.id]).next?.id == presence.id)
        #expect(model(selectedID: presence.id).next?.id == bass.id)
        #expect(model(selectedID: presence.id, dismissedIDs: [bass.id]).next?.id == lowMid.id)
    }

    @Test func nextIsNilWithASingleUndismissedItem() {
        #expect(model(events: [bass]).next == nil)
        #expect(model(dismissedIDs: [bass.id, lowMid.id]).next == nil)
    }
}

@Suite("AgentModel move")
struct AgentModelMoveTests {
    @Test func withoutConsoleEQTheBandIsUnavailableAndTheMapperSetsFreqQAndGain() throws {
        let move = try #require(model().move)
        let expected = try #require(ConsoleCoachingMapper.suggestion(for: bass, mainLR: ConsoleEQ.flat(for: .mainLR)))
        #expect(move.bandNumber == nil)
        #expect(move.bandText == AgentCopy.unavailableBand)
        #expect(abs(move.freqHz - expected.band.freqHz) < tolerance)
        #expect(abs(move.q - expected.band.q) < tolerance)
        #expect(abs(move.gainDb - expected.band.gainDb) < tolerance)
        #expect(move.retuneNote == nil)
        #expect(move.preview == nil)
        #expect(move.undoNote == nil)
    }

    @Test func withConsoleEQTheGainIsWhatTheWriterWillLand() throws {
        let move = try #require(model(mainLR: freeMainLR, phase: .live).move)
        let suggestion = try #require(ConsoleCoachingMapper.suggestion(for: bass, mainLR: freeMainLR))
        let written = ConsoleCoachingMapper.applied(suggestion, to: freeMainLR).written
        #expect(move.bandNumber == suggestion.bandNumber)
        #expect(move.bandText == "Band \(suggestion.bandNumber)")
        #expect(abs(move.gainDb - written.gainDb) < tolerance)
        #expect(abs(move.freqHz - written.freqHz) < tolerance)
        #expect(abs(move.q - written.q) < tolerance)
    }

    @Test func retuneShowsTheLimitedValueAndTheMapperNote() throws {
        let move = try #require(model(mainLR: busyMainLR, phase: .live).move)
        let suggestion = try #require(ConsoleCoachingMapper.suggestion(for: bass, mainLR: busyMainLR))
        let applied = ConsoleCoachingMapper.applied(suggestion, to: busyMainLR)
        #expect(suggestion.retunesBandInUse)
        #expect(move.retuneNote == suggestion.retuneNote)
        #expect(abs(move.gainDb - applied.written.gainDb) < tolerance)
        #expect(abs(move.gainDb - suggestion.band.gainDb) > tolerance)
        #expect(abs(move.gainDb - -1.5) < tolerance)
        #expect(abs(applied.prior.gainDb - move.gainDb) <= maxStepDb + tolerance)
    }

    @Test func previewDrawsTheWrittenBandNotTheUnlimitedGhost() throws {
        let move = try #require(model(mainLR: busyMainLR, phase: .live).move)
        let preview = try #require(move.preview)
        let suggestion = try #require(ConsoleCoachingMapper.suggestion(for: bass, mainLR: busyMainLR))
        let written = ConsoleCoachingMapper.applied(suggestion, to: busyMainLR).written
        #expect(preview.target == .mainLR)
        #expect(preview.eq == busyMainLR)
        #expect(preview.coaching?.band == written)
        #expect(preview.coaching?.bandIndex == suggestion.bandIndex)
    }

    @Test func undoNoteNamesTheBandAndThePriorValueUndoRestores() throws {
        let move = try #require(model(mainLR: busyMainLR, phase: .live).move)
        #expect(move.undoNote == "Undo puts Main LR Band 2 back to +1.5 dB at 250 Hz.")
    }

    @Test(
        "gain never exceeds the ±3 dB step for deviations from −20 to +20",
        arguments: [nil, freeMainLR, busyMainLR] as [ConsoleEQ?]
    )
    func gainNeverExceedsTheSafeStep(mainLR: ConsoleEQ?) {
        for tenth in -200...200 where tenth != 0 {
            for band in Band.allCases {
                let event = bandEvent(band, deviation: Double(tenth) / 10)
                let agent = model(events: [event], mainLR: mainLR, phase: .live)
                guard let move = agent.move else {
                    Issue.record("no move for \(band) at \(tenth)")
                    continue
                }
                #expect(abs(move.gainDb) <= maxStepDb + tolerance)
            }
        }
    }

    @Test func tileTextUsesMonospaceFriendlyFormats() throws {
        let move = try #require(model(mainLR: freeMainLR, phase: .live).move)
        #expect(move.gainText == "\u{2212}3.0 dB")
        #expect(move.qText == String(format: "%.1f", move.q))
        #expect(move.freqText.hasSuffix("Hz"))
    }
}

@Suite("AgentModel apply state")
struct AgentModelApplyStateTests {
    @Test func noConsoleEQIsNoConsoleLink() {
        #expect(model(phase: .live, writer: armedWriter()).applyState == .noConsoleLink)
    }

    @Test(
        "a console EQ with the link down is no console link",
        arguments: [ConsoleSessionPhase.idle, .connecting, .syncing, .reconnecting, .suspended, .noNetwork, .permissionDenied]
    )
    func linkDown(phase: ConsoleSessionPhase) {
        #expect(model(mainLR: freeMainLR, phase: phase, writer: armedWriter()).applyState == .noConsoleLink)
    }

    @Test(
        "link up without a writer is locked",
        arguments: [ConsoleSessionPhase.live, .liveDegraded]
    )
    func locked(phase: ConsoleSessionPhase) {
        #expect(model(mainLR: freeMainLR, phase: phase).applyState == .locked)
    }

    @Test(
        "link up with a writer is ready",
        arguments: [ConsoleSessionPhase.live, .liveDegraded]
    )
    func ready(phase: ConsoleSessionPhase) {
        #expect(model(mainLR: freeMainLR, phase: phase, writer: armedWriter()).applyState == .ready)
    }

    @Test func aChannelEQIsNotAMainLRLink() {
        let channel = ConsoleEQ.flat(for: .channel(2))
        let agent = model(mainLR: channel, phase: .live, writer: armedWriter())
        #expect(agent.applyState == .noConsoleLink)
        #expect(agent.move?.bandNumber == nil)
    }
}

@Suite("AgentSelection")
struct AgentSelectionTests {
    @Test func startsEmpty() {
        let selection = AgentSelection()
        #expect(selection.selectedID == nil)
        #expect(selection.dismissedIDs.isEmpty)
    }

    @Test func selectingUndismissesThatEvent() {
        var selection = AgentSelection()
        selection.dismiss(bass.id)
        selection.select(bass.id)
        #expect(selection.selectedID == bass.id)
        #expect(selection.dismissedIDs.isEmpty)
    }

    @Test func dismissingTheSelectedEventClearsTheChoice() {
        var selection = AgentSelection()
        selection.select(bass.id)
        selection.dismiss(bass.id)
        #expect(selection.selectedID == nil)
        #expect(selection.dismissedIDs == [bass.id])
    }

    @Test func dismissingAnotherEventKeepsTheChoice() {
        var selection = AgentSelection()
        selection.select(bass.id)
        selection.dismiss(lowMid.id)
        #expect(selection.selectedID == bass.id)
    }

    @Test func pruneForgetsDismissalsOfTipsThatCleared() {
        var selection = AgentSelection()
        selection.dismiss(bass.id)
        selection.dismiss(presence.id)
        selection.prune(keeping: [bass, lowMid])
        #expect(selection.dismissedIDs == [bass.id])
    }
}

@Suite("AgentCopy")
struct AgentCopyTests {
    @Test func applyTitleUsesTheConsoleModelOrConsole() {
        #expect(AgentCopy.applyTitle(consoleModel: "M32R") == "Apply to M32R")
        #expect(AgentCopy.applyTitle(consoleModel: nil) == "Apply to console")
        #expect(AgentCopy.applyTitle(consoleModel: "  ") == "Apply to console")
    }

    @Test func honestCopy() {
        #expect(AgentCopy.title == "Sound Buddy Agent")
        #expect(AgentCopy.subtitle == "Suggest & Approve · nothing changes until you tap Apply")
        #expect(AgentCopy.badge == "On-device rules")
        #expect(AgentCopy.badgeDetail == "No AI model · no cloud")
        #expect(AgentCopy.diagnosisSource == "Phone mic estimate")
        #expect(AgentCopy.safeStep == "Inside the ±3 dB safe step")
        #expect(AgentCopy.noConsoleLink == "Apply needs a linked, armed console. Make this move on the desk.")
        #expect(AgentCopy.previewUnavailable == "Preview needs the console's current EQ")
        #expect(AgentCopy.footer == "Chat and Mac Companion are not in this build.")
        #expect(AgentCopy.applyLocked == ConsoleCoachingMapper.applyLabelDisarmed)
    }

    @Test func moveTitleFollowsTheGainSign() {
        #expect(AgentCopy.moveTitle(gainDb: -3, band: .bass) == "Cut bass")
        #expect(AgentCopy.moveTitle(gainDb: 2.5, band: .presence) == "Boost presence")
        #expect(AgentCopy.moveTitle(gainDb: -1, band: nil) == "Cut")
    }

    @Test func undoSentenceForAnAppliedMove() throws {
        let suggestion = try #require(ConsoleCoachingMapper.suggestion(for: bass, mainLR: busyMainLR))
        let applied = ConsoleCoachingMapper.applied(suggestion, to: busyMainLR)
        #expect(AgentCopy.undoSentence(for: applied) == "Undo puts Main LR Band 2 back to +1.5 dB at 250 Hz.")
    }
}

@Suite("AgentFormat")
struct AgentFormatTests {
    @Test(
        "signed dB",
        arguments: [
            (6.2, "+6.2 dB"),
            (-3.0, "\u{2212}3.0 dB"),
            (0.0, "0.0 dB"),
            (0.04, "0.0 dB"),
            (-0.04, "0.0 dB"),
        ]
    )
    func signedDb(value: Double, expected: String) {
        #expect(AgentFormat.signedDb(value) == expected)
    }
}
