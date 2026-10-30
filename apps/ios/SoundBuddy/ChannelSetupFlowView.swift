import SoundBuddyKit
import SwiftUI

/// The channel-setup flow sheet (#1781): consent, then the reused connect
/// step, then the model gate's outcome. Pure routing on `flow.step` — every
/// decision lives in `ChannelSetupFlow`, this view only renders.
struct ChannelSetupFlowView: View {
    let flow: ChannelSetupFlow
    let onDismiss: () -> Void
    var onConfirmed: (ConfirmedChannelSetup) -> Void = { _ in }

    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        content
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { flow.foregrounded() }
            }
    }

    @ViewBuilder
    private var content: some View {
        switch flow.step {
        case .consent:
            ConsoleConsentView(onAllow: { flow.grantConsent() }, onCancel: onDismiss)
        case .connect:
            ConsoleConnectView(store: flow.store, onContinue: { _ in flow.continueToChannels() }, onDismiss: onDismiss)
        case let .unsupported(info):
            unsupportedView(info)
        case let .channels(info):
            channelsView(info)
        }
    }

    private func unsupportedView(_ info: ConsoleXInfo) -> some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: Layout.sectionSpacing) {
                Text(ChannelSetupCopy.unsupportedTitle)
                    .font(.title2.weight(.bold))
                    .accessibilityIdentifier("channelSetup.unsupported")
                Text(ChannelSetupCopy.unsupportedDetail(model: info.model))
                    .font(.subheadline)
                    .foregroundStyle(Palette.secondaryText)
            }
            .padding(Layout.screenPadding)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(Palette.background.ignoresSafeArea())
            .navigationTitle(ChannelSetupCopy.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", action: onDismiss)
                        .foregroundStyle(Palette.accent)
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private func channelsView(_ info: ConsoleXInfo) -> some View {
        NavigationStack {
            Group {
                if flow.review != nil {
                    VStack(alignment: .leading, spacing: 0) {
                        compactHeader(info)
                        ChannelSetupReviewView(flow: flow, onDone: { onConfirmed($0); onDismiss() })
                    }
                } else {
                    VStack(alignment: .leading, spacing: Layout.innerSpacing) {
                        Text(info.name)
                            .font(.headline)
                        Text(info.model)
                            .font(.subheadline)
                            .foregroundStyle(Palette.secondaryText)
                        readStatusView
                        Text("Firmware \(info.firmware)")
                            .font(.footnote)
                            .foregroundStyle(Palette.secondaryText)
                        Text(info.ip)
                            .font(.footnote)
                            .foregroundStyle(Palette.secondaryText)
                    }
                    .padding(Layout.cardPadding)
                    .background(Palette.surface, in: RoundedRectangle(cornerRadius: Layout.cornerRadius))
                    .padding(Layout.screenPadding)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                }
            }
            .background(Palette.background.ignoresSafeArea())
            .accessibilityIdentifier("channelSetup.channels")
            .navigationTitle(ChannelSetupCopy.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                // The review's own Done (ChannelSetupReviewView) is the only
                // commit action; this sheet's toolbar only ever cancels.
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", action: onDismiss)
                }
            }
        }
        .preferredColorScheme(.dark)
        .task {
            if flow.channelRead == .idle { await flow.readChannels() }
        }
        .onDisappear { flow.cancelRead() }
    }

    private func compactHeader(_ info: ConsoleXInfo) -> some View {
        VStack(alignment: .leading, spacing: Layout.innerSpacing) {
            HStack(spacing: Layout.innerSpacing) {
                Text(info.name)
                    .font(.headline)
                Text(info.model)
                    .font(.subheadline)
                    .foregroundStyle(Palette.secondaryText)
            }
            if case let .done(result) = flow.channelRead, let missingSummary = result.missingSummary {
                HStack(spacing: Layout.innerSpacing) {
                    Text(missingSummary)
                        .font(.footnote)
                        .foregroundStyle(Palette.secondaryText)
                        .accessibilityIdentifier("channelSetup.missing")
                    Button(ChannelSetupCopy.retry) { Task { await flow.retryMissingChannels() } }
                        .accessibilityIdentifier("channelSetup.retry")
                }
            }
        }
        .padding(.horizontal, Layout.screenPadding)
        .padding(.top, Layout.innerSpacing)
        .padding(.bottom, Layout.cardPadding)
    }

    @ViewBuilder
    private var readStatusView: some View {
        switch flow.channelRead {
        case .idle:
            readingView(count: 0)
        case let .reading(count):
            readingView(count: count)
        case let .done(result):
            VStack(alignment: .leading, spacing: Layout.innerSpacing) {
                Text(ChannelSetupCopy.readSummary(count: result.readCount))
                    .font(.subheadline.weight(.semibold))
                    .accessibilityIdentifier("channelSetup.summary")
                if let missingSummary = result.missingSummary {
                    Text(missingSummary)
                        .font(.footnote)
                        .foregroundStyle(Palette.secondaryText)
                        .accessibilityIdentifier("channelSetup.missing")
                    Button(ChannelSetupCopy.retry) { Task { await flow.retryMissingChannels() } }
                        .accessibilityIdentifier("channelSetup.retry")
                }
            }
        case let .failed(error):
            VStack(alignment: .leading, spacing: Layout.innerSpacing) {
                Text(ChannelSetupCopy.readFailed(error))
                    .font(.subheadline.weight(.semibold))
                Button(ChannelSetupCopy.retry) { Task { await flow.readChannels() } }
                    .accessibilityIdentifier("channelSetup.retry")
            }
        }
    }

    private func readingView(count: Int) -> some View {
        HStack(spacing: Layout.innerSpacing) {
            ProgressView()
            Text(ChannelSetupCopy.reading(count: count))
        }
        .font(.subheadline.weight(.semibold))
        .accessibilityIdentifier("channelSetup.reading")
    }

    private enum Layout {
        static let screenPadding: CGFloat = 16
        static let sectionSpacing: CGFloat = 20
        static let innerSpacing: CGFloat = 6
        static let cardPadding: CGFloat = 16
        static let cornerRadius: CGFloat = 12
    }
}
