import SoundBuddyKit
import SwiftUI

/// The channel-setup flow sheet (#1781): consent, then the reused connect
/// step, then the model gate's outcome. Pure routing on `flow.step` — every
/// decision lives in `ChannelSetupFlow`, this view only renders.
struct ChannelSetupFlowView: View {
    let flow: ChannelSetupFlow
    let onDismiss: () -> Void

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
            VStack(alignment: .leading, spacing: Layout.innerSpacing) {
                Text(ChannelSetupCopy.channelsPlaceholder(name: info.name, model: info.model))
                    .font(.subheadline.weight(.semibold))
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
            .background(Palette.background.ignoresSafeArea())
            .accessibilityIdentifier("channelSetup.channels")
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

    private enum Layout {
        static let screenPadding: CGFloat = 16
        static let sectionSpacing: CGFloat = 20
        static let innerSpacing: CGFloat = 6
        static let cardPadding: CGFloat = 16
        static let cornerRadius: CGFloat = 12
    }
}
