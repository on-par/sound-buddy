import Foundation

/// A frame's classified program content, per ProgramContentClassifier.
public enum ProgramContent: String, Sendable {
    case speech, music, silence
}

/// No-ML speech/music/silence heuristic for one live reading — a Swift port
/// of packages/audio-engine/scripts/spectrum.py's `classify_chunk` (#1690).
/// Pure scoring in the static `classify`; the stateful `classify(_:)` adds a
/// rolling level-variance window so the live analyzer can estimate the
/// syllabic-modulation cue spectrum.py gets from a whole file chunk.
public struct ProgramContentClassifier: Sendable {
    // MARK: Score thresholds (spectrum.py classify_chunk)

    /// `if speech_band > 0.55: speech_score += 1.0`
    static let speechBandMajorityThreshold = 0.55
    static let speechBandMajorityWeight = 1.0
    /// `if speech_band > 0.7: speech_score += 0.5`
    static let speechBandDominantThreshold = 0.7
    static let speechBandDominantWeight = 0.5
    /// `if rms_var > 12.0: speech_score += 1.0`
    static let highVarianceThresholdDb2 = 12.0
    static let highVarianceWeight = 1.0
    /// `elif rms_var < 5.0: music_score += 0.7`
    static let lowVarianceThresholdDb2 = 5.0
    static let lowVarianceWeight = 0.7
    /// `if sub > 0.06: music_score += 0.8`
    static let subThreshold = 0.06
    static let subWeight = 0.8
    /// `if highs > 0.04: music_score += 0.6`
    static let airThreshold = 0.04
    static let airWeight = 0.6
    /// `if centroid_hz > 3000: music_score += 0.5`
    static let centroidMusicThresholdHz = 3000.0
    static let centroidMusicWeight = 0.5
    /// `elif centroid_hz < 1800: speech_score += 0.4`
    static let centroidSpeechThresholdHz = 1800.0
    static let centroidSpeechWeight = 0.4
    /// `if flatness < 0.02: music_score += 0.3`
    static let flatnessThreshold = 0.02
    static let flatnessWeight = 0.3

    // MARK: iOS-only constants (no Mac equivalent)

    /// Below this, a frame is `.silence` without scoring. spectrum.py's
    /// `SILENCE_RMS_DB` (-55) is on its column-RMS scale (per-FFT-bin mean
    /// power over a chunk), not the phone's broadband dBFS `overallDb` — the
    /// phone needs its own threshold on its own scale. Tune from dogfood.
    public static let silenceLevelDb = -70.0
    /// A quiet-but-present level (the 2026-10-11 dogfood readout was ~-47
    /// dBFS during a speech-over-pad talk-over) nudges a frame that already
    /// has some speech evidence further toward speech — low level alone
    /// never decides (see `classify`'s guard below).
    public static let quietLevelDb = -40.0
    public static let quietLevelSpeechWeight = 0.3
    /// ~1 s of frames at the live meter's ~20 Hz reading rate.
    public static let modulationWindowFrames = 20
    /// Below this many frames in the window, level variance is too noisy to
    /// use as a cue — `classify(_:)` passes `nil` instead.
    public static let minimumModulationFrames = 5

    private var levelWindow: [Double] = []

    public init() {}

    /// Pure classification from one frame's features, plus an optional
    /// temporal-modulation variance (dB², population variance of recent
    /// `levelDb` samples) when enough history is available.
    public static func classify(_ features: ProgramFeatures, levelVarianceDb2: Double?) -> ProgramContent {
        guard features.levelDb >= silenceLevelDb else { return .silence }

        var speechScore = 0.0
        var musicScore = 0.0

        if features.speechBandFraction > speechBandMajorityThreshold { speechScore += speechBandMajorityWeight }
        if features.speechBandFraction > speechBandDominantThreshold { speechScore += speechBandDominantWeight }

        if let variance = levelVarianceDb2 {
            if variance > highVarianceThresholdDb2 {
                speechScore += highVarianceWeight
            } else if variance < lowVarianceThresholdDb2 {
                musicScore += lowVarianceWeight
            }
        }

        if features.subFraction > subThreshold { musicScore += subWeight }
        if features.airFraction > airThreshold { musicScore += airWeight }

        if features.centroidHz > centroidMusicThresholdHz {
            musicScore += centroidMusicWeight
        } else if features.centroidHz < centroidSpeechThresholdHz {
            speechScore += centroidSpeechWeight
        }

        if features.flatness < flatnessThreshold { musicScore += flatnessWeight }

        // A quiet-but-not-silent level only reinforces existing speech
        // evidence — on its own it must never decide the mode.
        if speechScore > 0, features.levelDb < quietLevelDb {
            speechScore += quietLevelSpeechWeight
        }

        if musicScore == 0, speechScore == 0 { return .music }
        return speechScore > musicScore ? .speech : .music
    }

    /// Stateful classification: silent frames return `.silence` without
    /// entering the rolling window; otherwise `levelDb` is appended to the
    /// last `modulationWindowFrames` levels, and the population variance
    /// (once there are at least `minimumModulationFrames`) is passed to the
    /// static `classify`.
    public mutating func classify(_ features: ProgramFeatures) -> ProgramContent {
        guard features.levelDb >= Self.silenceLevelDb else { return .silence }

        levelWindow.append(features.levelDb)
        if levelWindow.count > Self.modulationWindowFrames {
            levelWindow.removeFirst(levelWindow.count - Self.modulationWindowFrames)
        }

        let variance: Double?
        if levelWindow.count >= Self.minimumModulationFrames {
            let mean = levelWindow.reduce(0, +) / Double(levelWindow.count)
            variance = levelWindow.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / Double(levelWindow.count)
        } else {
            variance = nil
        }

        return Self.classify(features, levelVarianceDb2: variance)
    }

    /// Empties the rolling level window (used on halt).
    public mutating func reset() {
        levelWindow.removeAll()
    }
}
