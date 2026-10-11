import SoundBuddyKit
import SwiftUI

/// The read-only EQ panel (#1669): the selected target's curve, band list,
/// EQ on/off state and (for a channel) the preamp HPF — a lock icon and no
/// edit affordance. Opens as a sheet on iPhone (`showsTargetButton: true`,
/// with a "Change" button to the existing picker, and `onDone` wired to
/// dismiss) or sits as a fixed-width side column on iPad landscape
/// (`showsTargetButton: false`, no `onDone` — the chip itself keeps opening
/// the picker there). While the link is down the values dim and a status
/// pill shows; the panel never blanks. While a coaching suggestion is
/// showing (#1671, Main LR only), a dashed ghost band/curve overlays the
/// desk's own curve with a copy block and an Apply button (#1676) beneath
/// the band list. Apply writes the ghost band to Main LR through `eqWriter`
/// — enabled only while an armed writer is injected; otherwise it reads
/// "Unlock to apply" and sends nothing. Pure rendering — every decision
/// lives in `ConsoleTargetModel.eqPanel`/`applyCoaching(using:)`
/// (SoundBuddyKit).
struct ConsoleEQPanel: View {
    let console: ConsoleTargetModel
    let analyze: AnalyzeModel
    var showsTargetButton = false
    /// `nil` until the #1666/#1674 adapter supplies a live armed writer —
    /// until then Apply always reads "Unlock to apply" and sends nothing.
    var eqWriter: ConsoleEQWriter? = nil
    var onDone: (() -> Void)?
    @State private var pickerOpen = false

    var body: some View {
        Group {
            if let onDone {
                NavigationStack {
                    panelBody
                        .navigationTitle("Console EQ")
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button("Done", action: onDone)
                                    .foregroundStyle(Palette.accent)
                                    .accessibilityIdentifier("consoleEQ.done")
                            }
                        }
                        .background(Palette.background.ignoresSafeArea())
                }
                .preferredColorScheme(.dark)
            } else {
                panelBody
            }
        }
        .sheet(isPresented: $pickerOpen) {
            ConsoleTargetPickerView(model: console) { pickerOpen = false }
        }
    }

    private var panelBody: some View {
        let state = console.eqPanel
        return ScrollView {
            VStack(alignment: .leading, spacing: Layout.sectionSpacing) {
                header(state: state)
                if let hint = console.deskSelectHint {
                    Text(hint)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Palette.secondaryText)
                        .accessibilityIdentifier("consoleEQ.deskSelectHint")
                }
                if let statusPill = state.statusPill {
                    Text(statusPill)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Palette.secondaryText)
                        .accessibilityIdentifier("consoleEQ.statusPill")
                }
                if let placeholder = state.placeholder {
                    Text(placeholder)
                        .font(.subheadline)
                        .foregroundStyle(Palette.secondaryText)
                } else {
                    valuesBody(state: state)
                        .opacity(state.isDimmed ? Layout.dimmedOpacity : 1)
                }
            }
            .padding(Layout.padding)
        }
        .background(Palette.background.ignoresSafeArea())
        .accessibilityIdentifier("consoleEQ.panel")
    }

    private func valuesBody(state: ConsoleEQPanelState) -> some View {
        let canApply = eqWriter != nil && state.phase.isLinkUp
        return VStack(alignment: .leading, spacing: Layout.sectionSpacing) {
            EQCurveView(eqPanel: state, analyze: analyze)
            if let hpfText = state.hpfText {
                Text(hpfText)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.secondaryText)
                    .accessibilityIdentifier("consoleEQ.hpf")
            }
            if let coaching = state.coaching, let eq = state.eq {
                CoachingGhostBlock(
                    coaching: coaching,
                    beforeAfter: ConsoleCoachingMapper.applied(coaching, to: eq).beforeAfter,
                    applyLabel: ConsoleCoachingMapper.applyLabel(isArmed: canApply),
                    canApply: canApply,
                    onApply: { try? console.applyCoaching(using: eqWriter) },
                    onClear: { console.clearCoaching() }
                )
            }
            if console.selected == .mainLR, let applied = console.appliedCoaching {
                AppliedCoachingBlock(applied: applied) { try? console.undoAppliedCoaching(using: eqWriter) }
            }
            VStack(alignment: .leading, spacing: Layout.rowSpacing) {
                ForEach(state.bandRows, id: \.number) { row in
                    BandRow(row: row)
                }
            }
        }
    }

    private func header(state: ConsoleEQPanelState) -> some View {
        HStack(spacing: Layout.headerSpacing) {
            Image(systemName: "lock.fill")
                .foregroundStyle(Palette.secondaryText)
                .accessibilityLabel("Read-only")
            Text(console.catalog.label(for: console.selected).displayName)
                .font(.headline)
                .lineLimit(1)
            if let eqOnLabel = state.eqOnLabel {
                Text(eqOnLabel)
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, Layout.badgePaddingH)
                    .padding(.vertical, Layout.badgePaddingV)
                    .background(Palette.surface, in: Capsule())
                    .accessibilityIdentifier("consoleEQ.onOff")
            }
            Spacer(minLength: 0)
            if showsTargetButton {
                Button("Change") { pickerOpen = true }
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.accent)
                    .accessibilityIdentifier("consoleEQ.changeTarget")
            }
        }
    }

    private enum Layout {
        static let sectionSpacing: CGFloat = 12
        static let rowSpacing: CGFloat = 6
        static let headerSpacing: CGFloat = 8
        static let padding: CGFloat = 16
        static let badgePaddingH: CGFloat = 8
        static let badgePaddingV: CGFloat = 4
        /// Dims the last-known values while the console link is down, per
        /// ConsoleEQPanelState.isDimmed — they stay on screen, never blank.
        static let dimmedOpacity: Double = 0.45
    }
}

/// One band row: "N · type · freq · gain · Q" in monospaced digits.
private struct BandRow: View {
    let row: ConsoleEQBandReadout

    var body: some View {
        HStack(spacing: Layout.spacing) {
            Text("\(row.number)")
                .frame(width: Layout.numberWidth, alignment: .leading)
            Text(row.typeLabel)
                .frame(width: Layout.typeWidth, alignment: .leading)
            Text(row.freqText)
                .frame(width: Layout.valueWidth, alignment: .trailing)
            Text(row.gainText)
                .frame(width: Layout.valueWidth, alignment: .trailing)
            Text(row.qText)
                .frame(width: Layout.valueWidth, alignment: .trailing)
        }
        .font(.footnote.monospacedDigit())
        .foregroundStyle(Color.primary)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Band \(row.number), \(row.typeLabel), \(row.freqText), \(row.gainText), Q \(row.qText)")
        .accessibilityIdentifier("consoleEQ.band.\(row.number)")
    }

    private enum Layout {
        static let spacing: CGFloat = 8
        static let numberWidth: CGFloat = 16
        static let typeWidth: CGFloat = 76
        static let valueWidth: CGFloat = 64
    }
}

/// The coaching ghost's copy block (#1671): "Suggestion (not applied)",
/// the band/amount copy, a retune note when the suggestion reuses a band
/// already in use, a before → after line, and Clear/Apply buttons.
/// `canApply` is only true with an armed writer and a live link (#1676);
/// while false, `applyLabel` reads "Unlock to apply" and the button is
/// disabled, so a tap sends nothing.
private struct CoachingGhostBlock: View {
    let coaching: ConsoleCoachingSuggestion
    let beforeAfter: String
    let applyLabel: String
    let canApply: Bool
    let onApply: () -> Void
    let onClear: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Layout.spacing) {
            HStack {
                Text("Suggestion (not applied)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Palette.secondaryText)
                Spacer(minLength: 0)
                Button("Clear", action: onClear)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Palette.accent)
                    .accessibilityIdentifier("consoleEQ.ghost.clear")
            }
            Text(coaching.copy)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Color.primary)
                .accessibilityIdentifier("consoleEQ.ghost.copy")
            if let retuneNote = coaching.retuneNote {
                Text(retuneNote)
                    .font(.caption)
                    .foregroundStyle(Palette.secondaryText)
                    .accessibilityIdentifier("consoleEQ.ghost.retune")
            }
            Text(beforeAfter)
                .font(.caption)
                .foregroundStyle(Palette.secondaryText)
                .accessibilityIdentifier("consoleEQ.ghost.beforeAfter")
            Button(applyLabel, action: onApply)
                .font(.caption.weight(.semibold))
                .disabled(!canApply)
                .accessibilityIdentifier("consoleEQ.ghost.apply")
        }
        .padding(Layout.padding)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: Layout.cornerRadius))
    }

    private enum Layout {
        static let spacing: CGFloat = 6
        static let padding: CGFloat = 10
        static let cornerRadius: CGFloat = 10
    }
}

/// The applied-coaching confirmation row (#1676): the confirmation copy, the
/// before → after line, and an Undo button that writes that one band back
/// to its prior value. Shown only while Main LR is selected and something is
/// applied — `onUndo` already swallows `.disarmed` because the button stays
/// enabled regardless of armed state, matching the Undo card in AnalyzeView.
private struct AppliedCoachingBlock: View {
    let applied: ConsoleCoachingApplied
    let onUndo: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Layout.spacing) {
            Text(applied.confirmation)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Color.primary)
                .accessibilityIdentifier("consoleEQ.applied.confirmation")
            Text(applied.beforeAfter)
                .font(.caption)
                .foregroundStyle(Palette.secondaryText)
            Button("Undo", action: onUndo)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Palette.accent)
                .accessibilityIdentifier("consoleEQ.applied.undo")
        }
        .padding(Layout.padding)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: Layout.cornerRadius))
    }

    private enum Layout {
        static let spacing: CGFloat = 6
        static let padding: CGFloat = 10
        static let cornerRadius: CGFloat = 10
    }
}
