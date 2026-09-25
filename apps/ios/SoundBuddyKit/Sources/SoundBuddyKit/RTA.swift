import Foundation

/// One fractional-octave RTA band.
public struct RTABand: Equatable, Sendable {
    public let lowHz: Double
    public let centerHz: Double
    public let highHz: Double
}

/// The display-only real-time-analyzer grid: log-spaced fractional-octave
/// bands across 20 Hz-20 kHz, anchored on 1 kHz like a console RTA. Coaching
/// never reads this — it stays on the canonical 7 bands (Band).
///
/// TODO(parity): the Mac draws a 48-point log curve (spectrum.py
/// curve_from_power). Once that is ported, decide whether the phone RTA should
/// share its grid.
public struct RTALayout: Equatable, Sendable {
    public static let minHz = 20.0
    public static let maxHz = 20_000.0
    /// Band centers are 1 kHz * 2^(k / bandsPerOctave).
    public static let anchorHz = 1000.0
    /// 1/6 octave: ~60 bars, dense enough to read like a console RTA while each
    /// bar stays a few points wide on an iPhone.
    public static let defaultBandsPerOctave = 6

    public let bandsPerOctave: Int
    public let bands: [RTABand]

    public init(bandsPerOctave: Int = RTALayout.defaultBandsPerOctave) {
        self.bandsPerOctave = bandsPerOctave
        let perOctave = Double(bandsPerOctave)
        let first = Int((perOctave * log2(Self.minHz / Self.anchorHz)).rounded(.up))
        let last = Int((perOctave * log2(Self.maxHz / Self.anchorHz)).rounded(.down))
        let halfBand = pow(2, 1 / (2 * perOctave))
        bands = (first...last).map { k in
            let center = Self.anchorHz * pow(2, Double(k) / perOctave)
            return RTABand(lowHz: center / halfBand, centerHz: center, highHz: center * halfBand)
        }
    }

    public static let standard = RTALayout()

    /// Horizontal position of `hz` on a log axis from minHz (0) to maxHz (1).
    public static func xFraction(hz: Double) -> Double {
        let fraction = log(hz / minHz) / log(maxHz / minHz)
        return min(1, max(0, fraction))
    }

    /// Axis labels in console style.
    public static let frequencyTicks: [(hz: Double, label: String)] = [
        (20, "20"), (50, "50"), (100, "100"), (200, "200"), (500, "500"),
        (1000, "1k"), (2000, "2k"), (5000, "5k"), (10_000, "10k"), (20_000, "20k"),
    ]
}

/// Vertical dB window of the RTA. Levels are dBFS off an uncalibrated phone
/// mic — relative, never SPL — so the UI keeps the "phone mic estimate" cue.
public struct RTAScale: Equatable, Sendable {
    public let floorDb: Double
    public let ceilingDb: Double
    public let tickStepDb: Double

    public init(floorDb: Double, ceilingDb: Double, tickStepDb: Double) {
        self.floorDb = floorDb
        self.ceilingDb = ceilingDb
        self.tickStepDb = tickStepDb
    }

    /// A quiet room reads roughly -100 to -90 dBFS per 1/6-octave band on the
    /// Simulator's USB input; program material through a PA lands around
    /// -60 to -30. The floor sits below room noise so the bars never flatline.
    public static let standard = RTAScale(floorDb: -120, ceilingDb: -20, tickStepDb: 10)

    /// Bar height in 0...1 for `db`, clamped to the window.
    public func fraction(db: Double) -> Double {
        min(1, max(0, (db - floorDb) / (ceilingDb - floorDb)))
    }

    /// Grid lines from the ceiling down to the floor.
    public var dbTicks: [Double] {
        Array(stride(from: ceilingDb, through: floorDb, by: -tickStepDb))
    }
}

/// RTA ballistics: bars jump up instantly and fall at a fixed release rate;
/// peak ticks hold, then fall. Pure value type, aged by the caller's clock.
public struct RTAMeter: Equatable, Sendable {
    /// How fast a bar falls once the signal drops (dB per second).
    public static let releaseDbPerSecond = 40.0
    /// How long a peak tick holds before it starts to fall.
    public static let peakHoldSeconds = 1.5
    /// How fast a peak tick falls after its hold (dB per second).
    public static let peakReleaseDbPerSecond = 20.0

    public private(set) var levels: [Double] = []
    public private(set) var peaks: [Double] = []
    private var peakAges: [Double] = []

    public init() {}

    public mutating func ingest(_ db: [Double], dt: Double) {
        guard db.count == levels.count else {
            levels = db
            peaks = db
            peakAges = Array(repeating: 0, count: db.count)
            return
        }
        let step = max(0, dt)
        for i in db.indices {
            levels[i] = max(db[i], levels[i] - Self.releaseDbPerSecond * step)
            peakAges[i] += step
            if levels[i] >= peaks[i] {
                peaks[i] = levels[i]
                peakAges[i] = 0
            } else if peakAges[i] > Self.peakHoldSeconds {
                peaks[i] = max(levels[i], peaks[i] - Self.peakReleaseDbPerSecond * step)
            }
        }
    }

    public mutating func reset() {
        self = RTAMeter()
    }
}

/// Bar color, after the console RTA reference: lows run green -> yellow ->
/// orange as they get hot; mids and highs stay cool, cyan -> blue with
/// frequency. Returned as HSB so the kit stays UI-framework free.
public enum RTAColor {
    public static let greenHue = 0.33
    public static let hotHue = 0.04
    public static let cyanHue = 0.5
    public static let blueHue = 0.62
    /// Bands centered below this are "lows" and get the warm ramp.
    public static let lowsCeilingHz = 250.0
    static let minBrightness = 0.55
    static let saturation = 0.85

    public static func hsb(hz: Double, fraction: Double) -> (hue: Double, saturation: Double, brightness: Double) {
        let level = min(1, max(0, fraction))
        let brightness = minBrightness + (1 - minBrightness) * level
        if hz < lowsCeilingHz {
            return (greenHue + (hotHue - greenHue) * level, saturation, brightness)
        }
        let span = log(hz / lowsCeilingHz) / log(RTALayout.maxHz / lowsCeilingHz)
        let t = min(1, max(0, span))
        return (cyanHue + (blueHue - cyanHue) * t, saturation, brightness)
    }
}
