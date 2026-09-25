import SoundBuddyKit
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// The P0 Analyze screen: large 7-band EQ meter, the short coaching stack,
/// and mic start/stop. Pure rendering — every decision lives in AnalyzeModel
/// (SoundBuddyKit), which is where the tests are.
///
/// TODO(ipad): the layout is single-column; switch the bands and coaching
/// stack side by side on a regular horizontal size class.
struct AnalyzeView: View {
    let model: AnalyzeModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        VStack(alignment: .leading, spacing: Layout.sectionSpacing) {
            header
            EQBandsView(levels: model.bandLevels, isLive: model.state == .live)
            CoachingStackView(events: model.coaching, state: model.state)
            Spacer(minLength: 0)
            StatusMessageView(state: model.state)
            startStopButton
        }
        .padding(Layout.screenPadding)
        .background(Palette.background.ignoresSafeArea())
        .preferredColorScheme(.dark)
        // No background audio mode in P0: release the mic when the app leaves
        // the foreground instead of letting the OS cut the engine.
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { model.stop() }
        }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("Analyze")
                .font(.largeTitle.weight(.bold))
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

    private var startStopButton: some View {
        let live = model.state == .live
        return Button {
            if live {
                model.stop()
            } else {
                Task { await model.start() }
            }
        } label: {
            Label(live ? "Stop" : "Start listening", systemImage: live ? "stop.fill" : "mic.fill")
                .font(.title3.weight(.semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, Layout.buttonPaddingV)
        }
        .buttonStyle(.borderedProminent)
        .tint(live ? Palette.stop : Palette.accent)
        .disabled(model.state == .requestingPermission)
        .accessibilityHint(live ? "Stops the microphone" : "Starts listening through the iPhone microphone")
    }
}

// MARK: - EQ bands

/// Seven tall bars, one per band, scaled relative to the loudest band.
struct EQBandsView: View {
    /// Bars span this many dB below the loudest band (relative display — see
    /// BandLevels.barFractions).
    static let displayRangeDb = 36.0

    let levels: BandLevels
    let isLive: Bool

    var body: some View {
        let fractions = levels.barFractions(rangeDb: Self.displayRangeDb)
        HStack(alignment: .bottom, spacing: Layout.barSpacing) {
            ForEach(Band.allCases, id: \.self) { band in
                BandBar(band: band, fraction: fractions[band] ?? 0, db: levels[band], isLive: isLive)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: Layout.bandsHeight)
        .padding(Layout.cardPadding)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: Layout.cornerRadius))
        .animation(.linear(duration: Layout.meterAnimationSeconds), value: levels)
    }
}

private struct BandBar: View {
    let band: Band
    let fraction: Double
    let db: Double
    let isLive: Bool

    var body: some View {
        VStack(spacing: Layout.barLabelSpacing) {
            GeometryReader { geo in
                ZStack(alignment: .bottom) {
                    RoundedRectangle(cornerRadius: Layout.barCornerRadius)
                        .fill(Palette.track)
                    RoundedRectangle(cornerRadius: Layout.barCornerRadius)
                        .fill(Palette.bar)
                        .frame(height: geo.size.height * fraction)
                }
            }
            Text(band.label)
                .font(.caption2.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(Layout.labelMinScale)
            Text(isLive ? String(format: "%.0f", db) : "–")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(Palette.secondaryText)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(band.label), \(band.rangeLabel)")
        .accessibilityValue(isLive ? "\(Int(db.rounded())) dB, estimated" : "not listening")
    }
}

// MARK: - Coaching

/// The short coaching stack (at most BandDeviationCoach.maxEvents cards).
struct CoachingStackView: View {
    let events: [CoachingEvent]
    let state: AnalyzeModel.State

    var body: some View {
        VStack(alignment: .leading, spacing: Layout.cardSpacing) {
            Text("Coaching")
                .font(.headline)
            if events.isEmpty {
                Text(emptyText)
                    .font(.subheadline)
                    .foregroundStyle(Palette.secondaryText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(Layout.cardPadding)
                    .background(Palette.surface, in: RoundedRectangle(cornerRadius: Layout.cornerRadius))
            } else {
                ForEach(events) { event in
                    CoachingCard(event: event)
                }
            }
        }
        .animation(.default, value: events)
    }

    private var emptyText: String {
        state == .live
            ? "Balance looks close to the target. Keep listening."
            : "Tap Start listening and play program material through the PA."
    }
}

private struct CoachingCard: View {
    let event: CoachingEvent

    var body: some View {
        HStack(alignment: .top, spacing: Layout.cardSpacing) {
            Image(systemName: icon)
                .foregroundStyle(Palette.accent)
            Text(event.message)
                .font(.subheadline)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(Layout.cardPadding)
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
    let state: AnalyzeModel.State

    var body: some View {
        switch state {
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
            Text(message)
                .font(.subheadline)
                .foregroundStyle(Palette.stop)
        case .idle, .requestingPermission, .live:
            EmptyView()
        }
    }
}

// MARK: - Style

private enum Layout {
    static let screenPadding: CGFloat = 20
    static let sectionSpacing: CGFloat = 20
    static let cardSpacing: CGFloat = 10
    static let cardPadding: CGFloat = 14
    static let cornerRadius: CGFloat = 12
    static let badgePaddingH: CGFloat = 10
    static let badgePaddingV: CGFloat = 5
    static let buttonPaddingV: CGFloat = 8
    static let bandsHeight: CGFloat = 260
    static let barSpacing: CGFloat = 8
    static let barLabelSpacing: CGFloat = 4
    static let barCornerRadius: CGFloat = 4
    static let labelMinScale: CGFloat = 0.6
    /// Matches MicCapture's 20 Hz meter tick so bars glide between readings.
    static let meterAnimationSeconds = 0.05
}

/// Mirrors the Mac renderer's design tokens (app/renderer :root) — dark
/// neutrals with the gold accent.
private enum Palette {
    static let background = hex(0x0B0C0F) // --neutral-950 (--bg-app)
    static let surface = hex(0x1B1F26) // --neutral-800 (--surface)
    static let track = hex(0x2B303A) // --neutral-700
    static let bar = hex(0xEBB93C) // --gold-500
    static let accent = hex(0xEBB93C) // --gold-500
    static let stop = hex(0xE5534B)
    static let secondaryText = hex(0xA2AAB6) // --neutral-300 (--text-secondary)

    private static func hex(_ rgb: UInt32) -> Color {
        Color(
            red: Double((rgb >> 16) & 0xFF) / 255,
            green: Double((rgb >> 8) & 0xFF) / 255,
            blue: Double(rgb & 0xFF) / 255
        )
    }
}
