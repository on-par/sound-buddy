import Foundation

public enum AppTab: String, CaseIterable, Hashable, Sendable {
    case analyze
    case mix
    case agent

    public static let launchDefault = AppTab.analyze

    public var title: String {
        switch self {
        case .analyze: "Analyze"
        case .mix: "Mix"
        case .agent: "Agent"
        }
    }

    public var symbolName: String {
        switch self {
        case .analyze: "waveform.path.ecg"
        case .mix: "slider.vertical.3"
        case .agent: "sparkles"
        }
    }

    public var accessibilityIdentifier: String { "tab.\(rawValue)" }
}

public enum AgentPresentation: Equatable, Sendable {
    case sheet
    case rail
    case agentTab

    public static func forReviewFix(isRegularWidth: Bool, mixShowsRail: Bool, from tab: AppTab) -> AgentPresentation {
        if tab == .agent { return .agentTab }
        if tab == .mix, mixShowsRail { return .rail }
        return isRegularWidth ? .agentTab : .sheet
    }

    public static let forShowMore = AgentPresentation.agentTab

    public static func offersReviewFix(for event: CoachingEvent) -> Bool {
        event.ruleType == .bandDeviation && event.band != nil
    }
}

extension DebugLaunchOptions {
    public static let startTabFlag = "-startTab"
    public static let agentSheetFlag = "-agentSheet"
    public static let sermonQuietFlag = "-sermonQuiet"
    public static let consoleArmedDemoFlag = "-consoleArmedDemo"
    static let consoleDemoFlag = "-consoleDemo"
    static let consoleDemoLivePhase = "live"

    public static func startTab(_ arguments: [String]) -> AppTab? {
        guard let index = arguments.firstIndex(of: startTabFlag), index + 1 < arguments.count else { return nil }
        return AppTab(rawValue: arguments[index + 1])
    }

    public static func opensAgentSheet(_ arguments: [String]) -> Bool {
        arguments.contains(agentSheetFlag)
    }

    public static func forcesSermonQuiet(_ arguments: [String]) -> Bool {
        arguments.contains(sermonQuietFlag)
    }

    public static func armsConsoleDemo(_ arguments: [String]) -> Bool {
        guard arguments.contains(consoleArmedDemoFlag),
              let index = arguments.firstIndex(of: consoleDemoFlag), index + 1 < arguments.count
        else { return false }
        return arguments[index + 1] == consoleDemoLivePhase
    }
}
