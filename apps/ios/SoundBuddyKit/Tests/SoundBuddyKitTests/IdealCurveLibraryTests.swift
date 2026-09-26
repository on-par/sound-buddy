import Foundation
import Testing
@testable import SoundBuddyKit

private let epsilon = 1e-9

/// The bundled ideal-curve.v1 JSON resources are a hand-synced copy of
/// packages/audio-engine/src/profiles/index.ts — these tests guard that the
/// bundle stays decodable and that the music-fullrange copy can't drift
/// unnoticed from the checked-in Contracts example.
@Suite struct IdealCurveLibraryTests {
    @Test(arguments: IdealCurveLibrary.builtInIds)
    func everyBuiltInIdDecodes(id: String) throws {
        let curve = try IdealCurveLibrary.builtIn(id: id)
        #expect(curve.id == id)
        #expect(curve.freqs.count == IdealCurve.gridPoints)
        #expect(curve.dbOffsets.count == IdealCurve.gridPoints)
    }

    @Test func bundledMusicFullRangeMatchesTheContractExample() throws {
        let bundled = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.musicFullRangeId)
        let example = try JSONDecoder().decode(
            IdealCurve.self,
            from: Data(contentsOf: TestPaths.contractExample("ideal-curve.v1.music-fullrange.json"))
        )
        #expect(bundled == example)
    }

    @Test func bundledFlatMatchesTheMacFlatProfile() throws {
        let bundled = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.flatId)
        #expect(bundled.id == IdealCurve.flat.id)
        #expect(bundled.label == IdealCurve.flat.label)
        #expect(bundled.dbOffsets.allSatisfy { $0 == 0 })
        for (a, b) in zip(bundled.freqs, IdealCurve.gridFreqs) {
            #expect(abs(a - b) < 0.01)
        }
    }

    @Test func worshipServiceMatchesTheMacProfile() throws {
        let curve = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        #expect(curve.label == "Worship service")
        #expect(curve.dbOffsets[0] == 3)
        #expect(curve.dbOffsets[5] == 18)
        #expect(curve.dbOffsets.last == -18)
    }

    @Test func anUnknownIdThrowsMissing() {
        #expect(throws: IdealCurveLibrary.LoadError.missing(id: "nope")) {
            try IdealCurveLibrary.builtIn(id: "nope")
        }
    }

    @Test func liveDefaultIsWorshipService() {
        #expect(IdealCurveLibrary.liveDefault().id == IdealCurveLibrary.worshipServiceId)
    }

    @Test func liveDefaultFallsBackToFlatWhenLoadingFails() {
        let target = IdealCurveLibrary.liveDefault { _ in throw IdealCurveLibrary.LoadError.missing(id: "x") }
        #expect(target == .flat)
    }
}
