import Foundation
import Testing
@testable import SoundBuddyKit

private let captureConfigLines = [
    "/ch/01/config \"\" 1 MG 1",
    "/ch/02/config \"Vox 1\" 1 MG 2",
    "/ch/03/config \"Vox 2\" 1 MG 3",
    "/main/st/config \"\" 66 WH",
]

private func freshDefaults() -> UserDefaults {
    // One suite per test, so stored picks never leak across tests.
    UserDefaults(suiteName: UUID().uuidString)!
}

@Suite struct ConsoleTargetSelectionTests {
    @Test func storageTokenRoundTrips() {
        #expect(ConsoleTargetMemory.target(storageToken: ConsoleTargetMemory.storageToken(for: .mainLR)) == .mainLR)
        for index in 1...ConsoleTargetCatalog.channelCount {
            let target = ConsoleEQTarget.channel(index)
            #expect(ConsoleTargetMemory.target(storageToken: ConsoleTargetMemory.storageToken(for: target)) == target)
        }
    }

    @Test func invalidStoredTokenFallsBackToMainLR() {
        let defaults = freshDefaults()
        let console = ConsoleIdentity(name: "FOH", model: "M32R")

        #expect(ConsoleTargetMemory.load(for: console, in: defaults) == .mainLR)

        defaults.set("garbage", forKey: ConsoleTargetMemory.key(for: console))
        #expect(ConsoleTargetMemory.load(for: console, in: defaults) == .mainLR)

        defaults.set("ch0", forKey: ConsoleTargetMemory.key(for: console))
        #expect(ConsoleTargetMemory.load(for: console, in: defaults) == .mainLR)

        defaults.set("ch33", forKey: ConsoleTargetMemory.key(for: console))
        #expect(ConsoleTargetMemory.load(for: console, in: defaults) == .mainLR)
    }

    @Test func mainLRFirstAndSelectedThen32DeskTiles() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        for line in captureConfigLines {
            model.ingest(nodeLine: line)
        }

        #expect(model.selected == .mainLR)
        #expect(model.catalog.labels.count == 33)
        #expect(model.catalog.labels[0].target == .mainLR)
        for index in 1...32 {
            #expect(model.catalog.labels[index].target == .channel(index))
        }
        #expect(model.catalog.label(for: .channel(2)).displayName == "Vox 1")
        #expect(model.catalog.label(for: .channel(2)).color == .magenta)
    }

    @Test func resyncAfterDeskRenameShowsNewName() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        model.ingest(nodeLine: "/ch/02/config \"Vox 1\" 1 MG 2")
        #expect(model.catalog.label(for: .channel(2)).displayName == "Vox 1")

        model.ingest(nodeLine: "/ch/02/config \"Pastor\" 1 GN 2")
        let label = model.catalog.label(for: .channel(2))
        #expect(label.displayName == "Pastor")
        #expect(label.color == .green)
    }

    @Test func rememberedTargetPerConsole() {
        let defaults = freshDefaults()
        let consoleA = ConsoleIdentity(name: "FOH", model: "M32R")
        let consoleB = ConsoleIdentity(name: "Monitors", model: "X32")

        let modelA = ConsoleTargetModel(defaults: defaults)
        modelA.consoleChanged(consoleA)
        modelA.select(.channel(5))

        let reloadedA = ConsoleTargetModel(defaults: defaults)
        reloadedA.consoleChanged(consoleA)
        #expect(reloadedA.selected == .channel(5))

        let modelB = ConsoleTargetModel(defaults: defaults)
        modelB.consoleChanged(consoleB)
        #expect(modelB.selected == .mainLR)
    }

    @Test func sameConsoleReconnectKeepsNames() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        let console = ConsoleIdentity(name: "FOH", model: "M32R")
        model.consoleChanged(console)
        model.ingest(nodeLine: "/ch/02/config \"Vox 1\" 1 MG 2")

        // Reconnecting to the same console (identity unchanged) must not
        // blank the catalog the next resync is about to refresh.
        model.consoleChanged(console)
        #expect(model.catalog.label(for: .channel(2)).displayName == "Vox 1")
    }

    @Test func differentConsoleResetsCatalog() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        model.ingest(nodeLine: "/ch/02/config \"Vox 1\" 1 MG 2")

        model.consoleChanged(ConsoleIdentity(name: "Monitors", model: "X32"))
        #expect(model.catalog.label(for: .channel(2)).displayName == "Ch 2")
    }

    @Test func selectWithoutConsoleDoesNotPersist() {
        let defaults = freshDefaults()
        let model = ConsoleTargetModel(defaults: defaults)
        model.select(.channel(7))
        #expect(model.selected == .channel(7))

        let console = ConsoleIdentity(name: "FOH", model: "M32R")
        #expect(ConsoleTargetMemory.load(for: console, in: defaults) == .mainLR)
    }

    @Test func selectIgnoresOutOfRangeTarget() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        model.select(.channel(33))
        #expect(model.selected == .mainLR)
    }

    @Test func chipTitleUsesModelAndDisplayName() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        #expect(model.chipTitle == nil)

        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        #expect(model.chipTitle == "M32R · Main LR")

        model.ingest(nodeLine: "/ch/02/config \"Vox 1\" 1 MG 2")
        model.select(.channel(2))
        #expect(model.chipTitle == "M32R · Vox 1")
    }
}
