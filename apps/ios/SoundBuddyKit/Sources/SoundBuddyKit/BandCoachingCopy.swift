/// Band-vs-target coaching copy in the Mac live-adjustments dialect
/// (app/renderer/live-adjustments-state.js: "A gentle cut there is what Sound
/// Buddy would try first.", "A small boost there…", en-dash Hz ranges).
/// TODO(shared-copy): replace this table with the ADR 0028 template registry
/// (packages/audio-engine/src/analyze/rule-narrative.ts) exported as JSON.
public enum BandCoachingCopy {
    static let overTemplate = "{band} ({range}) is {amount} dB above the target. A gentle cut there is what Sound Buddy would try first."
    static let underTemplate = "{band} ({range}) is {amount} dB below the target. A small boost there is what Sound Buddy would try first."
    static let kiloHz = 1000.0
    static let rangeDash = "\u{2013}" // en dash, as on the Mac

    /// Mac-style Hz/kHz range label, e.g. "60–250 Hz", "500 Hz–2 kHz", "2–4 kHz".
    public static func rangeLabel(lowHz: Double, highHz: Double) -> String {
        if highHz < kiloHz {
            return "\(Int(lowHz))\(rangeDash)\(Int(highHz)) Hz"
        }
        if lowHz >= kiloHz {
            return "\(kiloHzLabel(lowHz))\(rangeDash)\(kiloHzLabel(highHz)) kHz"
        }
        return "\(Int(lowHz)) Hz\(rangeDash)\(kiloHzLabel(highHz)) kHz"
    }

    /// The over/under coaching message for a band, filled from the templates.
    public static func message(band: Band, amountDb: Double, over: Bool) -> String {
        let template = over ? overTemplate : underTemplate
        return template
            .replacingOccurrences(of: "{band}", with: band.label)
            .replacingOccurrences(of: "{range}", with: rangeLabel(lowHz: band.lowHz, highHz: band.highHz))
            .replacingOccurrences(of: "{amount}", with: String(format: "%.1f", amountDb))
    }

    /// Whole kHz prints without decimals ("2", "20"); otherwise one decimal.
    private static func kiloHzLabel(_ hz: Double) -> String {
        let kHz = hz / kiloHz
        let rounded = (kHz * 10).rounded() / 10
        if rounded.truncatingRemainder(dividingBy: 1) == 0 {
            return String(Int(rounded))
        }
        return String(format: "%.1f", rounded)
    }
}
