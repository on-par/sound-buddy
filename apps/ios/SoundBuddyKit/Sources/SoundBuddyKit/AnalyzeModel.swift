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

    /// Short honesty label: a phone mic is not a measurement mic, so readings
    /// are estimates. No longer a header badge (#1594) — the caveat lives in
    /// Settings (MicInputPolicy.honestyFootnote) and the level's a11y label.
    public static let honestyCue = "Phone mic estimate"
    /// The coaching stack changes at most this often, so its text stays
    /// readable while the meter runs at 20 Hz.
    public static let coachingRefreshSeconds = 1.0
    /// A gap longer than this between readings (e.g. a stalled engine) ages
    /// the RTA meter by this much at most.
    static let maxMeterStepSeconds = 0.5
    /// Default dBFS -> dB SPL offset for the built-in phone mic (#1571). An
    /// uncalibrated estimate, not a measurement: MicCapture runs the session in
    /// .measurement mode (no AGC), so one broadband offset is a stable first
    /// guess. The first cut, 115 dB, came from -25.4 dBFS on the phone vs ~90 dB
    /// on a handheld meter; dogfood 2026-09-27 (#1611) then showed the hero at
    /// 104.5 while the handheld read ~92, ~12.5 dB hot, so 115 - 12.5 = 102.5,
    /// rounded half up to 103.
    /// Unweighted (Z), the same DC-excluded power sum SpectrumAnalyzer reports.
    /// A future user calibration replaces this at the same seam (ADR-0158).
    public static let phoneMicSplOffsetDb = 103.0
    /// The hero's unit: a plain "dB" that the view draws tiny beside the
    /// number. The value is still the unweighted phone-mic SPL estimate (not
    /// dBA — no A-weighting is applied); Settings' honesty footnote carries the caveat.
    /// The RTA and coaching stay in dBFS / relative dB.
    public static let overallLevelUnit = "dB"
    /// Readings at or below this are treated as silence and show "—". Sits
    /// above the analyzer's -120 floor and well below any real room.
    public static let overallLevelFloorDb = -100.0
    /// Shown when there is no level to report.
    public static let noLevelText = "—"
    /// Half of the one-decimal display step, so the "-0.0" check uses an
    /// epsilon rather than float equality.
    static let halfDisplayStep = 0.05
    static let targetLegendPrefix = "Target · "
    static let targetAutoSuffix = " (auto)"
    /// The program-mode chip's labels (#1690, #1702).
    static let programChipSpeech = "Speech"
    static let programChipMusic = "Music"
    static let programChipSpeechOverBed = "Speech + bed"

    public private(set) var state: State = .idle
    public private(set) var bandLevels: BandLevels = .silent
    /// The RTA display state at the analysis rate (#1707): smoothed levels,
    /// deviations and peaks. The level-match of the dashed target reads it.
    /// RTAView steps its own copy per rendered frame from `rtaInput`.
    public private(set) var rta = RTADisplayModel()
    /// The latest raw RTA frame (dBFS per `rtaLayout` band), unsmoothed:
    /// RTAView's render-rate input. Empty when not live.
    public private(set) var rtaInput: [Double] = []
    /// The RTA's smoothing choice (Settings, persisted by the view). Display
    /// only: coaching never reads it.
    public var rtaBallistics: RTABallisticsMode = .defaultValue {
        didSet { rta.ballistics = rtaBallistics.ballistics }
    }
    /// Broadband level of the latest reading in dBFS; nil when not live or at
    /// or below overallLevelFloorDb (never a fake 0).
    public private(set) var overallDb: Double?
    /// The coaching cards (#1715): level-matched band deltas from every
    /// reading are smoothed (CoachingDeltaSmoother), gated by dwell and
    /// hysteresis (CoachingStabilizer: a tip appears after a sustained
    /// off-target run and stays at least 8 s), then reconciled into
    /// identity-stable cards (#1700, AnalyzeCoachingViewModel) — a tip that
    /// stays keeps its position and only its numbers change. At most
    /// `AnalyzeCoachingViewModel.maxCards`. The RTA does not go through this
    /// path; it keeps its own per-reading timing.
    public private(set) var coaching: [CoachingEvent] = []
    /// The calm 'Mix is on target' state (#1699, #1715): live readings are
    /// coming in, no tip has earned its way onto the screen, and no card is
    /// showing. Never true while a card is visible or before a real reading.
    public private(set) var isMixOnTarget = false
    /// Same bands as `coaching`, in the same order (both come from the coach
    /// on the same refresh); drawn as text-free pulses on the portrait RTA.
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
    /// while editing) — affects the legend copy and whether `programMode`
    /// drives the target (#1690).
    public private(set) var targetIsAuto: Bool

    /// The last Custom curve committed with Done this session (#1561). On-device
    /// and in memory only — never persisted or synced.
    public private(set) var sessionCustomTarget: IdealCurve?

    /// The detected program state (#1690, #1702): Music, Speech, or Speech +
    /// bed (talk over a quiet underscore), from the live readings'
    /// ProgramFeatures through ProgramContentClassifier and
    /// ProgramModeTracker. Drives the chip, which bands get coached (Speech +
    /// bed coaches the voice bands only), and, while the target is auto and
    /// not being edited, the auto target itself.
    public private(set) var programMode: ProgramMode = .music

    private let permission: MicPermission
    private let source: LiveAudioSource
    // Coaches against the last *committed* target, not the live draft (#1561):
    // rebuilt only by `apply()`, at init, when an edit is resolved (Done or
    // Cancel), and on an auto program-mode switch outside edit mode (#1690).
    // While editing, `target` is the draft and the coach still holds the
    // pre-edit curve, so the overlay and the hints intentionally disagree
    // until the edit resolves.
    private var coach: BandDeviationCoach
    private var coachingCards = AnalyzeCoachingViewModel()
    private var deltaSmoother = CoachingDeltaSmoother()
    private var stabilizer = CoachingStabilizer()
    private let now: () -> Date
    /// `target` resampled onto `rtaLayout`'s band centers, recomputed whenever
    /// `target` changes.
    public private(set) var rtaTargetOffsets: [Double]
    private var targetEditor = TargetCurveEditor()
    /// The one active target-handle drag (#1559); nil when no finger holds a
    /// handle. Freezes the level-match shift for its duration so the handle
    /// stays under the finger instead of drifting as the shift tracks the
    /// meter.
    private var handleDrag: TargetHandleDrag?
    /// Loads a bundled preset curve (#1560); injected so tests can fake or
    /// fail loading without a real bundle.
    private let presetLoader: (String) throws -> IdealCurve
    private var contentClassifier = ProgramContentClassifier()
    private var modeTracker = ProgramModeTracker()
    /// The auto target for `.music` mode — the curve passed in at init,
    /// before any program-mode switch (#1690).
    private let autoMusicTarget: IdealCurve
    /// The auto target for `.speech` mode, lazily loaded via `presetLoader`
    /// and cached; stays nil (and the model stays on `autoMusicTarget`) if
    /// loading throws.
    private var speechTarget: IdealCurve?
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
        self.autoMusicTarget = target
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
    /// two never disagree outside of edit mode. Only called at init, when an
    /// edit resolves (Done or Cancel), and on an auto program-mode switch
    /// outside edit mode (#1690) — never from the live draft (#1561).
    private func apply(target: IdealCurve, isAuto: Bool) {
        applyDrawn(target: target, isAuto: isAuto)
        guard target != coach.ideal else { return }
        coach = BandDeviationCoach(ideal: target)
        // Deltas and dwells so far were judged against the old curve (#1715).
        resetCoaching()
    }

    /// Drops every smoothed delta, dwell, visible tip and card, so coaching
    /// starts over: on stop, on a Speech/Music switch, and when the coach's
    /// curve changes (#1715). Clears the cards immediately and lets the next
    /// reading refresh them.
    private func resetCoaching() {
        deltaSmoother.reset()
        stabilizer.reset()
        stabilizer.targetDidSwitch(to: programMode)
        coachingCards.reset()
        coaching = []
        problemMarkers = []
        isMixOnTarget = false
        lastCoachingAt = nil
    }

    /// The curve the coach judges the room against — `target` outside of edit
    /// mode, but the pre-edit curve while editing, since drafts never reach
    /// the coach (#1561).
    public var coachingCurve: IdealCurve { coach.ideal }

    /// The hero's estimated dB SPL for a dBFS level: dbfs + phoneMicSplOffsetDb.
    /// nil (or non-finite) in means nil out — never a fake number.
    public static func estimatedSpl(fromDbfs dbfs: Double?) -> Double? {
        guard let dbfs, dbfs.isFinite else { return nil }
        return dbfs + phoneMicSplOffsetDb
    }

    /// The latest reading as an estimated dB SPL; nil whenever overallDb is.
    public var overallSplDb: Double? { Self.estimatedSpl(fromDbfs: overallDb) }

    /// Just the number, "92.3", or "—" when there is nothing to report —
    /// never a fake 0. The view draws this large and the unit small.
    public static func formatOverallLevelNumber(_ splDb: Double?) -> String {
        guard let splDb, splDb.isFinite else { return noLevelText }
        let rounded = (splDb * 10).rounded() / 10
        let value = abs(rounded) < halfDisplayStep ? 0 : rounded
        return String(format: "%.1f", value)
    }

    /// "92.3 dB" (the estimated SPL with its unit), or "—" when there is
    /// nothing to report — never a fake 0.
    public static func formatOverallLevel(_ splDb: Double?) -> String {
        guard let splDb, splDb.isFinite else { return noLevelText }
        return "\(formatOverallLevelNumber(splDb)) \(overallLevelUnit)"
    }

    /// The Analyze header's readout as one string (accessibility, tests).
    public var overallLevelText: String { Self.formatOverallLevel(overallSplDb) }

    /// The readout's number alone, drawn large next to the tiny unit.
    public var overallLevelNumberText: String { Self.formatOverallLevelNumber(overallSplDb) }

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

    // MARK: Program mode (speech/music) chip (#1690)

    /// Only shown while live — there is nothing to classify otherwise.
    public var showsProgramModeChip: Bool { state == .live }

    /// "Speech", "Music" or "Speech + bed", next to the target legend.
    public var programModeChipText: String {
        switch programMode {
        case .speech: Self.programChipSpeech
        case .music: Self.programChipMusic
        case .speechOverBed: Self.programChipSpeechOverBed
        }
    }

    /// Spells out that the auto target follows this mode when it actually
    /// does (auto target, not mid-edit); otherwise just reports the mode.
    public var programModeAccessibilityLabel: String {
        let mode = switch programMode {
        case .speech: "speech"
        case .music: "music"
        case .speechOverBed: "speech over a music bed"
        }
        guard targetIsAuto, !isEditingTarget else { return "Program: \(mode)" }
        return "Program: \(mode), target switched automatically"
    }

    /// Placeholder for an empty coaching stack. Never points at a button:
    /// listening is automatic.
    public var coachingPlaceholder: String {
        switch state {
        case .live:
            isMixOnTarget
                ? CoachingStabilizer.onTargetMessage
                : "Listening for the mix. A tip shows once a band stays off target. Keep listening."
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
        return TargetCurveHandles.handles(for: target).map {
            // Handles draw on the bandwidth-corrected line (#1726); their
            // stored offsetDb stays in the per-bin convention.
            RTATargetHandle(handle: $0, displayDb: RTATarget.displayOffsetDb($0.offsetDb, atHz: $0.hz) + shift)
        }
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
        handleDrag = TargetHandleDrag(
            handle: handle,
            startOffsetDb: handles[handle].offsetDb,
            levelShiftDb: shift,
            displayCorrectionDb: RTATarget.bandwidthCorrectionDb(atHz: handles[handle].hz)
        )
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

    // MARK: Target tray (#1745)

    /// One choice in the iPad Target tray's picker.
    public struct TargetTrayOption: Identifiable, Equatable, Sendable {
        public let id: String
        public let title: String
    }

    /// The tray id for "Auto" (the program-mode target, #1690).
    public static let autoTargetTrayId = "auto"
    static let autoTargetTrayTitle = "Auto"

    /// The tray picker: Auto, then the built-in presets. Saved customs join
    /// here once a custom-target store lands (#1743).
    public var targetTrayOptions: [TargetTrayOption] {
        [TargetTrayOption(id: Self.autoTargetTrayId, title: Self.autoTargetTrayTitle)]
            + TargetCurvePreset.all.map { TargetTrayOption(id: $0.id, title: $0.title) }
    }

    /// Which tray option is current: Auto while the target is auto,
    /// otherwise the active curve's id (a custom drag has its own id that
    /// matches no option).
    public var selectedTargetTrayId: String {
        targetIsAuto ? Self.autoTargetTrayId : target.id
    }

    /// Applies the built-in curve `id` directly, outside edit mode, as a user
    /// choice (`targetIsAuto` false). Rebuilds the coach and restarts
    /// coaching right away, the same way Done does. Returns false (no-op)
    /// while editing or when the curve can't be loaded.
    @discardableResult
    public func selectTarget(id: String) -> Bool {
        guard !isEditingTarget, let curve = try? presetLoader(id) else { return false }
        apply(target: curve, isAuto: false)
        lastCoachingAt = nil
        return true
    }

    /// Returns the target to Auto: the program-mode target (#1690) for the
    /// current mode, applied immediately. Returns false (no-op) while editing.
    @discardableResult
    public func selectAutoTarget() -> Bool {
        guard !isEditingTarget else { return false }
        apply(target: autoTargetForProgramMode(), isAuto: true)
        lastCoachingAt = nil
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

    /// The user picked another mic input (#1594): release the old input and
    /// start again on the new route, if Analyze is on screen. Also recovers a
    /// failed start, since the new input may be the fix.
    public func restartListening() async {
        halt()
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
        rtaInput = []
        overallDb = nil
        handleDrag = nil
        contentClassifier.reset()
        modeTracker.reset()
        programMode = .music
        resetCoaching()
        syncAutoTarget()
        state = .idle
    }

    private func ingest(_ reading: SpectrumReading) {
        let time = now()
        let step = lastReadingAt.map { min(Self.maxMeterStepSeconds, time.timeIntervalSince($0)) } ?? 0
        lastReadingAt = time
        bandLevels = reading.bands
        overallDb = reading.overallDb > Self.overallLevelFloorDb ? reading.overallDb : nil
        rtaInput = reading.rtaDb
        rta.step(input: reading.rtaDb, targetOffsets: rtaTargetOffsets, dt: step)

        if let features = reading.programFeatures {
            programMode = modeTracker.update(contentClassifier.classify(features), at: time)
        }
        // Any state switch (Music, Speech, Speech + bed) drops every tip and
        // dwell (#1701, #1715, #1702), whether or not the auto target follows.
        if programMode != stabilizer.activeMode {
            resetCoaching()
        }
        syncAutoTarget()

        if isCoachingFrozen { return }
        // Every reading feeds the smoother and the stabilizer, so dwell
        // timing is measured at the meter rate; the cards refresh at most
        // once per coachingRefreshSeconds, or at once when the tip set changes.
        // Speech + bed coaches the voice bands only, level-matched among
        // themselves: the bed's lows and air are not the voice's (#1702).
        let deviations = coach.deviations(for: reading.bands, in: programMode.coachedBands)
        let smoothed = deviations.isEmpty ? [:] : deltaSmoother.ingest(deviations, at: time)
        let previouslyVisible = stabilizer.visible
        let visible = stabilizer.ingest(smoothed, at: time)
        if visible == previouslyVisible, let last = lastCoachingAt,
           time.timeIntervalSince(last) < Self.coachingRefreshSeconds {
            return
        }
        lastCoachingAt = time
        let elapsed = sessionStart.map { time.timeIntervalSince($0) } ?? 0
        coaching = coachingCards.update(with: coach.events(forDeviations: smoothed, bands: visible, sessionTime: elapsed))
        let markers = coach.problemMarkers(forDeviations: smoothed, bands: visible)
        problemMarkers = coaching.compactMap { card in markers.first { $0.band == card.band } }
        isMixOnTarget = stabilizer.isOnTarget && coaching.isEmpty
    }

    /// Reconciles the drawn/coaching target with `programMode` while the
    /// target is auto and not being edited (#1690): never switches a
    /// user-chosen target, and never touches the coach mid-edit (drafts
    /// never reach the coach, ADR-0156). Re-evaluated on every reading (not
    /// just on a mode flip) so it is self-healing after an edit cancels back
    /// to auto, or after halt.
    private func syncAutoTarget() {
        guard targetIsAuto, !isEditingTarget else { return }
        let desired = autoTargetForProgramMode()
        guard desired != target else { return }
        apply(target: desired, isAuto: true)
        lastCoachingAt = nil
    }

    /// The auto target for the current `programMode`: the speech curve for
    /// Speech and Speech + bed (the voice is what's coached), otherwise the
    /// music target from init.
    private func autoTargetForProgramMode() -> IdealCurve {
        switch programMode {
        case .speech, .speechOverBed:
            loadSpeechTarget() ?? autoMusicTarget
        case .music:
            autoMusicTarget
        }
    }

    /// Loads and caches the speech-podcast curve on first use; a load
    /// failure leaves `speechTarget` nil so every call keeps retrying (and
    /// the model stays on the music target) rather than caching a failure.
    private func loadSpeechTarget() -> IdealCurve? {
        if let speechTarget { return speechTarget }
        let curve = try? presetLoader(IdealCurveLibrary.speechPodcastId)
        speechTarget = curve
        return curve
    }
}
