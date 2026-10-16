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
    /// How long every band must stay strictly below `exitThresholdDb`
    /// before the calm state appears (#1773).
    public static let calmDwellSeconds: TimeInterval = 2.0
    /// What the coach shows while `isOnTarget` is true (#1699).
    public static let onTargetMessage = "Mix is on target"

    public private(set) var visible: Set<Band> = []
    /// The Speech/Music target the current tip state was judged against (#1701).
    public private(set) var activeMode: ProgramMode = .music
    private var offSince: [Band: Date] = [:]
    private var shownAt: [Band: Date] = [:]
    private var recoveringSince: [Band: Date] = [:]
    private var lastTime: Date?
    private var calmSince: Date?
    private var isCalm = false

    public init() {}

    /// Feeds one frame's smoothed deltas at `time` (the caller's injected
    /// clock) and returns the visible set after applying it. A frame earlier
    /// than the last accepted one is ignored.
    public mutating func ingest(_ deltas: [Band: Double], at time: Date) -> Set<Band> {
        if let lastTime, time < lastTime {
            return visible
        }
        lastTime = time

        var magnitudes: [Double] = []
        for band in Band.allCases {
            let magnitude = deltas[band].flatMap { $0.isFinite ? abs($0) : nil }
            if let magnitude { magnitudes.append(magnitude) }
            if visible.contains(band) {
                ingestVisible(band, magnitude: magnitude, at: time)
            } else {
                ingestHidden(band, magnitude: magnitude, at: time)
            }
        }
        updateCalm(magnitudes: magnitudes, at: time)
        return visible
    }

    /// Calm needs positive evidence (#1773): every measured band strictly
    /// below `exitThresholdDb` for `calmDwellSeconds`. It drops at once when
    /// a reading goes missing or any band reaches `enterThresholdDb` (i.e.
    /// starts its enter dwell). A band between the two thresholds holds
    /// whichever state is current, so calm doesn't flicker with a band
    /// hovering near either threshold. A visible tip blocks calm but doesn't
    /// restart the calm dwell: its own exit dwell is already the evidence,
    /// so calm returns on the frame the tip clears.
    private mutating func updateCalm(magnitudes: [Double], at time: Date) {
        if magnitudes.isEmpty || magnitudes.contains(where: { $0 >= Self.enterThresholdDb }) {
            calmSince = nil
            isCalm = false
        } else if magnitudes.allSatisfy({ $0 < Self.exitThresholdDb }) {
            let start = calmSince ?? time
            calmSince = start
            if time.timeIntervalSince(start) >= Self.calmDwellSeconds {
                isCalm = true
            }
        } else {
            calmSince = nil
        }
        if !visible.isEmpty {
            isCalm = false
        }
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
        calmSince = nil
        isCalm = false
    }

    /// The calm 'Mix is on target' state (#1699, #1773): true only after
    /// every measured band has stayed strictly below `exitThresholdDb` for
    /// `calmDwellSeconds`, and false the moment any band reaches
    /// `enterThresholdDb` — so a band still dwelling toward a tip shows the
    /// neutral listening placeholder, never calm. Never true without a real
    /// reading or while any tip is visible.
    public var isOnTarget: Bool {
        isCalm
    }
}
