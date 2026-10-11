import Foundation

/// Folds decoded `/xremote` push messages (raw 0...1 floats/ints on
/// per-parameter addresses) into a `ConsoleEQ`, the live counterpart to
/// `apply(nodeLine:)`'s text-based `/node` resync. Values go through
/// `ConsoleEQScale`, the same raw <-> engineering-unit converters the `/node`
/// write path (ADR-0161) will use.
extension ConsoleEQ {
    private enum Leaf {
        static let type = "type"
        static let freq = "f"
        static let gain = "g"
        static let q = "q"
        static let hpOn = "hpon"
        static let hpSlope = "hpslope"
        static let hpf = "hpf"
    }

    /// NaN is rejected outright (never silently becomes 0); anything else is
    /// clamped to the raw sweep's 0...1 domain rather than propagating an
    /// out-of-range float into `ConsoleEQScale`.
    private static func rawUnit(_ raw: Float) -> Double? {
        guard !raw.isNaN else { return nil }
        return min(1, max(0, Double(raw)))
    }

    /// Folds one decoded `/xremote` push for this target into engineering
    /// units. Returns `true` if applied; any failure (foreign address,
    /// wrong argument count/type, out-of-range band/type/slope index, or
    /// NaN) leaves `self` unchanged and returns `false`. The new value is
    /// built in full before assignment, so a failure never partially
    /// applies a message.
    @discardableResult
    public mutating func apply(push message: OSCMessage) -> Bool {
        let address = OSCMessage.normalizedReplyAddress(message.address)
        let args = message.arguments

        if address == target.eqPath {
            guard args.count == 1, case let .int(value) = args[0] else { return false }
            on = value != 0
            return true
        }

        let bandPrefix = target.eqPath + "/"
        if address.hasPrefix(bandPrefix) {
            return applyBandLeaf(address: String(address.dropFirst(bandPrefix.count)), args: args)
        }

        if let preampPath = target.preampPath {
            let preampPrefix = preampPath + "/"
            if address.hasPrefix(preampPrefix) {
                return applyPreampLeaf(leaf: String(address.dropFirst(preampPrefix.count)), args: args)
            }
        }

        return false
    }

    private mutating func applyBandLeaf(address: String, args: [OSCArgument]) -> Bool {
        let parts = address.split(separator: "/").map(String.init)
        guard let first = parts.first, let bandNumber = Int(first), (1...target.bandCount).contains(bandNumber) else {
            return false
        }
        let bandIndex = bandNumber - 1

        if parts.count == 1 {
            guard args.count == 4,
                  case let .int(typeRaw) = args[0],
                  case let .float(freqRaw) = args[1],
                  case let .float(gainRaw) = args[2],
                  case let .float(qRaw) = args[3],
                  let type = ConsoleEQBandType(rawValue: Int(typeRaw)),
                  let freqUnit = ConsoleEQ.rawUnit(freqRaw),
                  let gainUnit = ConsoleEQ.rawUnit(gainRaw),
                  let qUnit = ConsoleEQ.rawUnit(qRaw)
            else { return false }

            bands[bandIndex] = ConsoleEQBand(
                type: type,
                freqHz: ConsoleEQScale.freqHz(raw: freqUnit),
                gainDb: ConsoleEQScale.gainDb(raw: gainUnit),
                q: ConsoleEQScale.q(raw: qUnit)
            )
            return true
        }

        guard parts.count == 2, args.count == 1 else { return false }
        switch parts[1] {
        case Leaf.type:
            guard case let .int(raw) = args[0], let type = ConsoleEQBandType(rawValue: Int(raw)) else { return false }
            bands[bandIndex].type = type
            return true
        case Leaf.freq:
            guard case let .float(raw) = args[0], let unit = ConsoleEQ.rawUnit(raw) else { return false }
            bands[bandIndex].freqHz = ConsoleEQScale.freqHz(raw: unit)
            return true
        case Leaf.gain:
            guard case let .float(raw) = args[0], let unit = ConsoleEQ.rawUnit(raw) else { return false }
            bands[bandIndex].gainDb = ConsoleEQScale.gainDb(raw: unit)
            return true
        case Leaf.q:
            guard case let .float(raw) = args[0], let unit = ConsoleEQ.rawUnit(raw) else { return false }
            bands[bandIndex].q = ConsoleEQScale.q(raw: unit)
            return true
        default:
            return false
        }
    }

    private mutating func applyPreampLeaf(leaf: String, args: [OSCArgument]) -> Bool {
        guard args.count == 1 else { return false }
        var next = hpf ?? .off
        switch leaf {
        case Leaf.hpOn:
            guard case let .int(raw) = args[0] else { return false }
            next.on = raw != 0
        case Leaf.hpSlope:
            guard case let .int(raw) = args[0], ConsoleHPF.supportedSlopes.indices.contains(Int(raw)) else { return false }
            next.slopeDbPerOctave = ConsoleHPF.supportedSlopes[Int(raw)]
        case Leaf.hpf:
            guard case let .float(raw) = args[0], let unit = ConsoleEQ.rawUnit(raw) else { return false }
            next.freqHz = ConsoleEQScale.hpfHz(raw: unit)
        default:
            return false
        }
        hpf = next
        return true
    }
}

extension ConsoleEQTarget {
    /// The `/node` argument paths (no leading slash) the #1666 adapter sends
    /// to heal this target's EQ: the eq path, then each band in order, then
    /// (for a channel) the preamp. Main LR gives 7 paths; a channel gives 6.
    public var nodeQueryPaths: [String] {
        let eqPathNoSlash = String(eqPath.dropFirst())
        var paths = [eqPathNoSlash]
        for band in 1...bandCount {
            paths.append("\(eqPathNoSlash)/\(band)")
        }
        if let preampPath {
            paths.append(String(preampPath.dropFirst()))
        }
        return paths
    }
}
