import Foundation
import Testing
@testable import SoundBuddyKit

/// Drives `tracker` from `elapsed == 0` in `step`-sized ticks up to (but not
/// including) `duration`, classifying each tick's content from `content`,
/// and returns the mode after the last tick.
@discardableResult
private func run(
    _ tracker: inout ProgramModeTracker,
    for duration: TimeInterval,
    step: TimeInterval = 0.05,
    startingAt start: Date = Date(timeIntervalSince1970: 0),
    content: (TimeInterval) -> ProgramContent
) -> ProgramMode {
    var time = start
    var elapsed: TimeInterval = 0
    var mode = tracker.mode
    while elapsed < duration {
        mode = tracker.update(content(elapsed), at: time)
        time = time.addingTimeInterval(step)
        elapsed += step
    }
    return mode
}

/// Hysteresis over ProgramContentClassifier's per-frame output (#1690): a 1 s
/// evidence window decides which class currently dominates, and a challenger
/// must dominate continuously for its dwell (speech 4 s, music 2 s) before
/// the mode switches. Every test uses an injected clock stepped by hand —
/// no wall-clock timing.
@Suite struct ProgramModeTrackerTests {
    @Test func startsInMusic() {
        #expect(ProgramModeTracker().mode == .music)
    }

    @Test func entersSpeechAfterTheSpeechDwell() {
        var tracker = ProgramModeTracker()
        let notYet = run(&tracker, for: 3.5) { _ in .speech }
        #expect(notYet == .music, "3.5 s of speech is short of the 4 s dwell")

        let after = run(&tracker, for: 1.5, startingAt: Date(timeIntervalSince1970: 3.5)) { _ in .speech }
        #expect(after == .speech, "continuous speech past the dwell switches the mode")
    }

    @Test func returnsToMusicAfterTheMusicDwell() {
        var tracker = ProgramModeTracker()
        run(&tracker, for: 6.0) { _ in .speech }
        #expect(tracker.mode == .speech, "driven into speech first")

        let notYet = run(&tracker, for: 1.5, startingAt: Date(timeIntervalSince1970: 6.0)) { _ in .music }
        #expect(notYet == .speech, "1.5 s of music is short of the 2 s dwell")

        let after = run(&tracker, for: 1.5, startingAt: Date(timeIntervalSince1970: 7.5)) { _ in .music }
        #expect(after == .music, "continuous music past the dwell switches back")
    }

    @Test func silenceHoldsTheCurrentModeFromMusic() {
        var tracker = ProgramModeTracker()
        let after = run(&tracker, for: 20.0) { _ in .silence }
        #expect(after == .music)
    }

    @Test func silenceHoldsTheCurrentModeFromSpeech() {
        var tracker = ProgramModeTracker()
        run(&tracker, for: 6.0) { _ in .speech }
        #expect(tracker.mode == .speech)

        let after = run(&tracker, for: 20.0, startingAt: Date(timeIntervalSince1970: 6.0)) { _ in .silence }
        #expect(after == .speech, "a long silence never reverts the mode")
    }

    @Test func briefSilencesBetweenPhrasesStillEnterSpeech() {
        var tracker = ProgramModeTracker()
        // 0.3 s of speech, 0.1 s of silence, repeating.
        let after = run(&tracker, for: 5.0) { elapsed in
            elapsed.truncatingRemainder(dividingBy: 0.4) < 0.3 ? .speech : .silence
        }
        #expect(after == .speech)
    }

    @Test func alternatingPerFrameNeverFlapsFromMusic() {
        var tracker = ProgramModeTracker()
        let after = run(&tracker, for: 30.0, step: 0.05) { elapsed in
            Int((elapsed / 0.05).rounded()).isMultiple(of: 2) ? .speech : .music
        }
        #expect(after == .music, "per-frame alternation never reaches dominance")
    }

    @Test func alternatingPerFrameNeverFlapsFromSpeech() {
        var tracker = ProgramModeTracker()
        run(&tracker, for: 6.0) { _ in .speech }
        #expect(tracker.mode == .speech)

        let after = run(&tracker, for: 30.0, step: 0.05, startingAt: Date(timeIntervalSince1970: 6.0)) { elapsed in
            Int((elapsed / 0.05).rounded()).isMultiple(of: 2) ? .speech : .music
        }
        #expect(after == .speech)
    }

    @Test func alternatingOneSecondBlocksNeverFlapsFromMusic() {
        var tracker = ProgramModeTracker()
        let after = run(&tracker, for: 30.0) { elapsed in
            Int(elapsed).isMultiple(of: 2) ? .speech : .music
        }
        #expect(after == .music, "1 s blocks never sustain dominance for the 4 s speech dwell")
    }

    @Test func alternatingOneSecondBlocksNeverFlapsFromSpeech() {
        var tracker = ProgramModeTracker()
        run(&tracker, for: 6.0) { _ in .speech }
        #expect(tracker.mode == .speech)

        let after = run(&tracker, for: 30.0, startingAt: Date(timeIntervalSince1970: 6.0)) { elapsed in
            Int(elapsed).isMultiple(of: 2) ? .music : .speech
        }
        #expect(after == .speech, "1 s blocks never sustain dominance for the 2 s music dwell")
    }

    @Test func alternatingThreeAndOneHalfSecondBlocksNeverFlapsFromMusic() {
        var tracker = ProgramModeTracker()
        let after = run(&tracker, for: 30.0) { elapsed in
            elapsed.truncatingRemainder(dividingBy: 4.5) < 3.0 ? .speech : .music
        }
        #expect(after == .music, "a 3 s speech block is short of the 4 s speech dwell")
    }

    @Test func alternatingThreeAndOneHalfSecondBlocksNeverFlapsFromSpeech() {
        var tracker = ProgramModeTracker()
        run(&tracker, for: 6.0) { _ in .speech }
        #expect(tracker.mode == .speech)

        let after = run(&tracker, for: 30.0, startingAt: Date(timeIntervalSince1970: 6.0)) { elapsed in
            elapsed.truncatingRemainder(dividingBy: 4.5) < 3.0 ? .speech : .music
        }
        #expect(after == .speech, "a 1.5 s music block is short of the 2 s music dwell")
    }

    @Test func resetReturnsToMusic() {
        var tracker = ProgramModeTracker()
        run(&tracker, for: 6.0) { _ in .speech }
        #expect(tracker.mode == .speech)
        tracker.reset()
        #expect(tracker.mode == .music)

        // After a reset, the dwell timing starts over — a fresh run
        // confirms no stale challenger state survived.
        let notYet = run(&tracker, for: 3.5) { _ in .speech }
        #expect(notYet == .music)
    }
}
