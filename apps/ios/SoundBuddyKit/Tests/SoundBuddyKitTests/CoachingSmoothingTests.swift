import Foundation
import Testing
@testable import SoundBuddyKit

private let frameRate = 30.0
private let jitterDb = 3.0
private let meanTolerance = 0.1
private let maxSettledStepDb = 0.05
private let t0 = Date(timeIntervalSinceReferenceDate: 0)

/// Per-band means used by `jitterAroundAMeanConvergesToTheMean` and
/// `rtaPathReadsRawDeltasUnaffectedBySmoothing`, one per `Band.allCases` in order.
private let bandMeans: [Band: Double] = [
    .subBass: 4, .bass: 2, .lowMid: 0, .mid: -2, .highMid: -1, .presence: 1, .brilliance: -3,
]

/// A jittery frame of per-band deltas at `frameIndex`: each band sits at
/// `mean +/- jitterDb`, alternating sign every frame, with a per-band phase
/// offset (the band's position in `Band.allCases`) so the first frame sits
/// every band at an extreme (not all at the same extreme).
private func jitteryFrame(frameIndex: Int) -> [Band: Double] {
    Dictionary(uniqueKeysWithValues: Band.allCases.enumerated().map { offset, band in
        let sign = (frameIndex + offset).isMultiple(of: 2) ? 1.0 : -1.0
        return (band, bandMeans[band]! + sign * jitterDb)
    })
}

/// Feeds `smoother` a jittery frame (`jitteryFrame(frameIndex:)`) every
/// `1 / frameRate` seconds for `duration` seconds, starting at `t0`, and
/// returns every (rawFrame, smoothedOutput) pair in order.
private func run(
    _ smoother: inout CoachingDeltaSmoother,
    duration: TimeInterval,
    frameRate: Double
) -> [(raw: [Band: Double], smoothed: [Band: Double])] {
    let step = 1.0 / frameRate
    let frameCount = Int((duration * frameRate).rounded())
    var results: [(raw: [Band: Double], smoothed: [Band: Double])] = []
    for i in 0..<frameCount {
        let frame = jitteryFrame(frameIndex: i)
        let time = t0.addingTimeInterval(Double(i) * step)
        let smoothed = smoother.ingest(frame, at: time)
        results.append((raw: frame, smoothed: smoothed))
    }
    return results
}

/// A time-based exponential moving average per Band (#1697): callers drive
/// it with timestamped per-band deltas, and it returns deltas that converge
/// to the stream's mean without following frame-to-frame jitter. Every test
/// uses an injected clock stepped by hand — no wall-clock timing.
@Suite struct CoachingSmoothingTests {
    @Test func jitterAroundAMeanConvergesToTheMean() {
        var smoother = CoachingDeltaSmoother()
        let results = run(&smoother, duration: 30.0, frameRate: frameRate)

        let final = results.last!.smoothed
        for band in Band.allCases {
            let mean = bandMeans[band]!
            #expect(abs(final[band]! - mean) < meanTolerance, "\(band) should settle near its mean")
            #expect(final[band]! >= mean - jitterDb && final[band]! <= mean + jitterDb)
        }

        for frame in results {
            for band in Band.allCases {
                #expect(frame.smoothed[band]! >= bandMeans[band]! - jitterDb)
                #expect(frame.smoothed[band]! <= bandMeans[band]! + jitterDb)
            }
        }

        let lastTenSeconds = results.suffix(Int(10.0 * frameRate))
        var maxSmoothedStep = 0.0
        var maxRawStep = 0.0
        for (previous, current) in zip(lastTenSeconds, lastTenSeconds.dropFirst()) {
            for band in Band.allCases {
                maxSmoothedStep = max(maxSmoothedStep, abs(current.smoothed[band]! - previous.smoothed[band]!))
                maxRawStep = max(maxRawStep, abs(current.raw[band]! - previous.raw[band]!))
            }
        }
        #expect(maxSmoothedStep < maxSettledStepDb, "settled output should barely move frame to frame")
        #expect(abs(maxRawStep - 2 * jitterDb) < 1e-9, "raw input keeps swinging by the full 2x jitter")
    }

    @Test func frameRateIndependent() {
        var slow = CoachingDeltaSmoother()
        var fast = CoachingDeltaSmoother()
        let slowResults = run(&slow, duration: 30.0, frameRate: 30.0)
        let fastResults = run(&fast, duration: 30.0, frameRate: 60.0)

        let slowFinal = slowResults.last!.smoothed
        let fastFinal = fastResults.last!.smoothed
        for band in Band.allCases {
            let mean = bandMeans[band]!
            #expect(abs(slowFinal[band]! - mean) < meanTolerance)
            #expect(abs(fastFinal[band]! - mean) < meanTolerance)
            #expect(abs(slowFinal[band]! - fastFinal[band]!) < meanTolerance)
        }
    }

    @Test func firstSampleSeeds() {
        var smoother = CoachingDeltaSmoother()
        let input: [Band: Double] = [.subBass: 4.5, .mid: -1.5]
        let output = smoother.ingest(input, at: t0)
        #expect(output == input)
        #expect(smoother.smoothed == input)
    }

    @Test func smoothingFactorEdges() {
        #expect(CoachingDeltaSmoother.smoothingFactor(dt: 0) == 0)
        #expect(CoachingDeltaSmoother.smoothingFactor(dt: -1) == 0)

        let atTau = CoachingDeltaSmoother.smoothingFactor(dt: CoachingDeltaSmoother.timeConstantSeconds)
        #expect(abs(atTau - (1 - 1 / M_E)) < 1e-9)

        let atLargeDt = CoachingDeltaSmoother.smoothingFactor(dt: 20 * CoachingDeltaSmoother.timeConstantSeconds)
        #expect(atLargeDt < 1, "even a huge dt stays a true blend, never a hard snap")
        #expect(atLargeDt > 0.999999, "a dt many time constants out is effectively fully blended")

        #expect(abs(CoachingDeltaSmoother.timeConstantSeconds - CoachingDeltaSmoother.windowSeconds / 2) < 1e-9)
        #expect(abs(CoachingDeltaSmoother.windowSeconds - 10.0) < 1e-9)
    }

    @Test func repeatedOrBackwardsTimestampHolds() {
        var smoother = CoachingDeltaSmoother()
        _ = smoother.ingest([.mid: 0.0], at: t0)
        let afterSeed = smoother.smoothed

        let sameTime = smoother.ingest([.mid: 10.0], at: t0)
        #expect(sameTime == afterSeed, "a repeated timestamp blends nothing")

        let earlier = smoother.ingest([.mid: 10.0], at: t0.addingTimeInterval(-5))
        #expect(earlier == afterSeed, "a backwards timestamp blends nothing")

        let later = smoother.ingest([.mid: 10.0], at: t0.addingTimeInterval(CoachingDeltaSmoother.timeConstantSeconds))
        let expectedAlpha = 1 - 1 / M_E
        let expectedValue = 0.0 + expectedAlpha * (10.0 - 0.0)
        #expect(abs(later[.mid]! - expectedValue) < 1e-9, "the forward step blends from the latest forward time")
    }

    @Test func missingOrNonFiniteBandsHold() {
        var smoother = CoachingDeltaSmoother()
        _ = smoother.ingest([.mid: 0.0, .bass: 2.0], at: t0)

        let next = smoother.ingest([.bass: 4.0], at: t0.addingTimeInterval(1))
        #expect(next[.mid] == 0.0, "a band omitted from the input keeps its previous value")
        #expect(next[.bass]! > 2.0, "the present band still updates")

        let withNaN = smoother.ingest([.mid: .nan, .bass: 6.0], at: t0.addingTimeInterval(2))
        #expect(withNaN[.mid] == next[.mid], "a NaN value keeps the previous value")

        let withInfinity = smoother.ingest([.mid: .infinity, .bass: 8.0], at: t0.addingTimeInterval(3))
        #expect(withInfinity[.mid] == withNaN[.mid], "an infinite value keeps the previous value")

        var fresh = CoachingDeltaSmoother()
        let seededWithNaN = fresh.ingest([.presence: .nan], at: t0)
        #expect(seededWithNaN[.presence] == nil, "a non-finite value never seeds a band")
    }

    @Test func resetClearsState() {
        var smoother = CoachingDeltaSmoother()
        _ = smoother.ingest([.mid: 1.0], at: t0)
        #expect(!smoother.smoothed.isEmpty)

        smoother.reset()
        #expect(smoother.smoothed.isEmpty)

        let reseeded = smoother.ingest([.mid: 5.0], at: t0.addingTimeInterval(100))
        #expect(reseeded == [.mid: 5.0], "the next ingest seeds again after a reset")
    }

    @Test func rtaPathReadsRawDeltasUnaffectedBySmoothing() {
        let step = 1.0 / frameRate
        let frameCount = Int(10.0 * frameRate)
        let rawFrames: [[Double]] = (0..<frameCount).map { i in
            Band.allCases.enumerated().map { offset, band in
                let sign = (i + offset).isMultiple(of: 2) ? 1.0 : -1.0
                return bandMeans[band]! + sign * jitterDb
            }
        }
        let framesSnapshot = rawFrames

        var reference = RTAMeter()
        var alongside = RTAMeter()
        var smoother = CoachingDeltaSmoother()

        for (i, frame) in rawFrames.enumerated() {
            let previousLevels = reference.levels
            reference.ingest(frame, dt: i == 0 ? 0 : step)
            alongside.ingest(frame, dt: i == 0 ? 0 : step)
            let deltas = Dictionary(uniqueKeysWithValues: zip(Band.allCases, frame))
            let time = t0.addingTimeInterval(Double(i) * step)
            _ = smoother.ingest(deltas, at: time)

            #expect(alongside == reference, "the RTA path is identical whether or not a smoother runs alongside it")
            let rising = i == 0 || zip(frame, previousLevels).allSatisfy { raw, previous in raw >= previous }
            if rising {
                #expect(alongside.levels == frame, "a rising frame makes the RTA track the raw value exactly")
            }
        }

        #expect(rawFrames == framesSnapshot, "feeding the frames never mutates them")

        let lastFrame = rawFrames.last!
        let divergesByMoreThanOneDb = Band.allCases.enumerated().contains { offset, band in
            abs(smoother.smoothed[band]! - lastFrame[offset]) > 1.0
        }
        #expect(divergesByMoreThanOneDb, "the smoothed output really differs from the raw path")
    }
}
