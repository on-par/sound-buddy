import Foundation
import Testing
@testable import SoundBuddyKit

@Suite struct BandTests {
    @Test func sevenBandsInCanonicalOrder() {
        #expect(Band.allCases.map(\.rawValue) == [
            "subBass", "bass", "lowMid", "mid", "highMid", "presence", "brilliance",
        ])
    }

    /// Parity guard: the Swift band table must match BAND_METADATA in the
    /// Mac engine exactly (key, label, edges), or the two apps coach on
    /// different bands.
    @Test func matchesAudioEngineBandMetadata() throws {
        let bandsTs = try String(
            contentsOf: TestPaths.repoRoot.appending(path: "packages/audio-engine/src/bands.ts"),
            encoding: .utf8
        )
        let row = /\{ key: "(\w+)",\s*label: "([^"]+)",.*lo: (\d+),\s*hi: (\d+)\s*\}/
        let mac = bandsTs.matches(of: row).map { "\($0.1)|\($0.2)|\($0.3)|\($0.4)" }
        let swift = Band.allCases.map { "\($0.rawValue)|\($0.label)|\(Int($0.lowHz))|\(Int($0.highHz))" }
        #expect(mac.count == Band.allCases.count)
        #expect(mac == swift)
    }

    @Test func containingFrequency() {
        #expect(Band.containing(hz: 100) == .bass)
        #expect(Band.containing(hz: 1000) == .mid)
        #expect(Band.containing(hz: 60) == .bass, "lower edge is inclusive")
        #expect(Band.containing(hz: 20000) == .brilliance, "top edge of the top band is inclusive")
        #expect(Band.containing(hz: 10) == nil)
        #expect(Band.containing(hz: 22000) == nil)
    }
}
