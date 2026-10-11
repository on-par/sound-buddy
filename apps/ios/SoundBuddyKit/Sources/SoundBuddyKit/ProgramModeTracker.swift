import Foundation

/// The Analyze auto target's current program state, per ProgramModeTracker.
public enum ProgramMode: String, Sendable {
    case music, speech
    /// Talk over a quiet music underscore (#1702): speech and a sustained
    /// music bed are both present, so neither Music nor Speech fits.
    case speechOverBed

    /// The voice bands, roughly 250 Hz-4 kHz: Low-mid, Mid and High-mid.
    public static let voiceBands: Set<Band> = [.lowMid, .mid, .highMid]

    /// The bands coaching judges in this state. In Speech + bed the bands
    /// below ~250 Hz and above ~4 kHz belong to the bed, so their coaching
    /// pauses and only voice-band tips remain (#1702).
    public var coachedBands: Set<Band> {
        switch self {
        case .speechOverBed: Self.voiceBands
        case .music, .speech: Set(Band.allCases)
        }
    }
}

/// Turns a stream of per-frame ProgramContent into a sticky ProgramMode
/// (#1690, #1702). A rolling evidence window decides the candidate state:
/// Music, Speech, or Speech + bed when speech and a music bed are both
/// present (talk over an underscore reads as speech on the words and music in
/// the gaps between them). A candidate must stay the same for
/// `switchEvidenceSeconds` of consistent evidence before the tracker switches,
/// and after any switch the state holds for at least `minimumHoldSeconds`.
/// Silence never counts as evidence for anything.
public struct ProgramModeTracker: Sendable {
    /// How much recent history decides the candidate state. Long enough to
    /// span a phrase and the pause after it.
    public static let evidenceWindowSeconds: TimeInterval = 3.0
    /// Speech counts as present when at least this share of the window's
    /// voiced (non-silence) frames read as speech. Below it, singing or a
    /// stray frame inside music never pulls the state away from Music.
    public static let speechPresenceFraction = 0.3
    /// A music bed counts as present under speech when at least this share
    /// of the window's voiced frames read as music.
    public static let bedPresenceFraction = 0.2
    /// How long a candidate must hold, continuously, before the state changes.
    public static let switchEvidenceSeconds: TimeInterval = 6.0
    /// After a switch the state holds at least this long, whatever the evidence.
    public static let minimumHoldSeconds: TimeInterval = 10.0

    public private(set) var mode: ProgramMode = .music
    private var samples: [(time: Date, content: ProgramContent)] = []
    private var challenger: ProgramMode?
    private var challengerSince: Date?
    private var lastSwitchAt: Date?

    public init() {}

    /// The state the current evidence window points to, or nil when the
    /// window holds no voiced frames.
    static func candidate(speechFrames: Int, musicFrames: Int) -> ProgramMode? {
        let voiced = speechFrames + musicFrames
        guard voiced > 0 else { return nil }
        let speechShare = Double(speechFrames) / Double(voiced)
        let musicShare = Double(musicFrames) / Double(voiced)
        guard speechShare >= speechPresenceFraction else { return .music }
        return musicShare >= bedPresenceFraction ? .speechOverBed : .speech
    }

    /// Feeds one frame's classified content at `time` (the model's injected
    /// clock) and returns the tracker's state after applying it.
    public mutating func update(_ content: ProgramContent, at time: Date) -> ProgramMode {
        samples.append((time: time, content: content))
        let windowStart = time.addingTimeInterval(-Self.evidenceWindowSeconds)
        samples.removeAll { $0.time < windowStart }

        let speechFrames = samples.filter { $0.content == .speech }.count
        let musicFrames = samples.filter { $0.content == .music }.count
        guard let candidate = Self.candidate(speechFrames: speechFrames, musicFrames: musicFrames) else {
            // Silence-only window: hold the current state, and leave any
            // challenger's evidence where it was.
            return mode
        }

        guard candidate != mode else {
            challenger = nil
            challengerSince = nil
            return mode
        }
        if candidate != challenger {
            // A different candidate restarts the evidence clock: evidence has
            // to be consistent for the whole switch window.
            challenger = candidate
            challengerSince = time
        }

        let since = challengerSince ?? time
        let evidenceHeld = time.timeIntervalSince(since) >= Self.switchEvidenceSeconds
        let holdDone = lastSwitchAt.map { time.timeIntervalSince($0) >= Self.minimumHoldSeconds } ?? true
        if evidenceHeld, holdDone {
            mode = candidate
            lastSwitchAt = time
            challenger = nil
            challengerSince = nil
            samples.removeAll()
        }
        return mode
    }

    /// Returns the tracker to its initial state (used on halt).
    public mutating func reset() {
        self = ProgramModeTracker()
    }
}
