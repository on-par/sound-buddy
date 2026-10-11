import Foundation
import Testing
@testable import SoundBuddyKit

@Suite struct ConsoleEQCurveTests {
    // MARK: - AC4: a single PEQ cut bottoms at its center and is flat far away

    @Test func singlePeqCutBottomsAtOneKilohertzAndIsFlatTwoDecadesAway() {
        var eq = ConsoleEQ.flat(for: .channel(1))
        eq.on = true
        eq.bands[0] = ConsoleEQBand(type: .peaking, freqHz: 1000, gainDb: -6, q: 2.0)

        let layout = RTALayout.standard
        let response = eq.magnitudeResponseDb(on: layout)
        let minIndex = response.indices.min(by: { response[$0] < response[$1] })!

        #expect(abs(layout.bands[minIndex].centerHz - 1000) < 1e-6)
        #expect(abs(response[minIndex] - (-6)) < 0.1)
        #expect(abs(eq.magnitudeResponseDb(atHz: [10])[0]) < 0.1)
        #expect(abs(eq.magnitudeResponseDb(atHz: [20_000])[0]) < 0.1)
    }

    @Test func eqOffIsFlatButHpfStillApplies() {
        var eq = ConsoleEQ.flat(for: .channel(1))
        eq.on = false
        eq.bands[0] = ConsoleEQBand(type: .peaking, freqHz: 1000, gainDb: -6, q: 2.0)

        for value in eq.magnitudeResponseDb(on: .standard) {
            #expect(abs(value) < 1e-9)
        }

        eq.hpf = ConsoleHPF(on: true, slopeDbPerOctave: 12, freqHz: 100)
        #expect(abs(eq.magnitudeResponseDb(atHz: [100])[0] - (-3.01)) < 0.1)
        #expect(abs(eq.magnitudeResponseDb(atHz: [1000])[0]) < 0.1)
    }

    @Test func hpfSlopesFallAtTheirOrder() {
        for slope in ConsoleHPF.supportedSlopes {
            var eq = ConsoleEQ.flat(for: .channel(1))
            eq.hpf = ConsoleHPF(on: true, slopeDbPerOctave: slope, freqHz: 100)

            #expect(abs(eq.magnitudeResponseDb(atHz: [100])[0] - (-3)) < 0.15)

            let at25 = eq.magnitudeResponseDb(atHz: [25])[0]
            let at12_5 = eq.magnitudeResponseDb(atHz: [12.5])[0]
            let drop = at25 - at12_5
            #expect(abs(drop - Double(slope)) < 1.5)
        }
    }

    @Test func bandTypesShapeTheCurve() {
        var lowShelf = ConsoleEQ.flat(for: .channel(1))
        lowShelf.on = true
        lowShelf.bands[0] = ConsoleEQBand(type: .lowShelf, freqHz: 100, gainDb: 6, q: 2.0)
        #expect(abs(lowShelf.magnitudeResponseDb(atHz: [20])[0] - 6) < 0.3)
        #expect(abs(lowShelf.magnitudeResponseDb(atHz: [10_000])[0]) < 0.2)

        var highShelf = ConsoleEQ.flat(for: .channel(1))
        highShelf.on = true
        highShelf.bands[0] = ConsoleEQBand(type: .highShelf, freqHz: 5000, gainDb: 6, q: 2.0)
        #expect(abs(highShelf.magnitudeResponseDb(atHz: [20_000])[0] - 6) < 0.3)
        #expect(abs(highShelf.magnitudeResponseDb(atHz: [50])[0]) < 0.2)

        var lowCut = ConsoleEQ.flat(for: .channel(1))
        lowCut.on = true
        lowCut.bands[0] = ConsoleEQBand(type: .lowCut, freqHz: 200, gainDb: -12, q: 5.0)
        #expect(abs(lowCut.magnitudeResponseDb(atHz: [200])[0] - (-3)) < 0.1)
        #expect(abs(lowCut.magnitudeResponseDb(atHz: [5000])[0]) < 0.1)

        var highCut = ConsoleEQ.flat(for: .channel(1))
        highCut.on = true
        highCut.bands[0] = ConsoleEQBand(type: .highCut, freqHz: 5000, gainDb: -12, q: 5.0)
        #expect(abs(highCut.magnitudeResponseDb(atHz: [5000])[0] - (-3)) < 0.1)

        var peaking = ConsoleEQ.flat(for: .channel(1))
        peaking.on = true
        peaking.bands[0] = ConsoleEQBand(type: .peaking, freqHz: 1000, gainDb: -6, q: 2.0)
        var vintage = peaking
        vintage.bands[0].type = .vintagePeaking
        #expect(
            abs(peaking.magnitudeResponseDb(atHz: [1000])[0] - vintage.magnitudeResponseDb(atHz: [1000])[0]) < 1e-9
        )
    }

    @Test func mainLRUsesAllSixBands() {
        var main = ConsoleEQ.flat(for: .mainLR)
        main.on = true
        main.bands[5] = ConsoleEQBand(type: .peaking, freqHz: 8000, gainDb: -6, q: 2.0)

        let layout = RTALayout.standard
        let response = main.magnitudeResponseDb(on: layout)
        let minIndex = response.indices.min(by: { response[$0] < response[$1] })!

        #expect(abs(log2(layout.bands[minIndex].centerHz / 8000)) < 0.1)
    }

    @Test func layoutOverloadSamplesBandCenters() {
        var eq = ConsoleEQ.flat(for: .channel(1))
        eq.on = true
        eq.bands[0] = ConsoleEQBand(type: .peaking, freqHz: 1000, gainDb: -6, q: 2.0)
        eq.hpf = ConsoleHPF(on: true, slopeDbPerOctave: 24, freqHz: 80)

        let layout = RTALayout.standard
        let onLayout = eq.magnitudeResponseDb(on: layout)
        let atCenters = eq.magnitudeResponseDb(atHz: layout.bands.map(\.centerHz))

        #expect(onLayout.count == layout.bands.count)
        #expect(onLayout.count == atCenters.count)
        for i in onLayout.indices {
            #expect(abs(onLayout[i] - atCenters[i]) < 1e-12)
        }
    }
}
