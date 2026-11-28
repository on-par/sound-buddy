import Foundation
import Testing
@testable import SoundBuddyKit

@Suite("AppTab")
struct AppTabTests {
    @Test func tabsAreAnalyzeMixAgentInOrder() {
        #expect(AppTab.allCases == [.analyze, .mix, .agent])
    }

    @Test func launchDefaultIsAnalyze() {
        #expect(AppTab.launchDefault == .analyze)
    }

    @Test(
        "titles and symbols",
        arguments: [
            (AppTab.analyze, "Analyze", "waveform.path.ecg"),
            (AppTab.mix, "Mix", "slider.vertical.3"),
            (AppTab.agent, "Agent", "sparkles"),
        ]
    )
    func titleAndSymbol(tab: AppTab, title: String, symbol: String) {
        #expect(tab.title == title)
        #expect(tab.symbolName == symbol)
    }

    @Test func accessibilityIdentifiersAreStableAndDistinct() {
        let identifiers = AppTab.allCases.map(\.accessibilityIdentifier)
        #expect(identifiers == ["tab.analyze", "tab.mix", "tab.agent"])
    }
}

@Suite("AgentPresentation")
struct AgentPresentationTests {
    @Test(
        "Review fix opens a sheet on compact width, the rail when Mix shows it, the Agent tab otherwise",
        arguments: [
            (false, false, AppTab.analyze, AgentPresentation.sheet),
            (false, false, AppTab.mix, AgentPresentation.sheet),
            (false, false, AppTab.agent, AgentPresentation.agentTab),
            (true, false, AppTab.analyze, AgentPresentation.agentTab),
            (true, false, AppTab.mix, AgentPresentation.agentTab),
            (true, true, AppTab.mix, AgentPresentation.rail),
            (true, true, AppTab.analyze, AgentPresentation.agentTab),
            (true, true, AppTab.agent, AgentPresentation.agentTab),
        ]
    )
    func reviewFix(isRegularWidth: Bool, mixShowsRail: Bool, tab: AppTab, expected: AgentPresentation) {
        #expect(AgentPresentation.forReviewFix(isRegularWidth: isRegularWidth, mixShowsRail: mixShowsRail, from: tab) == expected)
    }

    @Test func reviewFixIsOfferedOnlyOnBandDeviationCards() {
        let band = CoachingEvent(
            id: "a", ruleType: .bandDeviation, severity: .suggestion, band: .bass,
            message: "m", data: nil, source: .phoneMicEstimate, sessionTime: 0
        )
        let noBand = CoachingEvent(
            id: "b", ruleType: .bandDeviation, severity: .suggestion, band: nil,
            message: "m", data: nil, source: .phoneMicEstimate, sessionTime: 0
        )
        let other = CoachingEvent(
            id: "c", ruleType: .harshness, severity: .warning, band: .presence,
            message: "m", data: nil, source: .phoneMicEstimate, sessionTime: 0
        )
        #expect(AgentPresentation.offersReviewFix(for: band))
        #expect(!AgentPresentation.offersReviewFix(for: noBand))
        #expect(!AgentPresentation.offersReviewFix(for: other))
    }

    @Test func showMoreAlwaysSelectsTheAgentTab() {
        #expect(AgentPresentation.forShowMore == .agentTab)
    }
}

@Suite("DebugLaunchOptions tabs and Agent proofs")
struct DebugLaunchOptionsTabsTests {
    @Test(
        "-startTab picks a tab; anything else is nil",
        arguments: [
            (["-startTab", "analyze"], AppTab.analyze as AppTab?),
            (["-startTab", "mix"], .mix),
            (["-startTab", "agent"], .agent),
            (["-startTab", "settings"], nil),
            (["-startTab"], nil),
            (["-coachingDemo"], nil),
            ([], nil),
        ]
    )
    func startTab(arguments: [String], expected: AppTab?) {
        #expect(DebugLaunchOptions.startTab(arguments) == expected)
    }

    @Test func agentSheetFlag() {
        #expect(DebugLaunchOptions.opensAgentSheet(["-coachingDemo", "-agentSheet"]))
        #expect(!DebugLaunchOptions.opensAgentSheet(["-coachingDemo"]))
    }

    @Test func sermonQuietFlag() {
        #expect(DebugLaunchOptions.forcesSermonQuiet(["-sermonQuiet"]))
        #expect(!DebugLaunchOptions.forcesSermonQuiet([]))
    }

    @Test func consoleArmedDemoNeedsALiveConsoleDemo() {
        #expect(DebugLaunchOptions.armsConsoleDemo(["-consoleDemo", "live", "-consoleArmedDemo"]))
        #expect(!DebugLaunchOptions.armsConsoleDemo(["-consoleArmedDemo"]))
        #expect(!DebugLaunchOptions.armsConsoleDemo(["-consoleDemo", "offline", "-consoleArmedDemo"]))
        #expect(!DebugLaunchOptions.armsConsoleDemo(["-consoleDemo", "live"]))
    }

    @Test func newProofFlagsNeverSkipTheMicPromptOnTheirOwn() {
        #expect(!DebugLaunchOptions.skipsMicPermissionPrompt(["-startTab", "mix", "-agentSheet", "-sermonQuiet", "-consoleArmedDemo"]))
    }
}
