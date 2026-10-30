import Foundation
import Testing
@testable import SoundBuddyKit

// Real example lines from packages/console/src/capture-2026-08-16.scn.
private let captureConfigLines = [
    "/ch/01/config \"\" 1 MG 1",
    "/ch/02/config \"Vox 1\" 1 MG 2",
    "/ch/03/config \"Vox 2\" 1 MG 3",
    "/main/st/config \"\" 66 WH",
]

@Suite struct ConsoleTargetCatalogTests {
    @Test func catalogListsMainLRFirstThen32Channels() {
        let catalog = ConsoleTargetCatalog()
        #expect(catalog.labels.count == 33)
        #expect(catalog.labels[0].target == .mainLR)
        for index in 1...32 {
            #expect(catalog.labels[index].target == .channel(index))
        }
    }

    @Test func parsesRealCaptureConfigLines() {
        var catalog = ConsoleTargetCatalog()
        for line in captureConfigLines {
            #expect(catalog.apply(nodeLine: line) == true)
        }

        let vox1 = catalog.label(for: .channel(2))
        #expect(vox1.name == "Vox 1")
        #expect(vox1.color == .magenta)

        let main = catalog.label(for: .mainLR)
        #expect(main.name == "")
        #expect(main.color == .white)
        #expect(main.displayName == "Main LR")

        let ch1 = catalog.label(for: .channel(1))
        #expect(ch1.displayName == "Ch 1")
    }

    @Test func parsesInvertedColor() {
        var catalog = ConsoleTargetCatalog()
        #expect(catalog.apply(nodeLine: "/ch/04/config \"Pastor\" 1 RDi 4") == true)
        let label = catalog.label(for: .channel(4))
        #expect(label.color == .redInverted)
        #expect(label.color.isInverted == true)
        #expect(label.color.base == .red)
    }

    @Test func rejectsMalformedConfigLines() {
        let malformedLines = [
            "/ch/01/config \"Vox 1 1 MG 1", // unterminated quote
            "/ch/01/config 1 MG 1", // no quotes
            "/ch/01/config \"Vox 1\" 1", // missing color
            "/ch/01/config \"Vox 1\" abc MG 1", // non-int icon
            "/ch/01/config \"Vox 1\" 1 PK 1", // unknown color token
            "/ch/01/config \"Vox 1\" 1 rd 1", // lowercase color token
            "/ch/00/config \"Vox 1\" 1 MG 1", // channel 00
            "/ch/33/config \"Vox 1\" 1 MG 1", // channel 33
            "/bus/01/config \"Vox 1\" 1 MG 1", // out-of-scope path
            "/main/m/config \"Vox 1\" 1 MG 1", // out-of-scope path
            "/ch/01/eq \"Vox 1\" 1 MG 1", // out-of-scope path
            "", // empty
        ]

        for line in malformedLines {
            var catalog = ConsoleTargetCatalog()
            let before = catalog
            let applied = catalog.apply(nodeLine: line)
            #expect(applied == false, "expected \"\(line)\" to be rejected")
            #expect(catalog == before, "expected \"\(line)\" to leave the catalog unchanged")
        }
    }

    @Test func laterLineReplacesNameAndColor() {
        var catalog = ConsoleTargetCatalog()
        #expect(catalog.apply(nodeLine: "/ch/02/config \"Vox 1\" 1 MG 2") == true)
        #expect(catalog.apply(nodeLine: "/ch/02/config \"Pastor\" 1 GN 2") == true)

        let label = catalog.label(for: .channel(2))
        #expect(label.displayName == "Pastor")
        #expect(label.color == .green)
    }

    @Test func walkMessagesAreThe33BoundedConfigReadsMainFirst() throws {
        let messages = ConsoleTargetCatalog.walkMessages()
        #expect(messages.count == 33)

        guard case let .string(firstArg) = messages[0].arguments[0] else {
            Issue.record("expected a string argument")
            return
        }
        #expect(firstArg == "main/st/config")

        guard case let .string(secondArg) = messages[1].arguments[0] else {
            Issue.record("expected a string argument")
            return
        }
        #expect(secondArg == "ch/01/config")

        guard case let .string(lastArg) = messages[32].arguments[0] else {
            Issue.record("expected a string argument")
            return
        }
        #expect(lastArg == "ch/32/config")

        for message in messages {
            #expect(throws: Never.self) {
                try OSCCodec.encode(message)
            }
        }
    }

    @Test func onlyFullResyncWalks() {
        #expect(ConsoleTargetCatalog.walkMessages(for: .requestFullResync).count == 33)

        let otherEffects: [ConsoleSessionEffect] = [
            .openSocket,
            .closeSocket,
            .sendXInfo,
            .sendStatus,
            .sendXRemote,
            .resyncTarget("/ch/01/eq"),
            .returnToConnectFlow(.unreachable),
        ]
        for effect in otherEffects {
            #expect(ConsoleTargetCatalog.walkMessages(for: effect).isEmpty)
        }
    }

    @Test func syncingEntryTriggersWalk() {
        let identity = ConsoleIdentity(name: "FOH", model: "M32R")
        var state = ConsoleSessionState.idle
        var effects: [ConsoleSessionEffect]

        (state, effects) = ConsoleSessionReducer.reduce(state, .connect(identity), now: 0)
        (state, effects) = ConsoleSessionReducer.reduce(state, .identityReceived(identity), now: 0)
        #expect(state.phase == .syncing)

        var walked = effects.flatMap { ConsoleTargetCatalog.walkMessages(for: $0) }
        #expect(walked.count == 33)

        // A reconnect's identityReceived walks again.
        (state, _) = ConsoleSessionReducer.reduce(state, .socketFailed, now: 1)
        #expect(state.phase == .reconnecting)
        (state, effects) = ConsoleSessionReducer.reduce(state, .identityReceived(identity), now: 1)
        #expect(state.phase == .syncing)
        walked = effects.flatMap { ConsoleTargetCatalog.walkMessages(for: $0) }
        #expect(walked.count == 33)
    }

    @Test func unknownTargetLabelIsBlank() {
        let catalog = ConsoleTargetCatalog()
        let label = catalog.label(for: .channel(99))
        #expect(label.name == "")
        #expect(label.color == .off)
    }

    @Test func configLineParserExposesSourceToken() {
        let withSource = ConsoleConfigLine(nodeLine: "/ch/02/config \"Vox 1\" 1 MG 2")
        #expect(withSource?.path == "/ch/02/config")
        #expect(withSource?.name == "Vox 1")
        #expect(withSource?.icon == 1)
        #expect(withSource?.colorToken == "MG")
        #expect(withSource?.sourceToken == "2")

        let withoutSource = ConsoleConfigLine(nodeLine: "/main/st/config \"\" 66 WH")
        #expect(withoutSource?.path == "/main/st/config")
        #expect(withoutSource?.sourceToken == nil)

        #expect(ConsoleConfigLine(nodeLine: "/ch/01/config \"Vox 1 1 MG 1") == nil) // unterminated quote
    }

    @Test func colorFromRawInt() {
        #expect(ConsoleChannelColor(rawInt: 0) == .off)
        #expect(ConsoleChannelColor(rawInt: 15) == .whiteInverted)
        #expect(ConsoleChannelColor(rawInt: 16) == nil)
        #expect(ConsoleChannelColor(rawInt: -1) == nil)
    }
}
