import Foundation

/// Debug/UI-test-only fixture seeds for the channel-setup review (#1793): two
/// complete, no-desk-required layouts so Simulator screenshots can show the
/// "Check these" grouping and the room-mic pick with nothing on the wire.
/// Gated twice — `requested` returns `nil` outside Debug builds, and the
/// only caller (`SoundBuddyApp.init`) is itself wrapped in `#if DEBUG` — so
/// this type stays public and testable from `swift test` without ever
/// reaching a Release build.
public enum ChannelSetupFixture: String, CaseIterable, Sendable {
    case spike
    case synthetic

    public static let launchFlag = "-channelSetupFixture"

    /// `nil` outside Debug builds, or when `arguments` carries no recognized
    /// value after `launchFlag`.
    public static func requested(by arguments: [String], isDebugBuild: Bool) -> ChannelSetupFixture? {
        guard isDebugBuild else { return nil }
        guard let flagIndex = arguments.firstIndex(of: launchFlag), flagIndex + 1 < arguments.count else {
            return nil
        }
        return ChannelSetupFixture(rawValue: arguments[flagIndex + 1])
    }

    /// The model string each fixture's node lines were captured against —
    /// also `ConsoleChannelInventory(model:)`'s key.
    public var model: String {
        switch self {
        case .spike: return "M32R"
        case .synthetic: return "X32"
        }
    }

    public var nodeLines: [String] {
        switch self {
        case .spike: return ChannelSetupFixture.spikeNodeLines
        case .synthetic: return ChannelSetupFixture.syntheticNodeLines
        }
    }

    /// A fake `/xinfo` identity — no real console answers at this address.
    public var xInfo: ConsoleXInfo {
        let ip: String
        let name: String
        let firmware: String
        switch self {
        case .spike:
            ip = "10.0.0.7"
            name = "Fixture spike"
            firmware = "4.09"
        case .synthetic:
            ip = "10.0.0.8"
            name = "Fixture synthetic"
            firmware = "4.13"
        }
        let reply = OSCMessage("/xinfo", [.string(ip), .string(name), .string(model), .string(firmware)])
        guard let info = ConsoleXInfo(reply: reply) else {
            preconditionFailure("ChannelSetupFixture's own /xinfo reply must decode")
        }
        return info
    }

    /// Builds the inventory from `nodeLines` and guesses every role, exactly
    /// as a real read would — just with no socket involved.
    public func readResult(guesser: ChannelRoleGuesser = .bundled()) -> ConsoleChannelReadResult {
        ChannelSetupFixture.readResult(lines: nodeLines, model: model, guesser: guesser)
    }

    /// Same as `readResult(guesser:)`, except `id`'s own line has its quoted
    /// name replaced with `newName` first (the `ChannelSetupDiffTests.rename`
    /// algorithm). A no-op edit — the unedited read — if `id` has no line.
    /// Used by the recheck tests and the DEBUG `-channelSetupRecheckFixture`
    /// proof seed to synthesize "the desk changed since last time".
    public func readResult(renaming id: ConsoleStripID, to newName: String, guesser: ChannelRoleGuesser = .bundled()) -> ConsoleChannelReadResult {
        var lines = nodeLines
        ChannelSetupFixture.rename(&lines, id: id, to: newName)
        return ChannelSetupFixture.readResult(lines: lines, model: model, guesser: guesser)
    }

    private static func readResult(lines: [String], model: String, guesser: ChannelRoleGuesser) -> ConsoleChannelReadResult {
        guard var inventory = ConsoleChannelInventory(model: model) else {
            preconditionFailure("ChannelSetupFixture.model (\(model)) must be in ConsoleChannelInventory's model table")
        }
        for line in lines {
            inventory.apply(nodeLine: line)
        }
        let guesses = guesser.guess(ConsoleChannelReadResult.roleInputs(from: inventory))
        return ConsoleChannelReadResult(
            inventory: inventory,
            guesses: guesses,
            roomMicCandidates: ChannelRoleGuesser.roomMicCandidates(in: guesses)
        )
    }

    /// Internal (not `private`) so the recheck tests' own line-editing
    /// helpers (recolor, resource) can share this instead of re-deriving it.
    static func closingQuoteIndex(in line: String) -> String.Index? {
        guard let openQuote = line.firstIndex(of: "\"") else { return nil }
        return line[line.index(after: openQuote)...].firstIndex(of: "\"")
    }

    static func rename(_ lines: inout [String], id: ConsoleStripID, to newName: String) {
        guard let index = lines.firstIndex(where: { $0.hasPrefix(id.configPath + " ") }) else { return }
        guard let openQuote = lines[index].firstIndex(of: "\""), let closeQuote = closingQuoteIndex(in: lines[index]) else { return }
        lines[index].replaceSubrange(lines[index].index(after: openQuote)..<closeQuote, with: newName)
    }

    // test data: TPC M32R spike 2026-10-29 (person-name variant) — the same
    // shape as the on-disk spike fixture
    // (Tests/Fixtures/console-channel-inventory.tpc-m32r-spike.json), but
    // ch01...04 carry person names (as in
    // ChannelSetupReviewTests.spikePeopleNamesLines) instead of the real
    // capture's "Vox 1".."Vox 3", so Check These has something to confirm.
    private static let spikeNodeLines: [String] = [
        "/ch/01/config \"Ryan\" 1 MG 1",
        "/ch/02/config \"Lily\" 1 MG 2",
        "/ch/03/config \"Clarissa\" 1 MG 3",
        "/ch/04/config \"Sofia\" 1 MG 4",
        "/ch/05/config \"MC\" 1 WH 5",
        "/ch/06/config \"Headset\" 1 CY 6",
        "/ch/07/config \"Keys L\" 1 RD 7",
        "/ch/08/config \"Keys R\" 1 RD 8",
        "/ch/09/config \"EG L\" 1 CY 9",
        "/ch/10/config \"EG R\" 1 CY 10",
        "/ch/11/config \"AG\" 1 BL 11",
        "/ch/12/config \"Bass\" 1 YE 12",
        "/ch/13/config \"\" 1 OFF 13",
        "/ch/14/config \"\" 1 OFF 14",
        "/ch/15/config \"\" 1 OFF 15",
        "/ch/16/config \"Crowd\" 1 WH 16",
        "/ch/17/config \"TPerc\" 1 RD 17",
        "/ch/18/config \"TBass\" 1 YE 18",
        "/ch/19/config \"TEG L\" 1 BL 19",
        "/ch/20/config \"TEG R\" 1 BL 20",
        "/ch/21/config \"TKeys L\" 1 GN 21",
        "/ch/22/config \"TKeys R\" 1 GN 22",
        "/ch/23/config \"Click\" 1 WH 23",
        "/ch/24/config \"Guide\" 1 RD 24",
        "/ch/25/config \"Kick\" 1 RD 25",
        "/ch/26/config \"Snare\" 1 RD 26",
        "/ch/27/config \"F Tom\" 1 RD 27",
        "/ch/28/config \"Tom\" 1 RD 28",
        "/ch/29/config \"HiHat\" 1 RD 29",
        "/ch/30/config \"Cymbals\" 1 RD 30",
        "/ch/31/config \"MD 1\" 1 WH 31",
        "/ch/32/config \"MD 2\" 1 WH 32",
        "/auxin/01/config \"ProP L\" 55 YE 33",
        "/auxin/02/config \"ProP R\" 55 YE 34",
        "/auxin/03/config \"Spotify L\" 55 GN 35",
        "/auxin/04/config \"Spotify R\" 55 GN 36",
        "/auxin/05/config \"\" 55 GN 37",
        "/auxin/06/config \"\" 55 GN 38",
        "/auxin/07/config \"USB L\" 60 YE 39",
        "/auxin/08/config \"USB R\" 60 YE 40",
        "/bus/01/config \"IEM1\" 71 CY",
        "/bus/02/config \"IEM1\" 71 CY",
        "/bus/03/config \"IEM2\" 71 CY",
        "/bus/04/config \"IEM2\" 71 CY",
        "/bus/05/config \"IEM3\" 71 CY",
        "/bus/06/config \"IEM3\" 71 CY",
        "/bus/07/config \"IEM4\" 71 CY",
        "/bus/08/config \"IEM4\" 71 CY",
        "/bus/09/config \"IEM5\" 71 CY",
        "/bus/10/config \"IEM6\" 71 CY",
        "/bus/11/config \"IEM7\" 71 CY",
        "/bus/12/config \"IEM8\" 71 CY",
        "/bus/13/config \"D-Verb\" 71 MG",
        "/bus/14/config \"B-Verb\" 71 MG",
        "/bus/15/config \"Vox Verb\" 71 MG",
        "/bus/16/config \"Vox Delay\" 71 MG",
    ]

    // Copied verbatim from
    // Tests/SoundBuddyKitTests/Fixtures/console-channel-inventory.synthetic.json's
    // nodeLines, so the Debug fixture and the Kit test fixture never drift.
    private static let syntheticNodeLines: [String] = [
        "/ch/01/config \"Pastor\" 1 MG 9",
        "/ch/02/config \"Choir L\" 1 YE 10",
        "/ch/03/config \"Choir R\" 1 YE 11",
        "/ch/04/config \"Kik\" 1 RDi 12",
        "/ch/05/config \"\" 1 OFF 0",
        "/ch/06/config \"\" 1 OFF 0",
        "/ch/07/config \"OH L\" 1 CY 13",
        "/ch/08/config \"OH R\" 1 CY 14",
        "/ch/09/config \"Trk L\" 1 GN 35",
        "/ch/10/config \"Trk R\" 1 GN 39",
        "/ch/11/config \"\" 1 OFF 0",
        "/ch/12/config \"\" 1 OFF 0",
        "/ch/13/config \"Click\" 1 BL 44",
        "/ch/14/config \"\" 1 OFF 0",
        "/ch/15/config \"\" 1 OFF 0",
        "/ch/16/config \"Crowd Mic\" 1 WH 50",
        "/ch/17/config \"\" 1 OFF 0",
        "/ch/18/config \"\" 1 OFF 0",
        "/ch/19/config \"\" 1 OFF 0",
        "/ch/20/config \"\" 1 OFF 0",
        "/ch/21/config \"\" 1 OFF 0",
        "/ch/22/config \"\" 1 OFF 0",
        "/ch/23/config \"\" 1 OFF 0",
        "/ch/24/config \"\" 1 OFF 0",
        "/ch/25/config \"\" 1 OFF 0",
        "/ch/26/config \"\" 1 OFF 0",
        "/ch/27/config \"\" 1 OFF 0",
        "/ch/28/config \"\" 1 OFF 0",
        "/ch/29/config \"\" 1 OFF 0",
        "/ch/30/config \"\" 1 OFF 0",
        "/ch/31/config \"\" 1 OFF 0",
        "/ch/32/config \"\" 1 OFF 0",
        "/auxin/01/config \"Track 1\" 55 BL 33",
        "/auxin/02/config \"Track 2\" 55 BL 34",
        "/auxin/03/config \"CD L\" 55 MG 35",
        "/auxin/04/config \"CD R\" 55 MG 36",
        "/auxin/05/config \"\" 55 MG 37",
        "/auxin/06/config \"\" 55 MG 38",
        "/auxin/07/config \"Click L\" 60 CY 39",
        "/auxin/08/config \"Click R\" 60 CY 40",
        "/bus/01/config \"Mon1\" 71 RD",
        "/bus/02/config \"Mon2\" 71 RD",
        "/bus/03/config \"Mon3\" 71 RD",
        "/bus/04/config \"Mon4\" 71 RD",
        "/bus/05/config \"Mon5\" 71 RD",
        "/bus/06/config \"Mon6\" 71 RD",
        "/bus/07/config \"Mon7\" 71 RD",
        "/bus/08/config \"Mon8\" 71 RD",
        "/bus/09/config \"FX1\" 71 BL",
        "/bus/10/config \"FX2\" 71 BL",
        "/bus/11/config \"FX3\" 71 BL",
        "/bus/12/config \"FX4\" 71 BL",
        "/bus/13/config \"Talkback\" 71 GN",
        "/bus/14/config \"Record\" 71 GN",
        "/bus/15/config \"Video\" 71 GN",
        "/bus/16/config \"ClickMix\" 71 GN",
    ]
}
