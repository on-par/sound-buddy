import Foundation

/// The Analyze auto target's current program mode, per ProgramModeTracker.
public enum ProgramMode: String, Sendable {
    case music, speech
}

/// Turns a stream of per-frame ProgramContent into a hysteresis-gated
/// ProgramMode (#1690): a short evidence window decides which class
/// currently dominates, and a challenger mode must dominate continuously for
/// its dwell before the tracker switches — so content alternating faster
/// than the dwell, or a brief silence, never flips the mode.
public struct ProgramModeTracker: Sendable {
    /// How much recent history decides "currently dominant".
    public static let evidenceWindowSeconds: TimeInterval = 1.0
    /// A class needs this share of the window's voiced (non-silence) samples
    /// to be considered dominant; otherwise the window reads as mixed.
    public static let dominanceFraction = 0.6
    /// How long a challenger must stay dominant before the mode enters speech.
    public static let speechDwellSeconds: TimeInterval = 4.0
    /// How long a challenger must stay dominant before the mode returns to music.
    public static let musicDwellSeconds: TimeInterval = 2.0

    public private(set) var mode: ProgramMode = .music
    private var samples: [(time: Date, content: ProgramContent)] = []
    private var challengerSince: Date?

    public init() {}

    private func dwell(for challenger: ProgramMode) -> TimeInterval {
        challenger == .speech ? Self.speechDwellSeconds : Self.musicDwellSeconds
    }

    /// Feeds one frame's classified content at `time` (the model's injected
    /// clock) and returns the tracker's mode after applying it.
    public mutating func update(_ content: ProgramContent, at time: Date) -> ProgramMode {
        samples.append((time: time, content: content))
        let windowStart = time.addingTimeInterval(-Self.evidenceWindowSeconds)
        samples.removeAll { $0.time < windowStart }

        let voiced = samples.filter { $0.content != .silence }
        guard !voiced.isEmpty else {
            // Silence-only window: hold the current mode, and don't let a
            // quiet stretch count toward (or interrupt) a challenger's dwell.
            return mode
        }

        let speechCount = voiced.filter { $0.content == .speech }.count
        let musicCount = voiced.count - speechCount
        let speechFraction = Double(speechCount) / Double(voiced.count)
        let musicFraction = Double(musicCount) / Double(voiced.count)

        let dominant: ProgramMode?
        if speechFraction >= Self.dominanceFraction {
            dominant = .speech
        } else if musicFraction >= Self.dominanceFraction {
            dominant = .music
        } else {
            dominant = nil
        }

        guard let dominant, dominant != mode else {
            challengerSince = nil
            return mode
        }

        let since = challengerSince ?? time
        challengerSince = since
        if time.timeIntervalSince(since) >= dwell(for: dominant) {
            mode = dominant
            challengerSince = nil
            samples.removeAll()
        }
        return mode
    }

    /// Returns the tracker to its initial state (used on halt).
    public mutating func reset() {
        mode = .music
        samples.removeAll()
        challengerSince = nil
    }
}
