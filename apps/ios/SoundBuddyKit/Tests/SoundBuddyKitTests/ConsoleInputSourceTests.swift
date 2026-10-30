import Foundation
import Testing
@testable import SoundBuddyKit

@Suite struct ConsoleInputSourceTests {
    @Test func mapsEachDocumentedRange() {
        #expect(ConsoleInputSource(raw: 0) == .off)
        #expect(ConsoleInputSource(raw: 1) == .input(1))
        #expect(ConsoleInputSource(raw: 32) == .input(32))
        #expect(ConsoleInputSource(raw: 33) == .aux(1))
        #expect(ConsoleInputSource(raw: 38) == .aux(6))
        #expect(ConsoleInputSource(raw: 39) == .usbL)
        #expect(ConsoleInputSource(raw: 40) == .usbR)
        #expect(ConsoleInputSource(raw: 41) == .fxReturn(unit: 1, isRight: false))
        #expect(ConsoleInputSource(raw: 42) == .fxReturn(unit: 1, isRight: true))
        #expect(ConsoleInputSource(raw: 48) == .fxReturn(unit: 4, isRight: true))
        #expect(ConsoleInputSource(raw: 49) == .bus(1))
        #expect(ConsoleInputSource(raw: 64) == .bus(16))
    }

    @Test func outOfRangeRawValuesDecodeToUnknown() {
        #expect(ConsoleInputSource(raw: -1) == .unknown(-1))
        #expect(ConsoleInputSource(raw: 65) == .unknown(65))
        #expect(ConsoleInputSource(raw: 1000) == .unknown(1000))
    }

    @Test func displayNames() {
        #expect(ConsoleInputSource.off.displayName == "Off")
        #expect(ConsoleInputSource.input(5).displayName == "In 5")
        #expect(ConsoleInputSource.aux(3).displayName == "Aux 3")
        #expect(ConsoleInputSource.usbL.displayName == "USB L")
        #expect(ConsoleInputSource.usbR.displayName == "USB R")
        #expect(ConsoleInputSource.fxReturn(unit: 2, isRight: true).displayName == "FX 2R")
        #expect(ConsoleInputSource.bus(7).displayName == "Bus 7")
        #expect(ConsoleInputSource.unknown(99).displayName == "Unknown (99)")
    }
}
