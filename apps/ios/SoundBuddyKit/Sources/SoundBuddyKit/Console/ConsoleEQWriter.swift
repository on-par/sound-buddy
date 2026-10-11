import Foundation

/// Named limits for `ConsoleEQWriter` (ADR-0161 §4–§5): nothing below is a
/// magic number at a call site.
public enum ConsoleEQWriteLimits {
    /// Max gain change per gesture, from the gesture's start value.
    public static let maxGainStepDb = 3.0
    /// Max frequency change per gesture, from the gesture's start value.
    public static let maxFreqStepOctaves = 1.0
    /// The console's own gain range; a gesture can never push past this even
    /// if `maxGainStepDb` would otherwise allow it.
    public static let gainLimitDb = 15.0
    /// The coalesced write rate cap.
    public static let maxMessagesPerSecond = 20.0
    /// `1 / maxMessagesPerSecond` — the minimum gap between two sent
    /// datagrams.
    public static let minSendInterval: TimeInterval = 1 / maxMessagesPerSecond
}

/// One user gesture's requested EQ change, in engineering units. Gain and
/// frequency cases carry the gesture's starting value so `ConsoleEQWriter`
/// can bound the change against it (ADR-0161 §4), independent of whatever
/// the console's current value actually is.
public enum ConsoleEQEdit: Equatable, Sendable {
    case gain(band: Int, db: Double, gestureStartDb: Double)
    case freq(band: Int, hz: Double, gestureStartHz: Double)
    case q(band: Int, q: Double)
    case type(band: Int, ConsoleEQBandType)
    case band(Int, ConsoleEQBand, gestureStart: ConsoleEQBand)
    case eqOn(Bool)
}

extension ConsoleEQEdit {
    /// The 1-based band this edit targets, or `nil` for `.eqOn` (which has
    /// no band).
    var band: Int? {
        switch self {
        case let .gain(band, _, _): band
        case let .freq(band, _, _): band
        case let .q(band, _): band
        case let .type(band, _): band
        case let .band(band, _, _): band
        case .eqOn: nil
        }
    }

    /// `db` limited to `[gestureStart - maxGainStepDb, gestureStart +
    /// maxGainStepDb]`, intersected with `[-gainLimitDb, +gainLimitDb]`. NaN
    /// passes through unclamped — `ConsoleEQScale.rawGain` has its own NaN
    /// handling (flat, 0.5), and clamping NaN against finite bounds would
    /// otherwise silently pick one of those bounds instead.
    private static func limitedGainDb(_ db: Double, gestureStart: Double) -> Double {
        guard !db.isNaN else { return db }
        let lower = max(gestureStart - ConsoleEQWriteLimits.maxGainStepDb, -ConsoleEQWriteLimits.gainLimitDb)
        let upper = min(gestureStart + ConsoleEQWriteLimits.maxGainStepDb, ConsoleEQWriteLimits.gainLimitDb)
        return min(max(db, lower), upper)
    }

    /// `hz` limited to `[gestureStart / 2^maxFreqStepOctaves, gestureStart *
    /// 2^maxFreqStepOctaves]`. No extra clamp to the sweep's 20 Hz–20 kHz
    /// range is needed: `ConsoleEQScale.rawFreq` already clamps there. NaN
    /// (and non-positive `hz`) passes through unclamped for the same reason
    /// as `limitedGainDb`.
    private static func limitedFreqHz(_ hz: Double, gestureStart: Double) -> Double {
        guard !hz.isNaN, hz > 0 else { return hz }
        let octaveRatio = pow(2.0, ConsoleEQWriteLimits.maxFreqStepOctaves)
        return min(max(hz, gestureStart / octaveRatio), gestureStart * octaveRatio)
    }

    /// `value` with its freq/gain limited against `gestureStart`'s freq/gain
    /// the same way `.band`'s own message encoding does. `internal` so
    /// `ConsoleCoachingMapper` (#1676) can work out exactly what a write will
    /// land on before submitting it.
    static func limitedBand(_ value: ConsoleEQBand, gestureStart: ConsoleEQBand) -> ConsoleEQBand {
        var limited = value
        limited.freqHz = limitedFreqHz(value.freqHz, gestureStart: gestureStart.freqHz)
        limited.gainDb = limitedGainDb(value.gainDb, gestureStart: gestureStart.gainDb)
        return limited
    }

    /// The one `OSCMessage` this edit sends, addressed under `eqPath`
    /// (`target.eqPath`), with its value limited, clamped, and quantized to
    /// the console's raw step grid.
    func message(eqPath: String) -> OSCMessage {
        switch self {
        case let .gain(band, db, gestureStartDb):
            let limited = ConsoleEQEdit.limitedGainDb(db, gestureStart: gestureStartDb)
            return OSCMessage("\(eqPath)/\(band)/g", [.float(Float(ConsoleEQScale.rawGain(db: limited)))])
        case let .freq(band, hz, gestureStartHz):
            let limited = ConsoleEQEdit.limitedFreqHz(hz, gestureStart: gestureStartHz)
            return OSCMessage("\(eqPath)/\(band)/f", [.float(Float(ConsoleEQScale.rawFreq(hz: limited)))])
        case let .q(band, q):
            return OSCMessage("\(eqPath)/\(band)/q", [.float(Float(ConsoleEQScale.rawQ(q)))])
        case let .type(band, type):
            return OSCMessage("\(eqPath)/\(band)/type", [.int(Int32(type.rawValue))])
        case let .band(band, value, gestureStart):
            let limited = ConsoleEQEdit.limitedBand(value, gestureStart: gestureStart)
            return OSCMessage("\(eqPath)/\(band)", [
                .int(Int32(limited.type.rawValue)),
                .float(Float(ConsoleEQScale.rawFreq(hz: limited.freqHz))),
                .float(Float(ConsoleEQScale.rawGain(db: limited.gainDb))),
                .float(Float(ConsoleEQScale.rawQ(limited.q))),
            ])
        case let .eqOn(on):
            return OSCMessage("\(eqPath)/on", [.int(on ? 1 : 0)])
        }
    }
}

/// The only path in SoundBuddyKit that can write to the console (ADR-0161).
/// Obtainable only from an armed `ConsoleSessionModel` (`init` is
/// `internal`). Every write is EQ-only (`ConsoleEQWriteAllowlist`), bounded
/// per gesture against its own gesture-start value, coalesced to the latest
/// value per address at `ConsoleEQWriteLimits.maxMessagesPerSecond`, and
/// reversible to a pre-session snapshot taken before a target's first
/// write. The clock, armed state, and transport are injected closures — this
/// class owns no timer and no socket.
public final class ConsoleEQWriter {
    private let now: () -> TimeInterval
    private let isArmed: () -> Bool
    private let send: (Data) -> Void

    /// Keyed by `ConsoleEQTarget`, not `OSCMessage` address: one snapshot per
    /// target, taken before that target's first write.
    private var snapshots: [ConsoleEQTarget: ConsoleEQ] = [:]
    private var snapshotOrder: [ConsoleEQTarget] = []

    /// Keyed by OSC address so the latest value for a given parameter wins.
    /// `pendingOrder` is insertion order: re-submitting an address replaces
    /// its value in `pending` but keeps its original position, so earlier
    /// *distinct* parameters still drain first.
    private var pending: [String: OSCMessage] = [:]
    private var pendingOrder: [String] = []
    private var lastSentAt: TimeInterval?

    /// Tolerance on the `minSendInterval` gate so float accumulation error
    /// in `now()` never holds back a send that is, for all practical
    /// purposes, already due.
    private static let sendGateEpsilon: TimeInterval = 1e-9

    init(now: @escaping () -> TimeInterval, isArmed: @escaping () -> Bool, send: @escaping (Data) -> Void) {
        self.now = now
        self.isArmed = isArmed
        self.send = send
    }

    /// `true` until the first `recordSnapshot(_:)` for `target` — before
    /// that, `submit` throws `.snapshotMissing` rather than writing blind.
    public func needsSnapshot(for target: ConsoleEQTarget) -> Bool {
        snapshots[target] == nil
    }

    /// Records `eq` as `eq.target`'s pre-session snapshot. The first
    /// recording per target wins for the life of this writer; every later
    /// one is ignored, so a target's revert baseline never silently drifts
    /// mid-session.
    public func recordSnapshot(_ eq: ConsoleEQ) {
        guard snapshots[eq.target] == nil else { return }
        snapshots[eq.target] = eq
        snapshotOrder.append(eq.target)
    }

    /// `true` while a write is still queued, not yet sent.
    public var hasPendingWrites: Bool { !pending.isEmpty }

    /// Submits `edit` for `target`: checks armed, checks the band is in
    /// range, checks a snapshot exists, then enqueues and pumps.
    public func submit(_ edit: ConsoleEQEdit, on target: ConsoleEQTarget) throws(ConsoleEQWriteError) {
        guard isArmed() else { throw .disarmed }
        if let band = edit.band, !(1...target.bandCount).contains(band) {
            throw .bandOutOfRange(target, band)
        }
        guard snapshots[target] != nil else {
            throw .snapshotMissing(target)
        }

        try enqueue(edit.message(eqPath: target.eqPath))
        pump()
    }

    /// Allowlist-checks `message`, then stores it latest-wins in `pending`.
    /// `internal`, reached by tests via `@testable` — nothing bypasses the
    /// allowlist on the way into `pending`.
    func enqueue(_ message: OSCMessage) throws(ConsoleEQWriteError) {
        guard isArmed() else { throw .disarmed }
        try ConsoleEQWriteAllowlist.check(message)
        if pending[message.address] == nil {
            pendingOrder.append(message.address)
        }
        pending[message.address] = message
    }

    /// Drives the rate-limited pump from an external clock (the future
    /// adapter's own timer, or a test's fake clock) — the same shape as the
    /// reducer's `.tick`.
    public func tick() {
        pump()
    }

    /// Sends at most one datagram per call: if disarmed, drops everything
    /// pending instead (a stale writer reference can't write after
    /// `disarm()`); otherwise, if the rate gate allows it, sends the oldest
    /// pending message.
    private func pump() {
        guard isArmed() else {
            pending.removeAll()
            pendingOrder.removeAll()
            return
        }
        guard !pendingOrder.isEmpty else { return }
        if let lastSentAt, now() - lastSentAt < ConsoleEQWriteLimits.minSendInterval - ConsoleEQWriter.sendGateEpsilon {
            return
        }

        let address = pendingOrder.removeFirst()
        guard let message = pending.removeValue(forKey: address) else { return }
        guard let data = try? ConsoleEQWriteAllowlist.encode(message) else {
            // Unreachable: `enqueue` already ran `ConsoleEQWriteAllowlist.check`
            // on this exact message before it was admitted to `pending`.
            return
        }
        send(data)
        lastSentAt = now()
    }

    /// Restores every snapshotted target's bands and on/off state to the
    /// exact pre-session raw values, replacing (rather than queuing behind)
    /// any of that target's still-pending edits. Later `tick()`s drain the
    /// restoration writes at the usual rate.
    public func revertAll() throws(ConsoleEQWriteError) {
        guard isArmed() else { throw .disarmed }

        for target in snapshotOrder {
            guard let snapshot = snapshots[target] else { continue }

            let bandPrefix = target.eqPath + "/"
            let staleAddresses = pendingOrder.filter { $0 == target.eqPath || $0.hasPrefix(bandPrefix) }
            for address in staleAddresses {
                pending.removeValue(forKey: address)
            }
            pendingOrder.removeAll { $0 == target.eqPath || $0.hasPrefix(bandPrefix) }

            for (index, bandValue) in snapshot.bands.enumerated() {
                let message = OSCMessage("\(target.eqPath)/\(index + 1)", [
                    .int(Int32(bandValue.type.rawValue)),
                    .float(Float(ConsoleEQScale.rawFreq(hz: bandValue.freqHz))),
                    .float(Float(ConsoleEQScale.rawGain(db: bandValue.gainDb))),
                    .float(Float(ConsoleEQScale.rawQ(bandValue.q))),
                ])
                try enqueue(message)
            }
            try enqueue(OSCMessage(target.eqPath + "/on", [.int(snapshot.on ? 1 : 0)]))
        }

        pump()
    }
}
