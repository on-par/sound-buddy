import Foundation
import Testing
@testable import SoundBuddyKit

private let captureConfigLines = [
    "/ch/01/config \"\" 1 MG 1",
    "/ch/02/config \"Vox 1\" 1 MG 2",
    "/ch/03/config \"Vox 2\" 1 MG 3",
    "/main/st/config \"\" 66 WH",
]

private let mainLREqLines = [
    "/main/st/eq ON",
    "/main/st/eq/1 LShv 80 +0.00 0.7",
    "/main/st/eq/2 PEQ 250 +0.00 1.4",
    "/main/st/eq/3 PEQ 1000 +0.00 2.0",
    "/main/st/eq/4 PEQ 2500 +0.00 1.0",
    "/main/st/eq/5 PEQ 8000 +0.00 3.0",
    "/main/st/eq/6 HShv 12000 +0.00 0.7",
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

    @Test func band2GainPushUpdatesReadoutAndCurveImmediately() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        for line in mainLREqLines { model.ingest(nodeLine: line) }

        let before = model.eqPanel.curveDb
        model.ingest(push: OSCMessage("/main/st/eq/2/g", [.float(0.6)]))

        #expect(model.eqPanel.bandRows[1].gainText == "+3.0 dB")
        #expect(model.eqPanel.curveDb != before)
    }

    @Test func reconnectingKeepsLastValuesDimmedThenResyncRefreshes() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        for line in mainLREqLines { model.ingest(nodeLine: line) }
        model.phase = .live

        let liveRows = model.eqPanel.bandRows
        model.phase = .reconnecting
        #expect(model.eqPanel.bandRows == liveRows)
        #expect(model.eqPanel.isDimmed == true)
        #expect(model.eqPanel.statusPill == "Reconnecting…")

        model.ingest(nodeLine: "/main/st/eq/2 PEQ 250 +6.00 1.4")
        model.phase = .live
        #expect(model.eqPanel.bandRows[1].gainText == "+6.0 dB")
        #expect(model.eqPanel.isDimmed == false)
        #expect(model.eqPanel.statusPill == nil)
    }

    @Test func selectingAnotherTargetClearsEq() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        for line in mainLREqLines { model.ingest(nodeLine: line) }
        #expect(model.eq != nil)

        model.select(.channel(3))
        #expect(model.eq == nil)
    }

    @Test func differentConsoleClearsEqSameConsoleKeepsIt() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        let console = ConsoleIdentity(name: "FOH", model: "M32R")
        model.consoleChanged(console)
        for line in mainLREqLines { model.ingest(nodeLine: line) }
        #expect(model.eq != nil)

        model.consoleChanged(console)
        #expect(model.eq != nil)

        model.consoleChanged(ConsoleIdentity(name: "Monitors", model: "X32"))
        #expect(model.eq == nil)
    }

    @Test func pushForNonSelectedTargetIsIgnored() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        for line in mainLREqLines { model.ingest(nodeLine: line) }

        model.ingest(push: OSCMessage("/ch/02/eq/1/g", [.float(0.9)]))
        #expect(model.eqPanel.bandRows[0].gainText == "0.0 dB")
    }

    @Test func followDeskSelectDefaultsOff() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        #expect(model.followDeskSelect == false)
        #expect(model.deskSelectHint == nil)
    }

    @Test func followOnDeskSelectChannel7SwitchesPanelToChannel7() {
        let defaults = freshDefaults()
        let model = ConsoleTargetModel(defaults: defaults)
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        model.setFollowDeskSelect(true)

        model.ingest(push: OSCMessage("/-stat/selidx", [.int(6)]))

        #expect(model.selected == .channel(7))
        #expect(model.eqPanel.target == .channel(7))
        #expect(ConsoleTargetMemory.load(for: ConsoleIdentity(name: "FOH", model: "M32R"), in: defaults) == .channel(7))
    }

    @Test func followOnDeskSelectMainLRSelectsMainLR() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        model.select(.channel(2))
        model.setFollowDeskSelect(true)

        model.ingest(push: OSCMessage("/-stat/selidx", [.int(70)]))

        #expect(model.selected == .mainLR)
    }

    @Test func followOnDeskSelectBusKeepsTargetAndShowsNotSupportedHint() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        model.select(.channel(2))
        for line in ["/ch/02/eq ON", "/ch/02/eq/1 PEQ 250 +0.00 1.4", "/ch/02/eq/2 PEQ 1000 +0.00 2.0", "/ch/02/eq/3 PEQ 2500 +0.00 1.0", "/ch/02/eq/4 PEQ 8000 +0.00 3.0"] {
            model.ingest(nodeLine: line)
        }
        let eqBefore = model.eq
        model.setFollowDeskSelect(true)

        model.ingest(push: OSCMessage("/-stat/selidx", [.int(48)]))

        #expect(model.selected == .channel(2))
        #expect(model.eq == eqBefore)
        #expect(model.deskSelectHint == "Not supported yet")

        model.ingest(push: OSCMessage("/-stat/selidx", [.int(3)]))
        #expect(model.selected == .channel(4))
        #expect(model.deskSelectHint == nil)
    }

    @Test func followOffDeskSelectChangesNothing() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        model.select(.channel(2))
        for line in ["/ch/02/eq ON", "/ch/02/eq/1 PEQ 250 +0.00 1.4", "/ch/02/eq/2 PEQ 1000 +0.00 2.0", "/ch/02/eq/3 PEQ 2500 +0.00 1.0", "/ch/02/eq/4 PEQ 8000 +0.00 3.0"] {
            model.ingest(nodeLine: line)
        }
        let eqBefore = model.eq

        model.ingest(push: OSCMessage("/-stat/selidx", [.int(6)]))
        model.ingest(push: OSCMessage("/-stat/selidx", [.int(48)]))

        #expect(model.selected == .channel(2))
        #expect(model.eq == eqBefore)
        #expect(model.deskSelectHint == nil)
    }

    @Test func turningFollowOffClearsHint() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        model.setFollowDeskSelect(true)
        model.ingest(push: OSCMessage("/-stat/selidx", [.int(48)]))
        #expect(model.deskSelectHint == "Not supported yet")

        model.setFollowDeskSelect(false)
        #expect(model.deskSelectHint == nil)
    }

    @Test func manualSelectClearsHint() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        model.setFollowDeskSelect(true)
        model.ingest(push: OSCMessage("/-stat/selidx", [.int(48)]))
        #expect(model.deskSelectHint == "Not supported yet")

        model.select(.channel(5))
        #expect(model.deskSelectHint == nil)
    }

    @Test func consoleChangeClearsHint() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        model.setFollowDeskSelect(true)
        model.ingest(push: OSCMessage("/-stat/selidx", [.int(48)]))
        #expect(model.deskSelectHint == "Not supported yet")

        model.consoleChanged(ConsoleIdentity(name: "Monitors", model: "X32"))
        #expect(model.deskSelectHint == nil)
    }

    @Test func eqPushesStillFoldWithFollowOn() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        for line in mainLREqLines { model.ingest(nodeLine: line) }
        model.setFollowDeskSelect(true)

        model.ingest(push: OSCMessage("/main/st/eq/2/g", [.float(0.6)]))

        #expect(model.eqPanel.bandRows[1].gainText == "+3.0 dB")
    }

    private static func lowMidEvent(deviationDb: Double = 6) -> CoachingEvent {
        CoachingEvent(
            id: "lowMid", ruleType: .bandDeviation, severity: .suggestion, band: .lowMid,
            message: "test", data: ["deviationDb": .number(deviationDb)], source: .phoneMicEstimate, sessionTime: 0
        )
    }

    @Test func showCoachingSelectsMainLRAndPanelCarriesClampedGhostCut() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        model.select(.channel(2))

        model.showCoaching(Self.lowMidEvent())
        #expect(model.selected == .mainLR)

        for line in mainLREqLines { model.ingest(nodeLine: line) }

        let coaching = model.eqPanel.coaching
        #expect(coaching != nil)
        #expect((coaching?.band.gainDb ?? 0) >= -3.01)
        #expect((coaching?.band.gainDb ?? 0) < 0)
    }

    @Test func coachingSuggestionNilUntilMainLREqRead() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        model.select(.channel(2))
        model.showCoaching(Self.lowMidEvent())

        #expect(model.selected == .mainLR)
        #expect(model.eq == nil)
        #expect(model.eqPanel.coaching == nil)

        for line in mainLREqLines { model.ingest(nodeLine: line) }
        #expect(model.eqPanel.coaching != nil)
    }

    @Test func selectingAnotherTargetClearsCoaching() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        for line in mainLREqLines { model.ingest(nodeLine: line) }
        model.showCoaching(Self.lowMidEvent())
        #expect(model.coachingEvent != nil)

        model.select(.channel(3))
        #expect(model.coachingEvent == nil)
    }

    @Test func clearCoachingRemovesGhost() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        for line in mainLREqLines { model.ingest(nodeLine: line) }
        model.showCoaching(Self.lowMidEvent())
        #expect(model.eqPanel.coaching != nil)

        model.clearCoaching()
        #expect(model.coachingEvent == nil)
        #expect(model.eqPanel.coaching == nil)
    }

    @Test func consoleChangeClearsCoaching() {
        let model = ConsoleTargetModel(defaults: freshDefaults())
        model.consoleChanged(ConsoleIdentity(name: "FOH", model: "M32R"))
        for line in mainLREqLines { model.ingest(nodeLine: line) }
        model.showCoaching(Self.lowMidEvent())
        #expect(model.coachingEvent != nil)

        model.consoleChanged(ConsoleIdentity(name: "Monitors", model: "X32"))
        #expect(model.coachingEvent == nil)
    }
}
