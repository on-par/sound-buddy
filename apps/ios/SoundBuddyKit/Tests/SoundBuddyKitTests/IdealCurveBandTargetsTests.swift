import Foundation
import Testing
@testable import SoundBuddyKit

/// Golden values from the Mac's `bandTargetsFromProfile`
/// (packages/audio-engine/src/profiles/index.ts), written by
/// apps/ios/scripts/make_band_targets_fixture.mjs. The TS side re-derives the
/// same file in CI (band-targets-fixture.test.ts), so a curve or reduction
/// change on either platform that skips the generator fails a suite (#1724).
private struct BandTargetsFixture: Decodable {
    struct BuiltIn: Decodable {
        let id: String
        let targets: [String: Double]
    }

    struct EdgeCase: Decodable {
        let name: String
        let freqs: [Double]
        /// null stands in for a non-finite offset (JSON has no NaN).
        let dbOffsets: [Double?]
        let targets: [String: Double]
    }

    let schemaVersion: Int
    let toleranceDb: Double
    let builtIn: [BuiltIn]
    let edgeCases: [EdgeCase]

    static func load() throws -> BandTargetsFixture {
        try JSONDecoder().decode(Self.self, from: Data(contentsOf: TestPaths.fixture("band-targets.v1.json")))
    }
}

private func expectMatches(
    _ actual: [Band: Double],
    _ expected: [String: Double],
    tolerance: Double,
    _ context: String,
    sourceLocation: SourceLocation = #_sourceLocation
) {
    #expect(Set(expected.keys) == Set(Band.allCases.map(\.rawValue)), "\(context): fixture covers every band", sourceLocation: sourceLocation)
    for band in Band.allCases {
        guard let want = expected[band.rawValue], let got = actual[band] else {
            Issue.record("\(context): missing \(band.rawValue)", sourceLocation: sourceLocation)
            continue
        }
        #expect(abs(got - want) <= tolerance, "\(context) \(band.rawValue): Swift \(got) vs Mac \(want)", sourceLocation: sourceLocation)
    }
}

@Suite struct IdealCurveBandTargetsTests {
    @Test func fixtureCoversEveryBundledCurve() throws {
        let fixture = try BandTargetsFixture.load()
        #expect(fixture.schemaVersion == 1)
        #expect(fixture.toleranceDb == 0.01)
        #expect(fixture.builtIn.map(\.id) == IdealCurveLibrary.builtInIds)
    }

    @Test(arguments: IdealCurveLibrary.builtInIds)
    func builtInCurveMatchesTheMacReduction(id: String) throws {
        let fixture = try BandTargetsFixture.load()
        let golden = try #require(fixture.builtIn.first { $0.id == id })
        let curve = try IdealCurveLibrary.builtIn(id: id)
        expectMatches(curve.bandTargets, golden.targets, tolerance: fixture.toleranceDb, id)
    }

    @Test func flatCurveTargetsAreAllZero() throws {
        for curve in [IdealCurve.flat, try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.flatId)] {
            #expect(curve.bandTargets.count == Band.allCases.count)
            #expect(curve.bandTargets.values.allSatisfy { $0 == 0 })
        }
    }

    @Test func edgeCasesMatchTheMacReduction() throws {
        let fixture = try BandTargetsFixture.load()
        #expect(fixture.edgeCases.count >= 5)
        for edge in fixture.edgeCases {
            let curve = IdealCurve(
                id: edge.name, label: edge.name, description: "",
                freqs: edge.freqs,
                dbOffsets: edge.dbOffsets.map { $0 ?? .nan }
            )
            expectMatches(curve.bandTargets, edge.targets, tolerance: fixture.toleranceDb, edge.name)
        }
    }

    @Test func mismatchedLengthsAreTreatedAsFlat() {
        let curve = IdealCurve(id: "m", label: "M", description: "", freqs: [100, 1000], dbOffsets: [3])
        #expect(curve.bandTargets.values.allSatisfy { $0 == 0 })
        #expect(curve.bandTargets.count == Band.allCases.count)
    }

    @Test func aConstantCurveGivesThatConstantInEveryBand() {
        let curve = IdealCurve(
            id: "c", label: "C", description: "",
            freqs: IdealCurve.gridFreqs,
            dbOffsets: Array(repeating: 4, count: IdealCurve.gridPoints)
        )
        for band in Band.allCases {
            #expect(abs(curve.bandTargets[band]! - 4) < 1e-9)
        }
    }

    /// The reduction is a power mean over uniform-Hz samples, not a dB mean of
    /// the log-spaced grid points. On worship-service, sub-bass (20-60 Hz)
    /// has grid points of 3 dB at the low edge and 18 dB near 60 Hz: the old
    /// grid-point mean (about 11.6 dB) leans on the low edge, while the Mac's
    /// uniform-Hz power mean lands at about 16.1 dB.
    @Test func subBassIsWeightedUniformlyInHzNotTowardItsLowEdge() throws {
        let curve = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        let gridPointsInBand = zip(curve.freqs, curve.dbOffsets).filter { Band.containing(hz: $0.0) == .subBass }.map(\.1)
        let oldGridMean = gridPointsInBand.reduce(0, +) / Double(gridPointsInBand.count)
        let target = try #require(curve.bandTargets[.subBass])
        #expect(abs(target - 16.107808) < 0.01)
        #expect(target - oldGridMean > 4, "the old grid-point mean (\(oldGridMean)) leans toward the quieter low edge")
    }
}
