import Foundation
import Testing
@testable import SoundBuddyKit

private func strip(_ name: String, _ color: ConsoleChannelColor = .white, id: String = "/ch/01/config") -> ChannelRoleInput {
    ChannelRoleInput(id: id, name: name, color: color)
}

private func permuted(_ strips: [ChannelRoleInput], stride: Int) -> [ChannelRoleInput] {
    let count = strips.count
    return (0..<count).map { strips[($0 * stride) % count] }
}

private func assertPairwiseLabelStable(
    _ lhs: [ChannelRoleGuess],
    _ rhs: [ChannelRoleGuess],
    strips: [ChannelRoleInput],
    guesser: ChannelRoleGuesser
) {
    let lhsByID = Dictionary(uniqueKeysWithValues: lhs.map { ($0.id, $0) })
    let rhsByID = Dictionary(uniqueKeysWithValues: rhs.map { ($0.id, $0) })
    let stripsByID = Dictionary(uniqueKeysWithValues: strips.map { ($0.id, $0) })

    for strip in strips {
        guard let lhsGuess = lhsByID[strip.id], let rhsGuess = rhsByID[strip.id] else {
            Issue.record("missing guess for id \(strip.id)")
            continue
        }
        guard lhsGuess.basis != .context, rhsGuess.basis != .context else { continue }
        #expect(lhsGuess == rhsGuess, "id \(strip.id) differs across permutations")
        #expect(lhsGuess == guesser.labelGuess(for: stripsByID[strip.id]!), "id \(strip.id) differs from labelGuess")
    }
}

@Suite struct ChannelRoleGuesserTests {
    private static let guesser = ChannelRoleGuesser.bundled()

    // test data: TPC M32R spike 2026-10-29
    private static let spike: [ChannelRoleInput] = [
        strip("Ryan", .magenta, id: "s01"),
        strip("Lily", .magenta, id: "s02"),
        strip("Clarissa", .magenta, id: "s03"),
        strip("Sofia", .magenta, id: "s04"),
        strip("MC", .white, id: "s05"),
        strip("Headset", .cyan, id: "s06"),
        strip("Keys L", .red, id: "s07"),
        strip("Keys R", .red, id: "s08"),
        strip("EG L", .cyan, id: "s09"),
        strip("EG R", .cyan, id: "s10"),
        strip("AG", .blue, id: "s11"),
        strip("Bass", .yellow, id: "s12"),
        strip("", .off, id: "s13"),
        strip("", .off, id: "s14"),
        strip("", .off, id: "s15"),
        strip("Crowd", .white, id: "s16"),
        strip("TPerc", .red, id: "s17"),
        strip("TBass", .yellow, id: "s18"),
        strip("TEG L", .blue, id: "s19"),
        strip("TEG R", .blue, id: "s20"),
        strip("TKeys L", .green, id: "s21"),
        strip("TKeys R", .green, id: "s22"),
        strip("Click", .white, id: "s23"),
        strip("Guide", .red, id: "s24"),
        strip("Kick", .red, id: "s25"),
        strip("Snare", .red, id: "s26"),
        strip("F Tom", .red, id: "s27"),
        strip("Tom", .red, id: "s28"),
        strip("HiHat", .red, id: "s29"),
        strip("Cymbals", .red, id: "s30"),
        strip("MD 1", .white, id: "s31"),
        strip("MD 2", .white, id: "s32"),
        strip("ProP L", .yellow, id: "s33"),
        strip("ProP R", .yellow, id: "s34"),
        strip("Spotify L", .green, id: "s35"),
        strip("Spotify R", .green, id: "s36"),
        strip("", .green, id: "s37"),
        strip("", .green, id: "s38"),
        strip("USB L", .yellow, id: "s39"),
        strip("USB R", .yellow, id: "s40"),
    ]

    // Synthetic: different order, naming habits and blanks than the spike.
    private static let synthetic: [ChannelRoleInput] = [
        strip("Pastor", .magenta, id: "y01"),
        strip("Choir L", .yellow, id: "y02"),
        strip("Choir R", .yellow, id: "y03"),
        strip("Kik", .redInverted, id: "y04"),
        strip("", .off, id: "y05"),
        strip("Ld Vox", .green, id: "y06"),
        strip("Anna", .green, id: "y07"),
        strip("Ben", .green, id: "y08"),
        strip("Cara", .green, id: "y09"),
        strip("Dee", .green, id: "y10"),
        strip("OH L", .cyan, id: "y11"),
        strip("OH R", .cyan, id: "y12"),
        strip("Trk L", .green, id: "y13"),
        strip("Trk R", .green, id: "y14"),
        strip("", .off, id: "y15"),
        strip("Click", .blue, id: "y16"),
        strip("Crowd Mic", .white, id: "y17"),
        strip("Track 1", .blue, id: "y18"),
        strip("Track 2", .blue, id: "y19"),
        strip("CD L", .magenta, id: "y20"),
        strip("CD R", .magenta, id: "y21"),
        strip("", .magenta, id: "y22"), // named-off-color: blank but colored
        strip("Click L", .cyan, id: "y23"),
        strip("Talkback", .green, id: "y24"),
    ]

    @Test func instrumentLabelsGetTheirRoleAtHighConfidence() {
        let cases: [(String, ChannelRole)] = [
            ("Kick", .kick), ("Snare", .snare), ("HiHat", .hiHat), ("Bass", .bass),
            ("AG", .acousticGuitar), ("Keys L", .keys),
        ]
        for (name, role) in cases {
            let result = Self.guesser.labelGuess(for: strip(name))
            #expect(result.role == role, "\(name)")
            #expect(result.bucket == .high, "\(name)")
        }
    }

    @Test func tracksPrefixedLabelsAreTracksNotTheInstrument() {
        for name in ["TBass", "TKeys L", "Trk L"] {
            let result = Self.guesser.labelGuess(for: strip(name))
            #expect(result.role == .tracks, "\(name)")
            #expect(result.bucket != .low, "\(name)")
            #expect(result.role != .bass && result.role != .keys, "\(name)")
        }

        #expect(Self.guesser.labelGuess(for: strip("Tom")).role == .tom)
        #expect(Self.guesser.labelGuess(for: strip("Tamb")).role != .tracks)
    }

    @Test func clickAndGuideAreTheirOwnRolesAtHighConfidence() {
        let click = Self.guesser.labelGuess(for: strip("Click"))
        #expect(click.role == .click)
        #expect(click.bucket == .high)

        let guide = Self.guesser.labelGuess(for: strip("Guide"))
        #expect(guide.role == .guide)
        #expect(guide.bucket == .high)
    }

    @Test func playbackSourcesArePlayback() {
        for name in ["ProP L", "Spotify R", "USB L"] {
            #expect(Self.guesser.labelGuess(for: strip(name)).role == .playback, "\(name)")
        }
    }

    @Test func roomLabelsAreRoomMicAndRankedAsCandidates() {
        let strips = [
            strip("Crowd", .white, id: "r1"),
            strip("Kick", .red, id: "r2"),
            strip("Room", .white, id: "r3"),
            strip("Click", .blue, id: "r4"),
            strip("Amb L", .white, id: "r5"),
            strip("Aud Mic", .white, id: "r6"),
            strip("Bass", .yellow, id: "r7"),
        ]
        let roomIDs: Set<String> = ["r1", "r3", "r5", "r6"]

        let guesses = Self.guesser.guess(strips)
        for guess in guesses where roomIDs.contains(guess.id) {
            #expect(guess.role == .roomMic, "\(guess.id)")
        }

        let candidateIDs = Set(ChannelRoleGuesser.roomMicCandidates(in: guesses).map(\.id))
        #expect(candidateIDs == roomIDs)
    }

    @Test func roomMicCandidatesRankByConfidenceThenConsoleOrder() {
        let table = ChannelRoleAliasTable(
            version: 1,
            aliases: [.roomMic: ["room", "mic"]],
            tracksPrefixes: [],
            tracksStems: []
        )
        let guesser = ChannelRoleGuesser(aliases: table)
        let strips = [
            strip("Room Mic", .white, id: "a"),
            strip("Room", .white, id: "b"),
            strip("Room", .white, id: "c"),
        ]

        let guesses = guesser.guess(strips)
        #expect(guesses.first { $0.id == "a" }?.confidence == ChannelRoleGuesser.tokenAliasConfidence)
        #expect(guesses.first { $0.id == "b" }?.confidence == ChannelRoleGuesser.exactAliasConfidence)

        let candidates = ChannelRoleGuesser.roomMicCandidates(in: guesses)
        #expect(candidates.map(\.id) == ["b", "c", "a"])
    }

    @Test func peopleNamesInAColorRunNextToVoicesAreVocalAtMostMedium() {
        let spikeGuesses = Self.guesser.guess(Self.spike)
        for id in ["s01", "s02", "s03", "s04"] {
            guard let guess = spikeGuesses.first(where: { $0.id == id }) else {
                Issue.record("missing \(id)")
                continue
            }
            #expect(guess.role == .vocal, "\(id)")
            #expect(guess.bucket == .medium || guess.bucket == .low, "\(id)")
            #expect(guess.basis == .context, "\(id)")
            #expect(guess.reason.contains("neighbors"), "\(id)")
        }

        let syntheticGuesses = Self.guesser.guess(Self.synthetic)
        for id in ["y07", "y08", "y09", "y10"] {
            guard let guess = syntheticGuesses.first(where: { $0.id == id }) else {
                Issue.record("missing \(id)")
                continue
            }
            #expect(guess.role == .vocal, "\(id)")
            #expect(guess.bucket == .medium, "\(id)")
            #expect(guess.basis == .context, "\(id)")
        }
    }

    @Test func peopleNamesAloneAreUnknown() {
        let names = ["Ryan", "Lily", "Clarissa", "Sofia"]

        for name in names {
            let alone = Self.guesser.guess([strip(name, .magenta, id: "alone")])
            #expect(alone[0].role == .unknown, "\(name)")
        }

        let run = names.enumerated().map { index, name in
            strip(name, .magenta, id: "run\(index)")
        }
        for guess in Self.guesser.guess(run) {
            #expect(guess.role == .unknown, "\(guess.id)")
        }
    }

    @Test func unmatchedLabelsAreUnknownAtLowConfidence() {
        for name in ["MD 1", "MD 2", "Zzz", "IEM1", "Tamb"] {
            let result = Self.guesser.labelGuess(for: strip(name))
            #expect(result.role == .unknown, "\(name)")
            #expect(result.bucket == .low, "\(name)")
            #expect(result.confidence == 0, "\(name)")
        }
    }

    @Test func blankOffStripIsUnused() {
        let off = Self.guesser.labelGuess(for: strip("", .off))
        #expect(off.role == .unused)
        #expect(off.basis == .blank)

        let offInverted = Self.guesser.labelGuess(for: strip("   ", .offInverted))
        #expect(offInverted.role == .unused)
        #expect(offInverted.basis == .blank)

        let coloredBlank = Self.guesser.labelGuess(for: strip("", .magenta))
        #expect(coloredBlank.role == .unknown)
    }

    @Test func labelOnlyGuessesSurviveShuffleInBothFixtures() {
        for strips in [Self.spike, Self.synthetic] {
            let original = Self.guesser.guess(strips)
            let reversed = Self.guesser.guess(Array(strips.reversed()))
            let strided = Self.guesser.guess(permuted(strips, stride: 7))

            assertPairwiseLabelStable(original, reversed, strips: strips, guesser: Self.guesser)
            assertPairwiseLabelStable(original, strided, strips: strips, guesser: Self.guesser)
        }

        #expect(Self.guesser.guess(Self.spike).contains { $0.basis == .context })
    }

    @Test func labelCaseTableMatchesExpectedRoles() {
        let table: [(String, ChannelRole)] = [
            ("BD", .kick),
            ("AG 2", .acousticGuitar),
            ("Vox Pastor", .vocal),
            ("Kick In", .kick),
            ("Kick Out", .kick),
            ("OH R", .overheads),
            ("Kik", .kick),
            ("Snare Top", .snare),
            ("Sn", .snare),
            ("F Tom", .tom),
            ("Floor Tom", .tom),
            ("HH", .hiHat),
            ("Hi-Hat", .hiHat),
            ("Cymbals", .overheads),
            ("OH L", .overheads),
            ("Bass DI", .bass),
            ("EG L", .electricGuitar),
            ("Gtr", .electricGuitar),
            ("Ac Gtr", .acousticGuitar),
            ("Keys R", .keys),
            ("Piano", .keys),
            ("Pad", .synth),
            ("Synth", .synth),
            ("Ld Vox", .vocal),
            ("BGV", .vocal),
            ("Vox1", .vocal),
            ("Choir L", .choir),
            ("Pastor", .speech),
            ("MC", .speech),
            ("Headset", .speech),
            ("Lectern", .speech),
            ("Trk L", .tracks),
            ("TBass", .tracks),
            ("Track 1", .tracks),
            ("Click", .click),
            ("Guide", .guide),
            ("ProP R", .playback),
            ("Spotify L", .playback),
            ("USB R", .playback),
            ("Video", .playback),
            ("Crowd", .roomMic),
            ("Room", .roomMic),
            ("Amb L", .roomMic),
            ("Aud Mic", .roomMic),
            ("Talkback", .talkback),
            ("MD 1", .unknown),
            ("", .unknown),
        ]

        #expect(table.count >= 40)
        for (name, role) in table {
            #expect(Self.guesser.labelGuess(for: strip(name)).role == role, "\(name)")
        }
    }

    @Test func normalizedLabelHandlesCaseLimitNumbersSidesAndSpaces() {
        let cases: [(String, String)] = [
            ("Keys L", "keys"),
            ("AG 2", "ag"),
            ("Kick Out", "kick"),
            ("OH R", "oh"),
            ("TKeys L", "tkeys"),
            ("Hi-Hat", "hi hat"),
            ("MD 1", "md"),
            ("  ", ""),
            ("Acoustic Gtr Extra", "acoustic gtr"),
        ]
        for (input, expected) in cases {
            #expect(ChannelRoleGuesser.normalizedLabel(input) == expected, "\(input)")
        }
    }

    @Test func bundledAliasTableDecodesAndEveryAliasIsNormalizedAndUnique() throws {
        let table = try ChannelRoleAliasTable.loadBundled()
        #expect(table.version == 1)
        #expect(table.aliases[.unused] == nil)
        #expect(table.aliases[.unknown] == nil)

        var seen: [String: ChannelRole] = [:]
        for (role, words) in table.aliases {
            for word in words {
                #expect(word == ChannelRoleGuesser.normalizedLabel(word), "\(word) under \(role) is not normalized")
                if let existingRole = seen[word] {
                    Issue.record("\"\(word)\" is under both \(existingRole) and \(role)")
                } else {
                    seen[word] = role
                }
            }
        }
    }

    @Test func unknownRoleKeyInAliasJSONIsAnActionableError() {
        let json = Data("""
        {"version":1,"aliases":{"drums":["x"]},"tracksPrefixes":[],"tracksStems":[]}
        """.utf8)

        do {
            _ = try JSONDecoder().decode(ChannelRoleAliasTable.self, from: json)
            Issue.record("expected decode to throw")
        } catch let DecodingError.dataCorrupted(context) {
            #expect(context.debugDescription.contains("ChannelRole"))
        } catch {
            Issue.record("expected DecodingError.dataCorrupted, got \(error)")
        }
    }

    @Test func bundledFallsBackToEmptyTableWhenLoadFails() {
        struct InjectedLoadFailure: Error {}
        let guesser = ChannelRoleGuesser.bundled(load: { throw InjectedLoadFailure() })
        #expect(guesser.labelGuess(for: strip("Kick")).role == .unknown)
    }

    @Test func loadErrorMessageIsActionable() {
        #expect(ChannelRoleAliasTable.LoadError.missing.errorDescription?.contains("reinstall") == true)
    }
}
