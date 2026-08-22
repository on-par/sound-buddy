// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

'use strict';

/* ══ Icon set + report-card renderers — extracted to report-card.ts (#306),
   bridged onto window by App.tsx like spectrumDisplay (#305). ══ */
const {
  iconSvg, strongMixTargetMeta,
} = window.reportCard;

/* ══ Share Image export (#265) + Export PNG's metadata guard (#368) —
   pure modules bridged onto window by App.tsx the same way as reportCard. ══ */
const { assertPngMetadataStripped } = window.reportExport;
const {
  SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT, MAX_SHARE_METRICS,
  buildShareCardModel, shareCardDrawOps, renderShareCard,
  assertNoIdentifyingText, buildShareFilename,
} = window.shareCard;

// Hydrate every element carrying a data-icon attribute (static markup).
function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => {
    const name = el.getAttribute('data-icon');
    const size = parseInt(el.getAttribute('data-size') || '', 10) || 16;
    // For button/tab labels, prepend the icon before the text once.
    if (el.dataset.iconDone) return;
    el.insertAdjacentHTML('afterbegin', iconSvg(name, size));
    el.dataset.iconDone = '1';
  });
}

/* ══ App state ══ */
const sb = window.soundBuddy;
// The licensing/settings Zustand stores, bridged onto window by
// installStoreBridge() (App.tsx) before this script runs (TD-001 slice 3,
// #421) — the single source of truth for license and AI/settings state.
// This script reads/writes them instead of keeping its own module-level
// copies of that state.
const licStore = window.rendererStores.licensing;
const setStore = window.rendererStores.settings;
// The analysis/spectrum Zustand stores (TD-001 slice 4, #422) — analysisStore
// is now the single source of truth for "what backs the report card";
// spectrumStore backs the spectrum panel's curve/bars + active ideal profile.
// ReportCardIsland/SpectrumPanel (React) render from these reactively; this
// script only writes to them and drives the DOM/chrome the islands don't own.
const anaStore = window.rendererStores.analysis;
const specStore = window.rendererStores.spectrum;
const curAnalysis = () => anaStore.getState().currentAnalysis;
// The <audio> playback transport (TD-001 slice 6a, #695) — installed onto
// window by installStoreBridge() alongside rendererStores. Owns the analyzed
// file's <audio> element lifecycle; SpectrogramScrubber (React) drives its
// discrete state and ~60Hz tick listener.
const transport = window.spectrumTransport;
// The measurement-source selection (#456) lives in liveCaptureStore; this
// script reads/writes it through the store instead of a module-level var.
const lcStore = window.rendererStores.liveCapture;

// Focused input for the per-input instrument-aware adjustment candidates
// (#525) and the coaching stability state (#612) are store-owned now (TD-001
// slice 6g, #710): lcStore.getState().focusedInputIndex / lapCoaching, with
// setFocusedInputIndex/lapDispose/advanceLapCoaching/resetLapCoaching as the
// only write paths. The store is seeded with a null lapCoaching at import
// (the live-adjustments classic script isn't on window yet); this boot seed
// establishes the canonical fresh state, mirroring the old module-var seed.
lcStore.getState().resetLapCoaching();
// A stored report-card summary loaded from the Recent Services list (#147) now
// lives in analysisStore.historySummary — ReportCardIsland renders it via a
// reduced, summary-only card when set and no live/file analysis is backing
// the card (TD-001 slice 4, #422); set by loadHistoryEntry() below.

// TD-001 slice 6j (#713): the DAW shell's playhead/waveform module state and
// the liveRunning/liveMode mirror vars those painters used to read are gone —
// daw-shell-runtime.ts owns that state in its own closure and reads capture
// state straight from liveCaptureStore (no mirror needed). The only remaining
// piece of the old mirror subscription is the arm-hint hide-on-liveMode-change
// side effect (TD-001 slice 6c, #701) — kept as its own slim subscription.
lcStore.subscribe((state, prevState) => {
  if (state.liveMode !== prevState.liveMode) lcStore.getState().hideArmHint();
});

// rcFeedbackPeak/rcPhaseSignal used to be module vars set by renderReportCard();
// ReportCardIsland (React) now computes them each render and seeds
// window.rcCallouts from a passive effect (TD-001 slice 4, #422) — read that
// instead (see openFeedbackRingout below).
function rcCallouts() { return window.rcCallouts || { feedbackPeak: null, phaseSignal: false }; }

/* ══ Formatting helpers ══ */
// stripLabel/liveChannelAt (the #39 label-resolution wrappers) and
// savedInstrumentProfilesForDevice (#524) were only used by the board/EQ-pane
// renderers this slice deleted (TD-001 slice 6g, #710) — the pure
// live-workspace-view module resolves labels/profiles from its snapshot now.
// fmtDur is now bridged from spectrum-display.ts (see the window.spectrumDisplay
// destructure below) — extracted alongside heatmapSVG/miniCurveSVG/timeAxisHTML
// (TD-001 slice 4, #422).

/* ══ Band metadata / meter geometry — extracted to spectrum-display.ts (#305),
   bridged onto window by App.tsx like audioEngineProfiles (#309). ══ */
const {
  DB_MIN, DB_MAX, EQ_COLS,
  CURVE_VB, CURVE_FMIN, CURVE_FMAX,
  fmtHz, levelMatchedTarget, niceTicks, smoothPath,
  spectrumCurveSVG, spectrumLegendHTML, bandLevelsFromCurve, bandDbFromSpectrum,
  veqBarsAndLabelsHTML, eqTargetLineSVG, eqCentroidHTML, eqBarsHTML,
  veqLoudestIdx, veqBandView, veqValBottom,
  heatmapSVG, miniCurveSVG, fmtDur, timeAxisHTML, classLabel,
  hasUsableCurve,
} = window.spectrumDisplay;

/* ══ Live-capture panel rendering — extracted to live-capture-panel.ts (#307),
   bridged onto window by App.tsx like spectrumDisplay/reportCard. The 6g
   migration (TD-001 slice 6g, #710) orphaned the board/EQ-pane markup helpers
   (liveMetersHTML/eqPaneView/eqPaneHTML/eqPaneSignature/eqPanePatchPlan/
   patchLiveChannel, the group-summary helpers, LIVE_BAND_KEYS/liveBandCurve/
   veqArcSVG), the measurement-source label helpers, and
   clampEqPaneWidth/EQ_PANE_RESIZE_STEP (LiveEqPane owns the resize now) — and
   the 6i migration (TD-001 slice 6i, #712) moved the lifecycle + its
   deviceChannelCount/shouldOfferReportCard/liveSessionReportCardSource/
   normalizeMeasurementSource reads into capture-lifecycle.ts. ══ */

/* ══ Opt-in crash reporting (#473) — extracted to crash-hooks.ts, bridged onto
   window by App.tsx like spectrumDisplay/reportCard/liveCapturePanel. Only
   installed when the main process exposes reportRendererError (older mock
   bridges in e2e may not), so a stubbed bridge never breaks. ══ */
const { installCrashHooks } = window.crashHooks;
if (sb.reportRendererError) installCrashHooks(window, (input) => sb.reportRendererError(input));

/* ══ Ideal EQ profiles + curve editor (PRD 05) ══
   Selection state (idealProfileId/customIdealProfiles), the
   #ideal-profile-select dropdown, and the #curve-dialog curve editor are now
   idealProfilesStore + IdealProfileSelect/CurveEditorDialog (React) (TD-001
   slice 6b, #700). The analysis-or-selection → active-profile glue that used
   to live in this script's syncIdealProfile now lives in bridge.ts's
   idealProfilesStore subscriptions — see saveMixAsTarget below for the one
   remaining call site this script drives directly. */

/* ══ Spectrum panel rendering ══
   The whole analysis-spectrum surface — panel display state, the curve/bars,
   the spectrogram scrubber, and the <audio> playback transport — is now
   React's SpectrumPanel + spectrumTransport, driven by spectrumStore
   (TD-001 slice 6a, #695). This section keeps only the two thin e2e/legacy
   compat shims below (called by name — see the comment on each) and the
   still-inline #spectrum-imperative renderers for the not-yet-migrated live/
   soundcheck/DAW meter modes (`specStore.getState().setPanelState('meters')`
   hands that container back to inline-app.js — see spectrum-chrome.ts's ADR). */

// e2e/legacy compat shim — report-card-grading.spec.ts's "missing spectrum
// curve degrades…" test calls window.renderSpectrum(spectrum) directly to
// drive the no-curve fallback. Routes the raw spectrum object through
// spectrumStore so React's SpectrumPanel renders it (curve-with-target when
// usable, the uniform-bars fallback otherwise — SpectrumDisplay.tsx already
// degrades gracefully, reproducing this function's old two-branch body).
window.renderSpectrum = (spectrum) => {
  specStore.getState().setSpectrumFromAnalysis({ spectrum });
  // Bypasses analysisStore, so bridge.ts's currentAnalysis subscription never
  // fires for this shim — resync idealProfilesStore directly instead.
  window.rendererStores.idealProfiles.getState().syncActiveProfile();
};
// e2e/legacy compat shim — playback-transport.spec.ts drives the scrubber's
// seek behavior via window.seekPlayback(t) directly.
window.seekPlayback = (t) => transport.seek(t);

// Live-tick coalescing (meter ticks arrive up to ~20/s) is owned by
// LiveWorkspace.tsx's live-meter-controller (TD-001 slice 6c, #701), driven
// by liveCaptureStore's lastTick rather than this file's own rAF batching.
// The per-tick DOM appliers it calls (patchLiveChannel/patchGroupSummaries/
// patchEqPaneSection/patchStatsRow) are pure modules, and the DAW
// waveform/playhead painters are reached via window.dawShellRuntime
// (daw-shell-runtime.ts, TD-001 slice 6j, #713).

// The meter board, the docked EQ pane, the live-adjustments panel, the
// capture controls, and the channel-group CRUD are React/store-owned now
// (TD-001 slices 6g #710 + 6h #711): LiveCapturePanel renders #live-island
// from liveCaptureStore's discrete state and owns every board interaction
// (strip select, group fold, setup-skip dismiss, lap dispositions, inline
// rename, add/remove/arm/arm-all/kind/src/group/profile/drag-reorder, and
// group CRUD) through its delegated handlers — the #spectrum-body click/
// change/drag/keydown listeners are gone. Per-tick patching is
// live-meter-controller.ts's createLiveMeterController (mounted by
// LiveWorkspace.tsx), which calls the pure appliers (patchLiveChannel/
// patchGroupSummaries/patchEqPaneSection/patchStatsRow) against the
// React-rendered DOM and the DAW painters via window.dawShellRuntime. The
// stats row is pure-module-owned (statsRowView/liveStatsRowView +
// patchStatsRow in live-workspace-view.ts).

// syncSingleColumn is gone — mode-switch.ts#applySingleColumnSync (TD-001
// slice 6e, #703) ports it verbatim; inline-app.js reaches it via
// window.modeSwitch for the two call sites below that aren't inside
// switchMode() itself.

// #543 (epic e17): the unified "Analyze" source picker is React-owned now
// (TD-001 slice 6h, #711) — AnalyzeSourcePicker.tsx renders the overlay from
// analyzeSourceStore and routes choices through analyzeSourceState.targetModeFor
// / switchMode / report-card-chrome.ts#chooseAndAnalyzeFile (TD-001 slice 6k,
// #714). The static markup and the window.analyzeSourcePicker open/close
// bridge are gone; ModeTabs.tsx and ReportCardToolbar.tsx open it via
// useAnalyzeSourceStore.getState().open().

// Mode tabs (#547 and earlier): the click listener, currentMode var, and
// syncSpectrumForMode are gone — ModeTabs.tsx (portaled onto #mode-tabs) now
// renders the tabs and dispatches every click through mode-switch.ts's
// resolveModeSwitch/switchMode, which liveCaptureStore.appMode drives
// (TD-001 slice 6e, #703). window.modeSwitch bridges applySpectrumForMode/
// applySingleColumnSync for the remaining call sites below that aren't
// inside switchMode() itself.

/* ══ File mode ══
   The dropzone (click/drag/drop) and the Analyze button now live in
   ReportCardIsland (React), wired straight to analysisStore (TD-001 slice 4,
   #422). window.loadFile/window.runFileAnalysis survive as thin shims — the
   smoke test, sb.onMenuOpenFile, and onboarding's runFirstAnalysis all still
   call them by name. ══ */
window.loadFile = (fp) => anaStore.getState().selectFile(fp);
window.runFileAnalysis = (fp) => anaStore.getState().startAnalysis(fp);

// Coarse stage progress (#125) — the three stages run in parallel, so this
// just checks off each stage's row as its subprocess returns. Registered
// once at module scope; setPanelState('loading') resets stagesDone on each
// run, so there's nothing stale to clear between runs.
sb.onAnalysisProgress((data) => {
  // A batch run (#270) fires this same event per file too — suppressed the
  // same way as the pushed analysis-result below, so a batch file's stage
  // completion can't check off a stage row for a concurrent single-file
  // analysis the user started on the Report Card tab.
  if (window.batchAnalysis.shouldSuppressPushedResult(window.rendererStores.directory.getState().running)) return;
  if (!data.stage || data.status !== 'done') return;
  specStore.getState().markStageDone(data.stage);
});

// resolveReportCardChromeSource/syncReportCardChrome are gone —
// report-card-chrome.ts#resolveReportCardChromeSource/reportCardChromeView
// (TD-001 slice 6e, #703) port them verbatim; ReportCardToolbar.tsx now owns
// the toolbar buttons via its own useEffect on analysisStore.status,
// replacing the anaStore.subscribe(syncReportCardChrome) wiring below.

/* ══ Directory mode (#270) is React/store-owned now (TD-001 slice 6h, #711):
   directoryStore + DirectoryPanel.tsx own the batch state (#dir-choose-btn/
   #dir-path/#dir-analyze-btn/#dir-progress/#dir-results/#dir-empty) — this
   script's batchFiles/batchRunning vars and the two #dir-* listeners are
   gone. The two pushed-event handlers below read the running flag from the
   bridged store instead of the deleted batchRunning module var. ══ */

/* ── Live mode ── */
// #meter-interval/#window-secs's label repaint is React-owned now
// (CaptureCadenceControls.tsx, #725) — it derives the label text itself from
// meterIntervalLabel/windowSecsLabel on every render.

/* ── Mode is internal now (#757) ──
   The Source-panel Mode toggle is GONE — the Live tab is permanently
   monitor-mode and the top-bar Record button is the sole transport. liveMode
   still feeds the backend startLive({ mode, arm, labels }) contract and the
   header REC/LIVE indicator (capturePhase), and rig-apply writes it as part
   of applyRigPatch's returned patch (rig-panel.ts, TD-001 slice 6d, #702) —
   it just has no UI of its own anymore. recordCapture (LiveControls.tsx)
   normalizes it back to 'monitor' before an idle start so a stopped record
   session can be recorded again. Both store writes are picked up by the
   arm-hint subscription above (board repaint) — no inline wrapper function is
   called from here anymore. */
// TD-001 slice 6i (#712): the live-capture lifecycle (beforeStartCapture/
// onCaptureStarting/onCaptureStarted/promoteToRecording/preflightBlockReason/
// onCaptureStopping/onCaptureStopped/stopLive/showLiveNotEnoughData/
// syncCaptureControls) moved to capture-lifecycle.ts — App.tsx installs its
// runtime onto window.liveCaptureRuntime (the identical LiveCaptureRuntime
// bridge LiveControls.tsx's startLiveCapture/stopLiveCapture/recordCapture and
// mode-switch.ts's maybeAutoStartLive already call — see that file for the
// exact call ordering, which mirrors this file's old
// liveRunning=true-then-await-then-handle-result shape precisely) and its
// onWindowTick onto window.captureLifecycle (see the onLiveEvent handler
// below). The post-stop session chrome (#live-status, #live-rc-cue,
// #rec-offer/#rc-offer/#rc-not-enough, #window-badge) is rendered by the
// LiveStatusLine/LiveSessionOffers/WindowBadge React islands from
// liveCaptureStore. The rig/group name prompt is RigDialog.tsx +
// rigDialogStore now, keeping the window.rigDialog promise API. TD-001 slice
// 6j (#713) moved the DAW playhead/waveform painters to daw-shell-runtime.ts,
// installed onto window.dawShellRuntime by App.tsx.

/* ══ Rigs — save / load / switch capture setups (#37, persisted via #36) ══
   Fully React/store-owned (RigControls.tsx/PreflightPanel.tsx,
   stores/rigStore.ts, TD-001 slice 6d, #702); the shared rig/group name
   prompt is RigDialog.tsx + rigDialogStore (TD-001 slice 6i, #712), which
   keeps the window.rigDialog promise API LiveCapturePanel.tsx's group
   prompts call. */

/* ══ IPC event listeners ══ */
sb.onLiveEvent((data) => {
  if (!data || data.error) {
    if (data?.error) specStore.getState().setPanelState('error', `Live error: ${data.error}`);
    return;
  }

  // Every event (fast meter ticks + slower window ticks) drives the live
  // view — lcStore.getState().bindIpcEvents() (installed once by bridge.ts)
  // owns tick ingestion into the store's lastTick/lastLiveChannels/
  // liveWindows/boardShapeVersion (single source of truth, TD-001 slice 6c,
  // #701); LiveWorkspace.tsx's live-meter-controller coalesces lastTick
  // changes into one repaint per animation frame — this listener is reduced
  // to the session-only concern bindIpcEvents doesn't own (the window-tick
  // session accumulation + coaching advance, which TD-001 slice 6i (#712)
  // delegated to window.captureLifecycle). DAW waveform 'peaks' frames are a
  // separate listener registered by daw-shell-runtime.ts's bindLiveEvents
  // (TD-001 slice 6j, #713), not this handler. The room stats row is patched
  // by the meter controller (TD-001 slice 6g #710) — the board tick no longer
  // writes it here, and the secondary mic owns the row when active
  // (LiveWorkspace.tsx mirrors the old onMeasurementEvent path).

  // Only the heavier window ticks (which carry masking + window #) accumulate
  // to feed the report card — sessionWindows lives inside capture-lifecycle.ts
  // now, so this branch just forwards the tick (the error branch above stays
  // inline; captureLifecycle is installed by App.tsx before any live event
  // can arrive).
  if (data.type === 'window' || typeof data.window === 'number') {
    window.captureLifecycle?.onWindowTick?.(data);
  }
});

/* ══ Secondary measurement device (#460, ADR 0003) ══
   Experimental, default-off room-mic source metered on a SECOND stream.py
   process, fully independent of the board capture. All decision logic lives in
   the pure window.measurementDeviceState module. With the flag off,
   secondaryMeasurementActive() is always false and roomFeed() returns the
   board values unchanged, so the app renders byte-identically to today (the
   #602 parity guard). When active, the secondary mic owns the Room
   everywhere: badge, room stats, the graded live report-card source, AND the
   EQ pane's Room slot (LiveEqPane.tsx computes the roomPaneOverride itself,
   TD-001 slice 6g #710). The device picker, status/warning text, and the
   reconnect-poll scheduling are React-owned (SecondaryMeasurementPanel.tsx,
   #724) — this block keeps only the still-imperative Room-consumer glue. */

// The Room badge is MeasurementBadge.tsx now (TD-001 slice 6h, #711),
// derived reactively from liveCaptureStore via the pure measurementBadgeView —
// the old inline secondaryMeasurementActive()/roomFeed()/renderMeasurementBadge()
// glue is gone. The last surviving dead no-op and the onMeasurementEvent
// listener that called it are deleted outright too (TD-001 slice 6k, #714) —
// that listener only ever called the no-op; liveCaptureStore's own
// bindMeasurementEvents() (below) independently registers its own
// onMeasurementEvent handler that folds measurementEnded into
// secondaryMeasurement state, so nothing else needs replacing.
lcStore.getState().bindMeasurementEvents();

// A batch run (#270) also triggers this pushed event on every successful
// analyze-file call — left alone, it would flip the Report Card N times
// mid-batch. Suppressed only while a batch is actually running (the Directory
// tab's batch state is directoryStore-owned, TD-001 slice 6h #711).
sb.onAnalysisResult((data) => {
  if (window.batchAnalysis.shouldSuppressPushedResult(window.rendererStores.directory.getState().running)) return;
  anaStore.getState().setAnalysisFromEvent(data);
});

sb.onMenuOpenFile((fp) => {
  document.querySelector('.mode-tab[data-mode="reportcard"]').click();
  loadFile(fp);
  runFileAnalysis(fp);
});

// First-run onboarding (#69) is gone — stores/onboardingStore.ts +
// OnboardingDialog.tsx (TD-001 slice 6f, #704) port initOnboarding verbatim.

// Post-update "what's new" note (#271) is gone — WhatsNewBanner.tsx (TD-001
// slice 6k, #714) ports initWhatsNew verbatim as a mounted component instead
// of an IIFE-adjacent call that ran once at script load. whats-new-state.js /
// onboarding-state.js stay unchanged classic scripts, read via a typed window
// cast — same pattern UpdateBanner.tsx already established for
// update-download-state.js.

/* ══ Report Card ══ */
// Grading (grade/score/recommendations + recording-type + band-diff) lives in
// the pure, unit-tested grading.js module (#130); the renderer calls through
// window.grading below.

// The live-capture card's report-card source (the rolling liveWindows buffer,
// mirroring getReportCardSource()'s old live fallback) is now written into
// analysisStore.liveSource by bridge.ts's cross-store subscription wherever
// liveCaptureStore.liveWindows/measurementSource/channelConfig change (TD-001
// slice 6c, #701 — replacing this file's old syncLiveSource()/
// liveReportCardSource() glue). #460: that subscription is itself Room-feed
// aware (roomFeed(), same as this file's badge/stats-row roomFeed() helper) —
// it also reacts to secondaryWindows/secondaryMeasurement changes, so the
// graded source switches to the secondary mic exactly like the badge does,
// without a separate syncLiveSource() call site here.

// getReportCardSource()/persistSummary() are gone —
// report-card-chrome.ts#getReportCardSource/persistSummary (TD-001 slice 6e,
// #703) port them verbatim as pure/injected functions. This file's remaining
// inline consumers (saveMixAsTarget, the live-capture session persist call
// below) reach them via the window.reportCardChrome bridge (App.tsx) — same
// pattern as window.modeSwitch. stores/phaseDoublingStore.ts (TD-001 slice
// 6f, #704) also ends up depending on getReportCardSource indirectly, via
// ReportCardIsland.tsx's already-computed `source`/`phaseSignal` locals
// passed into usePhaseDoublingStore.getState().open(...).

// renderRecentServices/loadHistoryEntry are gone — RecentServicesPanel.tsx
// (TD-001 slice 6e, #703) ports them verbatim (loadHistoryEntry calls
// mode-switch.ts#switchMode directly now, not a simulated tab click).

// renderPassMode/renderBuildGuide + their delegated listeners are gone —
// BuildGuidePanel.tsx (TD-001 slice 6e, #703) ports them verbatim
// (#build-guide-review/#build-complete-share now call mode-switch.ts#switchMode
// directly instead of simulating a .mode-tab click).

// ringoutSetStatus/ringoutDegradeToManual/renderRingout + the ring-out
// listeners are gone — stores/ringoutStore.ts + RingoutPanel.tsx (TD-001
// slice 6e, #703) port them verbatim (same injected-API async-store shape
// as rigStore.ts).

// #372/#545 (epic e17): the feedback-ringout callout button and the
// Build-Guide forward link are gone — ReportCardIsland.tsx (TD-001 slice 6k,
// #714) ports openFeedbackRingout/openBuildGuide as inline onClick handlers
// calling mode-switch.ts#switchMode directly, instead of simulating a
// .mode-tab click through the old window bridge.

// Share prompt (#374): the Report Card is the shareable export, so the
// closing moment's "Share your grade" jumps to it — BuildGuidePanel.tsx's
// own onClick handles this now (#build-complete is React-rendered).

// renderContentType/renderProfileMatch/renderReportCardFromHistory/
// renderReportCard are gone — ReportCardIsland (React) now owns all of
// #report-card's rendering, driven by analysisStore/spectrumStore (TD-001
// slice 4, #422). The report-card toolbar buttons + the #rc-upgrade momentum
// aside are gone from this script too — ReportCardToolbar.tsx/
// UpgradeMomentum.tsx (TD-001 slice 6e, #703) own them now, both deriving
// from report-card-chrome.ts#reportCardChromeView.

// #208: while a live-capture card is showing, the file dropzone is hidden behind it
// (#rc-empty only renders when no card is present) and Clear is disabled (no file to
// release). chooseAndAnalyzeFile is gone — report-card-chrome.ts's export
// (TD-001 slice 6k, #714) is imported directly by ReportCardToolbar.tsx's
// Load button and AnalyzeSourcePicker.tsx's file choice, replacing both
// components' independent window.chooseAndAnalyzeFile reads.

/* ══ License (#54) ══ */
// renderLicenseUi/renderTrialBanner/trialDismissed/dismissTrial + the
// initLicense() IIFE are gone — LicenseChrome.tsx (TD-001 slice 6e, #703)
// ports them verbatim, reading licensingStore reactively instead of an
// explicit store.subscribe callback. The generic [data-license-open]
// listener below is the one piece LicenseChrome.tsx doesn't own — it's used
// by the two unrelated paywall .pg-link buttons (Live/Soundcheck pro-gates),
// still static root-markup.html markup, out of scope for this slice.
document.querySelectorAll('[data-license-open]').forEach((el) =>
  el.addEventListener('click', () => licStore.getState().openDialog()));

// initUpdates() is gone — UpdateBanner.tsx (TD-001 slice 6e, #703) ports it
// verbatim as a mounted component instead of an IIFE that runs once at
// script load.

/* ══ Settings dialog (#76, #91, #204) ══ */
// SettingsPanel.tsx now owns the whole dialog — Storage and About tabs, Save
// (TD-001 slice 3, #421; combined into one tabbed modal by #204). This
// section keeps the header gear button wired to settingsStore.

function aiEl(id) { return document.getElementById(id); }

// Feedback dialog (#144, in-app submission #472) is gone —
// stores/feedbackDialogStore.ts + FeedbackDialog.tsx (TD-001 slice 6f, #704)
// port openFeedbackDialog/closeFeedbackDialog/onFeedbackAttachToggle/
// feedbackEmailInstead/sendFeedback verbatim.

// "Grade your own service" guide dialog (#142, reworked #295) is gone —
// stores/gradeOwnGuideStore.ts + GradeOwnGuideDialog.tsx (TD-001 slice 6f,
// #704) port openGuideDialog/closeGuideDialog/gradeOwnChooseFile verbatim.

// Doubling/Phase Bug Detector guided checklist (#370) is gone —
// stores/phaseDoublingStore.ts + PhaseDoublingDialog.tsx (TD-001 slice 6f,
// #704) port renderPhaseDoublingStep/openPhaseDoublingDialog/
// closePhaseDoublingDialog verbatim; ReportCardIsland.tsx now passes
// { filename, detected } straight into
// usePhaseDoublingStore.getState().open(...) from its own already-computed
// source/phaseSignal locals, instead of this file reading them back off
// window.rcCallouts/window.reportCardChrome.getReportCardSource.

// #263: one-click "save this mix's tone as your target" from the report-card
// CTA is gone — ReportCardIsland.tsx's onSaveAsTarget (TD-001 slice 6k, #714)
// ports saveMixAsTarget as an inline handler calling
// useIdealProfilesStore.getState().saveMeasured directly, reproducing the
// same currentAnalysis-only gate (never liveSource) byte-for-byte.

(() => {
  aiEl('settings-btn').addEventListener('click', () => setStore.getState().openDialog());
  // Report-first-ux epic gate (#538): the body class is the branch point the
  // e17 slices mount against. Absent by default — with the flag off the
  // existing tab bar and 3-column workspace render exactly as before.
  setStore.subscribe((s) => document.body.classList.toggle('report-first-ux', window.reportFirstUxState.isEnabled(s.settings)));
  // #542: re-fold the workspace to a single column whenever the flag (or
  // mode) changes, so toggling it in Settings while on Recent reflows
  // immediately.
  setStore.subscribe(() => window.modeSwitch.applySingleColumnSync());
  // Experimental live adjustments gate (#522): re-sync the Live pane on an
  // actual flip so the area appears/disappears without a tab switch.
  let liveAdjustmentsWasEnabled = false;
  setStore.subscribe((s) => {
    const nowEnabled = window.liveAdjustmentsState.isEnabled(s.settings);
    if (nowEnabled !== liveAdjustmentsWasEnabled && lcStore.getState().appMode === 'live') window.modeSwitch.applySpectrumForMode('live');
    liveAdjustmentsWasEnabled = nowEnabled;
  });
})();

/* ══ Init ══ */
(async () => {
  await setStore.getState().loadSettings();
  // idealProfilesStore hydration (idealProfileId/customIdealProfiles) now
  // flows from bridge.ts's settings subscription (TD-001 slice 6b, #700). The
  // cold-boot #record-folder-path default write is gone (TD-001 slice 6h,
  // #711) — LiveSourceSettings.tsx renders it reactively from settingsStore.
})();

// ReportCardToolbar.tsx/UpgradeMomentum.tsx (TD-001 slice 6e, #703) now
// drive the report-card toolbar + the #rc-upgrade momentum aside directly
// from analysisStore/licensingStore — no boot wiring needed here.
// #542: a flag-already-on first paint on Recent / Guide / Ring-Out must
// render single-column without requiring a tab click.
window.modeSwitch.applySingleColumnSync();

hydrateIcons(document);
specStore.getState().setPanelState('empty'); // store default text ('Load a file to see the spectrum') is identical
// Load devices first so a saved rig can reconcile its device by name and clamp
// channels against the real device list; then apply the active rig (if any).
// Device loading is a store action now (TD-001 slice 6h, #711).
lcStore.getState().loadDevices().then(
  window.rendererStores.rig.getState().loadRigs,
  window.rendererStores.rig.getState().loadRigs,
);

// First-run onboarding (#69) is now App.tsx's
// `void useOnboardingStore.getState().init();` boot call (TD-001 slice 6f, #704).

// What's-new note (#271) is now WhatsNewBanner.tsx's own mount effect
// (TD-001 slice 6k, #714) — no boot wiring needed here.
