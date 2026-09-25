import SoundBuddyKit
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// The P0 Analyze screen: a console-style RTA, the short coaching stack, and
/// the phone-mic honesty cue. Always listening while on screen in the
/// foreground — no Start/Stop control; lifecycle events go to the model.
/// Pure rendering — every decision lives in AnalyzeModel (SoundBuddyKit),
/// which is where the tests are.
///
/// TODO(ipad): the layout is single-column; switch the RTA and coaching
/// stack side by side on a regular horizontal size class.
struct AnalyzeView: View {
    let model: AnalyzeModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        VStack(alignment: .leading, spacing: Layout.sectionSpacing) {
            header
            RTAView(model: model)
            CoachingStackView(model: model)
            Spacer(minLength: 0)
            StatusMessageView(model: model)
        }
        .padding(Layout.screenPadding)
        .background(Palette.background.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .task { await model.appear() }
        .onDisappear { model.disappear() }
        // No background audio mode in P0: release the mic when the app leaves
        // the foreground instead of letting the OS cut the engine, and pick it
        // back up on return. .inactive (permission alert, Control Center) is
        // deliberately ignored.
        .onChange(of: scenePhase) { _, phase in
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
        #endif
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: Layout.headerSpacing) {
                Text("Analyze")
                    .font(.largeTitle.weight(.bold))
                ListeningIndicator(state: model.state)
            }
            Spacer()
            Label(AnalyzeModel.honestyCue, systemImage: "iphone.gen3")
                .font(.caption.weight(.semibold))
                .padding(.horizontal, Layout.badgePaddingH)
                .padding(.vertical, Layout.badgePaddingV)
                .background(Palette.surface, in: Capsule())
                .foregroundStyle(Palette.secondaryText)
                .accessibilityLabel("\(AnalyzeModel.honestyCue): readings are relative, not calibrated")
        }
    }
}

/// Small status line under the title — the only listening chrome.
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

// MARK: - Coaching

/// The short coaching stack: BandDeviationCoach.maxEvents fixed slots, each
/// updated in place. Slots are identified by position (not by event), and
/// nothing here animates — the model refreshes the stack about once a second,
/// and an implicit animation over changing text cross-fades old and new
/// copies into ghosted, double-drawn text.
struct CoachingStackView: View {
    let model: AnalyzeModel

    var body: some View {
        let events = model.coaching
        VStack(alignment: .leading, spacing: Layout.cardSpacing) {
            Text("Coaching")
                .font(.headline)
            ForEach(0..<BandDeviationCoach.maxEvents, id: \.self) { slot in
                if slot < events.count {
                    CoachingCard(event: events[slot])
                } else if slot == 0 {
                    CoachingPlaceholder(text: model.coachingPlaceholder)
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

private struct CoachingPlaceholder: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(Palette.secondaryText)
            .frame(maxWidth: .infinity, minHeight: Layout.coachingSlotMinHeight, alignment: .leading)
            .padding(.horizontal, Layout.cardPadding)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: Layout.cornerRadius))
    }
}

private struct CoachingCard: View {
    let event: CoachingEvent

    var body: some View {
        HStack(alignment: .center, spacing: Layout.cardSpacing) {
            Image(systemName: icon)
                .foregroundStyle(Palette.accent)
            Text(event.message)
                .font(.subheadline)
                .lineLimit(Layout.coachingMaxLines)
                .frame(maxWidth: .infinity, alignment: .leading)
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
    static let headerSpacing: CGFloat = 4
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
}

/// Mirrors the Mac renderer's design tokens (app/renderer :root) — dark
/// neutrals with the gold accent.
private enum Palette {
    static let background = hex(0x0B0C0F) // --neutral-950 (--bg-app)
    static let surface = hex(0x1B1F26) // --neutral-800 (--surface)
    static let accent = hex(0xEBB93C) // --gold-500
    static let live = hex(0x3FB950)
    static let error = hex(0xE5534B)
    static let secondaryText = hex(0xA2AAB6) // --neutral-300 (--text-secondary)

    private static func hex(_ rgb: UInt32) -> Color {
        Color(
            red: Double((rgb >> 16) & 0xFF) / 255,
            green: Double((rgb >> 8) & 0xFF) / 255,
            blue: Double(rgb & 0xFF) / 255
        )
    }
}
