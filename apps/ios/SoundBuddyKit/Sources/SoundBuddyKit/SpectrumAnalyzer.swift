import Accelerate
import Foundation

/// Accelerate port of the Mac engine's 7-band energy
/// (packages/audio-engine/scripts/spectrum.py), one analysis frame at a time.
///
/// Per frame: periodic Hann window -> real FFT -> per-bin power scaled to
/// numpy's unnormalized rfft -> mean power over each band's bins (edges
/// inclusive, like compute_band_energy) -> dB with spectrum.py's silence
/// floor. SpectrumParityTests pins this against a spectrum.py golden fixture.
///
/// TODO(parity): spectrum.py averages power over a centered, zero-padded STFT
/// (HOP = N_FFT/4) and also reduces to a 48-point log grid (curve_from_power).
/// Port both, with fixtures from make_spectrum_parity_fixture.py, before any
/// grade or match score is computed on the phone.
/// `analyze` also reduces the same power spectrum to the display-only RTA grid
/// (RTALayout) in dBFS, and to a single broadband overall level; coaching
/// keeps using the 7 bands.
///
/// TODO(calibration): phone-mic dB is uncalibrated — levels are relative, so
/// the UI must keep the "phone mic estimate" cue.
public final class SpectrumAnalyzer {
    public enum ConfigurationError: Error, Equatable, LocalizedError {
        case fftSizeNotPowerOfTwo(Int)
        case frameLengthMismatch(expected: Int, got: Int)
        case invalidSampleRate(Double)

        public var errorDescription: String? {
            switch self {
            case .fftSizeNotPowerOfTwo(let size):
                "FFT size \(size) is not a power of two — use 1024, 2048, 4096 (default), or 8192."
            case .frameLengthMismatch(let expected, let got):
                "Got a \(got)-sample frame but the analyzer expects \(expected) — read exactly fftSize samples from the ring buffer."
            case .invalidSampleRate(let rate):
                "Input sample rate \(rate) Hz is unusable — pass the audio input's real sample rate (for example 48000)."
            }
        }
    }

    /// Same as spectrum.py N_FFT.
    public static let defaultFFTSize = 4096
    /// Same as spectrum.py SILENCE_FLOOR_DB.
    public static let silenceFloorDb = -120.0
    /// amplitude_to_db's clamp (max(rms, 1e-10)).
    private static let minimumAmplitude = 1e-10
    /// vDSP's real FFT returns 2x numpy's unnormalized rfft.
    private static let vDSPRealFFTScale: Float = 2
    /// spectrum.py classify_chunk's `total = sum(power) + 1e-12`.
    private static let fractionEpsilon = 1e-12
    /// spectrum.py classify_chunk: `band_frac(20, 120)` — deep low end, common
    /// in music, rare in speech.
    private static let subLowHz = 20.0
    private static let subHighHz = 120.0
    /// spectrum.py classify_chunk: `band_frac(300, 3400)` — telephone/voice band.
    private static let speechBandLowHz = 300.0
    private static let speechBandHighHz = 3400.0
    /// spectrum.py classify_chunk: `band_frac(6000, 20000)` — air/cymbals, music.
    private static let airLowHz = 6000.0
    private static let airHighHz = 20000.0
    /// spectrum.py FLATNESS_AMIN — the power floor _spectral_flatness clamps to.
    private static let flatnessAmin = 1e-10

    public let fftSize: Int
    public let sampleRate: Double
    private let fft: vDSP.FFT<DSPSplitComplex>
    private let window: [Float]
    private let bandBins: [Band: ClosedRange<Int>]
    private let rtaLayout: RTALayout
    /// Summed one-sided bin power of a full-scale sine (Parseval with the
    /// window's energy), so an RTA band holding a full-scale tone reads 0 dBFS.
    private let fullScaleSinePower: Double

    public init(
        fftSize: Int = SpectrumAnalyzer.defaultFFTSize,
        sampleRate: Double,
        rtaLayout: RTALayout = .standard
    ) throws {
        guard fftSize > 1, fftSize & (fftSize - 1) == 0 else {
            throw ConfigurationError.fftSizeNotPowerOfTwo(fftSize)
        }
        // A 0 Hz / NaN rate would make binHz 0 or NaN, and Int(bandHz / binHz)
        // below would trap instead of throwing.
        guard sampleRate.isFinite, sampleRate > 0 else {
            throw ConfigurationError.invalidSampleRate(sampleRate)
        }
        let log2n = vDSP_Length(fftSize.trailingZeroBitCount)
        guard let fft = vDSP.FFT(log2n: log2n, radix: .radix2, ofType: DSPSplitComplex.self) else {
            throw ConfigurationError.fftSizeNotPowerOfTwo(fftSize)
        }
        self.fftSize = fftSize
        self.sampleRate = sampleRate
        self.fft = fft
        // Periodic Hann, the exact formula spectrum.py's _stft_mag uses.
        window = (0..<fftSize).map { Float(0.5 - 0.5 * cos(2 * Double.pi * Double($0) / Double(fftSize))) }

        let binHz = sampleRate / Double(fftSize)
        let lastBin = fftSize / 2
        // Clamp in Double first: a tiny positive rate makes bandHz / binHz
        // overflow Int (or reach +inf), which would trap on conversion.
        let binLimit = Double(lastBin + 1)
        var bins: [Band: ClosedRange<Int>] = [:]
        for band in Band.allCases {
            let lo = Int(min(binLimit, (band.lowHz / binHz).rounded(.up)))
            let hi = min(lastBin, Int(min(binLimit, (band.highHz / binHz).rounded(.down))))
            if lo <= hi { bins[band] = lo...hi }
        }
        bandBins = bins
        self.rtaLayout = rtaLayout
        let windowEnergy = window.reduce(0.0) { $0 + Double($1) * Double($1) }
        fullScaleSinePower = Double(fftSize) * windowEnergy / 4
    }

    /// Per-bin power for bins 0...fftSize/2, on numpy's rfft scale.
    public func powerSpectrum(_ frame: [Float]) throws -> [Float] {
        guard frame.count == fftSize else {
            throw ConfigurationError.frameLengthMismatch(expected: fftSize, got: frame.count)
        }
        let half = fftSize / 2
        let windowed = vDSP.multiply(frame, window)
        var real = [Float](repeating: 0, count: half)
        var imag = [Float](repeating: 0, count: half)
        var power = [Float](repeating: 0, count: half + 1)
        let scale = Self.vDSPRealFFTScale

        real.withUnsafeMutableBufferPointer { realPtr in
            imag.withUnsafeMutableBufferPointer { imagPtr in
                var split = DSPSplitComplex(realp: realPtr.baseAddress!, imagp: imagPtr.baseAddress!)
                windowed.withUnsafeBytes { raw in
                    vDSP_ctoz(raw.bindMemory(to: DSPComplex.self).baseAddress!, 2, &split, 1, vDSP_Length(half))
                }
                fft.forward(input: split, output: &split)
                // Packed format: realp[0] = DC, imagp[0] = Nyquist.
                power[0] = pow(realPtr[0] / scale, 2)
                power[half] = pow(imagPtr[0] / scale, 2)
                for k in 1..<half {
                    power[k] = (realPtr[k] * realPtr[k] + imagPtr[k] * imagPtr[k]) / (scale * scale)
                }
            }
        }
        return power
    }

    /// 7-band energy (dB) for one frame of exactly `fftSize` samples.
    public func bandLevels(_ frame: [Float]) throws -> BandLevels {
        try bandLevels(power: powerSpectrum(frame))
    }

    /// One FFT, both reductions: 7-band levels for the coach and the RTA grid
    /// for the display, plus the broadband overall level and the program
    /// (speech/music) features (#1690).
    public func analyze(_ frame: [Float]) throws -> SpectrumReading {
        let power = try powerSpectrum(frame)
        let overallDb = overallLevel(power: power)
        return SpectrumReading(
            bands: bandLevels(power: power),
            rtaDb: rtaLevels(power: power),
            overallDb: overallDb,
            programFeatures: programFeatures(power: power, overallDb: overallDb)
        )
    }

    /// Broadband level in dBFS: summed one-sided power of bins 1...fftSize/2
    /// (DC excluded, so a mic offset never reads as level) over a full-scale
    /// sine's summed power — the RTA's convention, so a full-scale tone reads
    /// 0 dBFS here and in its RTA band.
    func overallLevel(power: [Float]) -> Double {
        let total = power[1...].reduce(0.0) { $0 + Double($1) }
        return Self.powerToDb(total / fullScaleSinePower)
    }

    /// Per-RTA-band level in dBFS: summed power of the bins inside the band.
    /// A low band narrower than one bin reads the power interpolated at its
    /// center, scaled to its width, so adjacent low bars ramp instead of
    /// repeating one bin. Bands above Nyquist read the silence floor.
    func rtaLevels(power: [Float]) -> [Double] {
        let binHz = sampleRate / Double(fftSize)
        let lastBin = fftSize / 2
        let nyquist = sampleRate / 2
        return rtaLayout.bands.map { band in
            guard band.lowHz < nyquist else { return Self.silenceFloorDb }
            let lo = Int((band.lowHz / binHz).rounded(.up))
            let hi = min(lastBin, Int((band.highHz / binHz).rounded(.up)) - 1)
            let bandPower: Double
            if lo <= hi {
                bandPower = (lo...hi).reduce(0.0) { $0 + Double(power[$1]) }
            } else {
                let position = band.centerHz / binHz
                let k0 = min(lastBin, Int(position))
                let k1 = min(lastBin, k0 + 1)
                let t = position - Double(k0)
                let density = Double(power[k0]) * (1 - t) + Double(power[k1]) * t
                bandPower = density * (band.highHz - band.lowHz) / binHz
            }
            return Self.powerToDb(bandPower / fullScaleSinePower)
        }
    }

    /// Program (speech/music) features for one frame's power spectrum, fed to
    /// ProgramContentClassifier (#1690) — a Swift port of spectrum.py's
    /// classify_chunk inputs, computed on the same per-bin power used for the
    /// 7 coaching bands and the RTA.
    func programFeatures(power: [Float], overallDb: Double) -> ProgramFeatures {
        let binHz = sampleRate / Double(fftSize)
        let total = power.reduce(0.0) { $0 + Double($1) } + Self.fractionEpsilon

        func bandFraction(lowHz: Double, highHz: Double) -> Double {
            var sum = 0.0
            for bin in power.indices {
                let hz = Double(bin) * binHz
                guard hz >= lowHz, hz < highHz else { continue }
                sum += Double(power[bin])
            }
            return sum / total
        }

        var weightedHzSum = 0.0
        var magnitudeSum = 0.0
        var logPowerSum = 0.0
        var clampedPowerSum = 0.0
        for bin in power.indices {
            let hz = Double(bin) * binHz
            let magnitude = Double(power[bin]).squareRoot()
            weightedHzSum += hz * magnitude
            magnitudeSum += magnitude

            let clampedPower = max(Self.flatnessAmin, Double(power[bin]))
            logPowerSum += log(clampedPower)
            clampedPowerSum += clampedPower
        }
        let centroidHz = magnitudeSum > 0 ? weightedHzSum / magnitudeSum : 0
        let binCount = Double(power.count)
        let flatness = exp(logPowerSum / binCount) / (clampedPowerSum / binCount)

        return ProgramFeatures(
            speechBandFraction: bandFraction(lowHz: Self.speechBandLowHz, highHz: Self.speechBandHighHz),
            subFraction: bandFraction(lowHz: Self.subLowHz, highHz: Self.subHighHz),
            airFraction: bandFraction(lowHz: Self.airLowHz, highHz: Self.airHighHz),
            centroidHz: centroidHz,
            flatness: flatness,
            levelDb: overallDb
        )
    }

    private func bandLevels(power: [Float]) -> BandLevels {
        var db: [Band: Double] = [:]
        for band in Band.allCases {
            guard let bins = bandBins[band] else {
                db[band] = Self.silenceFloorDb
                continue
            }
            let meanPower = bins.reduce(0.0) { $0 + Double(power[$1]) } / Double(bins.count)
            db[band] = Self.amplitudeToDb(meanPower.squareRoot())
        }
        return BandLevels(db: db)
    }

    /// Power ratio to dB, sharing amplitudeToDb's floor and clamp.
    static func powerToDb(_ ratio: Double) -> Double {
        amplitudeToDb(ratio.squareRoot())
    }

    /// spectrum.py amplitude_to_db.
    static func amplitudeToDb(_ rms: Double) -> Double {
        rms <= 0 ? silenceFloorDb : 20 * log10(max(rms, minimumAmplitude))
    }
}

/// One analysis frame's output: the 7 coaching bands, the display RTA, and
/// the broadband overall level.
public struct SpectrumReading: Equatable, Sendable {
    public var bands: BandLevels
    /// dBFS per RTALayout band, low to high.
    public var rtaDb: [Double]
    /// Broadband level of the frame in dBFS (see SpectrumAnalyzer.overallLevel).
    public var overallDb: Double
    /// Speech/music program features for this frame (#1690); nil for readings
    /// built without them (e.g. existing call sites and tests).
    public var programFeatures: ProgramFeatures?

    public init(
        bands: BandLevels,
        rtaDb: [Double],
        overallDb: Double = SpectrumAnalyzer.silenceFloorDb,
        programFeatures: ProgramFeatures? = nil
    ) {
        self.bands = bands
        self.rtaDb = rtaDb
        self.overallDb = overallDb
        self.programFeatures = programFeatures
    }
}

/// Program-content features for one analysis frame, fed to
/// ProgramContentClassifier (#1690) — a Swift port of the inputs spectrum.py's
/// classify_chunk uses to tell speech from music.
public struct ProgramFeatures: Equatable, Sendable {
    /// Fraction of total bin power in the 300-3400 Hz telephone/voice band.
    public var speechBandFraction: Double
    /// Fraction of total bin power in the 20-120 Hz deep-bass band.
    public var subFraction: Double
    /// Fraction of total bin power in the 6-20 kHz air/cymbals band.
    public var airFraction: Double
    /// Magnitude-weighted mean frequency (Hz) — spectrum.py's spectral centroid.
    public var centroidHz: Double
    /// Geometric-to-arithmetic mean power ratio, 0...1 — spectral flatness.
    public var flatness: Double
    /// The frame's broadband level in dBFS (same scale as SpectrumReading.overallDb).
    public var levelDb: Double

    public init(
        speechBandFraction: Double,
        subFraction: Double,
        airFraction: Double,
        centroidHz: Double,
        flatness: Double,
        levelDb: Double
    ) {
        self.speechBandFraction = speechBandFraction
        self.subFraction = subFraction
        self.airFraction = airFraction
        self.centroidHz = centroidHz
        self.flatness = flatness
        self.levelDb = levelDb
    }
}
