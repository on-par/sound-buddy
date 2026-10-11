import Foundation
import Testing
@testable import SoundBuddyKit

@Suite("FeatureFlags")
struct FeatureFlagsTests {
    @Test("allOff has every flag off")
    func allOff() {
        for id in FeatureFlagId.allCases {
            #expect(!FeatureFlags.allOff.isEnabled(id))
        }
        #expect(FeatureFlagId.allCases.contains(.console))
        #expect(FeatureFlagId.console.rawValue == "console")
    }

    @Test(
        "resolve covers every build × store environment combination",
        arguments: [
            (true, nil as StoreEnvironment?, true),
            (true, .production as StoreEnvironment?, true),
            (true, .sandbox as StoreEnvironment?, true),
            (true, .xcode as StoreEnvironment?, true),
            (false, nil as StoreEnvironment?, false),
            (false, .production as StoreEnvironment?, false),
            (false, .sandbox as StoreEnvironment?, true),
            (false, .xcode as StoreEnvironment?, false),
        ]
    )
    func resolveMatrix(isDebugBuild: Bool, storeEnvironment: StoreEnvironment?, expectedConsole: Bool) {
        let environment = FeatureFlagEnvironment(
            isDebugBuild: isDebugBuild,
            storeEnvironment: storeEnvironment,
            launchArguments: []
        )
        #expect(FeatureFlags.resolve(environment).isEnabled(.console) == expectedConsole)
    }

    @Test(
        "launch argument override wins over build and store environment",
        arguments: [
            (["-soundBuddyFeatures", "none"], true, nil as StoreEnvironment?, false),
            (["-soundBuddyFeatures", "console"], false, .production as StoreEnvironment?, true),
            (["-soundBuddyFeatures", "ALL"], false, .production as StoreEnvironment?, true),
            (["-soundBuddyFeatures", "NONE"], true, nil as StoreEnvironment?, false),
            (["-soundBuddyFeatures", ""], true, nil as StoreEnvironment?, false),
            (["-soundBuddyFeatures", "Console, bogus"], false, .production as StoreEnvironment?, true),
            (["-soundBuddyFeatures", "bogus"], true, nil as StoreEnvironment?, false),
            (["-soundBuddyFeatures"], true, nil as StoreEnvironment?, true),
            (["-soundBuddyFeatures"], false, .production as StoreEnvironment?, false),
            (["-coachingDemo"], true, nil as StoreEnvironment?, true),
        ]
    )
    func overrideWins(
        arguments: [String],
        isDebugBuild: Bool,
        storeEnvironment: StoreEnvironment?,
        expectedConsole: Bool
    ) {
        let environment = FeatureFlagEnvironment(
            isDebugBuild: isDebugBuild,
            storeEnvironment: storeEnvironment,
            launchArguments: arguments
        )
        #expect(FeatureFlags.resolve(environment).isEnabled(.console) == expectedConsole)
    }

    @Test("override returns nil without a well-formed argument")
    func overrideNil() {
        #expect(FeatureFlags.override(fromLaunchArguments: []) == nil)
        #expect(FeatureFlags.override(fromLaunchArguments: ["-soundBuddyFeatures"]) == nil)
    }

    @Test(
        "store environment parses AppStore.Environment raw values",
        arguments: [
            ("Production", .production as StoreEnvironment?),
            ("Sandbox", .sandbox as StoreEnvironment?),
            ("Xcode", .xcode as StoreEnvironment?),
            ("production", .production as StoreEnvironment?),
            ("sandbox", .sandbox as StoreEnvironment?),
            ("xcode", .xcode as StoreEnvironment?),
            ("Staging", nil as StoreEnvironment?),
            ("", nil as StoreEnvironment?),
        ]
    )
    func storeEnvironmentParse(rawValue: String, expected: StoreEnvironment?) {
        #expect(StoreEnvironment(rawValue: rawValue) == expected)
    }

    @Test("console settings copy")
    func settingsCopy() {
        #expect(ConsoleSettingsCopy.sectionTitle == "Console (beta)")
        #expect(!ConsoleSettingsCopy.footer.isEmpty)
    }
}
