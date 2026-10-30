import Foundation

/// The bundled role-alias table (`Resources/ChannelRoleAliases.json`):
/// normalized labels per `ChannelRole`, plus the tracks-prefix and
/// tracks-stem word lists.
public struct ChannelRoleAliasTable: Decodable, Equatable, Sendable {
    public let version: Int
    public let aliases: [ChannelRole: [String]]
    public let tracksPrefixes: [String]
    public let tracksStems: [String]

    public static let empty = ChannelRoleAliasTable(version: 1, aliases: [:], tracksPrefixes: [], tracksStems: [])

    public init(version: Int, aliases: [ChannelRole: [String]], tracksPrefixes: [String], tracksStems: [String]) {
        self.version = version
        self.aliases = aliases
        self.tracksPrefixes = tracksPrefixes
        self.tracksStems = tracksStems
    }

    private enum CodingKeys: String, CodingKey {
        case version, aliases, tracksPrefixes, tracksStems
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decode(Int.self, forKey: .version)
        tracksPrefixes = try container.decode([String].self, forKey: .tracksPrefixes)
        tracksStems = try container.decode([String].self, forKey: .tracksStems)

        let rawAliases = try container.decode([String: [String]].self, forKey: .aliases)
        var mapped: [ChannelRole: [String]] = [:]
        for (key, words) in rawAliases {
            guard let role = ChannelRole(rawValue: key) else {
                throw DecodingError.dataCorrupted(DecodingError.Context(
                    codingPath: container.codingPath + [CodingKeys.aliases],
                    debugDescription: "ChannelRoleAliases.json has unknown role \"\(key)\" — use a ChannelRole raw value."
                ))
            }
            mapped[role] = words
        }
        aliases = mapped
    }

    public enum LoadError: Error, Equatable, LocalizedError {
        case missing

        public var errorDescription: String? {
            switch self {
            case .missing:
                "Channel role aliases are missing from the app bundle — reinstall or update Sound Buddy."
            }
        }
    }

    /// Decodes the bundled `ChannelRoleAliases.json` resource.
    public static func loadBundled() throws -> ChannelRoleAliasTable {
        guard let url = Bundle.module.url(forResource: "ChannelRoleAliases", withExtension: "json") else {
            throw LoadError.missing
        }
        return try JSONDecoder().decode(ChannelRoleAliasTable.self, from: Data(contentsOf: url))
    }
}

/// Guesses each scribble-strip's role from its label alone, with weaker
/// color/neighbour context for unlabeled people-names. Pure and read-only:
/// no OSC, no `id`/channel-number rule, no person/church name in the table
/// (#1783).
public struct ChannelRoleGuesser: Sendable {
    public static let exactAliasConfidence = 0.9
    public static let tokenAliasConfidence = 0.85
    public static let conflictingTokensConfidence = 0.6
    public static let tracksPrefixConfidence = 0.7
    public static let unusedConfidence = 0.9
    public static let contextSameColorConfidence = 0.6
    public static let contextAdjacentConfidence = 0.4
    public static let unknownConfidence = 0.0
    public static let scribbleStripLength = 12
    public static let minTracksStemLength = 2

    private static let trailingDropTokens: Set<String> = [
        "l", "r", "lr", "left", "right", "st", "in", "out", "top", "bot", "bottom",
    ]

    private let aliases: ChannelRoleAliasTable
    private let exact: [String: ChannelRole]
    private let compactInstrument: Set<String>
    private let sortedPrefixes: [String]

    public init(aliases: ChannelRoleAliasTable) {
        self.aliases = aliases

        var exactMap: [String: ChannelRole] = [:]
        for (role, words) in aliases.aliases {
            for word in words {
                exactMap[ChannelRoleGuesser.normalizedLabel(word)] = role
            }
        }
        exact = exactMap

        var compact: Set<String> = []
        for (role, words) in aliases.aliases where role.isInstrumentOrVoice {
            for word in words {
                compact.insert(ChannelRoleGuesser.normalizedLabel(word).replacingOccurrences(of: " ", with: ""))
            }
        }
        for stem in aliases.tracksStems {
            compact.insert(ChannelRoleGuesser.normalizedLabel(stem).replacingOccurrences(of: " ", with: ""))
        }
        compactInstrument = compact

        sortedPrefixes = aliases.tracksPrefixes.sorted { $0.count > $1.count }
    }

    /// Built from the bundled alias table, falling back to an empty one (so
    /// every label is unknown, never wrong) if `load` throws.
    public static func bundled(load: () throws -> ChannelRoleAliasTable = ChannelRoleAliasTable.loadBundled) -> ChannelRoleGuesser {
        ChannelRoleGuesser(aliases: (try? load()) ?? .empty)
    }

    /// Normalizes a scribble-strip name into a lookup key: truncate to the
    /// 12-character strip length, lowercase, fold punctuation to spaces,
    /// split letters from glued trailing digits, then drop trailing
    /// side/position tokens ("L", "R", "In", "Out", ...) one at a time,
    /// never past the last remaining token.
    public static func normalizedLabel(_ name: String) -> String {
        let truncated = String(name.prefix(scribbleStripLength)).lowercased()

        var folded = ""
        folded.reserveCapacity(truncated.count)
        for character in truncated {
            folded.append(character.isLetter || character.isNumber ? character : " ")
        }

        var spaced = ""
        spaced.reserveCapacity(folded.count + 4)
        var previousWasLetter = false
        for character in folded {
            if character.isNumber && previousWasLetter {
                spaced.append(" ")
            }
            spaced.append(character)
            previousWasLetter = character.isLetter
        }

        var tokens = spaced.split(separator: " ").map(String.init)
        while tokens.count > 1 {
            let last = tokens[tokens.count - 1]
            let isAllDigits = !last.isEmpty && last.allSatisfy(\.isNumber)
            guard isAllDigits || trailingDropTokens.contains(last) else { break }
            tokens.removeLast()
        }

        return tokens.joined(separator: " ")
    }

    /// The label-only guess for one strip — order-independent, never reads
    /// `id`.
    public func labelGuess(for strip: ChannelRoleInput) -> ChannelRoleGuess {
        let trimmed = strip.name.trimmingCharacters(in: .whitespaces)

        if trimmed.isEmpty {
            if strip.color.base == .off {
                return makeGuess(strip, role: .unused, confidence: ChannelRoleGuesser.unusedConfidence, reason: "Blank and switched off", basis: .blank)
            }
            return makeGuess(strip, role: .unknown, confidence: ChannelRoleGuesser.unknownConfidence, reason: "No name on this strip", basis: .blank)
        }

        let key = ChannelRoleGuesser.normalizedLabel(strip.name)

        if let role = exact[key] {
            return makeGuess(strip, role: role, confidence: ChannelRoleGuesser.exactAliasConfidence, reason: "\u{201c}\(trimmed)\u{201d} reads as \(ChannelRoleGuesser.displayWord(for: role))", basis: .label)
        }

        if let prefixGuess = tracksPrefixGuess(key: key, trimmed: trimmed, strip: strip) {
            return prefixGuess
        }

        if let tokenGuess = tokenGuess(key: key, trimmed: trimmed, strip: strip) {
            return tokenGuess
        }

        return makeGuess(strip, role: .unknown, confidence: ChannelRoleGuesser.unknownConfidence, reason: "No rule matches this name", basis: .label)
    }

    private func tracksPrefixGuess(key: String, trimmed: String, strip: ChannelRoleInput) -> ChannelRoleGuess? {
        let compact = key.replacingOccurrences(of: " ", with: "")
        for prefix in sortedPrefixes {
            guard compact.hasPrefix(prefix) else { continue }
            let remainder = String(compact.dropFirst(prefix.count))
            guard remainder.count >= ChannelRoleGuesser.minTracksStemLength, compactInstrument.contains(remainder) else { continue }
            let prefixLabel = prefix.prefix(1).uppercased() + prefix.dropFirst()
            let reason = "\u{201c}\(trimmed)\u{201d} looks like a tracks stem (\(prefixLabel) + \(remainder))"
            return makeGuess(strip, role: .tracks, confidence: ChannelRoleGuesser.tracksPrefixConfidence, reason: reason, basis: .label)
        }
        return nil
    }

    private func tokenGuess(key: String, trimmed: String, strip: ChannelRoleInput) -> ChannelRoleGuess? {
        let hits = key.split(separator: " ").compactMap { token -> (word: String, role: ChannelRole)? in
            guard let role = exact[String(token)] else { return nil }
            return (String(token), role)
        }
        guard let first = hits.first else { return nil }

        if hits.allSatisfy({ $0.role == first.role }) {
            let reason = "\u{201c}\(trimmed)\u{201d} reads as \(ChannelRoleGuesser.displayWord(for: first.role))"
            return makeGuess(strip, role: first.role, confidence: ChannelRoleGuesser.tokenAliasConfidence, reason: reason, basis: .label)
        }

        let parts = hits.map { "\u{201c}\($0.word)\u{201d} (\(ChannelRoleGuesser.displayWord(for: $0.role)))" }
        let reason = "\u{201c}\(trimmed)\u{201d} has " + parts.joined(separator: " and ")
        return makeGuess(strip, role: first.role, confidence: ChannelRoleGuesser.conflictingTokensConfidence, reason: reason, basis: .label)
    }

    private func makeGuess(_ strip: ChannelRoleInput, role: ChannelRole, confidence: Double, reason: String, basis: ChannelRoleGuess.Basis) -> ChannelRoleGuess {
        ChannelRoleGuess(id: strip.id, name: strip.name, role: role, confidence: confidence, reason: reason, basis: basis)
    }

    private static func displayWord(for role: ChannelRole) -> String {
        switch role {
        case .hiHat: return "hi-hat"
        case .electricGuitar: return "electric guitar"
        case .acousticGuitar: return "acoustic guitar"
        case .roomMic: return "room mic"
        default: return role.rawValue.lowercased()
        }
    }

    /// Label guesses, then a weak color/neighbour context pass: a name-like
    /// strip that the label rules left unknown, sitting in a same-color run
    /// (or immediately next to one) that has a voice anchor, becomes a
    /// medium/low-confidence vocal guess. Never reads `id`.
    public func guess(_ strips: [ChannelRoleInput]) -> [ChannelRoleGuess] {
        var out = strips.map(labelGuess)
        guard !strips.isEmpty else { return out }

        var index = 0
        while index < strips.count {
            let runColor = strips[index].color.base
            guard runColor != .off else {
                index += 1
                continue
            }

            var end = index
            while end + 1 < strips.count, strips[end + 1].color.base == runColor {
                end += 1
            }

            applyContextRule(range: index...end, strips: strips, out: &out)
            index = end + 1
        }

        return out
    }

    private func applyContextRule(range: ClosedRange<Int>, strips: [ChannelRoleInput], out: inout [ChannelRoleGuess]) {
        var anchorName: String?
        var confidence = ChannelRoleGuesser.contextSameColorConfidence

        for index in range where out[index].role.isVoice {
            anchorName = strips[index].name.trimmingCharacters(in: .whitespaces)
            break
        }

        if anchorName == nil {
            let before = range.lowerBound - 1
            let after = range.upperBound + 1
            if before >= 0, out[before].role.isVoice {
                anchorName = strips[before].name.trimmingCharacters(in: .whitespaces)
                confidence = ChannelRoleGuesser.contextAdjacentConfidence
            } else if after < strips.count, out[after].role.isVoice {
                anchorName = strips[after].name.trimmingCharacters(in: .whitespaces)
                confidence = ChannelRoleGuesser.contextAdjacentConfidence
            }
        }

        guard let anchor = anchorName else { return }

        for index in range {
            guard out[index].role == .unknown, out[index].basis == .label else { continue }
            let trimmed = strips[index].name.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty, trimmed.allSatisfy({ $0.isLetter || $0.isWhitespace }) else { continue }

            let reason = "Same-color run with neighbors next to \u{201c}\(anchor)\u{201d} — likely a singer"
            out[index] = ChannelRoleGuess(id: strips[index].id, name: strips[index].name, role: .vocal, confidence: confidence, reason: reason, basis: .context)
        }
    }

    /// `.roomMic` guesses from `guess(_:)`, ranked by confidence (ties keep
    /// console order) for the review screen to offer as candidates — the
    /// guesser never picks the room mic itself.
    public static func roomMicCandidates(in guesses: [ChannelRoleGuess]) -> [ChannelRoleGuess] {
        guesses.enumerated()
            .filter { $0.element.role == .roomMic }
            .sorted { lhs, rhs in
                if lhs.element.confidence != rhs.element.confidence {
                    return lhs.element.confidence > rhs.element.confidence
                }
                return lhs.offset < rhs.offset
            }
            .map(\.element)
    }
}
