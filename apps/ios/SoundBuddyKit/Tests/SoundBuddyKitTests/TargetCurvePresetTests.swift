import Foundation
import Testing
@testable import SoundBuddyKit

private struct LoaderFailure: Error, Equatable {}

@Suite struct TargetCurvePresetAllTests {
    @Test func listsFlatMusicWorshipInOrder() {
        #expect(TargetCurvePreset.all.map(\.id) == [
            IdealCurveLibrary.flatId,
            IdealCurveLibrary.musicFullRangeId,
            IdealCurveLibrary.worshipServiceId,
        ])
        #expect(TargetCurvePreset.all.map(\.title) == ["Flat", "Music fullrange", "Worship service"])
    }

    @Test func everyPresetIdIsABuiltInId() {
        for preset in TargetCurvePreset.all {
            #expect(IdealCurveLibrary.builtInIds.contains(preset.id))
        }
    }
}

@Suite struct TargetCurvePresetCurveTests {
    @Test(arguments: TargetCurvePreset.all)
    func eachPresetMapsToItsBundledCurve(preset: TargetCurvePreset) throws {
        let curve = try preset.curve()
        let expected = try IdealCurveLibrary.builtIn(id: preset.id)
        #expect(curve == expected)
        #expect(curve.id == preset.id)
        #expect(curve.dbOffsets.count == 48)
    }

    @Test func curveUsesTheInjectedLoader() throws {
        var receivedIds: [String] = []
        let curve = try TargetCurvePreset.flat.curve { id in
            receivedIds.append(id)
            return .flat
        }
        #expect(receivedIds == [TargetCurvePreset.flat.id])
        #expect(curve == .flat)
    }

    @Test func aThrowingLoaderRethrows() {
        #expect(throws: LoaderFailure.self) {
            try TargetCurvePreset.flat.curve { _ in throw LoaderFailure() }
        }
    }
}
