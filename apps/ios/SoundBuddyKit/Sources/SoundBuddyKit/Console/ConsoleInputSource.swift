import Foundation

/// A channel strip's routed input source, `/ch/[01..32]/config/source`'s raw
/// int reply (also used by `/auxin/[01..08]/config/source` — bus strips have
/// no source field at all). Raw int ranges per the Behringer X32/M32
/// unofficial OSC protocol doc (Patrick-Gilles Maillot): 0 Off, 1...32 local
/// input 1...32, 33...38 Aux In 1...6, 39/40 USB L/R, 41...48 FX return
/// 1...4 L/R (two raw values per unit, L then R), 49...64 Bus 1...16 (post
/// fader, as a source). Anything outside these ranges is `.unknown(raw)` —
/// a future firmware value this type doesn't know yet, never a crash.
public enum ConsoleInputSource: Codable, Equatable, Sendable {
    case off
    case input(Int)
    case aux(Int)
    case usbL
    case usbR
    case fxReturn(unit: Int, isRight: Bool)
    case bus(Int)
    case unknown(Int)

    public static let offRaw = 0
    public static let inputRange = 1...32
    public static let auxRange = 33...38
    public static let usbLRaw = 39
    public static let usbRRaw = 40
    public static let fxReturnRange = 41...48
    public static let busRange = 49...64

    public init(raw: Int) {
        switch raw {
        case ConsoleInputSource.offRaw:
            self = .off
        case ConsoleInputSource.inputRange:
            self = .input(raw)
        case ConsoleInputSource.auxRange:
            self = .aux(raw - ConsoleInputSource.auxRange.lowerBound + 1)
        case ConsoleInputSource.usbLRaw:
            self = .usbL
        case ConsoleInputSource.usbRRaw:
            self = .usbR
        case ConsoleInputSource.fxReturnRange:
            let offset = raw - ConsoleInputSource.fxReturnRange.lowerBound
            self = .fxReturn(unit: offset / 2 + 1, isRight: offset % 2 == 1)
        case ConsoleInputSource.busRange:
            self = .bus(raw - ConsoleInputSource.busRange.lowerBound + 1)
        default:
            self = .unknown(raw)
        }
    }

    public var displayName: String {
        switch self {
        case .off:
            return "Off"
        case .input(let index):
            return "In \(index)"
        case .aux(let index):
            return "Aux \(index)"
        case .usbL:
            return "USB L"
        case .usbR:
            return "USB R"
        case .fxReturn(let unit, let isRight):
            return "FX \(unit)\(isRight ? "R" : "L")"
        case .bus(let index):
            return "Bus \(index)"
        case .unknown(let raw):
            return "Unknown (\(raw))"
        }
    }
}
