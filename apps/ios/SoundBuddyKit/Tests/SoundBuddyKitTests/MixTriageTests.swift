import Foundation
import Testing
@testable import SoundBuddyKit

private let tolerance = 1e-9

private func bandEvent(
    _ band: Band?,
    deviation: CoachingEvent.DataValue?,
    id: String? = nil,
    ruleType: CoachingEvent.RuleType = .bandDeviation
) -> CoachingEvent {
    CoachingEvent(
        id: id ?? "band-deviation-\(band?.rawValue ?? "none")",
        ruleType: ruleType,
        severity: .suggestion,
        band: band,
        message: "\(band?.label ?? "None") message",
        data: deviation.map { ["deviationDb": $0] },
        source: .phoneMicEstimate,
        sessionTime: 1
    )
}

@Suite("AttentionSeverity")
struct AttentionSeverityTests {
    @Test(
        "issue at 6 dB or more either way, check below",
        arguments: [
            (6.0, AttentionSeverity.issue),
            (-6.0, .issue),
            (9.4, .issue),
            (5.9, .check),
            (-5.9, .check),
            (3.1, .check),
        ]
    )
    func severity(deviation: Double, expected: AttentionSeverity) {
        #expect(AttentionSeverity(deviationDb: deviation) == expected)
    }

    @Test func labels() {
        #expect(AttentionSeverity.issue.label == "Issue")
        #expect(AttentionSeverity.check.label == "Check")
    }
}

@Suite("AttentionItem")
struct AttentionItemTests {
    @Test func buildsFromABandDeviationEvent() throws {
        let item = try #require(AttentionItem(event: bandEvent(.presence, deviation: .number(-6.2))))
        #expect(item.id == "band-deviation-presence")
        #expect(item.band == .presence)
        #expect(item.bandLabel == "Presence")
        #expect(item.rangeLabel == "4000-6000 Hz")
        #expect(abs(item.deviationDb - -6.2) < tolerance)
        #expect(item.direction == .underTarget)
        #expect(item.severity == .issue)
        #expect(item.message == "Presence message")
        #expect(item.deviationText == "\u{2212}6.2 dB")
    }

    @Test func overTargetTextHasAPlusSign() throws {
        let item = try #require(AttentionItem(event: bandEvent(.bass, deviation: .number(4.26))))
        #expect(item.direction == .overTarget)
        #expect(item.severity == .check)
        #expect(item.deviationText == "+4.3 dB")
    }

    @Test(
        "unusable events give no item",
        arguments: [
            bandEvent(.bass, deviation: nil),
            bandEvent(.bass, deviation: .number(.nan)),
            bandEvent(.bass, deviation: .number(.infinity)),
            bandEvent(.bass, deviation: .number(0)),
            bandEvent(.bass, deviation: .string("6")),
            bandEvent(nil, deviation: .number(6)),
            bandEvent(.bass, deviation: .number(6), ruleType: .harshness),
        ]
    )
    func unusable(event: CoachingEvent) {
        #expect(AttentionItem(event: event) == nil)
    }
}

@Suite("MixTriage")
struct MixTriageTests {
    @Test func emptyInputIsEmpty() {
        let triage = MixTriage(events: [], sermonQuiet: false)
        #expect(triage.visible.isEmpty)
        #expect(triage.heldCount == 0)
        #expect(triage.badgeCount == 0)
    }

    @Test func keepsEventOrderAndCountsTheBadgeFromVisibleItems() {
        let triage = MixTriage(
            events: [bandEvent(.bass, deviation: .number(7)), bandEvent(.presence, deviation: .number(-4))],
            sermonQuiet: false
        )
        #expect(triage.visible.map(\.band) == [.bass, .presence])
        #expect(triage.badgeCount == 2)
        #expect(triage.heldCount == 0)
    }

    @Test func capsAtThreeItems() {
        let events = [Band.bass, .lowMid, .mid, .presence].map { bandEvent($0, deviation: .number(7)) }
        let triage = MixTriage(events: events, sermonQuiet: false)
        #expect(MixTriage.maxVisible == 3)
        #expect(triage.visible.map(\.band) == [.bass, .lowMid, .mid])
        #expect(triage.badgeCount == 3)
        #expect(triage.heldCount == 0)
    }

    @Test func dropsUnusableEventsWithoutCountingThemAsHeld() {
        let triage = MixTriage(
            events: [bandEvent(.bass, deviation: nil), bandEvent(.mid, deviation: .number(.nan)), bandEvent(.presence, deviation: .number(5))],
            sermonQuiet: true
        )
        #expect(triage.visible.isEmpty)
        #expect(triage.heldCount == 1)
    }

    @Test func sermonQuietShowsOnlyOverTargetIssuesAndHoldsTheRest() {
        let events = [
            bandEvent(.bass, deviation: .number(7)),
            bandEvent(.presence, deviation: .number(-8)),
            bandEvent(.mid, deviation: .number(4)),
        ]
        let triage = MixTriage(events: events, sermonQuiet: true)
        #expect(triage.visible.map(\.band) == [.bass])
        #expect(triage.heldCount == 2)
        #expect(triage.badgeCount == 1)
    }

    @Test func sermonQuietOffHoldsNothing() {
        let events = [bandEvent(.presence, deviation: .number(-8)), bandEvent(.mid, deviation: .number(4))]
        let triage = MixTriage(events: events, sermonQuiet: false)
        #expect(triage.visible.count == 2)
        #expect(triage.heldCount == 0)
    }
}

@Suite("SermonQuiet")
struct SermonQuietTests {
    @Test func defaultsAreOffUnderAStableKey() {
        #expect(SermonQuiet.defaultsKey == "mix.sermonQuiet")
        #expect(SermonQuiet.defaultValue == false)
    }

    @Test(
        "shows only over-target issues",
        arguments: [
            (6.5, true),
            (6.0, true),
            (5.5, false),
            (-6.5, false),
            (-3.5, false),
        ]
    )
    func shows(deviation: Double, expected: Bool) throws {
        let item = try #require(AttentionItem(event: bandEvent(.bass, deviation: .number(deviation))))
        #expect(SermonQuiet.shows(item) == expected)
    }
}

@Suite("MixChannelList")
struct MixChannelListTests {
    @Test func blankCatalogHasNoRows() {
        #expect(MixChannelList.rows(from: ConsoleTargetCatalog()).isEmpty)
    }

    @Test func keepsNamedOrColouredStripsInDeskOrder() {
        var catalog = ConsoleTargetCatalog()
        catalog.apply(nodeLine: "/main/st/config \"\" 66 WH")
        catalog.apply(nodeLine: "/ch/02/config \"Vox 1\" 1 MG 2")
        catalog.apply(nodeLine: "/ch/04/config \"Pastor\" 1 RDi 4")
        catalog.apply(nodeLine: "/ch/09/config \"\" 1 OFF 9")
        let rows = MixChannelList.rows(from: catalog)
        #expect(rows.map(\.displayName) == ["Main LR", "Vox 1", "Pastor"])
        #expect(rows.map(\.color) == [.white, .magenta, .redInverted])
    }
}

@Suite("MixChannelsState")
struct MixChannelsStateTests {
    @Test func noConsoleModelIsALabelledUnavailableState() {
        let state = MixChannelsState(catalog: nil)
        #expect(state == .unavailable)
        #expect(state.rows.isEmpty)
        #expect(state.emptyMessage == MixCopy.channelsUnavailable)
    }

    @Test func aConsoleWithAnEmptyCatalogKeepsTheDiscoverCopy() {
        let state = MixChannelsState(catalog: ConsoleTargetCatalog())
        #expect(state == .empty)
        #expect(state.rows.isEmpty)
        #expect(state.emptyMessage == MixCopy.noChannels)
    }

    @Test func aConsoleWithOnlyBlankStripsIsStillEmpty() {
        var catalog = ConsoleTargetCatalog()
        catalog.apply(nodeLine: "/ch/09/config \"\" 1 OFF 9")
        #expect(MixChannelsState(catalog: catalog) == .empty)
    }

    @Test func aFilledCatalogListsItsRowsWithNoMessage() {
        var catalog = ConsoleTargetCatalog()
        catalog.apply(nodeLine: "/ch/02/config \"Vox 1\" 1 MG 2")
        let state = MixChannelsState(catalog: catalog)
        #expect(state == .rows(MixChannelList.rows(from: catalog)))
        #expect(state.rows.map(\.displayName) == ["Vox 1"])
        #expect(state.emptyMessage == nil)
    }

    @Test func unavailableCopyNeverPointsAtASettingsRowThatMayNotExist() {
        #expect(MixCopy.channelsUnavailable == "Channel names need a live console link. Not in this build.")
        #expect(!MixCopy.channelsUnavailable.contains("Discover"))
        #expect(MixCopy.noChannels == "No channel list yet. Run Discover channel setup in Settings › Console (beta).")
    }
}

@Suite("MixCopy")
struct MixCopyTests {
    @Test func segmentTitles() {
        #expect(MixCopy.attentionSegment(count: 2) == "Attention 2")
        #expect(MixCopy.channelsSegment(count: 6) == "Channels 6")
        #expect(MixCopy.channelsSegment(count: 0) == "Channels")
    }

    @Test func heldFooter() {
        #expect(MixCopy.heldFooter(count: 0) == nil)
        #expect(MixCopy.heldFooter(count: 2) == "2 held by Sermon Quiet")
    }

    @Test func sublineUsesTheConsoleChipWhenPresent() {
        #expect(MixCopy.subline(chipTitle: "M32R · Main LR", chipStatus: .live) == "M32R · Main LR · Live")
        #expect(MixCopy.subline(chipTitle: nil, chipStatus: nil) == "Room mic · phone estimate")
    }

    @Test func honestCopyNeverNamesAFabricatedSource() {
        #expect(MixCopy.meterUnavailable == "Fader, level and GR need console meters. Not in this build.")
        #expect(MixCopy.sermonQuietCaption == "This device only. Changes what you see here, not the console.")
        #expect(MixCopy.sourceLine == "Room mic · Main LR")
        #expect(MixCopy.onTarget == CoachingStabilizer.onTargetMessage)
    }
}

@Suite("MixTriage empty state")
struct MixTriageEmptyStateTests {
    @Test func visibleItemsNeedNoEmptyMessage() {
        let triage = MixTriage(events: [bandEvent(.bass, deviation: .number(7))], sermonQuiet: false)
        #expect(triage.emptyMessage(isMixOnTarget: false, placeholder: "p") == nil)
    }

    @Test func onTargetWins() {
        #expect(MixTriage(events: [], sermonQuiet: false).emptyMessage(isMixOnTarget: true, placeholder: "p") == MixCopy.onTarget)
    }

    @Test func otherwiseThePlaceholder() {
        #expect(MixTriage(events: [], sermonQuiet: false).emptyMessage(isMixOnTarget: false, placeholder: "p") == "p")
    }

    @Test func everythingHeldSaysSoInsteadOfTheListeningPlaceholder() {
        let triage = MixTriage(events: [bandEvent(.mid, deviation: .number(4))], sermonQuiet: true)
        #expect(triage.emptyMessage(isMixOnTarget: false, placeholder: "p") == MixCopy.allHeld)
    }
}

@Suite("MixLayout")
struct MixLayoutTests {
    @Test(
        "the rail and three-across cards only in iPad landscape",
        arguments: [
            (1336.0, 948.0, true),
            (1093.0, 660.0, true),
            (984.0, 1272.0, false),
            (774.0, 369.0, false),
            (390.0, 852.0, false),
        ]
    )
    func rail(width: Double, height: Double, expected: Bool) {
        let layout = MixLayout(width: width, height: height)
        #expect(layout.showsAgentRail == expected)
        #expect(layout.cardsAcross == (expected ? 3 : 1))
    }

    @Test func railWidthMatchesTheDesign() {
        #expect(MixLayout.railWidth == 408)
    }
}
