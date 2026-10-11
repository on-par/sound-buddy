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
        #expect(curve.label == "Worship – Classic")
        #expect(curve.dbOffsets[0] == 3)
        #expect(curve.dbOffsets[5] == 18)
        #expect(curve.dbOffsets.last == -18)
    }

    /// Mirrors packages/audio-engine/src/profiles/index.ts's `speech-podcast`
    /// shape terms (#1690): lowShelf(110,-6,1.4) + bell(3000,4,1.0) +
    /// highShelf(9000,-2,1.2), re-evaluated here on the Mac grid so the
    /// bundled JSON can't silently drift from the TS source of truth.
    @Test func speechPodcastMatchesTheMacProfile() throws {
        let curve = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.speechPodcastId)
        #expect(curve.label == "Speech – Clear Voice")
        #expect(curve.freqs.count == IdealCurve.gridPoints)
        let worship = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipServiceId)
        for (a, b) in zip(curve.freqs, worship.freqs) {
            #expect(abs(a - b) < epsilon)
        }

        func clamp01(_ x: Double) -> Double { Swift.max(0, Swift.min(1, x)) }
        func bell(centerHz: Double, gainDb: Double, bw: Double) -> (Double) -> Double {
            { f in gainDb * exp(-0.5 * pow((log2(f) - log2(centerHz)) / bw, 2)) }
        }
        func lowShelf(cornerHz: Double, gainDb: Double, widthOct: Double) -> (Double) -> Double {
            { f in
                let t = clamp01((log2(cornerHz) - log2(f)) / (2 * widthOct) + 0.5)
                return gainDb * (t * t * (3 - 2 * t))
            }
        }
        func highShelf(cornerHz: Double, gainDb: Double, widthOct: Double) -> (Double) -> Double {
            { f in
                let t = clamp01((log2(f) - log2(cornerHz)) / (2 * widthOct) + 0.5)
                return gainDb * (t * t * (3 - 2 * t))
            }
        }
        let terms = [
            lowShelf(cornerHz: 110, gainDb: -6, widthOct: 1.4),
            bell(centerHz: 3000, gainDb: 4, bw: 1.0),
            highShelf(cornerHz: 9000, gainDb: -2, widthOct: 1.2),
        ]
        for (hz, offset) in zip(curve.freqs, curve.dbOffsets) {
            let expected = (terms.reduce(0.0) { $0 + $1(hz) } * 100).rounded() / 100
            #expect(abs(offset - expected) < 0.011)
        }
    }

    @Test func anUnknownIdThrowsMissing() {
        #expect(throws: IdealCurveLibrary.LoadError.missing(id: "nope")) {
            try IdealCurveLibrary.builtIn(id: "nope")
        }
    }

    /// The phone measures a mic in the booth, not the Mac's line/desk feed, so
    /// its Music auto target is the room-mic reference (#1725) and no longer
    /// mirrors the Mac's LIVE_CAPTURE_DEFAULT_PROFILE_ID (worship-service).
    @Test func liveDefaultIsWorshipRoom() {
        #expect(IdealCurveLibrary.liveDefaultId == IdealCurveLibrary.worshipRoomId)
        #expect(IdealCurveLibrary.liveDefault().id == IdealCurveLibrary.worshipRoomId)
        #expect(IdealCurveLibrary.liveDefault().label == "Worship – Full Band")
    }

    @Test func worshipRoomIsABuiltIn() {
        #expect(IdealCurveLibrary.worshipRoomId == "worship-room")
        #expect(IdealCurveLibrary.builtInIds.contains(IdealCurveLibrary.worshipRoomId))
        #expect(IdealCurveLibrary.builtInIds.contains(IdealCurveLibrary.worshipServiceId), "worship-service stays available")
    }

    /// Mirrors packages/audio-engine/src/profiles/index.ts's `worship-room`
    /// point for point (#1725): the Oct 11 2026 FOH reference mix.
    @Test func worshipRoomMatchesTheMacProfile() throws {
        let curve = try IdealCurveLibrary.builtIn(id: IdealCurveLibrary.worshipRoomId)
        #expect(curve.label == "Worship – Full Band")
        #expect(curve.description == "Shape of a good-sounding full-band worship mix (Oct 11 2026 reference).")
        #expect(curve.dbOffsets == [
            -8.0, -7.5, -6.0, -3.5, -1.0, 1.5, 4.0, 6.5, 9.0, 11.0, 12.0, 12.0, 10.5, 8.5, 6.5, 5.5,
            4.5, 4.0, 4.0, 4.5, 4.5, 4.5, 4.5, 4.5, 3.5, 2.5, 1.0, -0.5, -2.0, -3.5, -5.5, -7.5,
            -11.0, -13.5, -16.5, -19.0, -21.0, -22.5, -23.5, -24.5, -26.0, -27.0, -28.5, -30.0, -31.5, -33.0, -34.5, -35.0,
        ])
        #expect(curve.freqs.count == IdealCurve.gridPoints)
        for (a, b) in zip(curve.freqs, IdealCurve.gridFreqs) {
            #expect(abs(a - b) < 0.01)
        }
    }

    /// #1742: built-in names describe a tonal shape to mix toward. None may
    /// read as an input (a mic, a feed, a desk or a channel).
    @Test(arguments: IdealCurveLibrary.builtInIds)
    func builtInLabelsNameACurveNotAnInput(id: String) throws {
        let curve = try IdealCurveLibrary.builtIn(id: id)
        for word in ["mic", "room mic", "input", "feed", "desk", "channel"] {
            #expect(!curve.label.lowercased().contains(word), "\(id) label '\(curve.label)' contains '\(word)'")
            #expect(!curve.description.lowercased().contains("\(word) "), "\(id) description mentions '\(word)'")
        }
    }

    /// #1742: the rename keeps every id, so a stored id resolves to the
    /// same curve data under its new label.
    @Test func renamedLabelsKeepTheirIds() throws {
        let expected = [
            IdealCurveLibrary.flatId: "Flat",
            IdealCurveLibrary.musicFullRangeId: "Music – Balanced",
            IdealCurveLibrary.worshipServiceId: "Worship – Classic",
            IdealCurveLibrary.speechPodcastId: "Speech – Clear Voice",
            IdealCurveLibrary.worshipRoomId: "Worship – Full Band",
        ]
        #expect(Set(expected.keys) == Set(IdealCurveLibrary.builtInIds))
        #expect(IdealCurveLibrary.builtInIds.sorted() == ["flat", "music-fullrange", "speech-podcast", "worship-room", "worship-service"])
        for (id, label) in expected {
            #expect(try IdealCurveLibrary.builtIn(id: id).label == label)
        }
        #expect(IdealCurve.flat.label == "Flat")
        let stored = try IdealCurveLibrary.builtIn(id: "worship-room")
        #expect(stored.dbOffsets.first == -8.0 && stored.dbOffsets.last == -35.0)
    }

    @Test func liveDefaultFallsBackToFlatWhenLoadingFails() {
        let target = IdealCurveLibrary.liveDefault { _ in throw IdealCurveLibrary.LoadError.missing(id: "x") }
        #expect(target == .flat)
    }
}
