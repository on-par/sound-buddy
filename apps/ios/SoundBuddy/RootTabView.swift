import SoundBuddyKit
import SwiftUI
#if canImport(UIKit)
import AVFAudio
import UIKit
#endif

struct RootTabView: View {
    let model: AnalyzeModel
    let keepAwake: KeepAwakeController
    let micInputs: MicInputController
    let console: ConsoleTargetModel?
    let featureFlags: FeatureFlags
    let consoleConsent: ConsoleConsentStore
    var onConsoleConsentRevoked: () -> Void = {}
    var onConsoleConnect: () -> Void = {}
    var onDiscoverChannelSetup: () -> Void = {}
    var channelSetupBanner: ChannelSetupBanner? = nil
    var onReviewChannelSetup: () -> Void = {}
    let channelSetups: ChannelSetupSettingsModel?
    var onRedoChannelSetup: () -> Void = {}
    var consoleEQWriter: ConsoleEQWriter? = nil
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var tab = RootTabView.initialTab
    @State private var agentSelection = AgentSelection()
    @State private var agentSheetOpen = false
    @State private var agentSheetDetent = PresentationDetent.medium
    @State private var railOpen = true
    @AppStorage(KeepAwakePolicy.defaultsKey) private var keepAwakeEnabled = KeepAwakePolicy.defaultValue
    @AppStorage(RTABallisticsMode.defaultsKey) private var rtaBallistics = RTABallisticsMode.defaultValue
    @AppStorage(SermonQuiet.defaultsKey, store: RootTabView.sermonQuietStore) private var sermonQuiet = SermonQuiet.defaultValue

    private var visibleConsole: ConsoleTargetModel? {
        ConsoleChipStatus.isVisible(flagEnabled: featureFlags.isEnabled(.console), consentGranted: consoleConsent.isGranted, console: console?.console)
            ? console
            : nil
    }

    var body: some View {
        GeometryReader { proxy in
            let mixLayout = MixLayout(width: proxy.size.width, height: proxy.size.height)
            tabs(mixLayout: mixLayout)
        }
        .tint(Palette.accent)
        .preferredColorScheme(.dark)
        .sheet(isPresented: $agentSheetOpen) {
            AgentPanel(
                host: .sheet,
                model: model,
                console: visibleConsole,
                writer: consoleEQWriter,
                selection: $agentSelection,
                onClose: { agentSheetOpen = false }
            )
            .presentationDetents([.medium, .large], selection: $agentSheetDetent)
            .presentationCornerRadius(ThemeMetrics.sheetRadius)
            .presentationBackground(Palette.panel)
            .preferredColorScheme(.dark)
        }
        .task { await model.appear() }
        .onAppear {
            applyKeepAwake()
            #if DEBUG
            if DebugLaunchOptions.opensAgentSheet(ProcessInfo.processInfo.arguments) {
                agentSheetDetent = .large
                agentSheetOpen = true
            }
            #endif
        }
        .onDisappear {
            model.disappear()
            keepAwake.release()
        }
        .onChange(of: keepAwakeEnabled) { _, _ in applyKeepAwake() }
        .onChange(of: rtaBallistics, initial: true) { _, mode in model.rtaBallistics = mode }
        .onChange(of: model.coaching.map(\.id)) { _, _ in agentSelection.prune(keeping: model.coaching) }
        // No background audio mode in P0: release the mic when the app leaves
        // the foreground instead of letting the OS cut the engine, and pick it
        // back up on return. .inactive (permission alert, Control Center) is
        // deliberately ignored.
        .onChange(of: scenePhase) { _, phase in
            applyKeepAwake()
            switch phase {
            case .background: model.enterBackground()
            case .active: Task { await model.enterForeground() }
            default: break
            }
        }
        #if canImport(UIKit)
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willTerminateNotification)) { _ in
            model.terminate()
        }
        // Belt and braces: scenePhase also reports .inactive, but never leave
        // auto-lock disabled once the app starts to leave the foreground.
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willResignActiveNotification)) { _ in
            keepAwake.release()
        }
        // An external mic unplugged (or a new one plugged in) while
        // listening (#1601): fall back to the system default and keep going
        // on the new route instead of leaving a dead engine.
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.routeChangeNotification).receive(on: RunLoop.main)) { note in
            if micInputs.routeChanged(MicRouteChange(notification: note)) {
                Task { await model.restartListening() }
            }
        }
        #endif
    }

    private func tabs(mixLayout: MixLayout) -> some View {
        let triage = MixTriage(events: model.coaching, sermonQuiet: sermonQuiet)
        return TabView(selection: $tab) {
            AnalyzeView(
                model: model,
                micInputs: micInputs,
                console: console,
                featureFlags: featureFlags,
                consoleConsent: consoleConsent,
                onConsoleConsentRevoked: onConsoleConsentRevoked,
                onConsoleConnect: onConsoleConnect,
                onDiscoverChannelSetup: onDiscoverChannelSetup,
                channelSetupBanner: channelSetupBanner,
                onReviewChannelSetup: onReviewChannelSetup,
                channelSetups: channelSetups,
                onRedoChannelSetup: onRedoChannelSetup,
                consoleEQWriter: consoleEQWriter,
                onReviewFix: { reviewFix($0, mixLayout: mixLayout) },
                onShowMore: { present(AgentPresentation.forShowMore) }
            )
            .modifier(TabChrome(tab: .analyze))

            MixView(
                model: model,
                console: visibleConsole,
                triage: triage,
                layout: mixLayout,
                sermonQuiet: $sermonQuiet,
                railOpen: $railOpen,
                onReviewFix: { reviewFix($0, mixLayout: mixLayout) }
            ) {
                AgentPanel(
                    host: .rail,
                    model: model,
                    console: visibleConsole,
                    writer: consoleEQWriter,
                    selection: $agentSelection,
                    onClose: { railOpen = false }
                )
            }
            .modifier(TabChrome(tab: .mix))
            .badge(triage.badgeCount)

            AgentPanel(
                host: .tab,
                model: model,
                console: visibleConsole,
                writer: consoleEQWriter,
                selection: $agentSelection
            )
            .modifier(TabChrome(tab: .agent))
        }
    }

    private func reviewFix(_ event: CoachingEvent, mixLayout: MixLayout) {
        agentSelection.select(event.id)
        present(AgentPresentation.forReviewFix(
            isRegularWidth: horizontalSizeClass == .regular,
            mixShowsRail: mixLayout.showsAgentRail,
            from: tab
        ))
    }

    private func present(_ presentation: AgentPresentation) {
        switch presentation {
        case .sheet: agentSheetOpen = true
        case .rail: railOpen = true
        case .agentTab: tab = .agent
        }
    }

    private func applyKeepAwake() {
        keepAwake.apply(keepAwake: keepAwakeEnabled, isSceneActive: scenePhase == .active)
    }

    private static var initialTab: AppTab {
        #if DEBUG
        DebugLaunchOptions.startTab(ProcessInfo.processInfo.arguments) ?? AppTab.launchDefault
        #else
        AppTab.launchDefault
        #endif
    }

    private static let sermonQuietStore: UserDefaults = {
        #if DEBUG
        if DebugLaunchOptions.forcesSermonQuiet(ProcessInfo.processInfo.arguments),
           let demo = UserDefaults(suiteName: "sermonQuietDemo") {
            demo.set(true, forKey: SermonQuiet.defaultsKey)
            return demo
        }
        #endif
        return .standard
    }()
}

private struct TabChrome: ViewModifier {
    let tab: AppTab

    func body(content: Content) -> some View {
        content
            .tabItem { Label(tab.title, systemImage: tab.symbolName) }
            .tag(tab)
            .toolbarBackground(Palette.panel, for: .tabBar)
            .toolbarBackground(.visible, for: .tabBar)
            .accessibilityIdentifier(tab.accessibilityIdentifier)
    }
}
