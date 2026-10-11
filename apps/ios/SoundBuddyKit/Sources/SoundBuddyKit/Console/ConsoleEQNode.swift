import Foundation

/// Port of the EQ parts of parseChannelStrips
/// (packages/console/src/channel-strip.ts: EQ_ON_RE, EQ_BAND_RE, PREAMP_RE),
/// extended to /main/st/eq. Unlike channel-strip.ts, which keeps a band's
/// frequency as the console's display string (e.g. "2k5"), this parses it to
/// Hz up front, since the curve math and a later write both need a number.
extension ConsoleEQ {
    /// Console frequency text -> Hz. "328.1" -> 328.1; "2k5" -> 2500;
    /// "1k09" -> 1090; "10k74" -> 10740; "20k0" -> 20000. A single "k" acts as
    /// the decimal point x1000. `nil` for anything else (empty, "k", "2k5k",
    /// "abc").
    public static func frequencyHz(nodeToken: String) -> Double? {
        let parts = nodeToken.split(separator: "k", omittingEmptySubsequences: false)
        guard parts.count <= 2 else { return nil }
        if parts.count == 1 {
            return Double(nodeToken)
        }

        let wholeToken = String(parts[0])
        let fractionToken = String(parts[1])
        guard !wholeToken.isEmpty, !fractionToken.isEmpty else { return nil }
        guard wholeToken.allSatisfy(\.isNumber), fractionToken.allSatisfy(\.isNumber) else { return nil }
        guard let whole = Double(wholeToken), let fractionDigits = Double(fractionToken) else { return nil }

        let fractionScale = pow(10.0, Double(fractionToken.count))
        return (whole + fractionDigits / fractionScale) * 1000
    }

    private static func parseOnOff(_ token: String) -> Bool? {
        switch token {
        case "ON": return true
        case "OFF": return false
        default: return nil
        }
    }

    /// Folds one `/node` text line into `self`. Returns `true` if it was
    /// applied; any failure (wrong first token, out-of-range band, unknown
    /// type, bad number, unsupported slope, or too few tokens) leaves `self`
    /// unchanged and returns `false`.
    @discardableResult
    public mutating func apply(nodeLine: String) -> Bool {
        let tokens = nodeLine.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        guard let firstToken = tokens.first else { return false }

        if firstToken == target.eqPath {
            guard tokens.count == 2, let eqOn = ConsoleEQ.parseOnOff(tokens[1]) else { return false }
            on = eqOn
            return true
        }

        let bandPrefix = target.eqPath + "/"
        if firstToken.hasPrefix(bandPrefix) {
            let indexToken = String(firstToken.dropFirst(bandPrefix.count))
            guard let bandNumber = Int(indexToken), bandNumber >= 1, bandNumber <= target.bandCount else {
                return false
            }
            guard tokens.count >= 5 else { return false }
            guard let type = ConsoleEQBandType(nodeToken: tokens[1]) else { return false }
            guard let freqHz = ConsoleEQ.frequencyHz(nodeToken: tokens[2]) else { return false }
            guard let gainDb = Double(tokens[3]), let q = Double(tokens[4]) else { return false }

            bands[bandNumber - 1] = ConsoleEQBand(type: type, freqHz: freqHz, gainDb: gainDb, q: q)
            return true
        }

        if let preampPath = target.preampPath, firstToken == preampPath {
            guard tokens.count >= 6 else { return false }
            guard Double(tokens[1]) != nil else { return false } // trim, unmodeled here
            guard ConsoleEQ.parseOnOff(tokens[2]) != nil else { return false } // invert, unmodeled here
            guard let hpfOn = ConsoleEQ.parseOnOff(tokens[3]) else { return false }
            guard let slope = Int(tokens[4]), ConsoleHPF.supportedSlopes.contains(slope) else { return false }
            guard let freqHz = Double(tokens[5]) else { return false }

            hpf = ConsoleHPF(on: hpfOn, slopeDbPerOctave: slope, freqHz: freqHz)
            return true
        }

        return false
    }

    /// `flat(for: target)`, then `apply(nodeLine:)` for each line in order.
    public static func parse(nodeLines: [String], for target: ConsoleEQTarget) -> ConsoleEQ {
        var eq = ConsoleEQ.flat(for: target)
        for line in nodeLines {
            eq.apply(nodeLine: line)
        }
        return eq
    }
}
