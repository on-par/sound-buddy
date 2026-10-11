import Foundation
import Testing
@testable import SoundBuddyKit

/// Drives `tracker` from `elapsed == 0` in `step`-sized ticks up to (but not
/// including) `duration`, classifying each tick's content from `content`,
/// and returns the mode after the last tick. `onSwitch` sees every mode
/// change with its absolute time in seconds.
@discardableResult
private func run(
    _ tracker: inout ProgramModeTracker,
    for duration: TimeInterval,
    step: TimeInterval = 0.05,
    startingAt start: TimeInterval = 0,
    content: (TimeInterval) -> ProgramContent,
    onSwitch: (TimeInterval, ProgramMode) -> Void = { _, _ in }
) -> ProgramMode {
    var elapsed: TimeInterval = 0
    var mode = tracker.mode
    var i = 0
    while elapsed < duration {
        let now = start + elapsed
        let next = tracker.update(content(elapsed), at: Date(timeIntervalSince1970: now))
        if next != mode { onSwitch(now, next) }
        mode = next
        i += 1
        elapsed = Double(i) * step
    }
    return mode
}

/// Frame `i` of a repeating pattern: `pattern[i % pattern.count]`.
private func cycle(_ pattern: [ProgramContent], step: TimeInterval = 0.05) -> (TimeInterval) -> ProgramContent {
    { elapsed in pattern[Int((elapsed / step).rounded()) % pattern.count] }
}

/// Hysteresis over ProgramContentClassifier's per-frame output (#1690, #1702):
/// a 3 s evidence window decides the candidate state (Music, Speech, or
/// Speech + bed when speech and a music bed are both present), a candidate
/// must hold for 6 s of consistent evidence before the tracker switches, and
/// every switch holds for at least 10 s. Every test uses an injected clock
/// stepped by hand, no wall-clock timing.
@Suite struct ProgramModeTrackerTests {
    @Test func thresholdsAreTheSpeccedNamedConstants() {
        #expect(ProgramModeTracker.switchEvidenceSeconds == 6.0)
        #expect(ProgramModeTracker.minimumHoldSeconds == 10.0)
        #expect(ProgramModeTracker.evidenceWindowSeconds == 3.0)
    }

    @Test func startsInMusic() {
        #expect(ProgramModeTracker().mode == .music)
    }

    // MARK: Pure content

    @Test func pureSpeechEntersSpeechOnlyAfterSixSecondsOfEvidence() {
        var tracker = ProgramModeTracker()
        let notYet = run(&tracker, for: 5.8) { _ in .speech }
        #expect(notYet == .music, "5.8 s of speech is short of the 6 s evidence")

        let after = run(&tracker, for: 1.0, startingAt: 5.8) { _ in .speech }
        #expect(after == .speech)
    }

    @Test func pureMusicStaysMusic() {
        var tracker = ProgramModeTracker()
        var switches = 0
        run(&tracker, for: 60, content: { _ in .music }, onSwitch: { _, _ in switches += 1 })
        #expect(tracker.mode == .music)
        #expect(switches == 0)
    }

    @Test func pureSpeechStaysSpeechOnceEntered() {
        var tracker = ProgramModeTracker()
        var switches: [ProgramMode] = []
        run(&tracker, for: 60, content: { _ in .speech }, onSwitch: { _, mode in switches.append(mode) })
        #expect(switches == [.speech])
    }

    @Test func occasionalMusicFramesInSpeechStaySpeech() {
        var tracker = ProgramModeTracker()
        // 1 frame in 10 misreads as music: well under the bed-presence share.
        var pattern = [ProgramContent](repeating: .speech, count: 9)
        pattern.append(.music)
        var switches: [ProgramMode] = []
        run(&tracker, for: 60, content: cycle(pattern), onSwitch: { _, mode in switches.append(mode) })
        #expect(switches == [.speech])
    }

    @Test func musicWithSomeSpeechLikeFramesStaysMusic() {
        var tracker = ProgramModeTracker()
        // Singing reads as speech on 1 frame in 4: under the speech-presence share.
        var switches = 0
        run(&tracker, for: 60, content: cycle([.speech, .music, .music, .music]), onSwitch: { _, _ in switches += 1 })
        #expect(tracker.mode == .music)
        #expect(switches == 0)
    }

    // MARK: Speech + bed

    @Test func talkOverAnUnderscoreSettlesInSpeechPlusBedWithoutFlipFlopping() {
        var tracker = ProgramModeTracker()
        // Words read as speech, the gaps between them read as the bed (music).
        var switches: [(TimeInterval, ProgramMode)] = []
        run(&tracker, for: 60, content: cycle([.speech, .speech, .music]), onSwitch: { switches.append(($0, $1)) })
        #expect(switches.map(\.1) == [.speechOverBed], "one switch into Speech + bed, then steady for 60 s")
        #expect(switches.first.map(\.0).map { $0 >= ProgramModeTracker.switchEvidenceSeconds } == true)
    }

    @Test func perFrameAlternationIsAMixNotAFlap() {
        var tracker = ProgramModeTracker()
        var switches: [ProgramMode] = []
        run(&tracker, for: 30, content: cycle([.speech, .music]), onSwitch: { _, mode in switches.append(mode) })
        #expect(switches == [.speechOverBed])
    }

    @Test func oneSecondBlocksAreAMixNotAFlap() {
        var tracker = ProgramModeTracker()
        var switches: [ProgramMode] = []
        run(&tracker, for: 30, content: { Int($0).isMultiple(of: 2) ? .speech : .music }, onSwitch: { _, mode in switches.append(mode) })
        #expect(switches == [.speechOverBed])
    }

    @Test func speechPlusBedFromSpeechAndBackToSpeech() {
        var tracker = ProgramModeTracker()
        run(&tracker, for: 7) { _ in .speech }
        #expect(tracker.mode == .speech)

        let mixed = run(&tracker, for: 20, startingAt: 7, content: cycle([.speech, .music]))
        #expect(mixed == .speechOverBed)

        let back = run(&tracker, for: 20, startingAt: 27) { _ in .speech }
        #expect(back == .speech, "the bed drops out, so it is speech again")
    }

    // MARK: Hold and evidence timing

    @Test func aSwitchHoldsForTheMinimumHoldEvenWithConsistentEvidenceAgainstIt() {
        var tracker = ProgramModeTracker()
        var switchTimes: [TimeInterval] = []
        run(&tracker, for: 7, content: { _ in .speech }, onSwitch: { t, _ in switchTimes.append(t) })
        let enteredSpeech = try! #require(switchTimes.first)

        // Music from 7 s: 6 s of evidence would be enough at ~13 s, but the hold
        // keeps Speech until enteredSpeech + 10 s.
        run(&tracker, for: 20, startingAt: 7, content: { _ in .music }, onSwitch: { t, _ in switchTimes.append(t) })
        #expect(switchTimes.count == 2)
        #expect(switchTimes[1] - enteredSpeech >= ProgramModeTracker.minimumHoldSeconds)
        #expect(tracker.mode == .music)
    }

    @Test func noStateChangeIsEverFasterThanTheMinimumHold() {
        var tracker = ProgramModeTracker()
        // A restless 3-minute program: 7 s blocks of speech, music, talk-over and silence.
        let blocks: [(TimeInterval) -> ProgramContent] = [
            { _ in .speech }, { _ in .music }, cycle([.speech, .music]), { _ in .silence },
            cycle([.speech, .speech, .music]), { _ in .music }, { _ in .speech },
        ]
        var switchTimes: [TimeInterval] = []
        run(&tracker, for: 180, content: { t in blocks[Int(t / 7) % blocks.count](t) }, onSwitch: { t, _ in switchTimes.append(t) })
        #expect(!switchTimes.isEmpty)
        #expect(switchTimes[0] >= ProgramModeTracker.switchEvidenceSeconds)
        for (a, b) in zip(switchTimes, switchTimes.dropFirst()) {
            #expect(b - a >= ProgramModeTracker.minimumHoldSeconds, "switched \(b - a) s after the previous switch")
        }
    }

    @Test func evidenceMustBeConsistentForTheWholeSixSeconds() {
        var tracker = ProgramModeTracker()
        // Speech for 4 s, then the bed creeps in: the candidate changes before
        // speech earned its 6 s, so Speech never wins, and Speech + bed needs
        // its own full 6 s from when the bed showed up.
        var switches: [(TimeInterval, ProgramMode)] = []
        run(&tracker, for: 4, content: { _ in .speech }, onSwitch: { switches.append(($0, $1)) })
        run(&tracker, for: 20, startingAt: 4, content: cycle([.speech, .music]), onSwitch: { switches.append(($0, $1)) })
        #expect(switches.map(\.1) == [.speechOverBed])
        #expect(switches[0].0 >= 4 + ProgramModeTracker.switchEvidenceSeconds)
    }

    // MARK: Silence

    @Test func silenceHoldsTheCurrentModeFromMusic() {
        var tracker = ProgramModeTracker()
        #expect(run(&tracker, for: 20) { _ in .silence } == .music)
    }

    @Test func silenceHoldsSpeechPlusBed() {
        var tracker = ProgramModeTracker()
        run(&tracker, for: 10, content: cycle([.speech, .music]))
        #expect(tracker.mode == .speechOverBed)
        #expect(run(&tracker, for: 30, startingAt: 10) { _ in .silence } == .speechOverBed, "a long silence never changes the mode")
    }

    @Test func briefSilencesBetweenPhrasesStillEnterSpeech() {
        var tracker = ProgramModeTracker()
        // 0.3 s of speech, 0.1 s of silence, repeating.
        let after = run(&tracker, for: 8) { elapsed in
            elapsed.truncatingRemainder(dividingBy: 0.4) < 0.3 ? .speech : .silence
        }
        #expect(after == .speech, "silence is not a bed")
    }

    @Test func resetReturnsToMusicAndClearsTheHold() {
        var tracker = ProgramModeTracker()
        run(&tracker, for: 7) { _ in .speech }
        #expect(tracker.mode == .speech)
        tracker.reset()
        #expect(tracker.mode == .music)

        // After a reset there is no hold and no stale evidence: a fresh run
        // needs the full 6 s again, and then switches without waiting 10 s.
        #expect(run(&tracker, for: 5.8, startingAt: 7) { _ in .speech } == .music)
        #expect(run(&tracker, for: 1.0, startingAt: 12.8) { _ in .speech } == .speech)
    }
}
