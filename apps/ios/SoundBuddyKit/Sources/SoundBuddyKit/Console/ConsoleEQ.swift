import Foundation

/// X32/M32 EQ band type, raw enum order as the console reports it on
/// `/ch/[01..32]/eq/[1..4]/type` (Behringer X32/M32 unofficial OSC protocol
/// doc, Patrick-Gilles Maillot).
public enum ConsoleEQBandType: Int, CaseIterable, Equatable, Sendable {
    case lowCut = 0, lowShelf, peaking, vintagePeaking, highShelf, highCut

    /// The `/node` text token: "LCut", "LShv", "PEQ", "VEQ", "HShv", "HCut".
    public var nodeToken: String {
        switch self {
        case .lowCut: return "LCut"
        case .lowShelf: return "LShv"
        case .peaking: return "PEQ"
        case .vintagePeaking: return "VEQ"
        case .highShelf: return "HShv"
        case .highCut: return "HCut"
        }
    }

    /// Exact, case-sensitive match on `nodeToken`; `nil` for anything else.
    public init?(nodeToken: String) {
        guard let match = ConsoleEQBandType.allCases.first(where: { $0.nodeToken == nodeToken }) else {
            return nil
        }
        self = match
    }
}

/// One parametric EQ band in engineering units (Hz / dB / unitless Q), as the
/// console's `/node` text line reports it — never the raw 0...1 float.
public struct ConsoleEQBand: Equatable, Sendable {
    public var type: ConsoleEQBandType
    public var freqHz: Double
    public var gainDb: Double
    public var q: Double

    public init(type: ConsoleEQBandType, freqHz: Double, gainDb: Double, q: Double) {
        self.type = type
        self.freqHz = freqHz
        self.gainDb = gainDb
        self.q = q
    }

    /// PEQ, 1000 Hz, 0 dB, Q 2.0 — contributes nothing to the curve.
    public static let flat = ConsoleEQBand(type: .peaking, freqHz: 1000, gainDb: 0, q: 2.0)
}

/// The input channel preamp's high-pass filter, in engineering units.
public struct ConsoleHPF: Equatable, Sendable {
    /// `/ch/[01..32]/preamp/hpslope` enum: 12/18/24 dB/octave.
    public static let supportedSlopes: [Int] = [12, 18, 24]

    public var on: Bool
    public var slopeDbPerOctave: Int
    public var freqHz: Double

    public init(on: Bool, slopeDbPerOctave: Int, freqHz: Double) {
        self.on = on
        self.slopeDbPerOctave = slopeDbPerOctave
        self.freqHz = freqHz
    }

    public static let off = ConsoleHPF(on: false, slopeDbPerOctave: 12, freqHz: 20)
}

/// What a `ConsoleEQ` describes: an input channel's EQ (4 bands + preamp HPF)
/// or Main LR's EQ (6 bands, no HPF — `/main/st/eq`).
public enum ConsoleEQTarget: Hashable, Sendable {
    case channel(Int) // 1...32, the OSC path number
    case mainLR

    public static let channelBandCount = 4
    public static let mainLRBandCount = 6

    private static let channelIndexWidth = 2

    public var bandCount: Int {
        switch self {
        case .channel: return ConsoleEQTarget.channelBandCount
        case .mainLR: return ConsoleEQTarget.mainLRBandCount
        }
    }

    public var eqPath: String {
        switch self {
        case .channel(let index):
            return "/ch/\(String(format: "%0\(ConsoleEQTarget.channelIndexWidth)d", index))/eq"
        case .mainLR:
            return "/main/st/eq"
        }
    }

    public var preampPath: String? {
        switch self {
        case .channel(let index):
            return "/ch/\(String(format: "%0\(ConsoleEQTarget.channelIndexWidth)d", index))/preamp"
        case .mainLR:
            return nil
        }
    }

    /// The `/node` scribble-strip config path: `/ch/NN/config` or
    /// `/main/st/config`.
    public var configPath: String {
        switch self {
        case .channel(let index):
            return "/ch/\(String(format: "%0\(ConsoleEQTarget.channelIndexWidth)d", index))/config"
        case .mainLR:
            return "/main/st/config"
        }
    }
}

/// A console channel's or Main LR's EQ, in engineering units.
public struct ConsoleEQ: Equatable, Sendable {
    public static let consoleSampleRateHz = 48_000.0

    public let target: ConsoleEQTarget
    public var on: Bool
    public var bands: [ConsoleEQBand]
    public var hpf: ConsoleHPF?

    public init(target: ConsoleEQTarget, on: Bool, bands: [ConsoleEQBand], hpf: ConsoleHPF?) {
        self.target = target
        self.on = on
        self.bands = bands
        self.hpf = hpf
    }

    /// `on` false, `target.bandCount` flat bands, HPF off for a channel / no
    /// HPF for Main LR — the seed `ConsoleEQ.parse(nodeLines:for:)` folds
    /// `/node` lines into.
    public static func flat(for target: ConsoleEQTarget) -> ConsoleEQ {
        let hpf: ConsoleHPF?
        switch target {
        case .channel: hpf = .off
        case .mainLR: hpf = nil
        }
        return ConsoleEQ(
            target: target,
            on: false,
            bands: Array(repeating: ConsoleEQBand.flat, count: target.bandCount),
            hpf: hpf
        )
    }
}

/// Port of the EQ/HPF raw-OSC-float <-> engineering-unit conversions in
/// packages/console/src/scaling.ts (`oscToEqFreqHz`, `oscToEqGainDb`,
/// `oscToEqQ`, `oscToHpfHz`; verified live on the M32R, #848), plus their
/// inverses. The inverses don't exist in scaling.ts — they're new here for a
/// later write path (ADR-0161) — so each one clamps to 0...1 and quantizes to
/// the console's step grid: a write must land on a value the console itself
/// can produce, never an arbitrary float the desk would silently round anyway.
public enum ConsoleEQScale {
    // Range constants, same values and names (translated to camelCase) as
    // scaling.ts, so a future range correction there is easy to cross-check
    // here.
    private static let eqFreqMinHz = 20.0
    private static let eqFreqSpanRatio = 1000.0
    private static let oscEqGainCenter = 0.5
    private static let eqGainRangeSpanDb = 30.0
    private static let eqQMax = 10.0
    private static let eqQDecayRatio = 0.03
    private static let hpfMinHz = 20.0
    private static let hpfSpanRatio = 20.0

    /// Frequency sweep step grid: logf 20 Hz..20 kHz, 201 steps (X32 OSC doc).
    public static let freqStepCount = 201
    /// Gain step grid: linf -15..+15 dB in 0.25 dB steps (X32 OSC doc).
    public static let gainStepDb = 0.25
    /// Q sweep step grid: logf 10..0.3, 72 steps (X32 OSC doc).
    public static let qStepCount = 72
    /// HPF sweep step grid: logf 20..400 Hz, 101 steps (X32 OSC doc).
    public static let hpfStepCount = 101

    public static let gainStepCount = Int((eqGainRangeSpanDb / gainStepDb).rounded()) + 1

    public static func freqHz(raw: Double) -> Double {
        eqFreqMinHz * pow(eqFreqSpanRatio, raw)
    }

    public static func gainDb(raw: Double) -> Double {
        (raw - oscEqGainCenter) * eqGainRangeSpanDb
    }

    public static func q(raw: Double) -> Double {
        eqQMax * pow(eqQDecayRatio, raw)
    }

    public static func hpfHz(raw: Double) -> Double {
        hpfMinHz * pow(hpfSpanRatio, raw)
    }

    /// `hz`'s raw position on the EQ frequency sweep, clamped and quantized.
    /// NaN or non-positive `hz` returns 0 (the bottom of the sweep) rather
    /// than propagating a NaN through `log`.
    public static func rawFreq(hz: Double) -> Double {
        guard !hz.isNaN, hz > 0 else { return 0 }
        return quantize(log(hz / eqFreqMinHz) / log(eqFreqSpanRatio), stepCount: freqStepCount)
    }

    /// `db`'s raw position on the EQ gain range, clamped and quantized. NaN
    /// returns 0.5 (flat) rather than propagating.
    public static func rawGain(db: Double) -> Double {
        guard !db.isNaN else { return 0.5 }
        return quantize(db / eqGainRangeSpanDb + oscEqGainCenter, stepCount: gainStepCount)
    }

    /// `q`'s raw position on the EQ Q sweep, clamped and quantized. NaN or
    /// non-positive `q` returns 0 (Q 10, the widest band) rather than
    /// propagating a NaN through `log`.
    public static func rawQ(_ q: Double) -> Double {
        guard !q.isNaN, q > 0 else { return 0 }
        return quantize(log(q / eqQMax) / log(eqQDecayRatio), stepCount: qStepCount)
    }

    /// `hz`'s raw position on the HPF sweep, clamped and quantized. NaN or
    /// non-positive `hz` returns 0 (the bottom of the sweep) rather than
    /// propagating a NaN through `log`.
    public static func rawHpf(hz: Double) -> Double {
        guard !hz.isNaN, hz > 0 else { return 0 }
        return quantize(log(hz / hpfMinHz) / log(hpfSpanRatio), stepCount: hpfStepCount)
    }

    /// Clamps `raw` to 0...1, then rounds to the nearest of `stepCount` evenly
    /// spaced raw values — the exact float a later armed write must send so
    /// the console doesn't silently re-round it to a different step.
    static func quantize(_ raw: Double, stepCount: Int) -> Double {
        let clamped = min(1, max(0, raw))
        let steps = Double(stepCount - 1)
        return (clamped * steps).rounded() / steps
    }
}
