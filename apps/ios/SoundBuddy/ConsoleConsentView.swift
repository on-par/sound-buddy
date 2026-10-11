import SoundBuddyKit
import SwiftUI

/// The console consent sheet (#1665, ADR-0161 §8): shown before the first
/// packet ever reaches an X32/M32, so the iOS Local Network prompt that
/// follows makes sense. Names exactly what Sound Buddy reads (channel names,
/// EQ, levels) and what it can change (EQ only, and only after Arm). This
/// view never touches `ConsoleConsentStore` itself — the caller's `onAllow`
/// does `consent.grant()` — so the store's only `grant()` call site in the
/// app stays attached to the closure passed in here.
struct ConsoleConsentView: View {
    let onAllow: () -> Void
    let onCancel: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Layout.sectionSpacing) {
                    consentBlock(heading: ConsoleConsentCopy.readsHeading, body: ConsoleConsentCopy.reads)
                    consentBlock(heading: ConsoleConsentCopy.writesHeading, body: ConsoleConsentCopy.writes)
                    Text(ConsoleConsentCopy.localNetworkNote)
                        .font(.footnote)
                        .foregroundStyle(Palette.secondaryText)
                        .accessibilityIdentifier("console.consent.localNetworkNote")
                    Button(ConsoleConsentCopy.allowButton, action: onAllow)
                        .buttonStyle(.borderedProminent)
                        .tint(Palette.accent)
                        .frame(maxWidth: .infinity)
                        .accessibilityIdentifier("console.consent.allow")
                }
                .padding(Layout.screenPadding)
            }
            .background(Palette.background.ignoresSafeArea())
            .navigationTitle(ConsoleConsentCopy.sheetTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(ConsoleConsentCopy.cancelButton, action: onCancel)
                        .foregroundStyle(Palette.secondaryText)
                        .accessibilityIdentifier("console.consent.cancel")
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private func consentBlock(heading: String, body: String) -> some View {
        VStack(alignment: .leading, spacing: Layout.innerSpacing) {
            Text(heading)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.primary)
            Text(body)
                .font(.body)
                .foregroundStyle(Palette.secondaryText)
        }
    }

    private enum Layout {
        static let screenPadding: CGFloat = 16
        static let sectionSpacing: CGFloat = 20
        static let innerSpacing: CGFloat = 6
    }
}
