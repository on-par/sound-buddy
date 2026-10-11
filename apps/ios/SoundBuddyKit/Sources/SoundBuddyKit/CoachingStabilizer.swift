import Foundation

/// Turns timestamped smoothed per-band coaching deltas (dB, from
/// CoachingDeltaSmoother, #1697) into a stable set of visible tip bands
/// (#1698). Normal music dynamics push a smoothed delta back and forth across
/// a single threshold every 1-1.5 s, so a tip gated on a single threshold
/// would flicker too fast to read. A dwell/hysteresis gate fixes that: a tip
/// enters only after a sustained off-target run, stays up for a minimum time
/// once shown, and exits only after a sustained recovery run through a lower
/// threshold. The clock is injected through `at:` — there is no wall clock
/// and no Timer.
public struct CoachingStabilizer: Equatable, Sendable {
    /// |delta| (dB) at or above which a hidden band starts its enter dwell.
    public static let enterThresholdDb = 4.0
    /// |delta| (dB) strictly below which a visible band starts its exit dwell.
    public static let exitThresholdDb = 2.5
    /// How long the enter condition must hold continuously before a tip appears.
    public static let enterDwellSeconds: TimeInterval = 5.0
    /// How long the exit condition must hold continuously before a tip clears.
    public static let exitDwellSeconds: TimeInterval = 5.0
    /// Minimum time a tip stays on screen once it appears.
    public static let minimumVisibleSeconds: TimeInterval = 8.0
    /// What the coach shows while `isOnTarget` is true (#1699).
    public static let onTargetMessage = "Mix is on target"

    public private(set) var visible: Set<Band> = []
    /// The Speech/Music target the current tip state was judged against (#1701).
    public private(set) var activeMode: ProgramMode = .music
    private var offSince: [Band: Date] = [:]
    private var shownAt: [Band: Date] = [:]
    private var recoveringSince: [Band: Date] = [:]
    private var lastTime: Date?
    private var hasReading = false

    public init() {}

    /// Feeds one frame's smoothed deltas at `time` (the caller's injected
    /// clock) and returns the visible set after applying it. A frame earlier
    /// than the last accepted one is ignored.
    public mutating func ingest(_ deltas: [Band: Double], at time: Date) -> Set<Band> {
        if let lastTime, time < lastTime {
            return visible
        }
        lastTime = time
        hasReading = deltas.values.contains { $0.isFinite }

        for band in Band.allCases {
            let magnitude = deltas[band].flatMap { $0.isFinite ? abs($0) : nil }
            if visible.contains(band) {
                ingestVisible(band, magnitude: magnitude, at: time)
            } else {
                ingestHidden(band, magnitude: magnitude, at: time)
            }
        }
        return visible
    }

    private mutating func ingestHidden(_ band: Band, magnitude: Double?, at time: Date) {
        guard let magnitude, magnitude >= Self.enterThresholdDb else {
            offSince[band] = nil
            return
        }
        let start = offSince[band] ?? time
        offSince[band] = start
        if time.timeIntervalSince(start) >= Self.enterDwellSeconds {
            visible.insert(band)
            shownAt[band] = time
            offSince[band] = nil
            recoveringSince[band] = nil
        }
    }

    private mutating func ingestVisible(_ band: Band, magnitude: Double?, at time: Date) {
        if let magnitude, magnitude < Self.exitThresholdDb {
            recoveringSince[band] = recoveringSince[band] ?? time
        } else {
            recoveringSince[band] = nil
        }

        guard let recoveringSince = recoveringSince[band],
              time.timeIntervalSince(recoveringSince) >= Self.exitDwellSeconds,
              let shownAt = shownAt[band],
              time.timeIntervalSince(shownAt) >= Self.minimumVisibleSeconds
        else {
            return
        }
        visible.remove(band)
        self.shownAt[band] = nil
        self.recoveringSince[band] = nil
    }

    /// Returns the stabilizer to its initial empty state.
    public mutating func reset() {
        self = CoachingStabilizer()
    }

    /// Speech-aware Analyze's hook for a Speech/Music target switch (#1701).
    /// Deltas fed so far were measured against the old target, so a real
    /// mode change drops every dwell and every visible tip: a band has to
    /// earn the full enter dwell again under the new target. The same mode
    /// is a no-op, so callers may forward the mode every frame. `lastTime` is
    /// kept so a late frame from before the switch is still ignored.
    public mutating func targetDidSwitch(to mode: ProgramMode) {
        guard mode != activeMode else { return }
        activeMode = mode
        visible = []
        offSince = [:]
        shownAt = [:]
        recoveringSince = [:]
        hasReading = false
    }

    /// The calm 'Mix is on target' state (#1699): true when the last accepted
    /// frame carried a real reading and no band's tip has entered through the
    /// enter dwell. A band still dwelling above `enterThresholdDb` keeps the
    /// calm state until its tip actually enters, so the calm state inherits the
    /// dwell/hysteresis smoothing instead of flickering with raw dynamics.
    /// Never true while any tip is visible.
    public var isOnTarget: Bool {
        hasReading && visible.isEmpty
    }
}
