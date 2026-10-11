import Foundation

/// One digital biquad section's coefficients, direct form, b/a as in the RBJ
/// Audio EQ Cookbook. A first-order section sets b2 = a2 = 0.
private struct Biquad {
    var b0, b1, b2, a0, a1, a2: Double

    /// |H(e^jw)| in dB at `hz`, w = 2*pi*hz/sampleRateHz, evaluated as the
    /// ratio of the numerator and denominator complex sums rather than via a
    /// shared normalization, so a section that was never normalized to a0 = 1
    /// (see `firstOrderHighPass`) still evaluates correctly.
    func magnitudeDb(atHz hz: Double, sampleRateHz: Double) -> Double {
        let w = 2 * Double.pi * hz / sampleRateHz
        let cosW = cos(w)
        let sinW = sin(w)
        let cos2W = cos(2 * w)
        let sin2W = sin(2 * w)

        let numReal = b0 + b1 * cosW + b2 * cos2W
        let numImag = -(b1 * sinW + b2 * sin2W)
        let denReal = a0 + a1 * cosW + a2 * cos2W
        let denImag = -(a1 * sinW + a2 * sin2W)

        let numMagnitude = (numReal * numReal + numImag * numImag).squareRoot()
        let denMagnitude = (denReal * denReal + denImag * denImag).squareRoot()
        guard denMagnitude > 0 else { return 0 }
        return 20 * log10(numMagnitude / denMagnitude)
    }
}

/// Magnitude-response curve for a ConsoleEQ: RBJ biquad coefficients per EQ
/// band plus a Butterworth high-pass for the preamp HPF, evaluated at the
/// console's own sample rate and summed in dB. RBJ Audio EQ Cookbook
/// formulas; see https://www.w3.org/>2011/audio/audio-eq-cookbook.html.
extension ConsoleEQ {
    /// Fixed Q for the approximated LCut/HCut band types below — Butterworth
    /// (maximally flat), 1/sqrt(2). The console's own Q and gain controls are
    /// ignored for these two types; see the design doc's open question.
    private static let butterworthQ = 1 / 2.0.squareRoot()

    /// Biquad Q for the second HPF section of an 18 dB/octave Butterworth
    /// high-pass (the cascade's one second-order section).
    private static let butterworth18DbBiquadQ = 1.0
    /// Biquad Qs for the two sections of a 24 dB/octave (4th-order)
    /// Butterworth high-pass.
    private static let butterworth24DbQ1 = 0.54120
    private static let butterworth24DbQ2 = 1.30656

    private static func rbjPeaking(freqHz: Double, gainDb: Double, q: Double, sampleRateHz: Double) -> Biquad {
        let w0 = 2 * Double.pi * freqHz / sampleRateHz
        let alpha = sin(w0) / (2 * q)
        let a = pow(10, gainDb / 40)
        let cosW0 = cos(w0)
        return Biquad(
            b0: 1 + alpha * a, b1: -2 * cosW0, b2: 1 - alpha * a,
            a0: 1 + alpha / a, a1: -2 * cosW0, a2: 1 - alpha / a
        )
    }

    /// RBJ low shelf. The console's band Q is used as the cookbook Q
    /// (approximation — see the design doc's open question).
    private static func rbjLowShelf(freqHz: Double, gainDb: Double, q: Double, sampleRateHz: Double) -> Biquad {
        let w0 = 2 * Double.pi * freqHz / sampleRateHz
        let a = pow(10, gainDb / 40)
        let alpha = sin(w0) / (2 * q)
        let cosW0 = cos(w0)
        let sqrtA = a.squareRoot()
        return Biquad(
            b0: a * ((a + 1) - (a - 1) * cosW0 + 2 * sqrtA * alpha),
            b1: 2 * a * ((a - 1) - (a + 1) * cosW0),
            b2: a * ((a + 1) - (a - 1) * cosW0 - 2 * sqrtA * alpha),
            a0: (a + 1) + (a - 1) * cosW0 + 2 * sqrtA * alpha,
            a1: -2 * ((a - 1) + (a + 1) * cosW0),
            a2: (a + 1) + (a - 1) * cosW0 - 2 * sqrtA * alpha
        )
    }

    /// RBJ high shelf. The console's band Q is used as the cookbook Q
    /// (approximation — see the design doc's open question).
    private static func rbjHighShelf(freqHz: Double, gainDb: Double, q: Double, sampleRateHz: Double) -> Biquad {
        let w0 = 2 * Double.pi * freqHz / sampleRateHz
        let a = pow(10, gainDb / 40)
        let alpha = sin(w0) / (2 * q)
        let cosW0 = cos(w0)
        let sqrtA = a.squareRoot()
        return Biquad(
            b0: a * ((a + 1) + (a - 1) * cosW0 + 2 * sqrtA * alpha),
            b1: -2 * a * ((a - 1) + (a + 1) * cosW0),
            b2: a * ((a + 1) + (a - 1) * cosW0 - 2 * sqrtA * alpha),
            a0: (a + 1) - (a - 1) * cosW0 + 2 * sqrtA * alpha,
            a1: 2 * ((a - 1) - (a + 1) * cosW0),
            a2: (a + 1) - (a - 1) * cosW0 - 2 * sqrtA * alpha
        )
    }

    private static func rbjHighPass(freqHz: Double, q: Double, sampleRateHz: Double) -> Biquad {
        let w0 = 2 * Double.pi * freqHz / sampleRateHz
        let alpha = sin(w0) / (2 * q)
        let cosW0 = cos(w0)
        return Biquad(
            b0: (1 + cosW0) / 2, b1: -(1 + cosW0), b2: (1 + cosW0) / 2,
            a0: 1 + alpha, a1: -2 * cosW0, a2: 1 - alpha
        )
    }

    private static func rbjLowPass(freqHz: Double, q: Double, sampleRateHz: Double) -> Biquad {
        let w0 = 2 * Double.pi * freqHz / sampleRateHz
        let alpha = sin(w0) / (2 * q)
        let cosW0 = cos(w0)
        return Biquad(
            b0: (1 - cosW0) / 2, b1: 1 - cosW0, b2: (1 - cosW0) / 2,
            a0: 1 + alpha, a1: -2 * cosW0, a2: 1 - alpha
        )
    }

    /// First-order bilinear high-pass section, the odd-order leftover in an
    /// 18 dB/octave (3rd-order) Butterworth cascade. K = tan(pi*f/fs).
    private static func firstOrderHighPass(freqHz: Double, sampleRateHz: Double) -> Biquad {
        let k = tan(Double.pi * freqHz / sampleRateHz)
        let b0 = 1 / (1 + k)
        return Biquad(b0: b0, b1: -b0, b2: 0, a0: 1, a1: (k - 1) / (k + 1), a2: 0)
    }

    private static func biquad(for band: ConsoleEQBand, sampleRateHz: Double) -> Biquad {
        switch band.type {
        case .peaking, .vintagePeaking:
            // VEQ is drawn identically to PEQ -- an approximation, see the
            // design doc's open question.
            return rbjPeaking(freqHz: band.freqHz, gainDb: band.gainDb, q: band.q, sampleRateHz: sampleRateHz)
        case .lowShelf:
            return rbjLowShelf(freqHz: band.freqHz, gainDb: band.gainDb, q: band.q, sampleRateHz: sampleRateHz)
        case .highShelf:
            return rbjHighShelf(freqHz: band.freqHz, gainDb: band.gainDb, q: band.q, sampleRateHz: sampleRateHz)
        case .lowCut:
            // Fixed Butterworth Q; the console's own Q and gain are ignored.
            return rbjHighPass(freqHz: band.freqHz, q: butterworthQ, sampleRateHz: sampleRateHz)
        case .highCut:
            // Fixed Butterworth Q; the console's own Q and gain are ignored.
            return rbjLowPass(freqHz: band.freqHz, q: butterworthQ, sampleRateHz: sampleRateHz)
        }
    }

    /// The HPF's cascade of sections for its slope. An unsupported slope
    /// (only reachable by constructing a `ConsoleHPF` directly, never via
    /// `apply(nodeLine:)`) contributes no filtering rather than crashing.
    private static func hpfSections(freqHz: Double, slopeDbPerOctave: Int, sampleRateHz: Double) -> [Biquad] {
        switch slopeDbPerOctave {
        case 12:
            return [rbjHighPass(freqHz: freqHz, q: butterworthQ, sampleRateHz: sampleRateHz)]
        case 18:
            return [
                firstOrderHighPass(freqHz: freqHz, sampleRateHz: sampleRateHz),
                rbjHighPass(freqHz: freqHz, q: butterworth18DbBiquadQ, sampleRateHz: sampleRateHz),
            ]
        case 24:
            return [
                rbjHighPass(freqHz: freqHz, q: butterworth24DbQ1, sampleRateHz: sampleRateHz),
                rbjHighPass(freqHz: freqHz, q: butterworth24DbQ2, sampleRateHz: sampleRateHz),
            ]
        default:
            return []
        }
    }

    /// Summed dB magnitude response at each frequency. EQ bands contribute
    /// only when `on`. The HPF contributes only when `hpf?.on == true`; it
    /// sits in the preamp, independent of EQ on.
    public func magnitudeResponseDb(
        atHz frequencies: [Double],
        sampleRateHz: Double = ConsoleEQ.consoleSampleRateHz
    ) -> [Double] {
        var sections: [Biquad] = []
        if on {
            sections.append(contentsOf: bands.map { ConsoleEQ.biquad(for: $0, sampleRateHz: sampleRateHz) })
        }
        if let hpf, hpf.on {
            sections.append(contentsOf: ConsoleEQ.hpfSections(
                freqHz: hpf.freqHz, slopeDbPerOctave: hpf.slopeDbPerOctave, sampleRateHz: sampleRateHz
            ))
        }
        return frequencies.map { hz in
            sections.reduce(0.0) { $0 + $1.magnitudeDb(atHz: hz, sampleRateHz: sampleRateHz) }
        }
    }

    /// Same, sampled on `layout.bands`' center frequencies (the RTA axis).
    public func magnitudeResponseDb(on layout: RTALayout = .standard) -> [Double] {
        magnitudeResponseDb(atHz: layout.bands.map(\.centerHz))
    }
}
