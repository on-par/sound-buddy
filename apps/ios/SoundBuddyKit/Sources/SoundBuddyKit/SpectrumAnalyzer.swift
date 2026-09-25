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
/// TODO(calibration): phone-mic dB is uncalibrated — levels are relative, so
/// the UI must keep the "phone mic estimate" cue.
public final class SpectrumAnalyzer {
    public enum ConfigurationError: Error, Equatable, LocalizedError {
        case fftSizeNotPowerOfTwo(Int)
        case frameLengthMismatch(expected: Int, got: Int)

        public var errorDescription: String? {
            switch self {
            case .fftSizeNotPowerOfTwo(let size):
                "FFT size \(size) is not a power of two — use 1024, 2048, 4096 (default), or 8192."
            case .frameLengthMismatch(let expected, let got):
                "Got a \(got)-sample frame but the analyzer expects \(expected) — read exactly fftSize samples from the ring buffer."
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

    public let fftSize: Int
    public let sampleRate: Double
    private let fft: vDSP.FFT<DSPSplitComplex>
    private let window: [Float]
    private let bandBins: [Band: ClosedRange<Int>]

    public init(fftSize: Int = SpectrumAnalyzer.defaultFFTSize, sampleRate: Double) throws {
        guard fftSize > 1, fftSize & (fftSize - 1) == 0 else {
            throw ConfigurationError.fftSizeNotPowerOfTwo(fftSize)
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
        var bins: [Band: ClosedRange<Int>] = [:]
        for band in Band.allCases {
            let lo = Int((band.lowHz / binHz).rounded(.up))
            let hi = min(lastBin, Int((band.highHz / binHz).rounded(.down)))
            if lo <= hi { bins[band] = lo...hi }
        }
        bandBins = bins
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
        let power = try powerSpectrum(frame)
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

    /// spectrum.py amplitude_to_db.
    static func amplitudeToDb(_ rms: Double) -> Double {
        rms <= 0 ? silenceFloorDb : 20 * log10(max(rms, minimumAmplitude))
    }
}
