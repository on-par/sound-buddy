import Testing
@testable import SoundBuddyKit

private func features(
    speech: Double = 0,
    sub: Double = 0,
    air: Double = 0,
    centroid: Double = 2500,
    flatness: Double = 0.05,
    levelDb: Double = -20
) -> ProgramFeatures {
    ProgramFeatures(
        speechBandFraction: speech,
        subFraction: sub,
        airFraction: air,
        centroidHz: centroid,
        flatness: flatness,
        levelDb: levelDb
    )
}

/// Swift port of spectrum.py's classify_chunk (#1690) — the static scoring
/// pinned against the Mac's named thresholds, plus the stateful rolling
/// level-variance window the live analyzer needs that a whole-file chunk
/// doesn't.
@Suite struct ProgramContentClassifierTests {
    @Test func voiceBandHeavySpeechClassifiesAsSpeech() {
        let f = features(speech: 0.8, sub: 0.01, air: 0.005, centroid: 1200, flatness: 0.05, levelDb: -30)
        #expect(ProgramContentClassifier.classify(f, levelVarianceDb2: nil) == .speech)
    }

    @Test func fullBandMusicClassifiesAsMusic() {
        let f = features(speech: 0.35, sub: 0.12, air: 0.08, centroid: 3200, flatness: 0.01, levelDb: -20)
        #expect(ProgramContentClassifier.classify(f, levelVarianceDb2: nil) == .music)
    }

    @Test func oct11SpeechOverAPadClassifiesAsSpeech() {
        let f = features(speech: 0.62, sub: 0.03, air: 0.01, centroid: 1400, flatness: 0.05, levelDb: -47)
        #expect(ProgramContentClassifier.classify(f, levelVarianceDb2: nil) == .speech)
    }

    @Test func neutralFeaturesAtAQuietLevelClassifyAsMusicNotSpeech() {
        let f = features(speech: 0.3, sub: 0.02, air: 0.01, centroid: 2500, flatness: 0.05, levelDb: -45)
        #expect(ProgramContentClassifier.classify(f, levelVarianceDb2: nil) == .music, "low level alone never decides")
    }

    @Test func belowSilenceLevelClassifiesAsSilenceRegardlessOfOtherCues() {
        let f = features(speech: 0.9, levelDb: ProgramContentClassifier.silenceLevelDb - 1)
        #expect(ProgramContentClassifier.classify(f, levelVarianceDb2: nil) == .silence)
    }

    @Test func noCueFiredClassifiesAsMusic() {
        let f = features()
        #expect(ProgramContentClassifier.classify(f, levelVarianceDb2: nil) == .music)
    }

    @Test func highVarianceCanPushABorderlineFrameToSpeech() {
        let f = features(speech: 0.3, sub: 0.07, centroid: 2500, flatness: 0.05, levelDb: -20)
        #expect(ProgramContentClassifier.classify(f, levelVarianceDb2: nil) == .music, "music without the variance cue")
        #expect(ProgramContentClassifier.classify(f, levelVarianceDb2: 20) == .speech, "high variance tips it to speech")
    }

    @Test func lowVarianceCanPushABorderlineFrameToMusic() {
        let f = features(speech: 0.56, sub: 0, air: 0, centroid: 3200, flatness: 0.05, levelDb: -20)
        #expect(ProgramContentClassifier.classify(f, levelVarianceDb2: nil) == .speech, "speech without the variance cue")
        #expect(ProgramContentClassifier.classify(f, levelVarianceDb2: 2) == .music, "low variance tips it to music")
    }

    // MARK: Stateful window

    @Test func statefulClassifyUsesNilVarianceUntilTheMinimumWindowIsFilled() {
        var classifier = ProgramContentClassifier()
        let f = features(speech: 0.3, sub: 0.07, centroid: 2500, flatness: 0.05, levelDb: -20)
        for _ in 0..<(ProgramContentClassifier.minimumModulationFrames - 1) {
            #expect(classifier.classify(f) == ProgramContentClassifier.classify(f, levelVarianceDb2: nil))
        }
    }

    @Test func statefulClassifyUsesTheWindowsVarianceOnceFilled() {
        var classifier = ProgramContentClassifier()
        var levels: [Double] = []
        var lastResult: ProgramContent = .music
        // Alternate loud/quiet frames so the window builds real variance.
        for i in 0..<ProgramContentClassifier.minimumModulationFrames {
            let level = i.isMultiple(of: 2) ? -10.0 : -40.0
            levels.append(level)
            lastResult = classifier.classify(features(speech: 0.3, sub: 0.07, centroid: 2500, flatness: 0.05, levelDb: level))
        }
        let mean = levels.reduce(0, +) / Double(levels.count)
        let variance = levels.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / Double(levels.count)
        let expected = ProgramContentClassifier.classify(
            features(speech: 0.3, sub: 0.07, centroid: 2500, flatness: 0.05, levelDb: levels.last!),
            levelVarianceDb2: variance
        )
        #expect(lastResult == expected)
        #expect(variance > 0)
    }

    @Test func silentFramesDoNotEnterTheWindow() {
        var classifier = ProgramContentClassifier()
        let loud = features(speech: 0.3, sub: 0.07, centroid: 2500, flatness: 0.05, levelDb: -20)
        let silent = features(levelDb: ProgramContentClassifier.silenceLevelDb - 10)

        for _ in 0..<(ProgramContentClassifier.minimumModulationFrames - 1) {
            #expect(classifier.classify(loud) == ProgramContentClassifier.classify(loud, levelVarianceDb2: nil))
        }
        // A silent frame in between must not count toward the window, so the
        // very next loud frame still has one slot left before variance kicks in.
        #expect(classifier.classify(silent) == .silence)
        #expect(classifier.classify(loud) == ProgramContentClassifier.classify(loud, levelVarianceDb2: nil))
    }

    @Test func resetClearsTheWindow() {
        var classifier = ProgramContentClassifier()
        let f = features(speech: 0.3, sub: 0.07, centroid: 2500, flatness: 0.05, levelDb: -20)
        for _ in 0..<ProgramContentClassifier.minimumModulationFrames {
            _ = classifier.classify(f)
        }
        classifier.reset()
        #expect(classifier.classify(f) == ProgramContentClassifier.classify(f, levelVarianceDb2: nil))
    }
}
