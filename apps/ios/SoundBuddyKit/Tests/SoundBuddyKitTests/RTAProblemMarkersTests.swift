import Foundation
import Testing
@testable import SoundBuddyKit

private let epsilon = 1e-9

private func marker(
    band: Band,
    direction: ProblemMarkerDescriptor.Direction = .overTarget,
    severityDb: Double = 5
) -> ProblemMarkerDescriptor {
    ProblemMarkerDescriptor(band: band, direction: direction, severityDb: severityDb)
}

@Suite struct RTAProblemMarkersSpansTests {
    let layout = RTALayout.standard

    @Test func emptyInputGivesEmptyOutput() {
        #expect(RTAProblemMarkers.spans(for: [], on: layout).isEmpty)
    }

    @Test func anOverTargetLowMidDescriptorCoversOnlyItsHzRange() throws {
        let spans = RTAProblemMarkers.spans(for: [marker(band: .lowMid, direction: .overTarget)], on: layout)
        let span = try #require(spans.first)
        #expect(spans.count == 1)
        #expect(span.direction == .overTarget)
        for i in span.bandIndices {
            let hz = layout.bands[i].centerHz
            #expect(hz >= 250 && hz < 500)
        }
        if span.bandIndices.lowerBound > layout.bands.indices.lowerBound {
            #expect(layout.bands[span.bandIndices.lowerBound - 1].centerHz < 250)
        }
        if span.bandIndices.upperBound < layout.bands.indices.upperBound {
            #expect(layout.bands[span.bandIndices.upperBound + 1].centerHz >= 500)
        }
    }

    /// Pins the same Hz-alignment contract the landscape Analyze RTA now
    /// relies on too (#1554): `RTALayout` has no portrait/landscape notion of
    /// its own, so this data-level check covers both call sites at once.
    @Test func aPresenceDescriptorAlignsWithItsHzRangeOnTheSharedLayout() throws {
        let spans = RTAProblemMarkers.spans(for: [marker(band: .presence, direction: .underTarget)], on: layout)
        let span = try #require(spans.first)
        #expect(spans.count == 1)
        #expect(span.direction == .underTarget)
        for i in span.bandIndices {
            let hz = layout.bands[i].centerHz
            #expect(hz >= 4000 && hz < 6000)
        }
        if span.bandIndices.lowerBound > layout.bands.indices.lowerBound {
            #expect(layout.bands[span.bandIndices.lowerBound - 1].centerHz < 4000)
        }
        if span.bandIndices.upperBound < layout.bands.indices.upperBound {
            #expect(layout.bands[span.bandIndices.upperBound + 1].centerHz >= 6000)
        }
    }

    @Test func anUnderTargetBrillianceDescriptorCoversTheTopRTABand() throws {
        let spans = RTAProblemMarkers.spans(for: [marker(band: .brilliance, direction: .underTarget)], on: layout)
        let span = try #require(spans.first)
        #expect(span.direction == .underTarget)
        #expect(span.bandIndices.upperBound == layout.bands.indices.last)
    }

    @Test func mixedInputKeepsDescriptorOrderAndDirections() {
        let markers = [
            marker(band: .subBass, direction: .underTarget),
            marker(band: .presence, direction: .overTarget),
            marker(band: .bass, direction: .overTarget),
        ]
        let spans = RTAProblemMarkers.spans(for: markers, on: layout)
        #expect(spans.map(\.direction) == [.underTarget, .overTarget, .overTarget])
        #expect(spans[0].bandIndices.upperBound < spans[2].bandIndices.lowerBound, "subBass sits below bass")
        #expect(spans[2].bandIndices.upperBound < spans[1].bandIndices.lowerBound, "bass sits below presence")
    }

    /// Every canonical Band's Hz range overlaps `RTALayout.standard` (and, by
    /// exhaustive check, every `RTALayout(bandsPerOctave:)` from 1 through 12):
    /// each Band's low edge is either wide enough to guarantee a grid point
    /// (subBass/bass/mid/brilliance) or lands exactly on an octave multiple of
    /// the RTA's 1 kHz anchor (lowMid/highMid/presence at 250/2000/4000 Hz), so
    /// the skip branch is unreachable with any real Band-derived descriptor.
    /// `RTALayout(bandsPerOctave: 0)` is the one initializer input that
    /// produces a genuine no-overlap layout: dividing by a zero band count
    /// makes every band edge NaN, so no descriptor can ever match it — this is
    /// the documented, non-meaningless way to exercise the skip path.
    @Test func aDescriptorIsDroppedWhenItOverlapsNoRTABand() throws {
        let degenerateLayout = RTALayout(bandsPerOctave: 0)
        let band = try #require(degenerateLayout.bands.first)
        #expect(band.centerHz.isNaN, "bandsPerOctave: 0 divides by zero, producing a NaN band center")
        let spans = RTAProblemMarkers.spans(for: [marker(band: .lowMid)], on: degenerateLayout)
        #expect(spans.isEmpty)
    }
}

@Suite struct RTAProblemMarkersPulseOpacityTests {
    @Test func startsAtTheMinimum() {
        #expect(abs(RTAProblemMarkers.pulseOpacity(atSeconds: 0) - RTAProblemMarkers.pulseMinOpacity) < epsilon)
    }

    @Test func peaksAtHalfThePeriod() {
        let half = RTAProblemMarkers.pulsePeriodSeconds / 2
        #expect(abs(RTAProblemMarkers.pulseOpacity(atSeconds: half) - RTAProblemMarkers.pulseMaxOpacity) < epsilon)
    }

    @Test func staysWithinBoundsAcrossManySamples() {
        for step in stride(from: 0.0, through: 10.0, by: 0.07) {
            let value = RTAProblemMarkers.pulseOpacity(atSeconds: step)
            #expect(value >= RTAProblemMarkers.pulseMinOpacity - epsilon)
            #expect(value <= RTAProblemMarkers.pulseMaxOpacity + epsilon)
        }
    }

    @Test func isPeriodic() {
        for seconds in [0.0, 0.3, 1.1, 2.4] {
            let a = RTAProblemMarkers.pulseOpacity(atSeconds: seconds)
            let b = RTAProblemMarkers.pulseOpacity(atSeconds: seconds + RTAProblemMarkers.pulsePeriodSeconds)
            #expect(abs(a - b) < epsilon)
        }
    }

    @Test(arguments: [Double.nan, .infinity, -.infinity])
    func nonFiniteInputReturnsTheMinimum(seconds: Double) {
        #expect(RTAProblemMarkers.pulseOpacity(atSeconds: seconds) == RTAProblemMarkers.pulseMinOpacity)
    }
}
