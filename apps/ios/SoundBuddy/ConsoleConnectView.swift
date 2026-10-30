import SoundBuddyKit
import SwiftUI
import UIKit

/// The connect sheet (#1666): manual IP entry, or re-probing last week's
/// console on open. `store.open()` runs once per presentation (`.task`) —
/// the auto-connect. This view never talks to `ConsoleTransport` itself,
/// only `ConsoleStore`.
struct ConsoleConnectView: View {
    let store: ConsoleStore
    let channelSetup: ChannelSetupFlow?
    let onDismiss: () -> Void

    @State private var manualAddress: String
    @Environment(\.scenePhase) private var scenePhase

    init(store: ConsoleStore, channelSetup: ChannelSetupFlow? = nil, onDismiss: @escaping () -> Void) {
        self.store = store
        self.channelSetup = channelSetup
        self.onDismiss = onDismiss
        _manualAddress = State(initialValue: store.savedConsole?.ip ?? "")
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Layout.sectionSpacing) {
                    header
                    phaseContent
                }
                .padding(Layout.screenPadding)
            }
            .background(Palette.background.ignoresSafeArea())
            .navigationTitle(channelSetup == nil ? ConsoleConnectCopy.title : ChannelSetupCopy.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done", action: onDismiss)
                        .foregroundStyle(Palette.secondaryText)
                        .accessibilityIdentifier("console.connect.done")
                }
            }
        }
        .preferredColorScheme(.dark)
        .task { await store.open() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { store.returnedToForeground() }
        }
    }

    private var header: some View {
        HStack {
            Text(store.currentWiFi?.displayName ?? ConsoleConnectCopy.noWiFi)
                .font(.footnote)
                .foregroundStyle(Palette.secondaryText)
                .accessibilityIdentifier("console.connect.wifi")
            Spacer()
            Button(ConsoleConnectCopy.rescan) {
                Task { await store.rescan() }
            }
            .disabled(store.savedConsole == nil)
            .accessibilityIdentifier("console.connect.rescan")
        }
    }

    @ViewBuilder
    private var phaseContent: some View {
        switch store.phase {
        case let .manual(notice):
            manualForm(notice: notice, fieldError: nil)
        case let .invalidAddress(error):
            manualForm(notice: nil, fieldError: error.message)
        case let .connecting(ip):
            ProgressView("Connecting to \(ip.description)…")
                .accessibilityIdentifier("console.connect.connecting")
        case let .connected(info):
            connectedContent(info)
        case let .noReply(ip):
            noReplyView(ip)
        case .permissionDenied:
            permissionDeniedView
        case let .failed(message):
            Text(message)
                .foregroundStyle(Palette.error)
                .accessibilityIdentifier("console.connect.failed")
        }
    }

    @ViewBuilder
    private func connectedContent(_ info: ConsoleXInfo) -> some View {
        if let channelSetup {
            switch channelSetup.step {
            case .unsupported:
                unsupportedView(info)
            case .identified:
                VStack(alignment: .leading, spacing: Layout.innerSpacing) {
                    connectedCard(info)
                    Button(ChannelSetupCopy.continueButton) {
                        channelSetup.continueToChannels()
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Palette.accent)
                    .accessibilityIdentifier("console.connect.continue")
                }
            default:
                connectedCard(info)
            }
        } else {
            connectedCard(info)
        }
    }

    private func manualForm(notice: String?, fieldError: String?) -> some View {
        VStack(alignment: .leading, spacing: Layout.innerSpacing) {
            if let notice {
                Text(notice)
                    .font(.footnote)
                    .foregroundStyle(Palette.secondaryText)
                    .accessibilityIdentifier("console.connect.notice")
            }
            Text(ConsoleConnectCopy.manualIP)
                .font(.subheadline.weight(.semibold))
            TextField("192.168.1.50", text: $manualAddress)
                .keyboardType(.decimalPad)
                .disableAutocorrection(true)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("console.connect.manualIP")
            if let fieldError {
                Text(fieldError)
                    .font(.footnote)
                    .foregroundStyle(Palette.error)
                    .accessibilityIdentifier("console.connect.fieldError")
            }
            Button(ConsoleConnectCopy.connect) {
                Task { await store.connect(manualAddress: manualAddress) }
            }
            .buttonStyle(.borderedProminent)
            .tint(Palette.accent)
            .accessibilityIdentifier("console.connect.connect")
        }
    }

    private func connectedCard(_ info: ConsoleXInfo) -> some View {
        VStack(alignment: .leading, spacing: Layout.innerSpacing) {
            Text(info.model)
                .font(.largeTitle.weight(.bold))
                .accessibilityIdentifier("console.connect.card.model")
            Text(info.name)
                .font(.subheadline)
                .foregroundStyle(Palette.secondaryText)
                .accessibilityIdentifier("console.connect.card.name")
            Text("Firmware \(info.firmware)")
                .font(.footnote)
                .foregroundStyle(Palette.secondaryText)
                .accessibilityIdentifier("console.connect.card.firmware")
            Text(info.ip)
                .font(.footnote)
                .foregroundStyle(Palette.secondaryText)
            Button(ConsoleConnectCopy.disconnect, role: .destructive) {
                store.disconnect()
            }
            .accessibilityIdentifier("console.connect.disconnect")
        }
        .padding(Layout.cardPadding)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: Layout.cornerRadius))
        .accessibilityIdentifier("console.connect.card")
    }

    private func unsupportedView(_ info: ConsoleXInfo) -> some View {
        VStack(alignment: .leading, spacing: Layout.innerSpacing) {
            Text(ChannelSetupCopy.unsupportedTitle)
                .font(.title2.weight(.bold))
            Text(ChannelSetupCopy.unsupportedDetail(model: info.model))
                .font(.subheadline)
                .foregroundStyle(Palette.secondaryText)
        }
        .padding(Layout.cardPadding)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: Layout.cornerRadius))
        .accessibilityIdentifier("console.connect.unsupported")
    }

    private func noReplyView(_ ip: ConsoleIPv4) -> some View {
        VStack(alignment: .leading, spacing: Layout.innerSpacing) {
            Text(ConsoleConnectCopy.noReply)
                .font(.subheadline.weight(.semibold))
            Text(ConsoleConnectCopy.noReplyDetail)
                .font(.footnote)
                .foregroundStyle(Palette.secondaryText)
            HStack {
                Button(ConsoleConnectCopy.retry) {
                    Task { await store.retry() }
                }
                .buttonStyle(.borderedProminent)
                .tint(Palette.accent)
                .accessibilityIdentifier("console.connect.retry")
                Button(ConsoleConnectCopy.manual) {
                    store.showManualEntry()
                }
                .accessibilityIdentifier("console.connect.manual")
            }
        }
    }

    private var permissionDeniedView: some View {
        VStack(alignment: .leading, spacing: Layout.innerSpacing) {
            Text(ConsoleConnectCopy.permissionDenied)
                .font(.subheadline)
                .foregroundStyle(Palette.secondaryText)
            Button(ConsoleConnectCopy.openSettings) {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(Palette.accent)
            .accessibilityIdentifier("console.connect.openSettings")
        }
    }

    private enum Layout {
        static let screenPadding: CGFloat = 16
        static let sectionSpacing: CGFloat = 20
        static let innerSpacing: CGFloat = 6
        static let cardPadding: CGFloat = 16
        static let cornerRadius: CGFloat = 12
    }
}
