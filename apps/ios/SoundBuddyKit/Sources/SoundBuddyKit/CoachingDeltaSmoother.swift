import Foundation

/// Turns timestamped per-band coaching deltas (dB) into smoothed coaching
/// deltas (#1697): a time-based exponential moving average per Band, so
/// normal music dynamics don't swing coaching frame to frame. Independent of
/// the live RTA (RTAMeter keeps reading raw readings). Smoothing a band's
/// level and smoothing its level-matched deviation are equivalent (the
/// level match is linear), so callers may feed either.
public struct CoachingDeltaSmoother: Equatable, Sendable {
    /// The smoothing window: roughly how much recent history the output reflects.
    public static let windowSeconds: TimeInterval = 10.0
    /// EMA time constant. An EMA with tau = window / 2 has the same centre of
    /// mass as a rolling mean over `windowSeconds`.
    public static let timeConstantSeconds: TimeInterval = windowSeconds / 2

    public private(set) var smoothed: [Band: Double] = [:]
    private var lastTime: Date?

    public init() {}

    /// EMA blend weight for a step of `dt` seconds: 1 - exp(-dt / tau), 0 for dt <= 0.
    public static func smoothingFactor(dt: TimeInterval) -> Double {
        guard dt > 0 else { return 0 }
        return 1 - exp(-dt / timeConstantSeconds)
    }

    /// Feeds one frame's deltas at `time` (the caller's injected clock) and
    /// returns the smoothed deltas after applying it.
    public mutating func ingest(_ deltas: [Band: Double], at time: Date) -> [Band: Double] {
        let dt = lastTime.map { time.timeIntervalSince($0) } ?? 0
        if lastTime == nil || time > lastTime! {
            lastTime = time
        }
        let alpha = Self.smoothingFactor(dt: dt)
        for (band, value) in deltas where value.isFinite {
            if let previous = smoothed[band] {
                smoothed[band] = previous + alpha * (value - previous)
            } else {
                smoothed[band] = value
            }
        }
        return smoothed
    }

    /// Returns the smoother to its initial state.
    public mutating func reset() {
        self = CoachingDeltaSmoother()
    }
}
