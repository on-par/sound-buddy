import SoundBuddyKit
import SwiftUI

/// The channel setup flow sheet (#1781): consent, console identity, then the
/// placeholder handoff to channel reading (#1782).
struct ChannelSetupFlowView: View {
    let flow: ChannelSetupFlow
    let consent: ConsoleConsentStore
    let onDismiss: () -> Void

    var body: some View {
        switch flow.step {
        case .consent:
            ConsoleConsentView(
                onAllow: { consent.grant() },
                onCancel: onDismiss
            )
        case .connect, .identified, .unsupported:
            ConsoleConnectView(store: flow.store, channelSetup: flow, onDismiss: onDismiss)
        case let .channels(info):
            NavigationStack {
                Text(ChannelSetupCopy.channelsPending(name: info.name))
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .padding(Layout.screenPadding)
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
    }

    private enum Layout {
        static let screenPadding: CGFloat = 16
    }
}
