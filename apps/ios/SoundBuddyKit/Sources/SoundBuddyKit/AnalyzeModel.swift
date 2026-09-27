import Foundation
import Observation

/// Asks the OS for microphone access. The app injects an AVAudioApplication
/// implementation; tests inject a fake.
public protocol MicPermission: Sendable {
    func request() async -> Bool
}

/// A live input that periodically reports a spectrum reading (7 coaching
/// bands + the display RTA) on the main actor. The app's MicCapture
/// (AVAudioEngine -> SampleRingBuffer -> SpectrumAnalyzer) is the real one.
@MainActor
public protocol LiveAudioSource: AnyObject {
    func start(onReading: @escaping @MainActor (SpectrumReading) -> Void) throws
    func stop()
}

/// State behind the Analyze screen. Analyze is always listening while it is on
/// screen and the app is in the foreground — there is no Start/Stop control.
/// The view reports lifecycle (appear/disappear, background/foreground,
/// terminate); this model owns permission, the mic, the latest readings, and
/// the short coaching stack. Views only render this.
///
/// P0 has no background audio mode, so backgrounding releases the mic and the
/// foreground resumes it.
@MainActor
@Observable
public final class AnalyzeModel {
    public enum State: Equatable {
        case idle
        case requestingPermission
        case micDenied
        case live
        case failed(String)
    }

    /// Always shown while analyzing on the built-in mic: a phone mic is not a
    /// measurement mic, so readings are estimates.
    public static let honestyCue = "Phone mic estimate"
    /// The coaching stack changes at most this often, so its text stays
    /// readable while the meter runs at 20 Hz.
    public static let coachingRefreshSeconds = 1.0
    /// A gap longer than this between readings (e.g. a stalled engine) ages
    /// the RTA meter by this much at most.
    static let maxMeterStepSeconds = 0.5
    /// Uncalibrated phone mic: full scale, never SPL.
    public static let overallLevelUnit = "dBFS"
    /// Readings at or below this are treated as silence and show "—". Sits
    /// above the analyzer's -120 floor and well below any real room.
    public static let overallLevelFloorDb = -100.0
    /// Shown when there is no level to report.
    public static let noLevelText = "—"
    /// Half of the one-decimal display step, so the "-0.0 dBFS" check uses an
    /// epsilon rather than float equality.
    static let halfDisplayStep = 0.05
    static let targetLegendPrefix = "Target · "
    static let targetAutoSuffix = " (auto)"

    public private(set) var state: State = .idle
    public private(set) var bandLevels: BandLevels = .silent
    public private(set) var rta = RTAMeter()
    /// Broadband level of the latest reading in dBFS; nil when not live or at
    /// or below overallLevelFloorDb (never a fake 0).
    public private(set) var overallDb: Double?
    public private(set) var coaching: [CoachingEvent] = []
    /// Same bands as `coaching` (both come from the coach on the same refresh);
    /// drawn as text-free pulses on the portrait RTA.
    public private(set) var problemMarkers: [ProblemMarkerDescriptor] = []
    public let rtaLayout = RTALayout.standard
    /// The clamp authority for target-handle drags (#1559): RTAView passes
    /// this as its own scale's default, so the drawn window and the drag
    /// clamp always agree.
    public let rtaScale = RTAScale.standard
    public let measurementSource: CoachingEvent.Source = .phoneMicEstimate
    /// The ideal-EQ curve drawn as the RTA's dashed target line. Changes only
    /// on edit-mode transitions, never at the meter rate.
    public private(set) var target: IdealCurve
    /// Whether `target` was picked automatically (vs. a user choice made
    /// while editing) — only affects the legend copy.
    public private(set) var targetIsAuto: Bool

    /// The last Custom curve committed with Done this session (#1561). On-device
    /// and in memory only — never persisted or synced.
    public private(set) var sessionCustomTarget: IdealCurve?

    private let permission: MicPermission
    private let source: LiveAudioSource
    // Coaches against the last *committed* target, not the live draft (#1561):
    // rebuilt only by `apply()`, at init and when an edit is resolved (Done or
    // Cancel). While editing, `target` is the draft and the coach still holds
    // the pre-edit curve, so the overlay and the hints intentionally disagree
    // until the edit resolves.
    private var coach: BandDeviationCoach
    private let now: () -> Date
    /// `target` resampled onto `rtaLayout`'s band centers, recomputed whenever
    /// `target` changes.
    private var rtaTargetOffsets: [Double]
    private var targetEditor = TargetCurveEditor()
    /// The one active target-handle drag (#1559); nil when no finger holds a
    /// handle. Freezes the level-match shift for its duration so the handle
    /// stays under the finger instead of drifting as the shift tracks the
    /// meter.
    private var handleDrag: TargetHandleDrag?
    /// Loads a bundled preset curve (#1560); injected so tests can fake or
    /// fail loading without a real bundle.
    private let presetLoader: (String) throws -> IdealCurve
    private var sessionStart: Date?
    private var lastReadingAt: Date?
    private var lastCoachingAt: Date?
    private var isOnScreen = false
    private var isForeground = true

    public init(
        permission: MicPermission,
        source: LiveAudioSource,
        target: IdealCurve = .flat,
        targetIsAuto: Bool = true,
        presetLoader: @escaping (String) throws -> IdealCurve = IdealCurveLibrary.builtIn(id:),
        now: @escaping () -> Date = Date.init
    ) {
        self.permission = permission
        self.source = source
        self.coach = BandDeviationCoach(ideal: target)
        self.target = target
        self.targetIsAuto = targetIsAuto
        self.rtaTargetOffsets = RTATarget.resample(target, onto: RTALayout.standard)
        self.presetLoader = presetLoader
        self.now = now
    }

    /// Sets `target`/`targetIsAuto` and the derived RTA offsets — the drawn
    /// line only, never the coach. Shared by `apply()` (which also rebuilds
    /// the coach) and `updateTargetDraft` (which must not).
    private func applyDrawn(target: IdealCurve, isAuto: Bool) {
        self.target = target
        self.targetIsAuto = isAuto
        rtaTargetOffsets = RTATarget.resample(target, onto: rtaLayout)
    }

    /// Sets the drawn target and rebuilds the coach from it together, so the
    /// two never disagree outside of edit mode. Only called at init and when
    /// an edit resolves (Done or Cancel) — never from the live draft (#1561).
    private func apply(target: IdealCurve, isAuto: Bool) {
        applyDrawn(target: target, isAuto: isAuto)
        coach = BandDeviationCoach(ideal: target)
    }

    /// The curve the coach judges the room against — `target` outside of edit
    /// mode, but the pre-edit curve while editing, since drafts never reach
    /// the coach (#1561).
    public var coachingCurve: IdealCurve { coach.ideal }

    /// "-18.4 dBFS", or "—" when there is nothing to report — never a fake 0.
    public static func formatOverallLevel(_ db: Double?) -> String {
        guard let db, db.isFinite else { return noLevelText }
        let rounded = (db * 10).rounded() / 10
        let value = abs(rounded) < halfDisplayStep ? 0 : rounded
        return String(format: "%.1f %@", value, overallLevelUnit)
    }

    /// The Analyze header's readout, rendered next to the honesty capsule.
    public var overallLevelText: String { Self.formatOverallLevel(overallDb) }

    /// `target` level-matched to the live meter's dB mean, one value per
    /// `rtaLayout` band — the RTA's dashed target line. `nil` when not live
    /// or the meter hasn't reported a full-width reading yet. Read only by
    /// RTAView (it already observes `rta`/`state`), so the coaching stack
    /// never re-renders at the meter rate.
    public var rtaTargetDb: [Double]? {
        guard state == .live, let shift = currentLevelShift else { return nil }
        return rtaTargetOffsets.map { $0 + shift }
    }

    /// The live dB-mean level-match shift, or the shift frozen at grab while
    /// a target handle is being dragged (#1559) — both `rtaTargetDb` and the
    /// handle overlay read this so the drawn line and the handles never
    /// disagree while a finger is down.
    private var currentLevelShift: Double? {
        handleDrag?.levelShiftDb ?? RTATarget.levelShift(offsets: rtaTargetOffsets, measured: rta.levels)
    }

    /// "Target · <label>", with " (auto)" appended when the target was picked
    /// automatically rather than chosen by the user.
    public static func formatTargetLegend(label: String, isAuto: Bool) -> String {
        targetLegendPrefix + label + (isAuto ? targetAutoSuffix : "")
    }

    /// The legend row shown under the RTA. Changes only on edit-mode
    /// transitions, never at the meter rate.
    public var targetLegendText: String { Self.formatTargetLegend(label: target.label, isAuto: targetIsAuto) }

    /// Placeholder for an empty coaching stack. Never points at a button:
    /// listening is automatic.
    public var coachingPlaceholder: String {
        switch state {
        case .live:
            "Balance looks close to the target. Keep listening."
        case .idle, .requestingPermission:
            "Listening starts automatically. Play program material through the PA."
        case .micDenied, .failed:
            "Coaching starts once the microphone is on."
        }
    }

    // MARK: Target curve editing (#1558)

    /// True while the in-place target-curve editor is open. The view swaps
    /// the Target legend for the "Editing target" chip while this is true.
    public var isEditingTarget: Bool { targetEditor.isEditing }

    /// True while the target is being edited: `coaching` and `problemMarkers`
    /// hold their last value until the edit resolves with Done or Cancel
    /// (#1561).
    public var isCoachingFrozen: Bool { isEditingTarget }

    /// Enters edit mode, snapshotting the active curve and its auto flag so
    /// Cancel can restore them exactly. No-op while already editing.
    public func beginTargetEdit() {
        targetEditor.begin(active: target, isAuto: targetIsAuto)
    }

    /// Applies `curve` as the draft: the RTA line follows it immediately, but
    /// the coach does not (#1561) — it keeps judging the pre-edit curve until
    /// the edit resolves. No-op when not editing.
    public func updateTargetDraft(_ curve: IdealCurve) {
        guard targetEditor.updateDraft(curve) else { return }
        applyDrawn(target: curve, isAuto: false)
    }

    /// Exits edit mode and restores the curve and auto flag that were active
    /// before editing began, then rebuilds the coach from that curve and
    /// clears `lastCoachingAt` so the very next reading refreshes coaching
    /// against it immediately (#1561). No-op when not editing.
    public func cancelTargetEdit() {
        guard let resolution = targetEditor.cancel() else { return }
        handleDrag = nil
        apply(target: resolution.curve, isAuto: resolution.isAuto)
        lastCoachingAt = nil
    }

    /// Exits edit mode, keeps the current draft, and rebuilds the coach from
    /// it, clearing `lastCoachingAt` so the next reading refreshes coaching
    /// immediately (#1561). When the committed curve is a drag (its id is
    /// `TargetCurveHandles.customId`), records it as `sessionCustomTarget`.
    /// No-op when not editing.
    public func commitTargetEdit() {
        guard let resolution = targetEditor.done() else { return }
        handleDrag = nil
        apply(target: resolution.curve, isAuto: resolution.isAuto)
        lastCoachingAt = nil
        if resolution.curve.id == TargetCurveHandles.customId {
            sessionCustomTarget = resolution.curve
        }
    }

    // MARK: Target curve handle drags (#1559)

    /// One control-point handle plus its display dB (level-matched, or the
    /// frozen drag shift while it is the active drag) — what RTAView draws.
    public struct RTATargetHandle: Equatable, Sendable {
        public let handle: TargetCurveHandle
        public let displayDb: Double
    }

    /// The handle overlay, level-matched for display. Empty unless editing,
    /// live, and a level shift is available (a full-width reading has
    /// arrived).
    public var rtaTargetHandles: [RTATargetHandle] {
        guard isEditingTarget, state == .live, let shift = currentLevelShift else { return [] }
        return TargetCurveHandles.handles(for: target).map { RTATargetHandle(handle: $0, displayDb: $0.offsetDb + shift) }
    }

    /// The ordinal of the handle currently held by a finger, or nil.
    public var activeTargetHandle: Int? { handleDrag?.handle }

    /// Grabs `handle`: returns `false` (no-op) when not editing, when `handle`
    /// is out of range, when a drag is already active (one active drag
    /// target at a time), or when there is no level shift yet. Otherwise
    /// captures the handle's current offset and freezes the level-match
    /// shift for the duration of the drag.
    @discardableResult
    public func beginTargetHandleDrag(_ handle: Int) -> Bool {
        guard isEditingTarget, handleDrag == nil, let shift = currentLevelShift else { return false }
        let handles = TargetCurveHandles.handles(for: target)
        guard handles.indices.contains(handle) else { return false }
        handleDrag = TargetHandleDrag(handle: handle, startOffsetDb: handles[handle].offsetDb, levelShiftDb: shift)
        return true
    }

    /// Moves the active drag by `translationFraction` (vertical drag distance
    /// as a fraction of the plot height, positive up) and writes the result
    /// into the draft. No-op without an active drag.
    public func dragTargetHandle(translationFraction: Double) {
        guard let drag = handleDrag else { return }
        let offsetDb = drag.offsetDb(forTranslationFraction: translationFraction, scale: rtaScale)
        updateTargetDraft(TargetCurveHandles.moving(target, handle: drag.handle, toOffsetDb: offsetDb))
    }

    /// Releases the active drag; the live level-match shift resumes on the
    /// next reading. No-op without an active drag.
    public func endTargetHandleDrag() {
        handleDrag = nil
    }

    // MARK: Target curve presets (#1560)

    /// The preset whose curve the draft currently is, for pill highlighting;
    /// nil when not editing or once a drag has made the draft custom.
    public var activeTargetPresetId: String? {
        guard isEditingTarget, TargetCurvePreset.all.contains(where: { $0.id == target.id }) else { return nil }
        return target.id
    }

    /// Replaces the draft with `preset`'s bundled curve, discarding unsaved
    /// drags. Ends any active handle drag first so the next drag starts from
    /// the preset's shape with a freshly captured level shift. Returns false
    /// (no-op) when not editing or when the bundled curve can't be loaded.
    @discardableResult
    public func selectTargetPreset(_ preset: TargetCurvePreset) -> Bool {
        guard isEditingTarget, let curve = try? preset.curve(load: presetLoader) else { return false }
        handleDrag = nil
        updateTargetDraft(curve)
        return true
    }

    // MARK: Lifecycle

    /// The Analyze screen is on screen: start listening.
    public func appear() async {
        isOnScreen = true
        await listen()
    }

    /// The Analyze screen left the screen: release the mic.
    public func disappear() {
        isOnScreen = false
        halt()
    }

    /// The app went to the background. No background audio in P0.
    public func enterBackground() {
        isForeground = false
        halt()
    }

    /// Back in the foreground: resume if Analyze is on screen. Also re-asks
    /// for the mic, so access granted in Settings takes effect on return.
    public func enterForeground() async {
        isForeground = true
        await listen()
    }

    /// The "Try again" action after a start failure.
    public func retry() async {
        await listen()
    }

    /// The app is terminating: release the mic.
    public func terminate() {
        halt()
    }

    private func listen() async {
        guard isOnScreen, isForeground, state != .live, state != .requestingPermission else { return }
        state = .requestingPermission
        let granted = await permission.request()
        // The app may have left the foreground while the prompt was up.
        guard isOnScreen, isForeground else {
            state = .idle
            return
        }
        guard granted else {
            state = .micDenied
            return
        }
        do {
            try source.start { [weak self] reading in self?.ingest(reading) }
            sessionStart = now()
            state = .live
        } catch {
            state = .failed(
                "Couldn't start the microphone: \(error.localizedDescription). Tap Try again, or close other apps that are using the mic."
            )
        }
    }

    private func halt() {
        guard state == .live else { return }
        source.stop()
        sessionStart = nil
        lastReadingAt = nil
        lastCoachingAt = nil
        bandLevels = .silent
        rta.reset()
        coaching = []
        problemMarkers = []
        overallDb = nil
        handleDrag = nil
        state = .idle
    }

    private func ingest(_ reading: SpectrumReading) {
        let time = now()
        let step = lastReadingAt.map { min(Self.maxMeterStepSeconds, time.timeIntervalSince($0)) } ?? 0
        lastReadingAt = time
        bandLevels = reading.bands
        overallDb = reading.overallDb > Self.overallLevelFloorDb ? reading.overallDb : nil
        rta.ingest(reading.rtaDb, dt: step)

        if isCoachingFrozen { return }
        if let last = lastCoachingAt, time.timeIntervalSince(last) < Self.coachingRefreshSeconds { return }
        lastCoachingAt = time
        let elapsed = sessionStart.map { time.timeIntervalSince($0) } ?? 0
        coaching = coach.events(for: reading.bands, sessionTime: elapsed)
        problemMarkers = coach.problemMarkers(for: reading.bands)
    }
}
