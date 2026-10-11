import Foundation
@testable import SoundBuddyKit

/// Deterministic synthetic program material for the Speech + bed tests
/// (#1702), built directly as per-frame power spectra at the live meter's
/// ~20 Hz reading rate and turned into ProgramFeatures by the real
/// SpectrumAnalyzer feature code (`programFeatures(power:overallDb:)`), so
/// the classifier sees the same feature math as on device.
///
/// - Speech: a 140 Hz voice with formant-weighted harmonics (little energy
///   below 250 Hz), ~4 syllables per second and a phrase pause every 3.2 s.
/// - Pad: a sustained low chord (65-392 Hz) plus a quiet high shimmer.
/// - Quiet band: bass notes, a kick on every beat, keys and an 8th-note
///   hi-hat (6-14 kHz) at a low level.
/// No randomness: every value is a pure function of time.
struct SpeechBedSignals {
    static let readingsPerSecond = 20.0
    static let frameSeconds = 1 / readingsPerSecond

    enum Program {
        case pureSpeech
        case pureMusic
        case speechOverPad
        case speechOverQuietBand
    }

    let analyzer: SpectrumAnalyzer
    let fullScalePower: Double

    init() {
        analyzer = try! SpectrumAnalyzer(sampleRate: 48_000)
        let n = Double(analyzer.fftSize)
        // A Hann window's energy is 0.375 N, so a full-scale sine sums to N * 0.375 N / 4.
        fullScalePower = n * 0.375 * n / 4
    }

    /// One reading's features at `t` seconds into `program`.
    func features(_ program: Program, at t: Double) -> ProgramFeatures {
        let power = spectrum(program, at: t)
        return analyzer.programFeatures(power: power, overallDb: analyzer.overallLevel(power: power))
    }

    /// Feature stream for `seconds` of `program`, one per reading.
    func stream(_ program: Program, seconds: Double) -> [(time: Double, features: ProgramFeatures)] {
        let count = Int((seconds * Self.readingsPerSecond).rounded())
        return (0..<count).map { i in
            let t = Double(i) * Self.frameSeconds
            return (t, features(program, at: t))
        }
    }

    // MARK: Spectrum synthesis

    private func spectrum(_ program: Program, at t: Double) -> [Float] {
        var power = [Double](repeating: 0, count: analyzer.fftSize / 2 + 1)
        // A -100 dBFS-per-bin noise floor so flatness and silence behave like a real mic.
        let floor = fullScalePower * pow(10, -100 / 10)
        for i in power.indices { power[i] = floor }

        switch program {
        case .pureSpeech:
            addSpeech(&power, at: t, peakDb: -24)
        case .pureMusic:
            addBand(&power, at: t, levelDb: -22)
            addPad(&power, at: t, levelDb: -28)
        case .speechOverPad:
            addSpeech(&power, at: t, peakDb: -30)
            addPad(&power, at: t, levelDb: -46)
        case .speechOverQuietBand:
            addSpeech(&power, at: t, peakDb: -30)
            addBand(&power, at: t, levelDb: -44)
        }
        return power.map { Float($0) }
    }

    private func addSine(_ power: inout [Double], hz: Double, db: Double) {
        let binHz = analyzer.sampleRate / Double(analyzer.fftSize)
        let position = hz / binHz
        let k = Int(position.rounded())
        guard k > 0, k < power.count - 1 else { return }
        let p = fullScalePower * pow(10, db / 10)
        // Hann main lobe: most power in the center bin, a little either side.
        power[k] += p * 0.67
        power[k - 1] += p * 0.165
        power[k + 1] += p * 0.165
    }

    private func addNoise(_ power: inout [Double], lowHz: Double, highHz: Double, db: Double) {
        let binHz = analyzer.sampleRate / Double(analyzer.fftSize)
        let lo = max(1, Int(lowHz / binHz)), hi = min(power.count - 1, Int(highHz / binHz))
        guard hi > lo else { return }
        let perBin = fullScalePower * pow(10, db / 10) / Double(hi - lo + 1)
        for k in lo...hi { power[k] += perBin }
    }

    /// Syllable envelope in dB (0 = peak): ~4 syllables/s, phrase pause 0.6 s every 3.2 s.
    static func speechEnvelopeDb(at t: Double) -> Double? {
        let phrase = t.truncatingRemainder(dividingBy: 3.2)
        if phrase > 2.6 { return nil }
        let syllable = t.truncatingRemainder(dividingBy: 0.25)
        if syllable > 0.17 { return nil }
        // Syllables vary in strength, like real words.
        return -6 * (0.5 + 0.5 * sin(t * 5.3))
    }

    private func addSpeech(_ power: inout [Double], at t: Double, peakDb: Double) {
        guard let envelope = Self.speechEnvelopeDb(at: t) else { return }
        let f0 = 140 + 15 * sin(t * 1.9)
        var k = 1.0
        while k * f0 < 4_000 {
            let hz = k * f0
            // Formant-weighted voice: strong 500-3000 Hz, weak below 250 Hz.
            let formant = max(
                -30 * pow(log2(hz / 550), 2),
                -30 * pow(log2(hz / 1_500), 2),
                -30 * pow(log2(hz / 2_600), 2) - 4
            )
            let lowCut = hz < 250 ? -14.0 : 0
            addSine(&power, hz: hz, db: peakDb + envelope + max(formant, -40) + lowCut - 6)
            k += 1
        }
        // Breath/fricative noise.
        addNoise(&power, lowHz: 2_000, highHz: 7_000, db: peakDb + envelope - 22)
    }

    private func addPad(_ power: inout [Double], at t: Double, levelDb: Double) {
        let swell = 1.5 * sin(t * 0.4)
        for hz in [65.4, 98.0, 130.8, 196.0, 261.6, 392.0] {
            addSine(&power, hz: hz, db: levelDb + swell - 4)
        }
        addNoise(&power, lowHz: 7_000, highHz: 12_000, db: levelDb + swell - 14)
    }

    private func addBand(_ power: inout [Double], at t: Double, levelDb: Double) {
        let beat = t.truncatingRemainder(dividingBy: 0.5)
        let eighth = t.truncatingRemainder(dividingBy: 0.25)
        let bassHz = Int(t / 2).isMultiple(of: 2) ? 55.0 : 82.4
        addSine(&power, hz: bassHz, db: levelDb - 2)
        addSine(&power, hz: bassHz * 2, db: levelDb - 8)
        if beat < 0.08 { addNoise(&power, lowHz: 40, highHz: 110, db: levelDb + 1) }
        for hz in [261.6, 329.6, 392.0, 523.3] { addSine(&power, hz: hz, db: levelDb - 9) }
        if eighth < 0.06 { addNoise(&power, lowHz: 6_000, highHz: 14_000, db: levelDb - 6) }
        addNoise(&power, lowHz: 8_000, highHz: 16_000, db: levelDb - 16)
    }
}
