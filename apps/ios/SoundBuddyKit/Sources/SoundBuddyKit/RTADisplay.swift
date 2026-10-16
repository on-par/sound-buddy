import Foundation

// The shared RTA display spec (#1707, epic #1705): see
// docs/rta-display-spec.md. Display only: coaching keeps its own window and
// hysteresis (#1695, #1702) and never reads anything in this file.
// Canonical parity vectors: docs/rta-display-spec/fixtures/rta-display-v1.json.

/// Exponential time-weighted averaging per band in the power domain, with
/// separate attack (rising) and release (falling) time constants.
public struct RTABallistics: Equatable, Sendable {
    public let attackTauSeconds: Double
    public let releaseTauSeconds: Double

    public init(attackTauSeconds: Double, releaseTauSeconds: Double) {
        self.attackTauSeconds = attackTauSeconds
        self.releaseTauSeconds = releaseTauSeconds
    }

    /// The default: quick enough attack that transients still show, and a
    /// 1 s release so bars glide on live FOH and pink noise. Build 14's
    /// 0.05 s / 0.4 s read as jerky (#1772).
    public static let medium = RTABallistics(attackTauSeconds: 0.1, releaseTauSeconds: 1.0)
    /// The optional calmer setting.
    public static let slow = RTABallistics(attackTauSeconds: 0.25, releaseTauSeconds: 1.5)

    /// One step of the exponential average from `previous` toward `input`
    /// (both linear power) over `dt` seconds.
    public func smoothed(previous: Double, input: Double, dt: Double) -> Double {
        let tau = input > previous ? attackTauSeconds : releaseTauSeconds
        return previous + (1 - exp(-dt / tau)) * (input - previous)
    }
}

/// The user's smoothing choice, persisted with @AppStorage.
public enum RTABallisticsMode: String, CaseIterable, Sendable {
    case medium
    case slow

    public static let defaultsKey = "analyze.rtaBallistics"
    public static let defaultValue = RTABallisticsMode.medium

    public var ballistics: RTABallistics {
        switch self {
        case .medium: .medium
        case .slow: .slow
        }
    }

    public var label: String {
        switch self {
        case .medium: "Medium"
        case .slow: "Slow"
        }
    }
}

/// Which RTA view is drawn, persisted with @AppStorage. Absolute is the
/// default (#1772): dBFS bars with the bandwidth-corrected target line drawn
/// over them, the same picture in Listening and edit mode. Relative
/// (deviations from the level-matched target) is a Settings opt-in.
public enum RTAViewMode: String, CaseIterable, Sendable {
    case absolute
    case relative

    public static let defaultsKey = "analyze.rtaViewMode"
    public static let defaultValue = RTAViewMode.absolute
    /// Set once `migrateToAbsoluteDefault(in:)` has run.
    public static let absoluteDefaultMigrationKey = "analyze.rtaViewMode.absoluteDefaultMigrated"

    public var scale: RTAScale {
        switch self {
        case .relative: .relative
        case .absolute: .absolute
        }
    }

    public var label: String {
        switch self {
        case .relative: "Relative"
        case .absolute: "Absolute"
        }
    }

    /// The small scale caption, drawn only in Relative so its 0 line can't
    /// be read as 0 dBFS. Absolute needs none: its dashed line is the target.
    public var caption: String? {
        switch self {
        case .relative: "vs target, 0 = target"
        case .absolute: nil
        }
    }

    /// Target editing always draws Absolute: the handles reshape the dashed
    /// target over the dBFS bars, and a Relative view would move its own 0
    /// line under the finger. With the Absolute default, entering or leaving
    /// edit never changes the scale.
    public static func effective(requested: RTAViewMode, isEditingTarget: Bool) -> RTAViewMode {
        isEditingTarget ? .absolute : requested
    }

    /// One-time reset (#1772): Relative was the default through build 14,
    /// so a stored "relative" is almost always that old default rather than
    /// a choice. The first launch with this code resets it to Absolute and
    /// records `absoluteDefaultMigrationKey`; a Relative chosen in Settings
    /// after that sticks. Returns whether the stored choice changed.
    @discardableResult
    public static func migrateToAbsoluteDefault(in defaults: UserDefaults) -> Bool {
        guard !defaults.bool(forKey: absoluteDefaultMigrationKey) else { return false }
        defaults.set(true, forKey: absoluteDefaultMigrationKey)
        guard defaults.string(forKey: defaultsKey) == RTAViewMode.relative.rawValue else { return false }
        defaults.set(RTAViewMode.absolute.rawValue, forKey: defaultsKey)
        return true
    }
}

/// Peak-hold ticks: hold, then fall at a fixed rate (never below the bar).
public enum RTAPeakHold {
    public static let holdSeconds = 1.5
    public static let releaseDbPerSecond = 20.0
}

/// Which way a Relative value left the ±15 dB window.
public enum RTAOverflow: String, Equatable, Sendable {
    case above
    case below
}

/// Relative-view bar color class: neutral gray within ±3 dB of the target,
/// amber over, cyan under (the problem-marker palette).
public enum RTADeviationTone: String, Equatable, Sendable {
    case neutral
    case over
    case under

    public static let neutralWithinDb = 3.0

    public init(deviationDb: Double) {
        if deviationDb > Self.neutralWithinDb {
            self = .over
        } else if deviationDb < -Self.neutralWithinDb {
            self = .under
        } else {
            self = .neutral
        }
    }
}

extension RTAScale {
    /// Relative view: ±15 dB around the target (the 0 line), 5 dB ticks.
    public static let relative = RTAScale(floorDb: -15, ceilingDb: 15, tickStepDb: 5)
    /// Absolute view: −96…0 dBFS on every platform, 12 dB ticks. −96 sits just
    /// under a quiet room's per-band floor, so idle bars never vanish.
    public static let absolute = RTAScale(floorDb: -96, ceilingDb: 0, tickStepDb: 12)

    /// `db` clamped to the window, with which edge it overflowed (drawn as a
    /// cap marker).
    public func clamp(_ db: Double) -> (db: Double, overflow: RTAOverflow?) {
        if db > ceilingDb { return (ceilingDb, .above) }
        if db < floorDb { return (floorDb, .below) }
        return (db, nil)
    }
}

/// Per-band peak hold on any dB series (absolute levels or deviations).
struct RTAPeakTracker: Equatable, Sendable {
    private(set) var peaks: [Double] = []
    private var ages: [Double] = []

    mutating func update(_ values: [Double], dt: Double) {
        guard values.count == peaks.count else {
            peaks = values
            ages = Array(repeating: 0, count: values.count)
            return
        }
        for i in values.indices {
            ages[i] += dt
            if values[i] >= peaks[i] {
                peaks[i] = values[i]
                ages[i] = 0
            } else {
                let falling = max(0, min(dt, ages[i] - RTAPeakHold.holdSeconds))
                peaks[i] = max(values[i], peaks[i] - RTAPeakHold.releaseDbPerSecond * falling)
            }
        }
    }
}

/// The pure RTA display model: smoothed levels (Absolute), deviations from
/// the level-matched target (Relative), and peak hold for both. Grid
/// agnostic; aged by the caller's real `dt`. Replaces RTAMeter's instant
/// attack and linear 40 dB/s release.
public struct RTADisplayModel: Equatable, Sendable {
    public var ballistics: RTABallistics
    /// Smoothed band levels in dBFS.
    public private(set) var levels: [Double] = []
    /// Peak-hold ticks over `levels`, dBFS.
    public private(set) var peaks: [Double] = []
    /// `levels` minus the level-matched target (or the measured mean with no
    /// target), unclamped.
    public private(set) var deviations: [Double] = []
    /// Peak-hold ticks over `deviations` (the Relative view's ticks).
    public private(set) var deviationPeaks: [Double] = []
    private var power: [Double] = []
    private var levelPeaks = RTAPeakTracker()
    private var deviationPeakTracker = RTAPeakTracker()

    public init(ballistics: RTABallistics = .medium) {
        self.ballistics = ballistics
    }

    /// Advances by `dt` seconds toward `input` (dBFS per band). The first
    /// frame, or a band-count change, is adopted as-is. `targetOffsets` are
    /// display offsets on the same grid (`RTATarget.resample`, already
    /// bandwidth-corrected); nil or a mismatched count means no target.
    public mutating func step(input: [Double], targetOffsets: [Double]?, dt: Double) {
        let step = dt.isFinite ? max(0, dt) : 0
        let inputDb = input.map { $0.isFinite ? max($0, SpectrumAnalyzer.silenceFloorDb) : SpectrumAnalyzer.silenceFloorDb }
        let inputPower = inputDb.map(Self.dbToPower)
        if inputPower.count != power.count {
            power = inputPower
            levels = inputDb
        } else {
            for i in inputPower.indices where inputPower[i] != power[i] {
                power[i] = ballistics.smoothed(previous: power[i], input: inputPower[i], dt: step)
                levels[i] = Self.powerToDb(power[i])
            }
        }
        deviations = Self.deviations(levels: levels, targetOffsets: targetOffsets)
        levelPeaks.update(levels, dt: step)
        deviationPeakTracker.update(deviations, dt: step)
        peaks = levelPeaks.peaks
        deviationPeaks = deviationPeakTracker.peaks
    }

    public mutating func reset() {
        self = RTADisplayModel(ballistics: ballistics)
    }

    /// The Absolute view's target line: `offsets` (the same bandwidth-
    /// corrected display offsets `step` takes) level-matched to these bars,
    /// so each deviation is exactly bar minus line (#1772). `nil` before any
    /// bars or for a mismatched band count.
    public func targetLine(offsets: [Double]) -> [Double]? {
        RTATarget.levelMatched(offsets: offsets, measured: levels)
    }

    static func deviations(levels: [Double], targetOffsets: [Double]?) -> [Double] {
        let offsets = targetOffsets.flatMap { $0.count == levels.count ? $0 : nil }
            ?? Array(repeating: 0, count: levels.count)
        guard let shift = RTATarget.levelShift(offsets: offsets, measured: levels) else {
            return Array(repeating: 0, count: levels.count)
        }
        return zip(levels, offsets).map { $0 - ($1 + shift) }
    }

    static func dbToPower(_ db: Double) -> Double { pow(10, db / 10) }

    static func powerToDb(_ power: Double) -> Double {
        guard power > 0 else { return SpectrumAnalyzer.silenceFloorDb }
        return max(SpectrumAnalyzer.silenceFloorDb, 10 * log10(power))
    }
}

/// Steps an `RTADisplayModel` once per rendered frame (≥30 fps) from the
/// latest analysis frame, using the real time between renders, so motion
/// interpolates smoothly between 20 Hz analysis frames.
public struct RTAFrameStepper: Equatable, Sendable {
    /// Longest step taken at once, so a view that was off screen for a while
    /// settles in one frame without integrating a huge `dt`.
    public static let maxStepSeconds = 0.25

    public private(set) var display = RTADisplayModel()
    private var lastTime: TimeInterval?

    public init() {}

    public mutating func advance(to time: TimeInterval, input: [Double], targetOffsets: [Double]?, ballistics: RTABallistics) {
        let dt = lastTime.map { min(Self.maxStepSeconds, max(0, time - $0)) } ?? 0
        lastTime = max(lastTime ?? time, time)
        display.ballistics = ballistics
        display.step(input: input, targetOffsets: targetOffsets, dt: dt)
    }

    public mutating func reset() {
        display.reset()
        lastTime = nil
    }
}
