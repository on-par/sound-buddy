import Foundation
import Testing
@testable import SoundBuddyKit

private func confirmedSetup(_ fixture: ChannelSetupFixture, at date: Date = Date(timeIntervalSince1970: 1_700_000_000)) throws -> ConfirmedChannelSetup {
    let read = fixture.readResult()
    var review = ChannelSetupReview(console: ConsoleIdentity(fixture.xInfo), inventory: read.inventory, guesses: read.guesses, roomMicCandidates: read.roomMicCandidates)
    review.confirmAll()
    return try #require(review.done(confirmedAt: date))
}

private let testLocale = Locale(identifier: "en_US_POSIX")
private let testTimeZone = TimeZone(identifier: "UTC")!

@MainActor
@Suite struct ChannelSetupSettingsTests {
    @Test func sectionVisibleOnlyWithFlagAndConsent() {
        let combinations: [(flag: Bool, consent: Bool, visible: Bool)] = [
            (false, false, false),
            (false, true, false),
            (true, false, false),
            (true, true, true),
        ]

        for combination in combinations {
            let visible = ChannelSetupSettingsModel.isSectionVisible(flagEnabled: combination.flag, consentGranted: combination.consent)
            #expect(visible == combination.visible, "expected \(combination) to be \(combination.visible)")
        }
    }

    @Test func noSavedSetupYieldsNoRowsAndEmptyCopy() {
        let store = ChannelSetupStore(defaults: UserDefaults(suiteName: UUID().uuidString)!)
        let model = ChannelSetupSettingsModel(setupStore: store, forget: { _ in })

        #expect(model.rows == [])
        #expect(ChannelSetupSettingsCopy.empty == "No channel setup yet")
    }

    @Test(arguments: ChannelSetupFixture.allCases)
    func rowsListEachSavedConsoleWithNameModelAndConfirmedDate(_ fixture: ChannelSetupFixture) throws {
        let store = ChannelSetupStore(defaults: UserDefaults(suiteName: UUID().uuidString)!)
        let date = Date(timeIntervalSince1970: 1_700_000_000)
        let setup = try confirmedSetup(fixture, at: date)
        try store.save(setup, ipHint: fixture.xInfo.ip)

        let model = ChannelSetupSettingsModel(setupStore: store, forget: { _ in }, locale: testLocale, timeZone: testTimeZone)

        #expect(model.rows.count == 1)
        let row = try #require(model.rows.first)
        #expect(row.title == fixture.xInfo.name)
        #expect(row.detail.contains(fixture.model))
        #expect(row.detail.contains(ChannelSetupSettingsCopy.confirmedOn(date, locale: testLocale, timeZone: testTimeZone)))
        #expect(row.confirmedAt == date)

        try store.save(try confirmedSetup(fixture == .spike ? .synthetic : .spike, at: date), ipHint: nil)
        model.refresh()
        #expect(model.rows.count == 2)
        #expect(model.rows.map(\.console) == store.savedConsoles)
    }

    @Test(arguments: ChannelSetupFixture.allCases)
    func rowAccessibilityLabelNamesConsoleModelAndDate(_ fixture: ChannelSetupFixture) throws {
        let store = ChannelSetupStore(defaults: UserDefaults(suiteName: UUID().uuidString)!)
        let date = Date(timeIntervalSince1970: 1_700_000_000)
        try store.save(try confirmedSetup(fixture, at: date), ipHint: fixture.xInfo.ip)

        let model = ChannelSetupSettingsModel(setupStore: store, forget: { _ in }, locale: testLocale, timeZone: testTimeZone)
        let row = try #require(model.rows.first)

        #expect(row.accessibilityLabel.contains(fixture.xInfo.name))
        #expect(row.accessibilityLabel.contains(fixture.model))
        let dateText = date.formatted(Date.FormatStyle(date: .abbreviated, time: .omitted, locale: testLocale, timeZone: testTimeZone))
        #expect(row.accessibilityLabel.contains(dateText))
    }

    @Test func emptyConsoleNameFallsBackToModel() {
        let console = ConsoleIdentity(name: "", model: "X32")
        #expect(ChannelSetupSettingsCopy.displayName(console) == "X32")
    }

    @Test func forgetRemovesOnlyThatConsoleAndRefreshesRows() throws {
        let store = ChannelSetupStore(defaults: UserDefaults(suiteName: UUID().uuidString)!)
        try store.save(try confirmedSetup(.spike), ipHint: ChannelSetupFixture.spike.xInfo.ip)
        try store.save(try confirmedSetup(.synthetic), ipHint: ChannelSetupFixture.synthetic.xInfo.ip)
        let spikeIdentity = ConsoleIdentity(ChannelSetupFixture.spike.xInfo)
        let syntheticIdentity = ConsoleIdentity(ChannelSetupFixture.synthetic.xInfo)

        let model = ChannelSetupSettingsModel(setupStore: store, forget: { store.forget($0) })
        #expect(model.rows.count == 2)

        model.forget(spikeIdentity)

        #expect(model.rows.map(\.console) == [syntheticIdentity])
        #expect(store.setup(for: spikeIdentity) == .notFound)
    }

    @Test(arguments: ChannelSetupFixture.allCases)
    func redoAdoptedSetupReplacesRowDateAfterRefresh(_ fixture: ChannelSetupFixture) throws {
        let store = ChannelSetupStore(defaults: UserDefaults(suiteName: UUID().uuidString)!)
        let t1 = Date(timeIntervalSince1970: 1_700_000_000)
        let t2 = Date(timeIntervalSince1970: 1_700_000_500)
        try store.save(try confirmedSetup(fixture, at: t1), ipHint: fixture.xInfo.ip)

        let model = ChannelSetupSettingsModel(setupStore: store, forget: { _ in })
        #expect(try #require(model.rows.first).confirmedAt == t1)

        try store.save(try confirmedSetup(fixture, at: t2), ipHint: fixture.xInfo.ip)
        model.refresh()

        #expect(model.rows.count == 1)
        #expect(try #require(model.rows.first).confirmedAt == t2)
    }
}
