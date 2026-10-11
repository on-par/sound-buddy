import Foundation

/// One coaching suggestion mapped onto Main LR's EQ (#1671): where a
/// band-deviation hint would land on the desk. A picture of the change —
/// `ConsoleTargetModel.applyCoaching(using:)` is what turns it into a write
/// (#1676), through `ConsoleEQWriter.submit`.
public struct ConsoleCoachingSuggestion: Equatable, Sendable {
    /// 0-based index into the Main LR `ConsoleEQ.bands` this suggestion
    /// substitutes.
    public let bandIndex: Int
    /// The ghost band: the chosen band's own type (PEQ or VEQ), with the
    /// suggested freq/gain/Q, console-grid quantized.
    public let band: ConsoleEQBand
    /// True when every PEQ/VEQ band was already in use, so the ghost retunes
    /// one of them rather than landing on a free band.
    public let retunesBandInUse: Bool
    /// "Band 3: −3 dB at 354 Hz".
    public var copy: String
    /// Non-nil only when `retunesBandInUse`.
    public var retuneNote: String?

    public var bandNumber: Int { bandIndex + 1 }

    public init(bandIndex: Int, band: ConsoleEQBand, retunesBandInUse: Bool, copy: String, retuneNote: String?) {
        self.bandIndex = bandIndex
        self.band = band
        self.retunesBandInUse = retunesBandInUse
        self.copy = copy
        self.retuneNote = retuneNote
    }
}

/// The result of applying a `ConsoleCoachingSuggestion` to Main LR (#1676):
/// the band's value before and after, and the copy the UI shows for the
/// confirmation and the before → after line. `written` is always what the
/// writer actually sent — limited against `prior` by
/// `ConsoleEQEdit.limitedBand` exactly as `ConsoleEQWriter.submit` limits it
/// — never the unlimited ghost, so the confirmation never claims more than
/// was sent (ADR-0161 §4).
public struct ConsoleCoachingApplied: Equatable, Sendable {
    /// 0-based index into Main LR's `ConsoleEQ.bands`.
    public let bandIndex: Int
    public let prior: ConsoleEQBand
    public let written: ConsoleEQBand
    /// "Applied −3 dB at 220 Hz on Main LR".
    public let confirmation: String
    /// "Band 2: 0 dB at 250 Hz → −3 dB at 220 Hz".
    public let beforeAfter: String

    public var bandNumber: Int { bandIndex + 1 }

    public init(bandIndex: Int, prior: ConsoleEQBand, written: ConsoleEQBand, confirmation: String, beforeAfter: String) {
        self.bandIndex = bandIndex
        self.prior = prior
        self.written = written
        self.confirmation = confirmation
        self.beforeAfter = beforeAfter
    }
}

/// Maps a band-deviation `CoachingEvent` onto Main LR's `ConsoleEQ`: a free
/// (flat) PEQ/VEQ band centred in the coached band, or else the nearest one
/// (flagged for retuning), gain opposite the deviation clamped to
/// ±`maxGainDb`. Pure; the view only renders what this computes.
public enum ConsoleCoachingMapper {
    /// The ghost never suggests more than this much cut or boost.
    public static let maxGainDb = 3.0
    /// A PEQ/VEQ band within this of 0 dB counts as "free" for the picker.
    public static let flatGainEpsilonDb = 0.05
    public static let minQ = 0.3
    public static let maxQ = 10.0

    /// The Apply button's label while an armed writer is available.
    public static let applyLabelArmed = "Apply"
    /// The Apply button's label (disabled) while no armed writer is
    /// available — tells the engineer what to do, not just that it's off.
    public static let applyLabelDisarmed = "Unlock to apply"
    /// The Undo button's label while an armed writer is available.
    public static let undoLabelArmed = "Undo"
    /// The Undo button's label (disabled) while no armed writer is
    /// available — tells the engineer what to do, not just that it's off.
    public static let undoLabelDisarmed = "Unlock to undo"

    static let deviationKey = "deviationDb"
    static let minusSign = "\u{2212}"

    /// `nil` when `event` isn't a usable band-deviation hint for Main LR, or
    /// Main LR has no PEQ/VEQ band to borrow at all.
    public static func suggestion(for event: CoachingEvent, mainLR eq: ConsoleEQ) -> ConsoleCoachingSuggestion? {
        guard event.ruleType == .bandDeviation, let band = event.band else { return nil }
        guard
            let data = event.data, let value = data[deviationKey],
            case .number(let deviation) = value, deviation.isFinite, deviation != 0
        else { return nil }
        guard eq.target == .mainLR else { return nil }

        let candidates = eq.bands.indices.filter { isPeqOrVeq(eq.bands[$0].type) }
        guard !candidates.isEmpty else { return nil }

        let gain = ConsoleEQScale.gainDb(raw: ConsoleEQScale.rawGain(db: clampGain(-deviation)))
        let centre = centreHz(for: band)
        let freq = ConsoleEQScale.freqHz(raw: ConsoleEQScale.rawFreq(hz: centre))
        let q = ConsoleEQScale.q(raw: ConsoleEQScale.rawQ(clampQ(centre / (band.highHz - band.lowHz))))

        let free = candidates.filter { abs(eq.bands[$0].gainDb) < flatGainEpsilonDb }
        let pool = free.isEmpty ? candidates : free
        let chosen = nearest(to: freq, among: pool, bands: eq.bands)
        let retunes = free.isEmpty

        let bandNumber = chosen + 1
        let ghostBand = ConsoleEQBand(type: eq.bands[chosen].type, freqHz: freq, gainDb: gain, q: q)
        let copy = "Band \(bandNumber): \(gainText(gain)) at \(ConsoleEQPanelState.freqText(freq))"
        let retuneNote = retunes ? "Every Main LR band is in use, so Band \(bandNumber) will be retuned." : nil

        return ConsoleCoachingSuggestion(bandIndex: chosen, band: ghostBand, retunesBandInUse: retunes, copy: copy, retuneNote: retuneNote)
    }

    /// `eq` with `suggestion`'s band substituted in and EQ forced on, so the
    /// ghost curve shows the change even when the desk's EQ is currently off.
    public static func ghostEQ(_ eq: ConsoleEQ, applying suggestion: ConsoleCoachingSuggestion) -> ConsoleEQ {
        var bands = eq.bands
        bands[suggestion.bandIndex] = suggestion.band
        return ConsoleEQ(target: eq.target, on: true, bands: bands, hpf: eq.hpf)
    }

    /// The "Show on console" action only ever shows for a band-deviation hint
    /// while the console chip is visible and the link is actually up.
    public static func showsAction(for event: CoachingEvent, consoleVisible: Bool, phase: ConsoleSessionPhase) -> Bool {
        consoleVisible && phase.isLinkUp && event.ruleType == .bandDeviation && event.band != nil
    }

    /// Works out what Apply will actually write: `suggestion.band` limited
    /// against the band's current (`prior`) value by
    /// `ConsoleEQEdit.limitedBand` — the same bound `ConsoleEQWriter.submit`
    /// applies — then quantized to the console's own step grid, so the copy
    /// and an optimistic fold never claim a value finer than the desk stores.
    public static func applied(_ suggestion: ConsoleCoachingSuggestion, to eq: ConsoleEQ) -> ConsoleCoachingApplied {
        let prior = eq.bands[suggestion.bandIndex]
        let limited = ConsoleEQEdit.limitedBand(suggestion.band, gestureStart: prior)
        let written = ConsoleEQBand(
            type: limited.type,
            freqHz: ConsoleEQScale.freqHz(raw: ConsoleEQScale.rawFreq(hz: limited.freqHz)),
            gainDb: ConsoleEQScale.gainDb(raw: ConsoleEQScale.rawGain(db: limited.gainDb)),
            q: ConsoleEQScale.q(raw: ConsoleEQScale.rawQ(limited.q))
        )
        let confirmation = "Applied \(gainText(written.gainDb)) at \(ConsoleEQPanelState.freqText(written.freqHz)) on Main LR"
        let beforeAfter = "Band \(suggestion.bandNumber): \(gainText(prior.gainDb)) at \(ConsoleEQPanelState.freqText(prior.freqHz)) \u{2192} \(gainText(written.gainDb)) at \(ConsoleEQPanelState.freqText(written.freqHz))"
        return ConsoleCoachingApplied(bandIndex: suggestion.bandIndex, prior: prior, written: written, confirmation: confirmation, beforeAfter: beforeAfter)
    }

    /// The single armed-writer-and-live-link gate for Apply and Undo
    /// (#1676 rework): true only with a non-nil writer and a live link.
    /// `ConsoleEQPanel` and `AnalyzeView` both call this rather than
    /// re-deriving the rule, so the two can't drift.
    public static func isArmed(writer: ConsoleEQWriter?, phase: ConsoleSessionPhase) -> Bool {
        writer != nil && phase.isLinkUp
    }

    /// "Apply" once armed, or "Unlock to apply" (disabled) otherwise.
    public static func applyLabel(isArmed: Bool) -> String {
        isArmed ? applyLabelArmed : applyLabelDisarmed
    }

    /// "Undo" once armed, or "Unlock to undo" (disabled) otherwise — the
    /// Undo button is gated on the same armed state as Apply (#1676 rework),
    /// so a tap while disarmed never silently swallows a `.disarmed` throw.
    public static func undoLabel(isArmed: Bool) -> String {
        isArmed ? undoLabelArmed : undoLabelDisarmed
    }

    private static func isPeqOrVeq(_ type: ConsoleEQBandType) -> Bool {
        type == .peaking || type == .vintagePeaking
    }

    /// Geometric centre of the coached band's [lowHz, highHz) range.
    private static func centreHz(for band: Band) -> Double {
        (band.lowHz * band.highHz).squareRoot()
    }

    private static func clampGain(_ db: Double) -> Double {
        min(maxGainDb, max(-maxGainDb, db))
    }

    private static func clampQ(_ q: Double) -> Double {
        min(maxQ, max(minQ, q))
    }

    /// Nearest band to `freq` by log-frequency distance; lowest index wins a
    /// tie, since `indices` is in ascending order and ties never replace the
    /// current best.
    private static func nearest(to freq: Double, among indices: [Int], bands: [ConsoleEQBand]) -> Int {
        var best = indices[0]
        var bestDistance = abs(log(bands[best].freqHz / freq))
        for index in indices.dropFirst() {
            let distance = abs(log(bands[index].freqHz / freq))
            if distance < bestDistance {
                best = index
                bestDistance = distance
            }
        }
        return best
    }

    /// "−3 dB" or "+2.5 dB" — `minusSign` (not a hyphen) for a cut, to match
    /// the console's own copy style.
    private static func gainText(_ db: Double) -> String {
        let sign = db < 0 ? minusSign : "+"
        return "\(sign)\(String(format: "%g", abs(db))) dB"
    }
}
