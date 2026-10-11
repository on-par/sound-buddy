import Foundation
import Testing
@testable import SoundBuddyKit

/// #1702: 60 s of synthetic program material (SpeechBedSignals) through the
/// real feature math, ProgramContentClassifier and ProgramModeTracker, the
/// same chain AnalyzeModel runs on every live reading.
private func modes(
    _ program: SpeechBedSignals.Program,
    seconds: Double = 60
) -> (final: ProgramMode, switches: [(time: Double, mode: ProgramMode)]) {
    let signals = SpeechBedSignals()
    var classifier = ProgramContentClassifier()
    var tracker = ProgramModeTracker()
    var switches: [(time: Double, mode: ProgramMode)] = []
    var mode = tracker.mode
    for (time, features) in signals.stream(program, seconds: seconds) {
        let next = tracker.update(classifier.classify(features), at: Date(timeIntervalSince1970: time))
        if next != mode { switches.append((time, next)) }
        mode = next
    }
    return (mode, switches)
}

@Suite struct SpeechBedScenarioTests {
    @Test func speechOverAPadStaysInSpeechPlusBedWithoutFlipFlopping() {
        let result = modes(.speechOverPad)
        #expect(result.switches.map(\.mode) == [.speechOverBed], "one switch into Speech + bed, then steady for 60 s")
        #expect(result.switches.first.map { $0.time >= ProgramModeTracker.switchEvidenceSeconds } == true)
        #expect(result.final == .speechOverBed)
    }

    @Test func speechOverAQuietBandStaysInSpeechPlusBedWithoutFlipFlopping() {
        let result = modes(.speechOverQuietBand)
        #expect(result.switches.map(\.mode) == [.speechOverBed], "one switch into Speech + bed, then steady for 60 s")
        #expect(result.switches.first.map { $0.time >= ProgramModeTracker.switchEvidenceSeconds } == true)
        #expect(result.final == .speechOverBed)
    }

    @Test func pureMusicStaysMusic() {
        let result = modes(.pureMusic)
        #expect(result.switches.isEmpty)
        #expect(result.final == .music)
    }

    @Test func pureSpeechStaysSpeech() {
        let result = modes(.pureSpeech)
        #expect(result.switches.map(\.mode) == [.speech])
        #expect(result.switches.first.map { $0.time >= ProgramModeTracker.switchEvidenceSeconds } == true)
    }

    @Test func theOldBinaryRuleChatteredOnTheSameMaterial() {
        // Regression guard for the bug itself: on the same speech-over-pad
        // material, 1 s windows alone flip between speech- and music-dominant
        // many times a minute. The tracker must not follow them.
        let signals = SpeechBedSignals()
        var classifier = ProgramContentClassifier()
        var window: [ProgramContent] = []
        var dominant: [ProgramContent] = []
        for (_, features) in signals.stream(.speechOverPad, seconds: 60) {
            window.append(classifier.classify(features))
            if window.count > 20 { window.removeFirst() }
            let speech = window.filter { $0 == .speech }.count
            let leader: ProgramContent = Double(speech) / Double(window.count) >= 0.6 ? .speech : .music
            if dominant.last != leader { dominant.append(leader) }
        }
        #expect(dominant.count > 10, "the raw 1 s evidence really does chatter (\(dominant.count) leader changes)")
        #expect(modes(.speechOverPad).switches.count == 1)
    }
}
