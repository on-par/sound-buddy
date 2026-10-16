import SoundBuddyKit
import SwiftUI
#if canImport(UIKit)
import AVFAudio
import UIKit
#endif

/// The P0 Analyze screen: a console-style RTA (with its dashed ideal-EQ
/// target and legend), the short coaching stack, the overall level readout
/// (an estimated dB, unit drawn tiny). Always listening while
/// on screen in the foreground — no Start/Stop control; lifecycle events go
/// to the model.
/// Pure rendering — every decision lives in AnalyzeModel (SoundBuddyKit),
/// which is where the tests are.
///
/// portrait: header + RTA + coaching; landscape: RTA-first with a coaching
/// peek (#1548). AnalyzeLayout (SoundBuddyKit) decides portrait vs landscape
/// and the peek state; this view only renders. Problem markers pulse on the
/// RTA in both layouts (#1554). Tapping the Target legend (or its pencil)
/// enters an in-place target-edit mode: an "Editing target" chip with
/// Cancel/Done takes the legend's place in the band under the RTA, and the RTA
/// stays on screen — no pushed view (#1558). The header / landscape strip
/// always keeps the listening indicator and the band keeps one height, so the
/// RTA never moves when editing starts or ends (#1565). While editing, a row
/// of preset pills (Flat / Music / Worship Classic / Worship Full Band) sits under the
/// legend band; tapping one seeds the draft from that bundled curve (#1560).
/// While editing, problem markers hide and the landscape coaching peek stays
/// closed, so neither overlay collides with the handles or the chip (#1562).
/// A small Speech/Music chip sits beside the legend in every layout (#1690):
/// it reflects AnalyzeModel's detected program mode, and — only while the
/// target is auto and not being edited — that mode also drives the auto
/// target itself (worship-room for music, speech-podcast for speech).
///
/// A gear button beside the level readout (end of the landscape strip) opens
/// the Settings sheet (#1591). Its keep-awake toggle (#1584): while on (the
/// default, persisted) and the scene is active, auto-lock is off; leaving the
/// foreground always restores it. KeepAwakePolicy decides; this view owns the
/// stored preference and applies it. Its Microphone section (#1594) picks the
/// input and carries the honesty copy that used to be a header badge;
/// choosing an input restarts listening on the new route.
///
/// The console chip opens the read-only EQ panel (#1669) as a sheet, except
/// on an iPad in regular-width landscape, where the EQ panel is a column
/// beside the RTA and the chip keeps opening the target picker instead —
/// AnalyzeLayout.consoleEQPlacement(isRegularWidth:) decides.
///
/// A band-deviation coaching card gets a "Show on console" button while a
/// console link is up (#1671): tapping it selects Main LR and shows a
/// dashed ghost band/curve for the suggested change. Tapping Apply on that
/// ghost (in the EQ panel) writes it to Main LR through an armed
/// `ConsoleEQWriter` (#1676, ADR-0161); the coaching stack then shows an
/// applied note with Undo, from `console.appliedCoaching`.
///
/// iPad (#1659): AnalyzeLayout also picks tallPortrait (regular-width
/// portrait — the RTA fills the height above the coaching cards instead of
/// the fixed 300 pt) and wide (iPad landscape — the RTA takes about 70% of
/// the width with the coaching cards inline in a trailing column, no peek).
/// In wide with the console EQ column up, that one trailing column widens to
/// the EQ column's share and stacks the EQ panel above the coaching cards,
/// so the RTA keeps the majority of the width and never gets squeezed by a
/// third column. Every layout keeps the same header / strip content, the
/// target band under the RTA and the edit rules above. iPhones and narrow
/// Split View windows stay on portrait / landscape, unchanged.
struct AnalyzeView: View {
    let model: AnalyzeModel
    let keepAwake: KeepAwakeController
    let micInputs: MicInputController
    /// Injected until #1666 (transport/connect) lands: Release passes
    /// `console: nil`, so the chip never shows there.
    let console: ConsoleTargetModel?
    let featureFlags: FeatureFlags
    let consoleConsent: ConsoleConsentStore
    var onConsoleConsentRevoked: () -> Void = {}
    var onConsoleConnect: () -> Void = {}
    /// Injected until the #1666/#1674 adapter hands over a live armed
    /// writer; Release passes `nil`, so Apply always reads "Unlock to
    /// apply" there.
    var consoleEQWriter: ConsoleEQWriter? = nil
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var coachingPeekOpen = false
    @State private var settingsOpen = false
    @State private var consolePickerOpen = false
    @State private var consoleEQOpen = false
    @AppStorage(KeepAwakePolicy.defaultsKey) private var keepAwakeEnabled = KeepAwakePolicy.defaultValue
    /// The RTA smoothing choice (#1707); pushed into the model, which steps
    /// the analysis-rate display state the target line level-matches against.
    @AppStorage(RTABallisticsMode.defaultsKey) private var rtaBallistics = RTABallisticsMode.defaultValue

    private var showsConsoleChip: Bool {
        ConsoleChipStatus.isVisible(flagEnabled: featureFlags.isEnabled(.console), consentGranted: consoleConsent.isGranted, console: console?.console)
    }

    var body: some View {
        GeometryReader { proxy in
            let layout = AnalyzeLayout(width: proxy.size.width, height: proxy.size.height)
            content(for: layout, proxy: proxy)
                .onChange(of: layout) { _, _ in coachingPeekOpen = false }
                .onChange(of: model.isEditingTarget) { _, editing in
                    coachingPeekOpen = AnalyzeLayout.peekOpen(afterEditingChange: editing, wasOpen: coachingPeekOpen)
                }
        }
        .padding(Layout.screenPadding)
        .background(Palette.background.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .sheet(isPresented: $settingsOpen) {
            SettingsView(
                keepAwakeEnabled: $keepAwakeEnabled,
                micInputs: micInputs,
                showsConsoleSection: featureFlags.isEnabled(.console),
                consent: consoleConsent,
                onConnect: onConsoleConnect,
                onRevoke: onConsoleConsentRevoked
            ) { id in
                micInputs.select(id)
                Task { await model.restartListening() }
            }
        }
        .sheet(isPresented: $consolePickerOpen) {
            if let console {
                ConsoleTargetPickerView(model: console) { consolePickerOpen = false }
            }
        }
        .sheet(isPresented: $consoleEQOpen, onDismiss: { console?.clearCoaching() }) {
            if let console {
                ConsoleEQPanel(console: console, analyze: model, showsTargetButton: true, eqWriter: consoleEQWriter) { consoleEQOpen = false }
                    .presentationDetents([.medium, .large])
            }
        }
        .task { await model.appear() }
        .onAppear {
            applyKeepAwake()
            #if DEBUG
            // Simulator proofs (#1708): open Settings without a tap.
            if DebugLaunchOptions.opensSettings(ProcessInfo.processInfo.arguments) {
                settingsOpen = true
            }
            #endif
        }
        .onDisappear {
            model.disappear()
            keepAwake.release()
        }
        .onChange(of: keepAwakeEnabled) { _, _ in applyKeepAwake() }
        .onChange(of: rtaBallistics, initial: true) { _, mode in model.rtaBallistics = mode }
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

    private func applyKeepAwake() {
        keepAwake.apply(keepAwake: keepAwakeEnabled, isSceneActive: scenePhase == .active)
    }

    @ViewBuilder
    private func content(for layout: AnalyzeLayout, proxy: GeometryProxy) -> some View {
        let placement = layout.consoleEQPlacement(isRegularWidth: horizontalSizeClass == .regular)
        switch layout {
        case .portrait, .tallPortrait: portraitBody(layout: layout, placement: placement)
        case .landscape: landscapeBody(proxy: proxy, placement: placement)
        case .wide: wideBody(proxy: proxy, placement: placement)
        }
    }

    private func consoleChipTapped(placement: AnalyzeLayout.ConsoleEQPlacement) {
        switch placement {
        case .sheet: consoleEQOpen = true
        case .sideColumn: consolePickerOpen = true
        }
    }

    private func showsConsoleAction(for event: CoachingEvent) -> Bool {
        ConsoleCoachingMapper.showsAction(for: event, consoleVisible: showsConsoleChip, phase: console?.phase ?? .idle)
    }

    /// The same armed-writer-and-live-link gate `ConsoleEQPanel` uses for
    /// Apply (#1676 rework) — Undo in the coaching stack shares it so a tap
    /// while disarmed never fires the `.disarmed` throw into the void.
    /// Delegates to `ConsoleCoachingMapper.isArmed` so the rule lives once.
    private var canUndoApplied: Bool {
        ConsoleCoachingMapper.isArmed(writer: consoleEQWriter, phase: console?.phase ?? .idle)
    }

    /// Selects Main LR and stores the tapped event (#1671); on the sheet
    /// placement it also opens the sheet — on the side-column placement the
    /// panel is already on screen and just updates.
    private func showOnConsole(_ event: CoachingEvent, placement: AnalyzeLayout.ConsoleEQPlacement) {
        console?.showCoaching(event)
        if placement == .sheet {
            consoleEQOpen = true
        }
    }

    /// iPhone portrait (fixed-height RTA, slack below the cards) and iPad
    /// tall portrait (#1659: the RTA takes the slack, so there is no empty
    /// band under the cards).
    private func portraitBody(layout: AnalyzeLayout, placement: AnalyzeLayout.ConsoleEQPlacement) -> some View {
        VStack(alignment: .leading, spacing: Layout.sectionSpacing) {
            header(placement: placement)
            VStack(alignment: .leading, spacing: Layout.legendSpacing) {
                RTAView(
                    model: model,
                    fillsHeight: layout.rtaFillsHeight,
                    showsProblemMarkers: layout.showsProblemMarkers(isEditingTarget: model.isEditingTarget)
                )
                if layout.targetControlsUnderRTA {
                    TargetControlsBand(model: model, metrics: layout.targetControlMetrics, onEdit: beginTargetEdit)
                }
            }
            CoachingStackView(
                model: model,
                onShowOnConsole: { showOnConsole($0, placement: placement) },
                showsConsoleAction: showsConsoleAction,
                applied: console?.appliedCoaching,
                canUndoApplied: canUndoApplied,
                onUndoApplied: { try? console?.undoAppliedCoaching(using: consoleEQWriter) }
            )
            if !layout.rtaFillsHeight {
                Spacer(minLength: 0)
            }
            StatusMessageView(model: model)
        }
    }

    /// iPad landscape (#1659): the status strip on top, then the big RTA and
    /// its target band on the leading side and one trailing column. Without
    /// the console EQ column the trailing column is just the coaching cards
    /// (about 30% of the width). With it (#1669, regular width + chip
    /// visible) the trailing column widens to the EQ column's share and
    /// stacks the EQ panel on top with the coaching cards scrolling beneath,
    /// so the RTA keeps the majority. The column's width never depends on
    /// edit state, so the RTA does not move or resize when editing starts or
    /// ends.
    private func wideBody(proxy: GeometryProxy, placement: AnalyzeLayout.ConsoleEQPlacement) -> some View {
        let layout = AnalyzeLayout.wide
        let showsConsoleEQ = layout.showsConsoleEQColumn(
            isRegularWidth: horizontalSizeClass == .regular,
            consoleVisible: showsConsoleChip && console != nil
        )
        let coaching = ScrollView {
            CoachingStackView(
                model: model,
                onShowOnConsole: { showOnConsole($0, placement: placement) },
                showsConsoleAction: showsConsoleAction
            )
        }
        return VStack(spacing: Layout.landscapeSpacing) {
            landscapeStrip(placement: placement)
            HStack(alignment: .top, spacing: Layout.wideColumnSpacing) {
                VStack(spacing: Layout.landscapeSpacing) {
                    RTAView(
                        model: model,
                        fillsHeight: layout.rtaFillsHeight,
                        showsProblemMarkers: layout.showsProblemMarkers(isEditingTarget: model.isEditingTarget)
                    )
                    if layout.targetControlsUnderRTA {
                        TargetControlsBand(model: model, metrics: layout.targetControlMetrics, onEdit: beginTargetEdit)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                // Trailing column, top to bottom (#1745): the Target tray
                // (fixed height; one row above the console EQ), the console
                // EQ panel when shown, then coaching (scrolls). Heights come
                // from AnalyzeLayout.wideTrailingColumnSplit, so nothing clips.
                GeometryReader { column in
                    let split = AnalyzeLayout.wideTrailingColumnSplit(
                        columnHeight: column.size.height,
                        spacing: Layout.landscapeSpacing,
                        showsConsoleEQ: showsConsoleEQ
                    )
                    VStack(spacing: Layout.landscapeSpacing) {
                        if layout.showsTargetTray {
                            TargetTray(
                                model: model,
                                rows: AnalyzeLayout.wideTargetTrayRows(showsConsoleEQ: showsConsoleEQ),
                                onEdit: beginTargetEdit
                            )
                            .frame(height: split.tray)
                        }
                        if showsConsoleEQ, let console {
                            ConsoleEQPanel(console: console, analyze: model, showsTargetButton: false)
                                .frame(height: split.consoleEQ)
                        }
                        coaching
                    }
                }
                .frame(width: AnalyzeLayout.wideTrailingColumnWidth(
                    containerWidth: proxy.size.width,
                    spacing: Layout.wideColumnSpacing,
                    showsConsoleEQ: showsConsoleEQ
                ))
            }
            StatusMessageView(model: model)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func beginTargetEdit() {
        withAnimation(.snappy) { model.beginTargetEdit() }
    }

    private func landscapeBody(proxy: GeometryProxy, placement: AnalyzeLayout.ConsoleEQPlacement) -> some View {
        let rta = RTAView(
            model: model,
            fillsHeight: true,
            showsProblemMarkers: AnalyzeLayout.landscape.showsProblemMarkers(isEditingTarget: model.isEditingTarget)
        )
        return VStack(spacing: Layout.landscapeSpacing) {
            landscapeStrip(placement: placement)
            if AnalyzeLayout.landscape.showsConsoleEQColumn(
                isRegularWidth: horizontalSizeClass == .regular,
                consoleVisible: showsConsoleChip
            ), let console {
                HStack(spacing: Layout.landscapeSpacing) {
                    rta
                    ConsoleEQPanel(console: console, analyze: model, showsTargetButton: false, eqWriter: consoleEQWriter)
                        .frame(width: proxy.size.width * AnalyzeLayout.consoleEQColumnWidthFraction)
                }
            } else {
                rta
            }
            if AnalyzeLayout.landscape.targetControlsUnderRTA {
                TargetControlsBand(model: model, metrics: AnalyzeLayout.landscape.targetControlMetrics, onEdit: beginTargetEdit)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            StatusMessageView(model: model)
            CoachingPeekHandle(model: model, isOpen: $coachingPeekOpen)
        }
        .overlay(alignment: .bottom) {
            if coachingPeekOpen {
                CoachingPeekPanel(
                    model: model,
                    isOpen: $coachingPeekOpen,
                    maxHeight: proxy.size.height * Layout.peekMaxHeightFraction,
                    onShowOnConsole: { event in
                        showOnConsole(event, placement: placement)
                        if placement == .sheet {
                            coachingPeekOpen = false
                        }
                    },
                    showsConsoleAction: showsConsoleAction,
                    applied: console?.appliedCoaching,
                    canUndoApplied: canUndoApplied,
                    onUndoApplied: { try? console?.undoAppliedCoaching(using: consoleEQWriter) }
                )
            }
        }
    }

    private func landscapeStrip(placement: AnalyzeLayout.ConsoleEQPlacement) -> some View {
        HStack(spacing: Layout.landscapeStripSpacing) {
            ListeningIndicator(state: model.state)
            if showsConsoleChip, let console, let chipTitle = console.chipTitle {
                ConsoleChip(title: chipTitle, status: console.chipStatus) { consoleChipTapped(placement: placement) }
            }
            Spacer()
            OverallLevelReadout(model: model, font: .headline.monospacedDigit())
            SettingsButton { settingsOpen = true }
        }
        .lineLimit(1)
    }

    /// Brand first: the Mac icon's mark and "Sound Buddy", with the Analyze
    /// section label and listening status beneath; the level readout and the
    /// settings gear stay on the right.
    private func header(placement: AnalyzeLayout.ConsoleEQPlacement) -> some View {
        HStack(alignment: .center, spacing: Layout.brandSpacing) {
            Image("BrandMark")
                .resizable()
                .frame(width: Layout.brandMarkSize, height: Layout.brandMarkSize)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Layout.headerSpacing) {
                Text("Sound Buddy")
                    .font(.title2.weight(.bold))
                    .lineLimit(1)
                    .minimumScaleFactor(Layout.titleMinScale)
                    .accessibilityAddTraits(.isHeader)
                HStack(spacing: Layout.indicatorSpacing) {
                    Text("Analyze")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Palette.accent)
                    ListeningIndicator(state: model.state)
                }
                if showsConsoleChip, let console, let chipTitle = console.chipTitle {
                    ConsoleChip(title: chipTitle, status: console.chipStatus) { consoleChipTapped(placement: placement) }
                }
            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: Layout.headerSpacing) {
                OverallLevelReadout(model: model, font: .title2.weight(.bold).monospacedDigit())
                SettingsButton { settingsOpen = true }
            }
        }
    }
}

/// The overall level readout: the estimated level large in `font`, with a
/// tiny "dB" beside it (omitted with the "—" dash). Shared by the portrait
/// header and the landscape status strip so the accessibility label stays
/// identical in both.
private struct OverallLevelReadout: View {
    let model: AnalyzeModel
    let font: Font

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Layout.levelUnitSpacing) {
            Text(model.overallLevelNumberText)
                .font(font)
            if model.overallDb != nil {
                Text(AnalyzeModel.overallLevelUnit)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(Palette.secondaryText)
            }
        }
        .foregroundStyle(model.overallDb == nil ? Palette.secondaryText : Color.primary)
        .lineLimit(1)
        .transaction { $0.animation = nil }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Overall level \(model.overallLevelText), phone mic estimate")
    }
}

/// Gear chip beside the level readout that opens the Settings sheet (#1591).
/// Shared by the portrait header and the landscape status strip.
private struct SettingsButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "gearshape")
                .font(.caption.weight(.semibold))
                .padding(.horizontal, Layout.badgePaddingH)
                .padding(.vertical, Layout.badgePaddingV)
                .background(Palette.surface, in: Capsule())
                .foregroundStyle(Palette.secondaryText)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Settings")
        .accessibilityIdentifier("analyze.settings")
    }
}

/// The Settings sheet (#1591): the keep-awake preference (#1584) and the
/// microphone picker with the honesty copy (#1594). The keep-awake binding is
/// AnalyzeView's @AppStorage, so flipping it here re-applies keep-awake
/// through AnalyzeView's onChange. `onSelectMic` persists and routes the
/// choice (nil = system default) and restarts listening.
private struct SettingsView: View {
    @Binding var keepAwakeEnabled: Bool
    let micInputs: MicInputController
    let showsConsoleSection: Bool
    let consent: ConsoleConsentStore
    let onConnect: () -> Void
    let onRevoke: () -> Void
    let onSelectMic: (String?) -> Void
    @Environment(\.dismiss) private var dismiss
    /// RTA display choices (#1707), read directly by RTAView and AnalyzeView.
    @AppStorage(RTAViewMode.defaultsKey) private var rtaViewMode = RTAViewMode.defaultValue
    @AppStorage(RTABallisticsMode.defaultsKey) private var rtaBallistics = RTABallisticsMode.defaultValue
    @State private var consentSheetOpen = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("View", selection: $rtaViewMode) {
                        ForEach(RTAViewMode.allCases, id: \.self) { mode in
                            Text(mode.label).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("settings.rta.view")
                    Picker("Smoothing", selection: $rtaBallistics) {
                        ForEach(RTABallisticsMode.allCases, id: \.self) { mode in
                            Text(mode.label).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("settings.rta.smoothing")
                } header: {
                    Text("Analyzer")
                } footer: {
                    Text("Absolute (default) shows dBFS from −96 to 0 with the dashed target line, the same view as target editing. Relative shows each band above or below the target, ±15 dB; target editing still uses Absolute.")
                }
                .listRowBackground(Palette.surface)

                Section {
                    Toggle(KeepAwakePolicy.accessibilityLabel, isOn: $keepAwakeEnabled)
                        .tint(Palette.accent)
                        .accessibilityLabel(KeepAwakePolicy.accessibilityLabel)
                        .accessibilityValue(KeepAwakePolicy.accessibilityValue(keepAwake: keepAwakeEnabled))
                        .accessibilityIdentifier("settings.keepAwake")
                } footer: {
                    Text("Stops the screen from locking while Analyze is open. Auto-lock always returns when you leave the app.")
                }
                .listRowBackground(Palette.surface)

                Section {
                    LabeledContent("In use", value: micInputs.activeName)
                        .accessibilityIdentifier("settings.mic.active")
                    MicInputRow(name: MicInputPolicy.systemDefaultName, id: nil, isSelected: micInputs.preferredID == nil, onSelect: onSelectMic)
                    ForEach(micInputs.options) { option in
                        MicInputRow(name: option.name, id: option.id, isSelected: micInputs.preferredID == option.id, onSelect: onSelectMic)
                    }
                } header: {
                    Text(MicInputPolicy.sectionTitle)
                } footer: {
                    Text(MicInputPolicy.honestyFootnote)
                        .accessibilityIdentifier("settings.mic.honesty")
                }
                .listRowBackground(Palette.surface)

                MicPathSection(diagnostics: micInputs.diagnostics)

                if showsConsoleSection {
                    Section {
                        if consent.isGranted {
                            LabeledContent("Access", value: ConsoleConsentCopy.grantedStatus)
                                .accessibilityIdentifier("settings.console.status")
                            Button(ConsoleConsentCopy.revokeButton, role: .destructive) {
                                consent.revoke()
                                onRevoke()
                            }
                            .accessibilityIdentifier("settings.console.revoke")
                        } else {
                            Button(ConsoleConsentCopy.connectTitle) {
                                switch consent.connectStep() {
                                case .showConsentSheet: consentSheetOpen = true
                                case .proceed: onConnect()
                                }
                            }
                            .accessibilityIdentifier("settings.console.connect")
                        }
                    } header: {
                        Text(ConsoleSettingsCopy.sectionTitle)
                    } footer: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(ConsoleSettingsCopy.footer)
                            if consent.isGranted {
                                Text(ConsoleConsentCopy.revokeFooter)
                            }
                        }
                    }
                    .accessibilityIdentifier("settings.console")
                    .listRowBackground(Palette.surface)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Palette.background.ignoresSafeArea())
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(Palette.accent)
                        .accessibilityIdentifier("settings.done")
                }
            }
        }
        .preferredColorScheme(.dark)
        .onAppear { micInputs.refresh() }
        #if canImport(UIKit)
        // A mic plugged in or pulled while the sheet is up.
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.routeChangeNotification).receive(on: RunLoop.main)) { _ in
            micInputs.refresh()
        }
        #endif
        .sheet(isPresented: $consentSheetOpen) {
            ConsoleConsentView(
                onAllow: {
                    consent.grant()
                    consentSheetOpen = false
                    onConnect()
                },
                onCancel: { consentSheetOpen = false }
            )
        }
    }
}

/// One microphone choice in Settings: the name with a checkmark when chosen.
private struct MicInputRow: View {
    let name: String
    /// nil is the system-default row.
    let id: String?
    let isSelected: Bool
    let onSelect: (String?) -> Void

    var body: some View {
        Button { onSelect(id) } label: {
            HStack {
                Text(name)
                    .foregroundStyle(Color.primary)
                Spacer()
                if isSelected {
                    Image(systemName: "checkmark")
                        .foregroundStyle(Palette.accent)
                }
            }
        }
        .accessibilityLabel(MicInputPolicy.accessibilityLabel(name: name, isSelected: isSelected))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier(MicInputPolicy.accessibilityIdentifier(for: id))
    }
}

// MARK: - Coaching peek (landscape)

/// The thin bottom bar that opens/closes the landscape coaching peek: tap or
/// swipe up to open, tap or swipe down to close.
private struct CoachingPeekHandle: View {
    let model: AnalyzeModel
    @Binding var isOpen: Bool

    var body: some View {
        let enabled = AnalyzeLayout.coachingPeekEnabled(isEditingTarget: model.isEditingTarget)
        HStack(spacing: Layout.landscapeStripSpacing) {
            Text(AnalyzeLayout.coachingPeekLabel(count: model.coaching.count))
                .font(.footnote.weight(.semibold))
            Image(systemName: isOpen ? "chevron.down" : "chevron.up")
                .font(.footnote.weight(.semibold))
        }
        .frame(maxWidth: .infinity)
        .frame(height: Layout.peekHandleHeight)
        .background(Palette.surface, in: Capsule())
        .foregroundStyle(Palette.secondaryText)
        .contentShape(Rectangle())
        .onTapGesture { withAnimation(.snappy) { isOpen.toggle() } }
        .gesture(
            DragGesture(minimumDistance: Layout.peekDragMinDistance)
                .onEnded { value in
                    withAnimation(.snappy) {
                        isOpen = AnalyzeLayout.peekOpen(afterDrag: value.translation.height, wasOpen: isOpen)
                    }
                }
        )
        .opacity(enabled ? 1 : Layout.peekDisabledOpacity)
        .allowsHitTesting(enabled)
        .disabled(!enabled)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel("Coaching")
        .accessibilityValue("\(model.coaching.count) hints")
        .accessibilityHint(
            enabled
                ? (isOpen ? "Hides the coaching cards" : "Shows the coaching cards")
                : "Unavailable while editing the target"
        )
    }
}

/// The landscape coaching overlay: the same CoachingStackView cards as
/// portrait, scrollable so they fit on a short landscape phone, closed by
/// the same handle repeated at the panel's bottom.
private struct CoachingPeekPanel: View {
    let model: AnalyzeModel
    @Binding var isOpen: Bool
    let maxHeight: CGFloat
    var onShowOnConsole: ((CoachingEvent) -> Void)? = nil
    var showsConsoleAction: (CoachingEvent) -> Bool = { _ in false }
    var applied: ConsoleCoachingApplied? = nil
    var canUndoApplied = false
    var onUndoApplied: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: Layout.landscapeSpacing) {
            ScrollView {
                CoachingStackView(
                    model: model,
                    onShowOnConsole: onShowOnConsole,
                    showsConsoleAction: showsConsoleAction,
                    applied: applied,
                    canUndoApplied: canUndoApplied,
                    onUndoApplied: onUndoApplied
                )
            }
            .frame(maxHeight: maxHeight)
            CoachingPeekHandle(model: model, isOpen: $isOpen)
        }
        .padding(Layout.cardPadding)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: Layout.cornerRadius))
    }
}

/// Small status line beside the Analyze label — the only listening chrome.
private struct ListeningIndicator: View {
    let state: AnalyzeModel.State

    var body: some View {
        HStack(spacing: Layout.indicatorSpacing) {
            Circle()
                .fill(state == .live ? Palette.live : Palette.secondaryText)
                .frame(width: Layout.indicatorDot, height: Layout.indicatorDot)
            Text(text)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Palette.secondaryText)
        }
        .accessibilityElement(children: .combine)
    }

    private var text: String {
        switch state {
        case .live: "Listening"
        case .requestingPermission: "Starting microphone…"
        case .idle: "Paused"
        case .micDenied: "Microphone off"
        case .failed: "Microphone unavailable"
        }
    }
}

// MARK: - Target legend

/// The band directly under the RTA: the Target legend when idle, the
/// "Editing target" chip while `model.isEditingTarget`, plus a row of preset
/// pills (#1560) that only that chip row needs. Every row stays laid out
/// (only the inactive ones are hidden), so the band is always the same total
/// height and nothing around it shifts on toggle (#1565). Sizes come from
/// `TargetControlMetrics` (#1744): on iPad every control is at least 44 pt
/// tall and the text is one step larger; iPhone keeps its compact sizes.
private struct TargetControlsBand: View {
    let model: AnalyzeModel
    let metrics: TargetControlMetrics
    let onEdit: () -> Void

    var body: some View {
        let editing = model.isEditingTarget
        VStack(alignment: .leading, spacing: Layout.legendSpacing) {
            HStack(spacing: Layout.legendSwatchGap) {
                ZStack(alignment: .leading) {
                    TargetLegend(text: model.targetLegendText, metrics: metrics, onEdit: onEdit)
                        .opacity(editing ? 0 : 1)
                        .allowsHitTesting(!editing)
                        .accessibilityHidden(editing)
                    TargetEditChip(model: model, metrics: metrics)
                        .opacity(editing ? 1 : 0)
                        .allowsHitTesting(editing)
                        .accessibilityHidden(!editing)
                }
                .frame(minHeight: metrics.rowMinHeight)
                Spacer(minLength: Layout.legendSwatchGap)
                ProgramModeChip(model: model, metrics: metrics)
            }
            TargetPresetStrip(model: model, metrics: metrics)
                .opacity(editing ? 1 : 0)
                .allowsHitTesting(editing)
                .accessibilityHidden(!editing)
        }
    }
}

private extension TargetControlMetrics {
    /// The Dynamic Type font for this text step.
    var font: Font {
        switch textStep {
        case .caption: .caption
        case .subheadline: .subheadline
        }
    }
}

/// The detected Speech/Music chip beside the target legend (#1690). Visible
/// (and laid out, so nothing shifts when it fades) only while live; same
/// font as the legend so the band's height never changes (#1565).
private struct ProgramModeChip: View {
    let model: AnalyzeModel
    let metrics: TargetControlMetrics

    var body: some View {
        Text(model.programModeChipText)
            .font(metrics.font.weight(.semibold))
            .foregroundStyle(Palette.secondaryText)
            .padding(.horizontal, Layout.badgePaddingH)
            .padding(.vertical, Layout.badgePaddingV)
            .background(Palette.surface, in: Capsule())
            .opacity(model.showsProgramModeChip ? 1 : 0)
            .accessibilityLabel(model.programModeAccessibilityLabel)
            .accessibilityIdentifier("analyze.programModeChip")
    }
}

/// A short dashed swatch plus "Target · <label> (auto)", under the RTA, and
/// a pencil. Tapping the row or the pencil enters in-place target-edit mode
/// (#1558). On iPad the pencil is its own 44 pt capsule button (#1744); on
/// iPhone it stays a bare glyph whose tappable shape reaches past its frame
/// to 44 pt without taking layout space.
private struct TargetLegend: View {
    let text: String
    let metrics: TargetControlMetrics
    let onEdit: () -> Void

    var body: some View {
        HStack(spacing: Layout.legendSwatchGap) {
            Button(action: onEdit) {
                HStack(spacing: Layout.legendSwatchGap) {
                    Path { path in
                        let midY = metrics.swatchHeight / 2
                        path.move(to: CGPoint(x: 0, y: midY))
                        path.addLine(to: CGPoint(x: metrics.swatchWidth, y: midY))
                    }
                    .stroke(Palette.target, style: StrokeStyle(lineWidth: Layout.legendSwatchLineWidth, dash: Layout.legendSwatchDash))
                    .frame(width: metrics.swatchWidth, height: metrics.swatchHeight)
                    Text(text)
                        .font(metrics.font.weight(.semibold))
                        .foregroundStyle(Palette.secondaryText)
                }
                .frame(minHeight: metrics.minHitSize)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(text)
            .accessibilityHint("Edits the target curve")
            .accessibilityIdentifier("analyze.targetLegend")
            pencil
        }
    }

    @ViewBuilder private var pencil: some View {
        let button = Button(action: onEdit) {
            Image(systemName: "pencil")
                .font(metrics.pencilIsBordered ? metrics.font.weight(.semibold) : metrics.font)
                .foregroundStyle(metrics.pencilIsBordered ? Palette.target : Palette.secondaryText)
                .frame(minWidth: metrics.pencilButtonSize, minHeight: metrics.pencilButtonSize)
                .background {
                    if metrics.pencilIsBordered {
                        Capsule()
                            .fill(Palette.surface)
                            .overlay(Capsule().strokeBorder(Palette.target.opacity(Layout.pencilBorderOpacity), lineWidth: Layout.pencilBorderWidth))
                    }
                }
                .contentShape(Rectangle().inset(by: -metrics.hitOutset))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Edit target")
        .accessibilityHint("Edits the target curve")
        .accessibilityIdentifier("analyze.targetLegend.edit")
        button
    }
}

/// The "Editing target" chip (Cancel / Done) shown in place of the legend,
/// under the RTA, while `model.isEditingTarget` (#1558, #1565). On iPad
/// Cancel and Done are 44 pt tall (#1744).
private struct TargetEditChip: View {
    let model: AnalyzeModel
    let metrics: TargetControlMetrics

    var body: some View {
        HStack(spacing: Layout.editChipSpacing) {
            Label(TargetCurveEditor.chipTitle, systemImage: "pencil")
                .font(metrics.font.weight(.semibold))
                .foregroundStyle(Palette.target)
            Button("Cancel") {
                withAnimation(.snappy) { model.cancelTargetEdit() }
            }
            .font(metrics.font.weight(.semibold))
            .foregroundStyle(Palette.secondaryText)
            .frame(minWidth: metrics.minHitSize, minHeight: metrics.editButtonMinHeight)
            .contentShape(Rectangle())
            .accessibilityIdentifier("analyze.targetEditChip.cancel")
            Button("Done") {
                withAnimation(.snappy) { model.commitTargetEdit() }
            }
            .font(metrics.font.weight(.semibold))
            .foregroundStyle(Palette.accent)
            .frame(minWidth: metrics.minHitSize, minHeight: metrics.editButtonMinHeight)
            .contentShape(Rectangle())
            .accessibilityIdentifier("analyze.targetEditChip.done")
        }
        .padding(.horizontal, Layout.editChipPaddingH)
        .padding(.vertical, metrics.editChipVerticalPadding)
        .background(Palette.surface, in: Capsule())
        .accessibilityIdentifier("analyze.targetEditChip")
    }
}

/// One-tap starting points for the target-curve draft while editing
/// (#1560): tapping a pill replaces the draft with that bundled curve,
/// discarding unsaved handle drags. On a narrow iPhone the row scrolls, and
/// it brings the selected pill fully into view on appear and on every
/// change, so the active curve is never the one cut off at the edge (#1742).
private struct TargetPresetStrip: View {
    let model: AnalyzeModel
    let metrics: TargetControlMetrics

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Layout.presetPillSpacing) {
                    ForEach(TargetCurvePreset.all) { preset in
                        TargetPresetPill(preset: preset, model: model, metrics: metrics)
                            .id(preset.id)
                    }
                }
            }
            .onAppear { reveal(model.activeTargetPresetId, with: proxy) }
            .onChange(of: model.activeTargetPresetId) { _, id in
                withAnimation(.snappy) { reveal(id, with: proxy) }
            }
        }
        .accessibilityIdentifier("analyze.targetPresets")
    }

    private func reveal(_ id: String?, with proxy: ScrollViewProxy) {
        guard let id else { return }
        proxy.scrollTo(id, anchor: .center)
    }
}

private struct TargetPresetPill: View {
    let preset: TargetCurvePreset
    let model: AnalyzeModel
    let metrics: TargetControlMetrics

    var body: some View {
        let selected = model.activeTargetPresetId == preset.id
        Button(preset.title) {
            withAnimation(.snappy) { _ = model.selectTargetPreset(preset) }
        }
        .font(metrics.font.weight(.semibold))
        .lineLimit(1)
        .padding(.horizontal, Layout.presetPillPaddingH)
        .padding(.vertical, metrics.pillVerticalPadding)
        .frame(minHeight: metrics.pillMinHeight)
        .foregroundStyle(selected ? Palette.background : Palette.secondaryText)
        .background(selected ? Palette.accent : Palette.surface, in: Capsule())
        .contentShape(Capsule())
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("analyze.targetPreset.\(preset.id)")
    }
}

// MARK: - Target tray (iPad landscape, #1745)

/// A compact card at the top of the wide layout's trailing column for
/// picking and editing the target curve on the right-hand side. Two rows
/// alone: the current target (with an "auto" badge) and **Edit curve**, then
/// the picker. One row above the console EQ panel. Picking applies the curve
/// directly (no edit mode); **Auto** returns to the program-mode target.
/// Every control is at least 44 pt. Disabled while editing: the band under
/// the RTA owns the edit (Cancel / Done).
private struct TargetTray: View {
    let model: AnalyzeModel
    let rows: Int
    let onEdit: () -> Void

    var body: some View {
        Group {
            if rows >= 2 {
                VStack(alignment: .leading, spacing: AnalyzeLayout.wideTargetTrayRowSpacing) {
                    HStack(spacing: Layout.legendSwatchGap) {
                        name
                        Spacer(minLength: Layout.legendSwatchGap)
                        editButton
                    }
                    picker
                    // Slot for Duplicate / Rename / Delete, filled by the
                    // manage-targets issue.
                }
            } else {
                HStack(spacing: Layout.legendSwatchGap) {
                    name
                    Spacer(minLength: Layout.legendSwatchGap)
                    picker
                    editButton
                }
            }
        }
        .padding(.horizontal, Layout.cardPadding)
        .padding(.vertical, AnalyzeLayout.wideTargetTrayPadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: Layout.cornerRadius))
        .disabled(model.isEditingTarget)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("analyze.targetTray")
    }

    private var name: some View {
        HStack(spacing: Layout.legendSwatchGap) {
            Text(model.target.label)
                .font(.headline)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            if model.targetIsAuto {
                Text("auto")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Palette.secondaryText)
                    .padding(.horizontal, Layout.badgePaddingH)
                    .padding(.vertical, Layout.badgePaddingV)
                    .background(Palette.background, in: Capsule())
            }
        }
        .frame(minHeight: TargetControlMetrics.minimumHitTarget)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(model.targetLegendText)
        .accessibilityIdentifier("analyze.targetTray.name")
    }

    private var editButton: some View {
        Button(action: onEdit) {
            Label("Edit curve", systemImage: "pencil")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Palette.target)
                .padding(.horizontal, Layout.trayButtonPaddingH)
                .frame(minWidth: TargetControlMetrics.minimumHitTarget, minHeight: TargetControlMetrics.minimumHitTarget)
                .background(Capsule().strokeBorder(Palette.target.opacity(Layout.pencilBorderOpacity), lineWidth: Layout.pencilBorderWidth))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Edits the target curve")
        .accessibilityIdentifier("analyze.targetTray.edit")
    }

    private var picker: some View {
        let selected = model.selectedTargetTrayId
        let options = model.targetTrayOptions
        let current = options.first(where: { $0.id == selected })?.title ?? model.target.label
        return Menu {
            ForEach(options) { option in
                Button {
                    withAnimation(.snappy) { select(option) }
                } label: {
                    if option.id == selected {
                        Label(option.title, systemImage: "checkmark")
                    } else {
                        Text(option.title)
                    }
                }
                .accessibilityIdentifier("analyze.targetTray.option.\(option.id)")
            }
        } label: {
            HStack(spacing: Layout.legendSwatchGap) {
                Text(current)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption.weight(.semibold))
            }
            .foregroundStyle(Palette.secondaryText)
            .padding(.horizontal, Layout.trayButtonPaddingH)
            .frame(minHeight: TargetControlMetrics.minimumHitTarget)
            .background(Palette.background, in: Capsule())
            .contentShape(Capsule())
        }
        .accessibilityLabel("Target curve")
        .accessibilityValue(current)
        .accessibilityIdentifier("analyze.targetTray.picker")
    }

    private func select(_ option: AnalyzeModel.TargetTrayOption) {
        if option.id == AnalyzeModel.autoTargetTrayId {
            model.selectAutoTarget()
        } else {
            model.selectTarget(id: option.id)
        }
    }
}

// MARK: - Coaching

/// The short coaching stack: up to AnalyzeCoachingViewModel.maxCards cards,
/// then the placeholder/filler slots so the stack height stays steady. Cards
/// are identified by `CoachingEvent.id` (#1700) and the model keeps their
/// order across refreshes, so a visible tip never moves or is recreated; only
/// its numbers update in place. Nothing here animates — the model refreshes
/// the stack about once a second, and an implicit animation over changing
/// text cross-fades old and new copies into ghosted, double-drawn text.
struct CoachingStackView: View {
    let model: AnalyzeModel
    var onShowOnConsole: ((CoachingEvent) -> Void)? = nil
    var showsConsoleAction: (CoachingEvent) -> Bool = { _ in false }
    /// The last coaching suggestion Apply wrote to Main LR (#1676), or `nil`
    /// before any Apply (or after Undo/a console change clears it).
    var applied: ConsoleCoachingApplied? = nil
    /// The same armed-writer-and-live-link gate `ConsoleEQPanel` uses for
    /// Apply (#1676 rework) — while false, Undo reads "Unlock to undo" and
    /// is disabled, so a tap never fires the `.disarmed` throw into the void.
    var canUndoApplied = false
    var onUndoApplied: (() -> Void)? = nil

    var body: some View {
        let events = model.coaching
        VStack(alignment: .leading, spacing: Layout.cardSpacing) {
            Text("Coaching")
                .font(.headline)
            if let applied, let onUndoApplied {
                AppliedCoachingNote(applied: applied, canUndo: canUndoApplied, onUndo: onUndoApplied)
            }
            ForEach(events) { event in
                CoachingCard(event: event, onShowOnConsole: onShowOnConsole, showsConsoleAction: showsConsoleAction)
            }
            ForEach(events.count..<AnalyzeCoachingViewModel.maxCards, id: \.self) { slot in
                if slot == 0 {
                    CoachingPlaceholder(text: model.coachingPlaceholder, isCalm: model.isMixOnTarget)
                } else {
                    // Keeps the stack's height steady as hints come and go.
                    Color.clear
                        .frame(height: Layout.coachingSlotMinHeight)
                        .accessibilityHidden(true)
                }
            }
        }
        .transaction { $0.animation = nil }
    }
}

/// The applied-coaching note in the coaching stack (#1676): a checkmark, the
/// confirmation copy, and an Undo button that writes that one band back to
/// its prior value. `canUndo` gates the button the same way `canApply` gates
/// Apply in `ConsoleEQPanel` (#1676 rework) — while false, the label reads
/// "Unlock to undo" and the button is disabled.
private struct AppliedCoachingNote: View {
    let applied: ConsoleCoachingApplied
    let canUndo: Bool
    let onUndo: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: Layout.cardSpacing) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(Palette.accent)
            Text(applied.confirmation)
                .font(.subheadline)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button(ConsoleCoachingMapper.undoLabel(isArmed: canUndo), action: onUndo)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Palette.accent)
                .disabled(!canUndo)
                .accessibilityIdentifier("coaching.applied.undo")
        }
        .padding(.horizontal, Layout.cardPadding)
        .frame(minHeight: Layout.coachingSlotMinHeight)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: Layout.cornerRadius))
        .accessibilityElement(children: .combine)
    }
}

/// The empty-stack slot. In the calm 'Mix is on target' state (#1699,
/// #1715) it gets a checkmark and primary text, so "nothing to fix" reads as
/// a result rather than as a waiting message.
private struct CoachingPlaceholder: View {
    let text: String
    var isCalm = false

    var body: some View {
        HStack(alignment: .center, spacing: Layout.cardSpacing) {
            if isCalm {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(Palette.accent)
                    .accessibilityHidden(true)
            }
            Text(text)
                .font(isCalm ? .subheadline.weight(.semibold) : .subheadline)
                .foregroundStyle(isCalm ? Color.primary : Palette.secondaryText)
        }
        .frame(maxWidth: .infinity, minHeight: Layout.coachingSlotMinHeight, alignment: .leading)
        .padding(.horizontal, Layout.cardPadding)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: Layout.cornerRadius))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(isCalm ? "coaching.onTarget" : "coaching.placeholder")
    }
}

private struct CoachingCard: View {
    let event: CoachingEvent
    var onShowOnConsole: ((CoachingEvent) -> Void)? = nil
    var showsConsoleAction: (CoachingEvent) -> Bool = { _ in false }

    var body: some View {
        HStack(alignment: .center, spacing: Layout.cardSpacing) {
            Image(systemName: icon)
                .foregroundStyle(Palette.accent)
            VStack(alignment: .leading, spacing: Layout.cardSpacing) {
                Text(event.message)
                    .font(.subheadline)
                    .lineLimit(Layout.coachingMaxLines)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let onShowOnConsole, showsConsoleAction(event) {
                    Button("Show on console") { onShowOnConsole(event) }
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Palette.accent)
                        .accessibilityIdentifier("coaching.showOnConsole")
                }
            }
        }
        .frame(minHeight: Layout.coachingSlotMinHeight)
        .padding(.horizontal, Layout.cardPadding)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: Layout.cornerRadius))
        .accessibilityElement(children: .combine)
    }

    private var icon: String {
        switch event.severity {
        case .warning: "exclamationmark.triangle.fill"
        case .suggestion: "slider.vertical.3"
        case .info: "info.circle"
        }
    }
}

// MARK: - Status

/// Mic-denied and start-failure messages, each with the next step.
private struct StatusMessageView: View {
    let model: AnalyzeModel

    var body: some View {
        switch model.state {
        case .micDenied:
            VStack(alignment: .leading, spacing: Layout.cardSpacing) {
                Text("Microphone access is off. Turn it on in Settings > Sound Buddy to analyze the room.")
                    .font(.subheadline)
                #if canImport(UIKit)
                Button("Open Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                }
                #endif
            }
        case .failed(let message):
            VStack(alignment: .leading, spacing: Layout.cardSpacing) {
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(Palette.error)
                Button("Try again") {
                    Task { await model.retry() }
                }
            }
        case .idle, .requestingPermission, .live:
            EmptyView()
        }
    }
}

// MARK: - Style

private enum Layout {
    static let screenPadding: CGFloat = 20
    static let sectionSpacing: CGFloat = 20
    static let headerSpacing: CGFloat = 2
    static let brandSpacing: CGFloat = 10
    /// Matches BRAND_MARK_POINTS in scripts/make_ios_icons.py.
    static let brandMarkSize: CGFloat = 36
    /// Lets "Sound Buddy" shrink rather than wrap beside the readout on narrow phones.
    static let titleMinScale: CGFloat = 0.8
    /// Gap between the hero number and its tiny "dB" unit.
    static let levelUnitSpacing: CGFloat = 2
    static let cardSpacing: CGFloat = 10
    static let cardPadding: CGFloat = 14
    static let cornerRadius: CGFloat = 12
    static let badgePaddingH: CGFloat = 10
    static let badgePaddingV: CGFloat = 5
    static let indicatorSpacing: CGFloat = 6
    static let indicatorDot: CGFloat = 8
    /// Fits a two-line coaching hint with padding, so cards keep one height.
    static let coachingSlotMinHeight: CGFloat = 64
    static let coachingMaxLines = 3
    static let legendSpacing: CGFloat = 6
    static let legendSwatchGap: CGFloat = 6
    static let legendSwatchLineWidth: CGFloat = 1.5
    static let legendSwatchDash: [CGFloat] = [3, 2]
    static let editChipSpacing: CGFloat = 10
    static let editChipPaddingH: CGFloat = 10
    static let presetPillSpacing: CGFloat = 8
    static let presetPillPaddingH: CGFloat = 10
    static let pencilBorderOpacity: CGFloat = 0.5
    static let pencilBorderWidth: CGFloat = 1
    static let trayButtonPaddingH: CGFloat = 12
    static let landscapeSpacing: CGFloat = 8
    static let peekHandleHeight: CGFloat = 28
    static let peekDragMinDistance: CGFloat = 8
    static let peekMaxHeightFraction: CGFloat = 0.6
    /// Dims the coaching peek handle while target-edit mode disables it (#1562).
    static let peekDisabledOpacity: Double = 0.4
    static let landscapeStripSpacing: CGFloat = 12
    /// Gap between the wide layout's RTA column and its coaching column (#1659).
    static let wideColumnSpacing: CGFloat = 16
}

/// Mirrors the Mac renderer's design tokens (app/renderer :root) — dark
/// neutrals with the gold accent. Internal (not file-private) so other
/// Analyze-adjacent views (e.g. ConsoleChip) share the same tokens.
enum Palette {
    static let background = hex(0x0B0C0F) // --neutral-950 (--bg-app)
    static let surface = hex(0x1B1F26) // --neutral-800 (--surface)
    static let accent = hex(0xEBB93C) // --gold-500
    static let live = hex(0x3FB950)
    static let error = hex(0xE5534B)
    static let secondaryText = hex(0xA2AAB6) // --neutral-300 (--text-secondary)
    /// Shares RTAPalette.target so the legend swatch matches the dashed line
    /// drawn on the RTA itself.
    static let target = RTAPalette.target

    private static func hex(_ rgb: UInt32) -> Color {
        Color(
            red: Double((rgb >> 16) & 0xFF) / 255,
            green: Double((rgb >> 8) & 0xFF) / 255,
            blue: Double(rgb & 0xFF) / 255
        )
    }
}

/// The raw-mic-path readout (#1708): what the running capture actually got
/// from the audio session and input node, so a processed path (voice
/// processing, AGC, a non-measurement mode) can never hide.
private struct MicPathSection: View {
    let diagnostics: MicSessionDiagnostics?

    var body: some View {
        Section {
            if let diagnostics {
                Label {
                    Text(diagnostics.statusLine)
                } icon: {
                    Image(systemName: diagnostics.isRawMeasurement ? "checkmark.seal" : "exclamationmark.triangle")
                        .foregroundStyle(diagnostics.isRawMeasurement ? Palette.accent : Color.orange)
                }
                .accessibilityIdentifier("settings.mic.diagnostics")
                ForEach(diagnostics.details, id: \.label) { detail in
                    LabeledContent(detail.label, value: detail.value)
                        .font(.footnote)
                }
            } else {
                Text("Mic: not listening")
                    .foregroundStyle(Palette.secondaryText)
                    .accessibilityIdentifier("settings.mic.diagnostics")
            }
        } header: {
            Text("Mic path")
        } footer: {
            Text("Raw measurement means Measurement mode with voice processing and AGC off. Built-in mics are uncalibrated, so levels stay estimates.")
        }
        .listRowBackground(Palette.surface)
    }
}
