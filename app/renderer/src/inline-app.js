// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

'use strict';

/* ══ Icon set + report-card renderers — extracted to report-card.ts (#306),
   bridged onto window by App.tsx like spectrumDisplay (#305). ══ */
const {
  iconSvg, fmt, gradeRingHTML, profileMatchHTML,
  recTypePillClass, recTypePillHTML, buildMetricRows, metricRowsHTML,
  whyGradeHTML, recListHTML, reportCardSourceFromAnalysis,
  buildAnalysisSummaryInput, strongMixTargetMeta,
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

let liveRunning = false;
let liveWindows = [];
// TD-001 slice 6e (#703): mode-switch.ts is a real ES module, so it can't
// read this script's lexical `let` bindings directly the way a top-level
// `function` declaration (e.g. renderChannelConfig) leaks onto `window`
// automatically — applySpectrumForMode's ported Live-tab branch needs these.
window.liveCapture = { isRunning: () => liveRunning, windows: () => liveWindows };
// Whole-session window accumulator (#261): liveWindows above is capped at 10
// entries (see the onLiveEvent handler below) for the rolling preview and the
// report-card source (#208) — nowhere near enough for "the whole session" a
// multi-minute monitor capture needs to grade. sessionWindows mirrors every
// window tick with no cap, reset alongside liveWindows at each capture start,
// and is what the session report card is built from at Stop Capture.
let sessionWindows = [];
// Focused input for the per-input instrument-aware adjustment candidates
// (#525) — ephemeral, per-session only, never persisted.
let focusedInputIndex = null;
// Coaching stability state (#612) — advanced once per analysis window, never
// per render, since syncLiveAdjustmentsPanel() is called from many render paths.
let lapCoaching = window.liveAdjustmentsState.createCoachingState();
// ReportCardToolbar.tsx's Clear button (TD-001 slice 6e, #703) needs to
// reset lapCoaching — a lexical `let` binding an ES module can't reach
// directly (see window.liveCapture above for the same reasoning).
window.liveCoaching = { reset: () => { lapCoaching = window.liveAdjustmentsState.createCoachingState(); } };
// Elapsed-time playhead for the experimental DAW shell (#518): window.dawPlayheadState
// state, null before the first capture ever starts. Tracked regardless of the
// DAW toggle so flipping the experiment mid-capture shows correct elapsed time.
let playheadState = null;
let playheadTimer = null;
const PLAYHEAD_TICK_MS = 100;        // patch cadence — smooth without rebuild cost
const PLAYHEAD_PX_PER_SECOND = 8;    // one 40px ruler division = 5s
const DAW_TIMELINE_INSET_PX = 4;     // matches the ruler's margin: 8px 4px horizontal inset
// Mix waveform lane for the experimental DAW shell (#520, ADR 0004):
// window.dawWaveformState state, reset (assigned fresh) on every capture Start.
let waveformState = window.dawWaveformState.create();
let waveformBucketsPerSec = window.dawWaveformState.WAVEFORM_BUCKETS_PER_SEC;
// Per-input waveform lanes (#521): lane id ("strip0", "strip1", …, matching
// stream.py's build_peak_lanes index) -> its own window.dawWaveformState
// state. Reset alongside waveformState on every capture Start. The
// strip{idx} <-> data-ch="${idx}" mapping is safe because channel config is
// locked during capture (setCaptureControlsLocked(true)).
let waveformLaneStates = {};
let waveformRenderScheduled = false;
// Recording-vs-monitoring waveform stroke, matching the transport-chip colors
// (--issue-text/--gold-text/--text-muted in app.css) — canvas drawing can't
// read CSS custom properties, so these are named constants here (#520).
const WAVEFORM_COLORS = {
  recording: '#F26D71',
  monitoring: '#F3CA5E',
  stopped: '#565D6B',
};
// A stored report-card summary loaded from the Recent Services list (#147) now
// lives in analysisStore.historySummary — ReportCardIsland renders it via a
// reduced, summary-only card when set and no live/file analysis is backing
// the card (TD-001 slice 4, #422); set by loadHistoryEntry() below.
// Named channel groups (#41, #483): [{ name, members:[stripIndex,…], collapsed? }].
// Organizational only — strips render under their group's header in the live
// board; a group header collapses to a compact live-summary row (#483), and
// both group order and per-group member order are drag/keyboard-reorderable.
// Persisted per-device in settings.json (#483, mirroring #482's channelLabels)
// and also saved into rigs (Pro) via rig-panel.ts's captureCurrentRigSnapshot/
// applyRigPatch (TD-001 slice 6d, #702).
let channelGroups = [];
// Drag-reorder source (#483): { type:'group'|'strip', index } set on dragstart,
// cleared on drop/dragend. Module-level because dragover/drop fire on whatever
// element is currently under the pointer, not the element that started the drag.
let liveDragSrc = null;
let lastLiveChannels = null;   // channels from the most recent meter tick (for #39 label fallbacks)
let liveDevices = [];          // last device list (for channel-count lookup)
let liveMode = 'monitor';      // 'monitor' | 'record'
let recordDir = '';            // chosen recording folder ('' = default ~/Music/Sound Buddy)
// Transient: true only while a running monitor session is being promoted to a
// recording (#458) — the backend swap from the monitor stream.py child to a
// record one is in flight. Distinct from liveMode so the transport UI can
// show "Starting…" without prematurely flipping into the recording state.
let capturePromoting = false;
let channelConfig = [];        // configured strips: { kind:'mono'|'stereo', a:idx, b:idx }

// Single-source-of-truth mirror (TD-001 slice 6c, #701): liveCaptureStore now
// owns channelConfig/channelGroups/liveDevices(devices)/liveMode/recordDir/
// liveWindows/lastLiveChannels/isCapturing(liveRunning)/promoting
// (capturePromoting) — every write to these below routes through a store
// action (see startLiveCapture/stopLive/resetChannelConfig/addChannelStrip/
// etc.), never a direct assignment to the module var. This subscription just
// mirrors the store's current values into the module vars above so the ~50
// read call sites throughout this file don't all have to become
// lcStore.getState().x.
function syncLiveCaptureMirror(state, prevState) {
  liveRunning = state.isCapturing;
  capturePromoting = state.promoting;
  liveWindows = state.liveWindows;
  channelGroups = state.channelGroups;
  lastLiveChannels = state.lastLiveChannels;
  liveDevices = state.devices;
  liveMode = state.liveMode;
  recordDir = state.recordDir;
  channelConfig = state.channelConfig;
  if (!prevState) return; // the initial sync call above has no prevState — nothing "changed" yet

  if (state.liveMode !== prevState.liveMode) hideArmHint();

  // Board-SHAPE changes (not the per-tick lastTick/liveWindows/
  // lastLiveChannels churn bindIpcEvents also writes here) repaint
  // #live-island synchronously while the Live tab is active — the reliable
  // replacement for the old per-mutation renderLiveWorkspace()/
  // renderLiveMeters() call sites (TD-001 slice 6c, #701). This has to be a
  // synchronous store subscription, not React's own re-render: LiveWorkspace
  // re-rendering doesn't run its effects synchronously with the store update
  // that triggered it, and renderLiveWorkspace()/renderLiveMeters() decide
  // patch-vs-rebuild by querying #live-island's CURRENT DOM — an imperative
  // read that has to happen right after the mutation, not on React's own
  // schedule. Per-tick patching (live-meter-controller.ts, mounted by
  // LiveWorkspace.tsx) stays the separate, animation-frame-coalesced path
  // for lastTick changes.
  if (lcStore.getState().appMode === 'live' && (
    state.channelConfig !== prevState.channelConfig
    || state.channelGroups !== prevState.channelGroups
    || state.isCapturing !== prevState.isCapturing
    || state.liveMode !== prevState.liveMode
    || state.devices !== prevState.devices
    || state.selectedChannel !== prevState.selectedChannel
  )) {
    window.liveWorkspaceRuntime.renderWorkspace();
  }
}
syncLiveCaptureMirror(lcStore.getState());
lcStore.subscribe(syncLiveCaptureMirror);

let phaseDoublingStep = 0; // current step in the phase/doubling checklist (#370)
// rcFeedbackPeak/rcPhaseSignal used to be module vars set by renderReportCard();
// ReportCardIsland (React) now computes them each render and seeds
// window.rcCallouts from a passive effect (TD-001 slice 4, #422) — read that
// instead (see openFeedbackRingout / openPhaseDoublingDialog below).
function rcCallouts() { return window.rcCallouts || { feedbackPeak: null, phaseSignal: false }; }

/* ══ Formatting helpers ══ */
// Resolve a strip's display name: label → backend name → "Ch N" (see #39).
function stripLabel(strip, ch, index) { return window.rigReconcile.resolveStripLabel(strip, ch, index); }
const MAX_LABEL_LEN = 40; // shared cap for both label entry points (config row + live header)
// The backend live channel for a strip index (or null before any tick), so the
// label fallback resolves the same way from every call site (#39).
function liveChannelAt(idx) { return lastLiveChannels ? lastLiveChannels[idx] : null; }
// fmtDur is now bridged from spectrum-display.ts (see the window.spectrumDisplay
// destructure below) — extracted alongside heatmapSVG/miniCurveSVG/timeAxisHTML
// (TD-001 slice 4, #422).

/* ══ Band metadata / meter geometry — extracted to spectrum-display.ts (#305),
   bridged onto window by App.tsx like audioEngineProfiles (#309). ══ */
const {
  DB_MIN, DB_MAX, EQ_COLS,
  CURVE_VB, CURVE_FMIN, CURVE_FMAX,
  escapeHtml, fmtHz, levelMatchedTarget, niceTicks, smoothPath,
  spectrumCurveSVG, spectrumLegendHTML, bandLevelsFromCurve, bandDbFromSpectrum,
  veqBarsAndLabelsHTML, eqTargetLineSVG, eqCentroidHTML, eqBarsHTML,
  veqLoudestIdx, veqBandView, veqValBottom,
  heatmapSVG, miniCurveSVG, fmtDur, timeAxisHTML, classLabel,
  patchGridBarsAndBandLabels, patchBarsAndLabels, hasUsableCurve,
} = window.spectrumDisplay;

// SPECTRUM_TITLE (TD-001 slice 6a, #695) — inline-app.js still writes
// #spectrum-title directly for the not-yet-migrated live/soundcheck meter
// modes; spectrum-chrome.ts's spectrumChromeView owns it everywhere else.
const { SPECTRUM_TITLE } = window.spectrumChrome;

/* ══ Live-capture panel rendering — extracted to live-capture-panel.ts (#307),
   bridged onto window by App.tsx like spectrumDisplay/reportCard. ══ */
const {
  LIVE_BAND_KEYS, deviceListView, deviceChannelCount,
  liveBandCurve, veqArcSVG, liveMetersHTML,
  groupSummary, groupSummaryText, shouldOfferReportCard,
  normalizeMeasurementSource, measurementSourceAfterRemove, measurementSourceOptionsHTML,
  measurementChannel, measurementSourceBadgeText, measurementSourceOptionLabel,
  liveSessionReportCardSource,
  patchLiveChannel,
  clampEqPaneWidth, EQ_PANE_RESIZE_STEP,
  eqPaneView, eqPaneHTML, eqPaneSignature, eqPanePatchPlan,
} = window.liveCapturePanel;
// Renamed to avoid colliding with the zero-arg usedChannelCount() wrapper below.
const lcUsedChannelCount = window.liveCapturePanel.usedChannelCount;

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

// Live-tick coalescing (meter ticks arrive up to ~20/s) is now owned by
// LiveWorkspace.tsx's live-meter-controller (TD-001 slice 6c, #701), driven
// by liveCaptureStore's lastTick rather than this file's own rAF batching —
// see window.liveWorkspaceRuntime.patchWorkspaceTick below.

// patchLiveChannel (the per-strip DOM applier) is now the pure version bridged
// in from live-capture-panel.ts (#668) — strips no longer carry their own
// chart, so there's nothing left for this file's copy to do that the pure
// module doesn't already cover via stripViewAt's `selected`/level-fill fields.

// The channel array backing the EQ pane right now: a live tick's channels
// while any have arrived this session, else the idle placeholder set — same
// fallback liveChannelAt() uses for the #39 name resolution, kept in one
// place so every renderEqPane call site (a tick, a workspace rebuild, the
// measurement-source picker, a strip click) agrees on "current" (#668).
function currentEqPaneChannels() {
  return lastLiveChannels || channelConfig.map(() => window.trackWorkspace.idleChannel(LIVE_BAND_KEYS));
}

// Patches one EQ pane section's arc + bars in place — mirrors the exact
// arc-then-bars patch sequence the old per-strip patchLiveChannel used, just
// applied to the pane's <=2 sections instead of every strip (#668).
function patchEqPaneSection(sectionEl, patch) {
  if (!sectionEl || !patch) return;
  const chart = sectionEl.querySelector('.veq-chart');
  if (chart) {
    const lineEl = chart.querySelector('.sb-curve-line');
    if (patch.arc && lineEl) {
      lineEl.setAttribute('d', patch.arc.line);
      chart.querySelector('.sb-curve-fill').setAttribute('d', patch.arc.area);
      chart.querySelector('.sb-centroid').innerHTML = patch.arc.centroidMark;
    } else {
      chart.innerHTML = patch.arc ? patch.arc.svg : '';
    }
  }
  if (patch.gridDb) patchGridBarsAndBandLabels(sectionEl, patch.gridDb, patch.loudestIdx);
  else patchBarsAndLabels(sectionEl, patch.curve.db);
}

// Renders/patches the docked live EQ pane (#668): the "Room" (measurement
// source) and "Selected" (last-clicked strip) sections. Rebuilds the pane's
// innerHTML only when its visible shape changes (which channel, which label);
// otherwise patches the existing arcs/bars in place so their CSS transitions
// keep animating. Guards on the pane body's presence — not every mode/screen
// renders it (syncSpectrumForMode only shows it in Live mode).
function renderEqPane(channels) {
  const el = document.getElementById('live-eq-pane-body');
  if (!el || !channels) return;
  const state = lcStore.getState();
  const view = eqPaneView(channels, channelConfig, state.measurementSource, state.selectedChannel);
  const signature = eqPaneSignature(view);
  if (el.dataset.signature !== signature) {
    el.innerHTML = eqPaneHTML(view);
    el.dataset.signature = signature;
    return;
  }
  const plan = eqPanePatchPlan(view);
  patchEqPaneSection(el.querySelector('.eq-pane-primary'), plan.primary);
  patchEqPaneSection(el.querySelector('.eq-pane-secondary'), plan.secondary);
}

// Shared "Add track" disabled rule (device channel cap or a capture running,
// #38) — used by both the toolbar's + Add track (#188) and the guided
// zero-track hero's Add your first track CTA (#294) so the two never drift.
function addTrackDisabled(used, total) {
  return !window.trackWorkspace.addEnabled(used, total, liveRunning);
}

// Shared by the idle workspace and the running live board (#188): one toolbar
// carries Add track + a used/total count, plus Collapse/Expand all, so the
// pane reads the same whether idle or mid-capture. Add is disabled at the
// device channel cap or while a capture is running (config is locked, #38).
function liveWorkspaceToolbarHTML() {
  const total = selectedDeviceChannels();
  const used = usedChannelCount();
  const addDisabled = addTrackDisabled(used, total);
  // Advanced controls (new group, collapse/expand, arm-all) stay out of the way
  // until the user has at least one track — a guided first-use setup (#294)
  // covers the zero-track state instead, so a brand-new user never sees
  // power-user chrome with nothing yet to act on.
  const advanced = window.liveSetupState.showAdvancedControls(channelConfig.length);
  // + New group (#190): names a group via the shared dialog and pushes it onto
  // channelGroups. Disabled mid-capture like every other config control (#38).
  // Arm all / Disarm all + armed count (#191), Record mode only (JS-gated — the
  // workspace sits outside #tab-live, so CSS gating can't reach it).
  const armHTML = advanced && liveMode === 'record'
    ? `<span class="live-ws-arm">`
      + `<span class="arm-count" id="live-ws-arm-count">${armedCount()} / ${channelConfig.length} armed</span>`
      + `<button type="button" class="ghost-btn sm" id="live-ws-arm-all"${liveRunning ? ' disabled' : ''} title="Arm every track for recording">Arm all</button>`
      + `<button type="button" class="ghost-btn sm" id="live-ws-disarm-all"${liveRunning ? ' disabled' : ''} title="Disarm every track">Disarm all</button>`
      + `</span>`
    : '';
  return `<div class="live-meters-toolbar">`
    + `<button type="button" class="ghost-btn" id="live-ws-add"${addDisabled ? ' disabled' : ''}>+ Add track</button>`
    + (advanced ? `<button type="button" class="ghost-btn" id="live-ws-new-group"${liveRunning ? ' disabled' : ''} title="Create a named channel group">+ New group</button>` : '')
    + `<span class="cap" id="live-ws-cap">${used} / ${total} used</span>`
    + armHTML
    + `</div>`;
}

// Shared renderer for the guided first-use setup's 3-step list (#294) — used
// by both the zero-track hero and the post-seed banner. Steps come from the
// pure window.liveSetupState.setupSteps() so done/active state never drifts
// from the toolbar gating above.
function liveSetupStepsHTML(steps) {
  return steps.map((s, i) =>
    `<li class="ls-step${s.done ? ' done' : ''}${s.active ? ' active' : ''}">`
    + `<span class="ls-num">${s.done ? iconSvg('check', 12) : i + 1}</span>`
    + `<span class="ls-body"><span class="ls-label">${s.label}</span>`
    + (s.active ? `<span class="ls-hint">${s.hint}</span>` : '')
    + `</span></li>`).join('');
}

// View adapter bridging this module's mutable state onto the setupSteps() view
// shape (#294) — mirrors stripViewAt/livePanelView above.
function liveSetupStepsView() {
  return window.liveSetupState.setupSteps({
    deviceReady: liveDevices.length > 0,
    trackCount: channelConfig.length,
    liveMode: liveMode,
  });
}

function renderLiveMeters(win) {
  // Keep lastLiveChannels (#39 device-name fallback for stripLabel) flowing
  // even while the DAW shell has taken over rendering below — otherwise every
  // lane name would be stuck unresolved for the whole capture.
  if (win && win.channels && win.channels.length > 0) lastLiveChannels = win.channels;
  if (window.dawWorkspaceState.showShell(setStore.getState().settings, lcStore.getState().appMode)) { renderDawShell(); return; }
  const body = document.getElementById('live-island');
  if (!win || !win.channels || win.channels.length === 0) {
    specStore.getState().setPanelState('empty', 'Waiting for live audio…');
    return;
  }
  specStore.getState().setPanelState('meters'); // hides #spectrum-island's React curve view while #live-island renders the board
  document.getElementById('stats-row').style.display = 'flex';
  const ipWrap = document.getElementById('ideal-profile-wrap');
  if (ipWrap) ipWrap.style.display = 'none'; // no whole-file curve in live mode

  // Patch in place while the strip set is unchanged (bar heights keep their CSS
  // transitions); rebuild only when the shape changes. Match by .live-ch COUNT so
  // interleaved group headers (#41) don't force a rebuild, and address strips by
  // data-ch since grouping reorders them. Grouping is fixed during a capture
  // (config is locked, #38), so the arrangement is stable across ticks.
  const stripEls = body.querySelectorAll('.sb-live-meters .live-ch');
  if (stripEls.length === win.channels.length) {
    win.channels.forEach((ch, i) => {
      const el = body.querySelector(`.sb-live-meters .live-ch[data-ch="${i}"]`);
      if (el) patchLiveChannel(el, ch, i, stripViewAt(i, ch), liveRunning);
    });
    // Refresh each group header's live summary (#483) so a collapsed group still
    // reflects current level/clip without touching collapse state — that's
    // applyLiveGroupCollapsed's job — or rebuilding the DOM.
    channelGroups.forEach((grp, g) => {
      const summaryEl = body.querySelector(`.sb-live-meters .live-group-head[data-group="${g}"] .live-group-summary`);
      if (!summaryEl) return;
      const summary = groupSummary(win.channels, grp.members);
      summaryEl.textContent = groupSummaryText(summary);
      if (summary.clipping) summaryEl.insertAdjacentHTML('beforeend', '<span class="live-ch-clip">CLIP</span>');
    });
    syncLiveAdjustmentsPanel();
    renderEqPane(win.channels);
    return;
  }
  body.innerHTML = liveWorkspaceToolbarHTML()
    + `<div class="meter-card sb-live-meters">${liveMetersHTML(win.channels, win.channels.map((c, i) => stripViewAt(i, c)), livePanelView())}</div>`;
  body.querySelectorAll('.sb-live-meters .live-ch-name').forEach(wireLiveNameEdit);
  applyLiveGroupCollapsed();
  syncLiveAdjustmentsPanel();
  renderEqPane(win.channels);
}

// Persistent idle track workspace (#188): the center pane renders
// channelConfig as track lanes the moment the Live tab is active, not only
// once capture starts. Idle lanes are synthetic all-floor channels rendered
// through the same veqChannelHTML/liveMetersHTML path the running board uses,
// so grouping (#41) keeps working for free. Shares liveWorkspaceToolbarHTML()
// with renderLiveMeters so Add/remove read consistently whether idle or
// (locked) mid-capture.
function renderLiveWorkspace() {
  specStore.getState().setPanelState('meters'); // hides #spectrum-island's React curve view while #live-island renders the board
  if (window.dawWorkspaceState.showShell(setStore.getState().settings, lcStore.getState().appMode)) { renderDawShell(); return; }
  const body = document.getElementById('live-island');
  document.getElementById('stats-row').style.display = 'none';
  const ipWrap = document.getElementById('ideal-profile-wrap');
  if (ipWrap) ipWrap.style.display = 'none';

  // Guided first-use setup (#294): a zero-track workspace shows an
  // instructional hero (no toolbar — that's what made this read as a blank
  // technical canvas) instead of the toolbar + bare empty state. It renders
  // permanently at zero tracks, guide-completed or not (acceptance criterion),
  // with live done/active step state.
  if (window.trackWorkspace.isEmpty(channelConfig.length)) {
    const addDisabled = addTrackDisabled(usedChannelCount(), selectedDeviceChannels());
    body.innerHTML = `<div class="live-setup-hero">`
      + iconSvg('radio', 34)
      + `<h2 class="lsh-title">Set up your live check</h2>`
      + `<p class="lsh-sub">Three steps from silence to live meters.</p>`
      + `<ol class="ls-steps">${liveSetupStepsHTML(liveSetupStepsView())}</ol>`
      + `<button type="button" class="btn btn-primary" id="live-ws-add"${addDisabled ? ' disabled' : ''}>${iconSvg('plus', 16)}Add your first track</button>`
      + `</div>`;
    return;
  }

  const toolbar = liveWorkspaceToolbarHTML();
  // First-use banner (#294): the real first-launch shape (loadDevices() seeds
  // 2 idle tracks automatically) still needs the guide — steps 1-2 read done,
  // step 3 ("Start monitoring/recording") stays active and points at Start
  // Capture. It sits above the toolbar; the power workspace beneath stays
  // fully visible and functional.
  const banner = window.liveSetupState.shouldShowGuide(window.localStorage)
    ? `<div class="live-setup-banner" role="note">`
      + `<span class="lsb-title">Getting set up</span>`
      + `<ol class="ls-steps compact">${liveSetupStepsHTML(liveSetupStepsView())}</ol>`
      + `<button type="button" class="ghost-btn sm" id="live-setup-skip">Dismiss</button>`
      + `</div>`
    : '';

  const idleChannels = channelConfig.map(() => window.trackWorkspace.idleChannel(LIVE_BAND_KEYS));
  body.innerHTML = banner + toolbar + `<div class="meter-card sb-live-meters idle">${liveMetersHTML(idleChannels, idleChannels.map((c, i) => stripViewAt(i, c)), livePanelView())}</div>`;
  body.querySelectorAll('.sb-live-meters .live-ch-name').forEach(wireLiveNameEdit);
  applyLiveGroupCollapsed();
  syncLiveAdjustmentsPanel();
  renderEqPane(idleChannels);
}

// Experimental live adjustments area (#522): ensure the placeholder panel's
// presence in the Live pane matches the toggle. Called from every Live
// render path — including the patch-in-place branches, so a mid-capture
// settings flip adds/removes the panel without a rebuild.
function syncLiveAdjustmentsPanel() {
  const body = document.getElementById('live-island');
  const html = window.liveAdjustmentsState.panelHTML(
    setStore.getState().settings, lcStore.getState().appMode, liveWindows, lcStore.getState().measurementSource, lapFocusView(), lapCoaching, Date.now());
  const existing = body.querySelector('.live-adjustments-panel');
  if (!html) { if (existing) existing.remove(); return; }
  if (!existing) body.insertAdjacentHTML('beforeend', html);
  else if (existing.outerHTML !== html) existing.outerHTML = html;
}

// Timeline-oriented DAW shell (#517, epic #515): swapped in for the meter
// workspace on the Live tab when the experimental toggle (#516) is on. UI-only
// vertical slice — no playhead/waveform math, just the shell layout. The
// Source panel remains the sole capture control surface, so this never
// renders #live-mode/#live-start-btn/#live-stop-btn.
function renderDawShell() {
  specStore.getState().setPanelState('meters'); // hides #spectrum-island's React curve view while #live-island renders the board
  const body = document.getElementById('live-island');
  document.getElementById('stats-row').style.display = 'none';
  const ipWrap = document.getElementById('ideal-profile-wrap');
  if (ipWrap) ipWrap.style.display = 'none';

  const laneNames = channelConfig.map((strip, idx) => escapeHtml(stripLabel(strip, liveChannelAt(idx), idx)));
  // Joined with a NUL separator (can't appear in an escaped label) as a safe
  // fingerprint for "did anything about the lanes themselves change" — a rig
  // swap with the same channel count changes labels without changing length.
  const laneSignature = laneNames.join('\u0000');
  const transportChip = window.dawWorkspaceState.transportLabel(liveRunning, liveMode);
  const captureMode = window.dawWaveformState.captureModeToken(liveRunning, liveMode);

  // Patch in place on the rAF meter tick (mirrors renderLiveMeters' strip-count
  // check) so the shell doesn't rebuild its DOM every frame during a capture —
  // only touch the transport chip, and only when its own text actually moved.
  const existingShell = body.querySelector('.daw-shell');
  if (existingShell && existingShell.dataset.laneSignature === laneSignature) {
    const chip = body.querySelector('.daw-transport-state');
    if (chip && chip.textContent !== transportChip) {
      chip.textContent = transportChip;
      chip.className = `daw-transport-state daw-transport-state-${transportChip.toLowerCase()}`;
    }
    const mixLane = body.querySelector('.daw-mix-lane');
    if (mixLane && mixLane.dataset.captureMode !== captureMode) mixLane.dataset.captureMode = captureMode;
    renderDawPlayhead(); // refresh the readout/line on meter-tick patch renders too
    renderDawWaveform(); // refresh the mix waveform on meter-tick patch renders too (#520)
    syncLiveAdjustmentsPanel();
    return;
  }

  const laneHTML = channelConfig.length > 0
    ? `<div class="daw-channel-lanes">${channelConfig.map((strip, idx) =>
      `<div class="daw-lane daw-channel-lane" data-ch="${idx}">`
      + `<span class="daw-lane-name">${laneNames[idx]}</span>`
      + `<span class="daw-lane-body"><canvas class="daw-channel-waveform"></canvas></span>`
      + `</div>`).join('')}</div>`
    : `<div class="daw-lane daw-empty-state">Add tracks from the Source panel to see channel lanes</div>`;

  // Seed the time from state so a mid-capture full rebuild (lane signature
  // change) never flashes 0:00 (#518).
  const seededElapsed = window.dawPlayheadState.elapsedMs(playheadState, Date.now());
  body.innerHTML = `<div class="daw-shell">`
    + `<div class="daw-transport">`
    + `<span class="daw-transport-title">Live Workspace</span>`
    + `<span class="daw-transport-state daw-transport-state-${transportChip.toLowerCase()}">${transportChip}</span>`
    + `<span class="daw-transport-time">${window.dawPlayheadState.formatElapsed(seededElapsed)}</span>`
    + `<span class="daw-transport-hint">Start and stop capture from the Source panel</span>`
    + `</div>`
    + `<div class="daw-playhead"></div>`
    + `<div class="daw-ruler"></div>`
    + `<div class="daw-lane daw-mix-lane" data-capture-mode="${captureMode}">`
    + `<span class="daw-lane-name">Overall mix</span>`
    + `<span class="daw-lane-body"><canvas class="daw-mix-waveform"></canvas></span>`
    + `</div>`
    + laneHTML
    + `</div>`;
  body.querySelector('.daw-shell').dataset.laneSignature = laneSignature;
  renderDawPlayhead(); // position the line after the rebuild
  renderDawWaveform(); // repaint waveform history after a mid-capture rebuild (#520)
  syncLiveAdjustmentsPanel();
}

// Thin adapters bridging this module's mutable state (channelConfig,
// liveRunning, channelGroups, …) onto the StripView/PanelView shapes the pure
// live-capture-panel.ts functions take as parameters (#307).
function stripViewAt(idx, ch) {
  const groupIndex = window.groupState.groupOf(channelGroups, idx);
  const token = channelConfig[idx] ? window.armState.stripToken(channelConfig[idx]) : String(idx);
  const savedProfiles = savedInstrumentProfilesForDevice();
  return {
    strip: channelConfig[idx] || null,
    displayName: stripLabel(channelConfig[idx], ch, idx),
    selected: lcStore.getState().selectedChannel === idx,
    armed: window.armState.isArmed(channelConfig[idx]),
    groupIndex: groupIndex,
    groupCollapsed: window.groupState.isGroupCollapsed(channelGroups, groupIndex),
    instrumentProfileId: window.instrumentProfiles.effectiveProfileId(savedProfiles, token, channelConfig[idx] && channelConfig[idx].label),
    instrumentAuto: !(savedProfiles[token] && window.instrumentProfiles.isKnownProfileId(savedProfiles[token])),
  };
}
function livePanelView() {
  return {
    deviceChannels: selectedDeviceChannels(),
    liveRunning,
    liveMode,
    groups: channelGroups,
    instrumentProfiles: window.instrumentProfiles.PROFILES.map((p) => ({ id: p.id, label: p.label })),
  };
}

// The focused-input view for the per-input instrument-aware adjustment
// candidates panel (#525): every current input strip's display name and
// effective instrument profile, plus which one (if any) is focused.
function lapFocusView() {
  const savedProfiles = savedInstrumentProfilesForDevice();
  return {
    focusedIndex: focusedInputIndex,
    inputs: channelConfig.map((strip, idx) => ({
      index: idx,
      name: stripLabel(strip, liveChannelAt(idx), idx),
      profile: window.instrumentProfiles.profileById(
        window.instrumentProfiles.effectiveProfileId(savedProfiles, window.armState.stripToken(strip), strip && strip.label)),
    })),
  };
}

// Observation context for #614: which source/scope the coaching evaluation is
// measuring, and whether this window's reading is usable.
function lapObservationContext() {
  const ms = lcStore.getState().measurementSource;
  const idx = ms == null ? 0 : ms;
  return window.liveAdjustmentsState.observationContext(
    liveWindows, ms, lapFocusView(), measurementSourceOptionLabel(channelConfig[idx], idx));
}

// Group collapse controls (#483). One delegated listener on #spectrum-body
// survives the meter card's rebuilds and covers the group header's fold
// chevron. Toggling only rewrites .collapsed/.group-collapsed on the existing
// DOM (no full re-render), so it's instant and doesn't disturb the rAF repaint.
// (Per-strip collapse/fold — #40 — was removed in favor of the docked EQ pane,
// #668.)
function applyLiveGroupCollapsed() {
  const wrap = document.querySelector('#spectrum-body .sb-live-meters');
  if (!wrap) return;
  wrap.querySelectorAll('.live-ch').forEach((el) => {
    const idx = parseInt(el.dataset.ch, 10);
    // A collapsed GROUP hides the member strip entirely (#483).
    const g = window.groupState.groupOf(channelGroups, idx);
    el.classList.toggle('group-collapsed', window.groupState.isGroupCollapsed(channelGroups, g));
  });
  // Group headers own an explicit collapsed flag now (#483), replacing the old
  // all-members-collapsed derivation from #41's per-strip-only fold.
  wrap.querySelectorAll('.live-group-head[data-group]').forEach((head) => {
    const g = parseInt(head.dataset.group, 10);
    if (g < 0) return;
    const collapsed = window.groupState.isGroupCollapsed(channelGroups, g);
    head.classList.toggle('collapsed', collapsed);
    const btn = head.querySelector('.live-group-fold');
    if (btn) btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  });
}

// Strip selection (#668): drives the docked EQ pane's "Selected" section.
// Shared by the click handler (below) and the keydown handler (further down,
// Enter/Space on a focused strip) so mouse and keyboard stay in sync — a
// strip is `tabindex="0"`/`role="button"` (live-capture-panel.ts) precisely
// so this isn't mouse-only.
function selectStrip(idx) {
  lcStore.getState().setSelectedChannel(idx);
  document.querySelectorAll('#spectrum-body .live-ch').forEach((el) => {
    const sel = parseInt(el.dataset.ch, 10) === idx;
    el.classList.toggle('selected', sel);
    if (sel) el.setAttribute('aria-current', 'true');
    else el.removeAttribute('aria-current');
  });
  renderEqPane(currentEqPaneChannels());
}
document.getElementById('spectrum-body').addEventListener('click', (e) => {
  // Guided first-use setup dismiss (#294): retire the banner permanently
  // without requiring a first capture. renderChannelConfig() early-outs while
  // liveRunning (a capture may already be starting), so remove the rendered
  // banner node directly rather than relying solely on a re-render — the same
  // fix the capture-start success handler below needs for the same reason.
  if (e.target.closest('#live-setup-skip')) {
    window.liveSetupState.markSetupComplete(window.localStorage);
    const skipBanner = document.querySelector('#spectrum-body .live-setup-banner');
    if (skipBanner) skipBanner.remove();
    renderChannelConfig();
    return;
  }
  // Live coaching dispositions (#613) — engineer control over the active card.
  // Delegated like every other lap- control so it survives panel re-renders.
  const lapActionBtn = e.target.closest('[data-lap-action]');
  if (lapActionBtn) {
    const lapNow = Date.now();
    const lapAction = lapActionBtn.dataset.lapAction;
    const lap = window.liveAdjustmentsState;
    if (lapAction === 'acknowledge') lapCoaching = lap.acknowledgeCoaching(lapCoaching);
    else if (lapAction === 'tried') lapCoaching = lap.markTriedCoaching(lapCoaching, lapNow, lapObservationContext());
    else if (lapAction === 'snooze') lapCoaching = lap.snoozeCoaching(lapCoaching, lapNow);
    else if (lapAction === 'dismiss') lapCoaching = lap.dismissCoaching(lapCoaching, lapNow);
    else if (lapAction === 'resume') lapCoaching = lap.resumeCoaching(lapCoaching);
    else if (lapAction === 'outcome-ack') lapCoaching = lap.acknowledgeOutcome(lapCoaching, lapNow);
    syncLiveAdjustmentsPanel();
    return;
  }
  // Workspace Add track (#188). Delegated (rather than re-wired per render) so
  // it survives renderLiveWorkspace()/renderLiveMeters() rebuilding the pane.
  if (e.target.closest('#live-ws-add')) { addChannelStrip(); return; }
  // Workspace + New group (#190).
  if (e.target.closest('#live-ws-new-group')) { createChannelGroup(); return; }
  // Workspace per-row remove (#188).
  const rmBtn = e.target.closest('.live-ch-x');
  if (rmBtn) { removeChannelStrip(parseInt(rmBtn.closest('.live-ch').dataset.ch, 10)); return; }
  // Workspace per-track arm toggle (#191).
  const armBtn = e.target.closest('.live-ch-arm');
  if (armBtn) {
    const idx = parseInt(armBtn.closest('.live-ch').dataset.ch, 10);
    lcStore.getState().toggleArm(idx);
    hideArmHint();
    renderChannelConfig();
    return;
  }
  // Workspace Arm all / Disarm all (#191).
  if (e.target.closest('#live-ws-arm-all')) {
    lcStore.getState().setAllArmed(true);
    hideArmHint();
    renderChannelConfig();
    return;
  }
  if (e.target.closest('#live-ws-disarm-all')) {
    lcStore.getState().setAllArmed(false);
    renderChannelConfig();
    return;
  }
  // Group header rename / delete (#190): reuse the shared group dialog/handlers.
  const gRename = e.target.closest('.live-group-rename');
  if (gRename) { renameChannelGroup(parseInt(gRename.closest('.live-group-head').dataset.group, 10)); return; }
  const gDel = e.target.closest('.live-group-del');
  if (gDel) { deleteChannelGroup(parseInt(gDel.closest('.live-group-head').dataset.group, 10)); return; }
  // Group header fold (#483): collapse the whole group to a compact summary
  // row (replaces #41's collapse-every-member behavior).
  const gfold = e.target.closest('.live-group-fold');
  if (gfold) {
    const g = parseInt(gfold.closest('.live-group-head').dataset.group, 10);
    lcStore.getState().toggleGroupCollapse(g);
    applyLiveGroupCollapsed();
    return;
  }
  // Strip selection (#668): clicking anywhere on a strip (but not one of its
  // interactive controls) inspects it in the docked EQ pane's "Selected"
  // section. Checked last so a click on a button/select/name-edit inside the
  // strip never also counts as a selection.
  const stripEl = e.target.closest('.live-ch');
  if (stripEl && !e.target.closest('button, select, [contenteditable], input')) {
    selectStrip(parseInt(stripEl.dataset.ch, 10));
  }
});

// Drag-reorder (#483): whole groups via .live-group-drag, or tracks within a
// group via .live-ch-drag. Delegated on #spectrum-body — same rationale as the
// click/change listeners — so wiring survives the pane's innerHTML rebuilds.
// Cross-group moves stay out of scope here; that's still the per-strip
// .live-ch-group dropdown (#33 follow-up).
document.getElementById('spectrum-body').addEventListener('dragstart', (e) => {
  if (liveRunning) { e.preventDefault(); return; }
  const groupHandle = e.target.closest('.live-group-drag');
  const stripHandle = !groupHandle && e.target.closest('.live-ch-drag');
  if (!groupHandle && !stripHandle) return;
  liveDragSrc = groupHandle
    ? { type: 'group', index: parseInt(groupHandle.closest('.live-group-head').dataset.group, 10) }
    : { type: 'strip', index: parseInt(stripHandle.closest('.live-ch').dataset.ch, 10) };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(liveDragSrc.index));
});
document.getElementById('spectrum-body').addEventListener('dragover', (e) => {
  if (!liveDragSrc) return;
  let target = null;
  if (liveDragSrc.type === 'group') {
    const head = e.target.closest('.live-group-head[data-group]');
    if (head && parseInt(head.dataset.group, 10) >= 0) target = head;
  } else {
    const strip = e.target.closest('.live-ch');
    if (strip) {
      const srcGroup = window.groupState.groupOf(channelGroups, liveDragSrc.index);
      if (srcGroup !== -1 && window.groupState.groupOf(channelGroups, parseInt(strip.dataset.ch, 10)) === srcGroup) target = strip;
    }
  }
  document.querySelectorAll('#spectrum-body .drag-over').forEach((el) => { if (el !== target) el.classList.remove('drag-over'); });
  if (!target) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  target.classList.add('drag-over');
});
document.getElementById('spectrum-body').addEventListener('dragleave', (e) => {
  const el = e.target.closest('.live-group-head, .live-ch');
  if (el) el.classList.remove('drag-over');
});
document.getElementById('spectrum-body').addEventListener('drop', (e) => {
  document.querySelectorAll('#spectrum-body .drag-over').forEach((el) => el.classList.remove('drag-over'));
  const src = liveDragSrc;
  liveDragSrc = null;
  if (!src) return;
  e.preventDefault();
  if (src.type === 'group') {
    const head = e.target.closest('.live-group-head[data-group]');
    const to = head && parseInt(head.dataset.group, 10);
    if (head && to >= 0) lcStore.getState().moveGroup(src.index, to);
  } else {
    const strip = e.target.closest('.live-ch');
    if (strip) {
      const g = window.groupState.groupOf(channelGroups, src.index);
      const members = (channelGroups[g] && channelGroups[g].members) || [];
      const from = members.indexOf(src.index);
      const to = members.indexOf(parseInt(strip.dataset.ch, 10));
      if (g !== -1 && from !== -1 && to !== -1) lcStore.getState().moveChannelInGroup(g, from, to);
    }
  }
  renderChannelConfig();
});
document.getElementById('spectrum-body').addEventListener('dragend', () => {
  liveDragSrc = null;
  document.querySelectorAll('#spectrum-body .drag-over').forEach((el) => el.classList.remove('drag-over'));
});

// Keyboard reorder (#483): Arrow Up/Down on a drag handle moves its group or
// track by one position — an accessible, deterministic alternative to HTML5
// drag-and-drop. Re-renders (grouping change) then re-focuses the moved
// handle, since the rebuild would otherwise drop keyboard focus.
document.getElementById('spectrum-body').addEventListener('keydown', (e) => {
  // Strip selection via keyboard (#668): Enter/Space while a strip itself
  // (not one of its interactive children — e.target === stripEl only holds
  // when the strip's own tabindex="0" wrapper has focus) has focus mirrors
  // the click handler above. Not gated on liveRunning — selection is a
  // renderer-side view state, unrelated to the capture lock (like
  // measurement-source).
  if (e.key === 'Enter' || e.key === ' ') {
    const stripEl = e.target.closest('.live-ch');
    if (stripEl && e.target === stripEl) {
      e.preventDefault();
      selectStrip(parseInt(stripEl.dataset.ch, 10));
    }
    return;
  }
  if (liveRunning || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
  const dir = e.key === 'ArrowUp' ? -1 : 1;
  const groupHandle = e.target.closest('.live-group-drag');
  if (groupHandle) {
    e.preventDefault();
    const g = parseInt(groupHandle.closest('.live-group-head').dataset.group, 10);
    const to = g + dir;
    if (to < 0 || to >= channelGroups.length) return;
    lcStore.getState().moveGroup(g, to);
    renderChannelConfig();
    document.querySelector(`#spectrum-body .live-group-head[data-group="${to}"] .live-group-drag`)?.focus();
    return;
  }
  const stripHandle = e.target.closest('.live-ch-drag');
  if (stripHandle) {
    const idx = parseInt(stripHandle.closest('.live-ch').dataset.ch, 10);
    const g = window.groupState.groupOf(channelGroups, idx);
    if (g === -1) return;
    const members = channelGroups[g].members;
    const from = members.indexOf(idx);
    const to = from + dir;
    if (from === -1 || to < 0 || to >= members.length) return;
    e.preventDefault();
    lcStore.getState().moveChannelInGroup(g, from, to);
    renderChannelConfig();
    document.querySelector(`#spectrum-body .live-ch[data-ch="${idx}"] .live-ch-drag`)?.focus();
  }
});

// Inline track definition (#189): the header's kind toggle + source picker(s)
// fire 'change' (not 'click'), so they need their own delegated listener —
// same delegation rationale as the click handler above, so the wiring
// survives renderLiveWorkspace()/renderLiveMeters() rebuilding the pane.
// Routes through renderChannelConfig() (not a bare renderLiveWorkspace()) so
// the capture lock and the workspace stay in sync.
document.getElementById('spectrum-body').addEventListener('change', (e) => {
  // Focused-input selector for the per-input instrument-aware adjustment
  // candidates panel (#525) — ephemeral, so it just re-syncs the panel.
  const focusSel = e.target.closest('.lap-focus-select');
  if (focusSel) {
    focusedInputIndex = focusSel.value === '' ? null : parseInt(focusSel.value, 10);
    syncLiveAdjustmentsPanel();
    return;
  }
  const kindSel = e.target.closest('.live-ch-kind');
  if (kindSel) {
    const idx = parseInt(kindSel.dataset.idx, 10);
    if (!channelConfig[idx]) return;
    lcStore.getState().setStripKind(idx, e.target.value);
    renderChannelConfig();
    return;
  }
  const srcSel = e.target.closest('.live-ch-src');
  if (srcSel) {
    const idx = parseInt(srcSel.dataset.idx, 10);
    if (!channelConfig[idx]) return;
    lcStore.getState().setStripSource(idx, srcSel.dataset.field, parseInt(e.target.value, 10));
    renderChannelConfig();
    return;
  }
  // Per-track group assignment (#190): write through groupState with its
  // exclusive-membership rules, then re-render the workspace.
  const grpSel = e.target.closest('.live-ch-group');
  if (grpSel) {
    const idx = parseInt(grpSel.dataset.idx, 10);
    lcStore.getState().assignGroup(idx, parseInt(e.target.value, 10));
    renderChannelConfig();
    return;
  }
  // Per-input instrument-profile override (#524): write through recordOverride
  // with its full-map replace discipline, then re-render the workspace.
  const profileSel = e.target.closest('.live-ch-profile');
  if (profileSel) {
    const idx = parseInt(profileSel.dataset.idx, 10);
    if (!channelConfig[idx]) return;
    const all = (setStore.getState().settings || {}).inputInstrumentProfiles || {};
    const next = window.instrumentProfiles.recordOverride(all, selectedDeviceName(), window.armState.stripToken(channelConfig[idx]), e.target.value);
    setStore.getState().updateSettings({ inputInstrumentProfiles: next });
    renderChannelConfig();
  }
});

// Make a live meter header name click-to-edit (#39): commit on blur/Enter into
// the matching channelConfig strip's label, Escape cancels. Writing the label
// keeps the config rows and the persisted rig in sync via renderChannelConfig().
function wireLiveNameEdit(nameEl) {
  const idx = parseInt(nameEl.closest('.live-ch').dataset.ch, 10);
  // Snapshot the displayed text when the edit begins. Committing only when the
  // text actually changed means a plain focus→blur (or an Escape that restores
  // the snapshot) is a no-op, so the resolved fallback is never pinned as an
  // explicit label — the field keeps following the device name / "Ch N".
  let original = nameEl.textContent;
  nameEl.addEventListener('focus', () => { original = nameEl.textContent; });
  const commit = () => {
    const strip = channelConfig[idx];
    if (!strip || nameEl.textContent === original) return;
    // setStripLabel (#482) trims/caps the label and persists it keyed by
    // device + strip token (mono "0" / stereo "2-3") — the store is the
    // single source of truth for channelConfig now (TD-001 slice 6c, #701).
    lcStore.getState().setStripLabel(idx, nameEl.textContent);
    // Reflect the resolved name (empty label falls back to the device name /
    // Ch N) and refresh the config row inputs to match.
    nameEl.textContent = stripLabel(channelConfig[idx], liveChannelAt(idx), idx);
    original = nameEl.textContent;
    renderChannelConfig();
  };
  nameEl.addEventListener('blur', commit);
  nameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); nameEl.textContent = original; nameEl.blur(); }
  });
}

/* ══ Stats row ══ */
function setStat(id, value, tone) {
  const el = document.getElementById(id);
  el.textContent = value;
  el.className = 'stat-num' + (tone ? ' ' + tone : '');
}
function updateStatsRow(sox, spectrum) {
  setStat('stat-rms', fmt(sox.rmsDbfs), sox.rmsDbfs > -6 ? 'check' : '');
  setStat('stat-peak', fmt(sox.peakDbfs), sox.peakDbfs > -1 ? 'issue' : '');
  setStat('stat-dr', fmt(sox.dynamicRangeDb), sox.dynamicRangeDb < 6 ? 'check' : '');
  setStat('stat-clip', sox.clipping ? 'YES' : 'No', sox.clipping ? 'issue' : '');
  document.getElementById('stat-centroid').textContent = spectrum && spectrum.spectralCentroid ? Math.round(spectrum.spectralCentroid).toLocaleString() : '—';
}
// ReportCardToolbar.tsx's status-transition useEffect (TD-001 slice 6e,
// #703) calls this by name instead of duplicating it as an ES import, since
// it's still a plain inline-app.js function (leaks onto window automatically
// as a top-level declaration, same as window.renderChannelConfig).
window.updateStatsRow = updateStatsRow;
function updateLiveStatsRow(ch) {
  setStat('stat-rms', fmt(ch.rms), ch.rms > -6 ? 'check' : '');
  setStat('stat-peak', fmt(ch.peak), ch.peak > -1 ? 'issue' : '');
  setStat('stat-dr', '—', '');
  setStat('stat-clip', ch.clipping ? 'CLIP' : 'No', ch.clipping ? 'issue' : '');
  document.getElementById('stat-centroid').textContent = ch.centroid ? Math.round(ch.centroid).toLocaleString() : '—';
}

// syncSingleColumn is gone — mode-switch.ts#applySingleColumnSync (TD-001
// slice 6e, #703) ports it verbatim; inline-app.js reaches it via
// window.modeSwitch for the two call sites below that aren't inside
// switchMode() itself.

// #543 (epic e17): the unified "Analyze" source picker — opened from the
// Report Card toolbar (see the reportcard-load-btn handler above), never on
// launch, so there's no full-screen overlay for e2e specs to trip over.
// Bridged onto window.analyzeSourcePicker.open (TD-001 slice 6e, #703) — the
// React-owned ModeTabs.tsx now dispatches the 'analyze' tab through this
// bridge instead of calling the function directly.
function openAnalyzeSourcePicker() {
  document.getElementById('analyze-source-picker').hidden = false;
  document.querySelector('[data-analyze-source]').focus();
}
function closeAnalyzeSourcePicker() {
  document.getElementById('analyze-source-picker').hidden = true;
}
window.analyzeSourcePicker = { open: openAnalyzeSourcePicker };
// Routing is a simulated tab click — the same idiom used throughout this file
// (e.g. #rc-offer-btn) — so Live/Soundcheck reach their
// destination through the real mode-tab handler: Pro gating, transport
// pausing, spectrum sync, syncSingleColumn() all fire exactly as if the user
// had clicked the tab themselves.
document.querySelectorAll('[data-analyze-source]').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = window.analyzeSourceState.targetModeFor(btn.dataset.analyzeSource);
    closeAnalyzeSourcePicker();
    if (mode === null) { chooseAndAnalyzeFile(); return; }
    if (mode === undefined) { console.error(`analyze-source-picker: unrecognized source "${btn.dataset.analyzeSource}"`); return; }
    document.querySelector(`.mode-tab[data-mode="${mode}"]`).click();
  });
});
document.getElementById('source-picker-cancel').addEventListener('click', closeAnalyzeSourcePicker);
document.getElementById('analyze-source-picker').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAnalyzeSourcePicker();
});

// Mode tabs (#547 and earlier): the click listener, currentMode var, and
// syncSpectrumForMode are gone — ModeTabs.tsx (portaled onto #mode-tabs) now
// renders the tabs and dispatches every click through mode-switch.ts's
// resolveModeSwitch/switchMode, which liveCaptureStore.appMode drives
// (TD-001 slice 6e, #703). window.modeSwitch bridges applySpectrumForMode/
// applySingleColumnSync for the remaining call sites below that aren't
// inside switchMode() itself.

// Virtual Soundcheck (#46): fully React/store-owned (SoundcheckPanel.tsx,
// stores/soundcheckStore.ts, TD-001 slice 6d, #702).
window.rendererStores.soundcheck.getState().loadDevices(); // populate the output picker at startup

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
  if (window.batchAnalysis.shouldSuppressPushedResult(batchRunning)) return;
  if (!data.stage || data.status !== 'done') return;
  specStore.getState().markStageDone(data.stage);
});

// resolveReportCardChromeSource/syncReportCardChrome are gone —
// report-card-chrome.ts#resolveReportCardChromeSource/reportCardChromeView
// (TD-001 slice 6e, #703) port them verbatim; ReportCardToolbar.tsx now owns
// the toolbar buttons via its own useEffect on analysisStore.status,
// replacing the anaStore.subscribe(syncReportCardChrome) wiring below.

/* ══ Directory mode (#270): batch-analyze a folder of whole-mix recordings.
   Runs the existing single-file analyze pipeline sequentially over every
   audio file found in a chosen folder (batchAnalysis.runBatch, #270) —
   strictly sequential because analyze-file supersedes any run still in
   flight for this renderer. Calls analyzeFile directly rather than
   anaStore.getState().startAnalysis() so the batch never drives the
   single-file report-card store's status machine through N spurious
   transitions (ReportCardToolbar.tsx's status-transition useEffect). ══ */
let batchFiles = [];
let batchRunning = false;

function renderDirEmptyState() {
  const empty = document.getElementById('dir-empty');
  const analyzeBtn = document.getElementById('dir-analyze-btn');
  const chooseBtn = document.getElementById('dir-choose-btn');
  empty.style.display = batchFiles.length === 0 ? 'block' : 'none';
  analyzeBtn.disabled = batchRunning || batchFiles.length === 0;
  chooseBtn.disabled = batchRunning;
}

document.getElementById('dir-choose-btn').addEventListener('click', async () => {
  // A batch already in flight owns #dir-path/#dir-results/batchFiles until it
  // finishes — picking a new folder mid-run would repaint the panel out from
  // under it while its onProgress callback keeps appending the OLD folder's
  // rows under the NEW folder's path. The button is also disabled while
  // running (renderDirEmptyState), this guard covers a click already queued
  // just before that disable took effect.
  if (batchRunning) return;
  const dir = await sb.openDirDialog();
  if (!dir) return;
  document.getElementById('dir-path').textContent = dir;
  document.getElementById('dir-results').innerHTML = '';
  document.getElementById('dir-progress').textContent = '';
  let res;
  try {
    res = await sb.listFolderAudio(dir);
  } catch (err) {
    console.warn('listFolderAudio failed', err);
    res = null;
  }
  batchFiles = (res && res.success && Array.isArray(res.files)) ? res.files : [];
  document.getElementById('dir-empty').textContent = window.batchAnalysis.dirEmptyMessage(res);
  renderDirEmptyState();
});

document.getElementById('dir-analyze-btn').addEventListener('click', async () => {
  if (batchRunning || batchFiles.length === 0) return;
  batchRunning = true;
  const analyzeBtn = document.getElementById('dir-analyze-btn');
  const progress = document.getElementById('dir-progress');
  const results = document.getElementById('dir-results');
  analyzeBtn.disabled = true;
  results.innerHTML = '';
  progress.textContent = window.batchAnalysis.progressText(0, batchFiles.length);

  try {
    const rows = await window.batchAnalysis.runBatch(batchFiles, {
      analyzeFile: (fp) => sb.analyzeFile({ filePath: fp }),
      toSummaryInput: (data, fp) => {
        const src = reportCardSourceFromAnalysis(data);
        return src ? buildAnalysisSummaryInput(src, grading, 'file') : null;
      },
      saveSummary: (input) => sb.saveAnalysisSummary(input),
      onProgress: (event) => {
        if (event.status === 'running') return;
        progress.textContent = window.batchAnalysis.progressText(event.index + 1, event.total);
        results.insertAdjacentHTML('beforeend', window.batchAnalysis.batchRowHtml(event, event.index, escapeHtml));
      },
    });
    progress.textContent = window.batchAnalysis.summaryText(rows);
  } finally {
    batchRunning = false;
    renderDirEmptyState();
    // RecentServicesPanel.tsx (TD-001 slice 6e, #703) re-fetches on every
    // appMode transition into 'recent' — the Directory tab (batch analysis
    // runs here) and Recent are mutually exclusive, so there's no longer a
    // stale-list case for this batch-completion refresh to cover.
  }
});

/* ══ Live mode ══ */
document.getElementById('window-secs').addEventListener('input', (e) => {
  document.getElementById('window-secs-label').textContent = parseFloat(e.target.value).toFixed(1) + 's';
});
document.getElementById('meter-interval').addEventListener('input', (e) => {
  const ms = parseInt(e.target.value);
  document.getElementById('interval-label').textContent = `${ms} ms · ${Math.round(1000 / ms)}/s`;
});

/* ── Monitor / Record toggle ──
   The Source-panel Mode toggle is React-owned (LiveControls.tsx, TD-001
   slice 6c, #701) and calls lcStore.getState().setLiveMode directly; rig-
   apply now writes `liveMode` as part of applyRigPatch's returned patch
   (rig-panel.ts, TD-001 slice 6d, #702). Both paths' store writes are picked
   up by syncLiveCaptureMirror's subscription (board repaint) — no inline
   wrapper function is called from here anymore. */
// Inline "arm at least one strip" hint near the Start button (#43).
function showArmHint(msg) { const h = document.getElementById('arm-hint'); h.textContent = msg; h.style.display = 'block'; }
function hideArmHint() { const h = document.getElementById('arm-hint'); if (h) h.style.display = 'none'; }

// The header #live-indicator (LIVE/REC pill) + #live-status text, driven by
// window.liveTransitionState's pure phase model (#458) from the raw
// liveRunning/liveMode/capturePromoting flags. The Start/Stop/Record
// TRANSPORT BUTTONS themselves are React-owned now (LiveTransportControls,
// TD-001 slice 6c, #701) and derive the same phase independently; this keeps
// the two remaining out-of-scope pieces (the header pill, sitting outside
// #tab-live; the status line, shared with rig-error text) in sync.
// `meterRate`, when passed, interpolates into the status line ("Recording ·
// meters N/s"); omit it to leave the current status text alone (e.g. the
// "Connecting…" placeholder).
function syncCaptureControls(meterRate) {
  const phase = window.liveTransitionState.capturePhase({ liveRunning, liveMode, promoting: capturePromoting });

  const indicator = window.liveTransitionState.captureIndicator(phase);
  document.querySelector('#live-indicator .live-txt').textContent = indicator.text;
  document.getElementById('live-indicator').classList.toggle('capture-record', indicator.recording);

  if (meterRate != null) {
    document.getElementById('live-status').textContent = window.liveTransitionState.statusLabel(phase, meterRate);
  }
}
// Name a new group via the shared dialog and push it onto channelGroups (#41).
// Called from the workspace toolbar's #live-ws-new-group (#190).
async function createChannelGroup() {
  const name = await rigDialog({ title: 'New group', value: '', confirmLabel: 'Create', withInput: true });
  const trimmed = (name || '').trim();
  if (!trimmed) return;
  lcStore.getState().addGroup(trimmed.slice(0, 40));
  renderChannelConfig();
}

// Rename group g in place via the shared dialog, leaving its members untouched
// (#190). Reached from the workspace group header's rename control.
async function renameChannelGroup(g) {
  const grp = channelGroups[g];
  if (!grp) return;
  const name = await rigDialog({ title: 'Rename group', value: grp.name, confirmLabel: 'Rename', withInput: true });
  const trimmed = (name || '').trim();
  if (!trimmed) return;
  lcStore.getState().renameGroup(g, trimmed.slice(0, 40));
  renderChannelConfig();
}

// Delete group g (#190). Its members fall back to Ungrouped — channelConfig is
// untouched, so no track is lost. Confirmed via the shared dialog.
async function deleteChannelGroup(g) {
  const grp = channelGroups[g];
  if (!grp) return;
  const ok = await rigDialog({
    title: 'Delete group',
    msg: `Delete "${grp.name}"? Its tracks move to Ungrouped.`,
    confirmLabel: 'Delete',
    withInput: false,
  });
  if (!ok) return;
  lcStore.getState().removeGroup(g);
  renderChannelConfig();
}

// The effective default recording folder to show when no folder is explicitly
// chosen (#482): the configured storageDir setting (#91), falling back to the
// platform default — mirrors ipc/shared.ts's defaultRecordDir(). LiveControls.tsx
// carries its own copy of this same logic for its React-owned #record-folder-path
// rendering (TD-001 slice 6c, #701); this one is still used by the boot sequence
// below (cold-boot placeholder text before settings load).
function defaultRecordFolderText() {
  const s = setStore.getState().settings;
  return (s && s.storageDir && s.storageDir.trim()) || '~/Music/Sound Buddy';
}

/* ── Channel configuration ── */
// The selected device's max input channels (0 = default device / unknown).
function selectedDeviceChannels() {
  return deviceChannelCount(lcStore.getState().selectedDevice, liveDevices);
}

// The selected device's name, resolved from liveDevices ('' = Default Device),
// mirroring rig-panel.ts's captureCurrentRigSnapshot's device-by-name
// resolution (TD-001 slice 6d, #702).
function selectedDeviceName() {
  const val = lcStore.getState().selectedDevice;
  if (val === '') return '';
  const dev = liveDevices.find((d) => String(d.index) === val);
  return dev ? dev.name : '';
}

// The persisted instrument-profile overrides (#524) saved for the currently
// selected device, mirroring liveCaptureStore.ts's withSavedLabels (#482).
function savedInstrumentProfilesForDevice() {
  return ((setStore.getState().settings || {}).inputInstrumentProfiles || {})[selectedDeviceName()] || {};
}

// Total device channels consumed by the current config (mono=1, stereo=2).
function usedChannelCount() {
  return lcUsedChannelCount(channelConfig);
}

// Push a new mono strip onto channelConfig and re-render (#188). Called from
// the workspace's #live-ws-add.
function addChannelStrip() {
  lcStore.getState().addStrip();
  renderChannelConfig();
}

// Remove a strip and re-render (#188). Called from the workspace's .live-ch-x;
// callers may drive this down to zero strips so the workspace empty state
// stays reachable. removeStrip (#456, #668, #41) already reindexes/clears
// measurementSource, selectedChannel, and prunes+persists channelGroups
// atomically — only focusedInputIndex (#525, not store-owned) needs its own
// reindex here.
function removeChannelStrip(idx) {
  focusedInputIndex = measurementSourceAfterRemove(focusedInputIndex, idx);
  lcStore.getState().removeStrip(idx);
  renderChannelConfig();
}

// Reset the config to the device default: first ≤2 channels as mono strips,
// then overlay any saved labels and groups for this device (#482, #483) —
// covers device switches and refresh. selectDevice (re-invoked for the
// currently selected device) already does this seeding — single source of
// truth for it now lives in liveCaptureStore.ts (TD-001 slice 6c, #701).
function resetChannelConfig() {
  lcStore.getState().selectDevice(lcStore.getState().selectedDevice);
  // Same reasoning applies to the focused input (#525) — it never dangles
  // across a device swap. (measurementSource/selectedChannel are reset by
  // selectDevice() itself.)
  focusedInputIndex = null;
  // A stale lastLiveChannels from the previous device must not leak into the
  // EQ pane (#668) on the next renderEqPane call — currentEqPaneChannels()
  // falls back to it whenever it's non-null, so it has to be cleared here too.
  lcStore.getState().clearLastLiveChannels();
  renderChannelConfig();
}

// Config changed: re-sync the center-pane track workspace and re-assert the
// capture lock. The channel list, add, group, and arm controls now live solely
// in the workspace (#192); this is the shared "config changed" entry point that
// every mutator (add/remove/kind/source/group/arm/mode/rig) routes through.
// The workspace board itself (#live-island) repaints via syncLiveCaptureMirror's
// store subscription reacting to the store write each of those mutators already
// made — not from this call (TD-001 slice 6c, #701).
function renderChannelConfig() {
  // Re-assert the capture lock (#38): a running capture keeps the workspace frozen.
  if (liveRunning) setCaptureControlsLocked(true);
  // Preflight checklist (#373) is React/store-owned now (PreflightPanel.tsx,
  // TD-001 slice 6d, #702) — it recomputes on every render from rigStore +
  // liveCaptureStore state, no imperative repaint needed here.
  renderMeasurementBadge();
}

// Label which strip the room-analysis indicators are judging (#457) — lives
// in the header's LIVE indicator so it's visible whenever analysis runs.
function renderMeasurementBadge() {
  document.getElementById('measurement-badge').textContent =
    measurementSourceBadgeText(channelConfig, lcStore.getState().measurementSource);
}

// Lock/unlock every capture-config control while a capture runs (#38). stream.py
// is spawned with a fixed device/channels/mode/dirs set and can't honor a
// mid-session change, so freezing avoids corrupting the take. Idempotent, and
// re-selects the live-rendered workspace children each call. The rig picker has
// its own lock (rigStore's `locked` field, set via onCaptureStarting/
// onCaptureStopping below) but is guarded here too, defensively.
// measurement-source is excluded (#457): it's a renderer-side selection into
// already-streaming tick data, not a stream.py argument, so switching it
// mid-capture is safe and is the point of #457's second AC. device-select/
// device-refresh-btn/record-folder-btn/#live-mode buttons are React-owned now
// (LiveControls.tsx) and derive `disabled` from isCapturing directly — not
// swept here (TD-001 slice 6c, #701).
function setCaptureControlsLocked(locked) {
  const set = (el) => { if (el) { el.disabled = locked; el.setAttribute('aria-disabled', String(locked)); } };
  ['meter-interval', 'window-secs', 'rig-select',
    'live-ws-add', 'live-ws-new-group',
    'live-ws-arm-all', 'live-ws-disarm-all'].forEach((id) => set(document.getElementById(id)));
  // Workspace track rows (#188): Add track (above) + each row's remove, read-only
  // while a capture is running.
  document.querySelectorAll('#spectrum-body .live-ch-x').forEach(set);
  // Workspace per-track arm toggle (#191), frozen mid-capture with the rest —
  // the workspace is outside #tab-live, so this explicit sweep is required.
  document.querySelectorAll('#spectrum-body .live-ch-arm').forEach(set);
  // Inline track definition (#189): kind toggle + source picker(s), frozen
  // mid-capture (stream.py can't honor a mid-session channel change).
  // veqChannelHTML already stamps `disabled` at build time; this re-asserts it
  // after any re-render triggered while running.
  document.querySelectorAll('#spectrum-body .live-ch-kind, #spectrum-body .live-ch-src, #spectrum-body .live-ch-group, #spectrum-body .live-ch-profile').forEach(set);
  // Group header rename/delete controls (#190), frozen mid-capture with the rest.
  document.querySelectorAll('#spectrum-body .live-group-rename, #spectrum-body .live-group-del').forEach(set);
  // Drag-reorder handles (#483): reordering is disabled mid-capture like every
  // other config control — the board is patched by data-ch and grouping is
  // assumed stable across ticks while a capture runs.
  document.querySelectorAll('#spectrum-body .live-group-drag, #spectrum-body .live-ch-drag').forEach(set);
  const tab = document.getElementById('tab-live');
  if (tab) tab.classList.toggle('capture-locked', locked);
}

// Build the stream.py channel tokens ("N" mono, "N-M" stereo) from the config.
// A stereo strip whose two legs collapsed to the same channel (possible on the
// last device channel) degrades to a mono token rather than a bogus "N-N" pair.
function channelTokens() { return window.armState.allTokens(channelConfig); }
// Armed subset of channelTokens() — what Record mode captures as session stems (#43).
function armedTokens() { return window.armState.armedTokens(channelConfig); }
function armedCount() { return window.armState.armedCount(channelConfig); }

function setDeviceHint(text, isError) {
  const hint = document.getElementById('device-hint');
  if (!hint) return;
  if (!text) { hint.style.display = 'none'; hint.textContent = ''; return; }
  hint.textContent = text;
  hint.classList.toggle('is-error', !!isError);
  hint.style.display = 'block';
}

// Device <select>/refresh button/hint are React-owned now (LiveControls.tsx,
// TD-001 slice 6c, #701) — this fetches the list and hands it to the store
// (which itself seeds channelConfig/channelGroups for the resolved device),
// then re-runs the inline-only remainder of the old reset (focusedInputIndex/
// lastLiveChannels/preflight — see resetChannelConfig).
async function loadDevices() {
  await lcStore.getState().loadDevices();
  // Seed the channel picker from the (default) device's channel count — only
  // once devices were actually found (mirrors the original early returns that
  // skipped this on every non-happy branch).
  if (lcStore.getState().devices.length) resetChannelConfig();
}

// Bridged runtime powering LiveControls.tsx's device/measurement-source/mode/
// record-folder/start-stop-record controls (TD-001 slice 6c, #701) — the
// heavier orchestration (validation, playhead/waveform/rig-lock/lapCoaching/
// session-offer side effects) stays here rather than moving into React,
// since it's still tightly coupled to the not-yet-migrated DAW shell/
// live-adjustments/preflight/rig surfaces (see the ADR in the #701 plan).
window.liveCaptureRuntime = {
  loadDevices,
  selectDevice(value) {
    void value; // store.selectDevice (called by LiveControls itself) already reseeds channelConfig/channelGroups reactively
    focusedInputIndex = null;
    lcStore.getState().clearLastLiveChannels();
    // PreflightPanel.tsx recomputes reactively off liveCaptureStore's
    // selectedDevice/channelConfig/devices — no imperative repaint needed
    // here (TD-001 slice 6d, #702).
  },
  // Measurement source picker (#456): normalize against the current strip
  // count so a stale selection ('' -> null, an index -> the resolved strip)
  // never lands in the store.
  changeMeasurementSource(value) {
    const parsed = value === '' ? null : parseInt(value, 10);
    lcStore.getState().setMeasurementSource(normalizeMeasurementSource(parsed, channelConfig.length));
    renderMeasurementBadge();
    renderEqPane(currentEqPaneChannels());
  },
  async chooseRecordFolder() {
    const dir = await sb.openDirDialog();
    if (dir) lcStore.getState().setRecordDir(dir);
  },
  beforeStartCapture,
  onCaptureStarting,
  onCaptureStarted,
  onCaptureStopping,
  onCaptureStopped,
  promoteToRecording,
};

// Bridged runtime powering LiveWorkspace.tsx's #live-island repaint timing
// (TD-001 slice 6c, #701) — renderWorkspace() re-triggers whenever board
// SHAPE changes (replacing the old per-mutation renderLiveWorkspace()/
// renderLiveMeters() call sites); patchTick() is called by the mounted
// live-meter-controller for every coalesced live tick. Both still delegate
// to renderLiveMeters()/renderLiveWorkspace() unchanged internally — those
// already own the patch-vs-rebuild decision, the DAW shell (#517) hand-off,
// and the docked EQ pane / live-adjustments panel refresh.
window.liveWorkspaceRuntime = {
  renderWorkspace() {
    if (liveRunning && lcStore.getState().lastTick) renderLiveMeters(lcStore.getState().lastTick);
    else renderLiveWorkspace();
  },
  patchTick(win) {
    renderLiveMeters(win);
  },
};

// Docked live EQ pane resize (#668): drag the handle, or focus it and press
// ArrowLeft/ArrowRight. The pane is docked to the right edge of #workspace
// with the handle riding its left edge, so dragging toward the window's
// center (decreasing clientX) widens the pane and dragging away shrinks it.
// The final width persists to settings.json so it survives across sessions.
(function initEqPaneResize() {
  const pane = document.getElementById('live-eq-pane');
  const handle = document.getElementById('live-eq-resize');
  if (!pane || !handle) return;
  let startX = 0;
  let startW = 0;
  function widthFromDrag(clientX) {
    return clampEqPaneWidth(startW + (startX - clientX));
  }
  function onPointerMove(e) {
    pane.style.width = widthFromDrag(e.clientX) + 'px';
  }
  function onPointerUp(e) {
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    void setStore.getState().updateSettings({ liveEqPaneWidth: widthFromDrag(e.clientX) });
  }
  handle.addEventListener('pointerdown', (e) => {
    startX = e.clientX;
    startW = clampEqPaneWidth(parseFloat(pane.style.width));
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  });
  handle.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const current = clampEqPaneWidth(parseFloat(pane.style.width));
    // Matches the drag handle's direction (decreasing clientX widens): ArrowLeft widens, ArrowRight shrinks.
    const next = clampEqPaneWidth(current + (e.key === 'ArrowLeft' ? EQ_PANE_RESIZE_STEP : -EQ_PANE_RESIZE_STEP));
    pane.style.width = next + 'px';
    void setStore.getState().updateSettings({ liveEqPaneWidth: next });
  });
})();

// Start/Stop/Record buttons are React-owned now (LiveTransportControls,
// TD-001 slice 6c, #701) — they call lcStore.getState().startCapture()/
// stopCapture() directly for the payload+IPC round trip (which already builds
// the exact same request this file's old inline handler did — device/
// channels/mode/recordDir/arm/labels — from store state) and delegate the
// surrounding side effects to the beforeStartCapture/onCaptureStarting/
// onCaptureStarted/onCaptureStopping/onCaptureStopped functions below via the
// window.liveCaptureRuntime bridge (see LiveControls.tsx's
// startLiveCapture()/stopLiveCapture() for the exact call ordering — it
// mirrors this file's old liveRunning=true-then-await-then-handle-result
// shape precisely, since store.startCapture()/stopCapture() flip isCapturing
// synchronously before their own await point).

// No configured tracks (#188): the workspace remove can drive channelConfig
// to zero, but stream.py silently falls back to its first device channels
// when given an empty channel list — block Start rather than start a
// capture the UI just showed as empty. Record mode with nothing armed would
// spawn an empty session — block that too (#43).
function beforeStartCapture() {
  if (channelConfig.length === 0) {
    const reason = 'Add at least one track before starting capture.';
    showArmHint(reason);
    return { ok: false, reason };
  }
  if (liveMode === 'record' && armedCount() === 0) {
    const reason = 'Arm at least one strip to record.';
    showArmHint(reason);
    return { ok: false, reason };
  }
  hideArmHint();
  return { ok: true };
}

// Runs synchronously right after lcStore.getState().startCapture() flips
// isCapturing true and resets liveWindows (before its own await resolves) —
// the same point this file's old inline handler ran these side effects at,
// right after `liveRunning = true`.
function onCaptureStarting() {
  const intervalSecs = parseInt(document.getElementById('meter-interval').value) / 1000;
  // Overwriting the previous state is the reset — the next capture starts
  // from zero (#518).
  playheadState = window.dawPlayheadState.start(Date.now());
  startPlayheadTicker();
  // Clear the previous capture's waveform and align the bucket rate to this
  // capture's meter interval (#520).
  waveformState = window.dawWaveformState.create();
  waveformBucketsPerSec = window.dawWaveformState.bucketsPerSecond(intervalSecs);
  waveformLaneStates = {};
  sessionWindows = [];
  // A new capture must not inherit the previous session's cooldowns or active card (#612).
  lapCoaching = window.liveAdjustmentsState.createCoachingState();
  syncLiveAdjustmentsPanel();
  // A live capture always wins over a loaded history entry (#147).
  anaStore.getState().setHistorySummary(null);
  window.rendererStores.rig.getState().setLocked(true);
  setCaptureControlsLocked(true); // freeze device/mode/folder/channels/sliders (#38)

  document.getElementById('rec-offer').style.display = 'none';
  document.getElementById('rc-offer').style.display = 'none';
  document.getElementById('rc-not-enough').style.display = 'none';
  document.getElementById('live-rc-cue').style.display = 'none';
  document.getElementById('live-indicator').style.display = 'flex';
  syncCaptureControls();
  renderMeasurementBadge();
  document.getElementById('live-status').style.display = 'block';
  document.getElementById('live-status').textContent = 'Connecting…';
  document.getElementById('spectrum-title').textContent = SPECTRUM_TITLE.live;
}

function onCaptureStarted(result, meterRate) {
  if (!result || !result.success) {
    void stopLive();
    specStore.getState().setPanelState('error', (result && result.error) || 'Failed to start live capture');
  } else {
    syncCaptureControls(meterRate);
    // Guided first-use setup (#294): starting a capture completes setup
    // permanently. Remove any rendered banner immediately rather than calling
    // renderChannelConfig(), which early-outs while liveRunning — the running
    // board takes the pane over on the first tick anyway.
    window.liveSetupState.markSetupComplete(window.localStorage);
    const b = document.querySelector('#spectrum-body .live-setup-banner');
    if (b) b.remove();
  }
}

// Promote a running monitor session to a recording in place (#458): same
// device, channels, groups, labels, and measurement source carry over
// unchanged — no teardown, no re-selection. The backend still swaps the
// monitor stream.py child for a record one (an acceptable short transition
// for this slice), but the UI never makes the user rebuild the setup. On
// failure the session drops to a stopped-but-configured state via stopLive()
// (device/channels/groups/measurement source all preserved) rather than
// attempting to resume monitoring — see the spec's non-goals. Stays a single
// bridged function (LiveTransportControls' Record button calls it directly)
// since its guard/backend-swap/failure-recovery shape doesn't decompose into
// the same before/starting/started split Start does.
async function promoteToRecording() {
  const guard = window.liveTransitionState.canPromoteToRecording({
    liveRunning, liveMode, promoting: capturePromoting, armedCount: armedCount(),
  });
  if (!guard.ok) {
    showArmHint(guard.reason);
    return;
  }
  hideArmHint();

  lcStore.getState().setPromoting(true);
  lcStore.getState().setLiveMode('record');
  syncCaptureControls();

  const device = lcStore.getState().selectedDevice || undefined;
  const windowSecs = parseFloat(document.getElementById('window-secs').value);
  const intervalSecs = parseInt(document.getElementById('meter-interval').value) / 1000;
  const channels = channelTokens();

  const result = await sb.startLive({
    device, channels, windowSecs, intervalSecs,
    mode: 'record', recordDir: recordDir || undefined,
    // Record mode: capture only the armed strips as session stems (#43).
    arm: armedTokens(),
    // Record mode: carry display labels into stem filenames + session.json (#482).
    labels: channelConfig.map((s) => (s.label || '').trim()),
  });
  lcStore.getState().setPromoting(false);

  if (result.success) {
    syncCaptureControls(Math.round(1 / intervalSecs));
    renderMeasurementBadge();
  } else {
    lcStore.getState().setLiveMode('monitor');
    specStore.getState().setPanelState('error', result.error || 'Could not start recording. Monitoring stopped — press Start Capture to resume.');
    await stopLive();
    syncCaptureControls();
  }
}

// Runs synchronously right after lcStore.getState().stopCapture() flips
// isCapturing false (before its own await resolves) — the same point this
// file's old inline handler ran these side effects at, right after
// `liveRunning = false`. Also invoked directly by promoteToRecording's
// failure path and onCaptureStarted's failed-start path (both call stopLive()
// below, which wraps store.stopCapture() + this + onCaptureStopped together
// for those two internal callers — LiveTransportControls' own Stop button
// calls store.stopCapture() itself and this/onCaptureStopped via the bridge,
// see LiveControls.tsx's stopLiveCapture()).
function onCaptureStopping() {
  playheadState = window.dawPlayheadState.stop(playheadState, Date.now());
  stopPlayheadTicker();
  renderDawPlayhead(); // paint the frozen time
  window.rendererStores.rig.getState().setLocked(false);
  setCaptureControlsLocked(false); // re-enable config (also the failed-Start path) (#38)
}

function onCaptureStopped(result) {
  document.getElementById('live-indicator').style.display = 'none';
  document.getElementById('live-status').style.display = 'none';
  syncCaptureControls();
  document.getElementById('live-rc-cue').style.display = 'block';
  document.getElementById('window-badge').textContent = '';
  document.getElementById('measurement-badge').textContent = '';
  // "Stopped" distinguishes the frozen EQ from a running one; guard the mode so
  // a tab switch during the stop-live await isn't clobbered.
  if (lcStore.getState().appMode === 'live') document.getElementById('spectrum-title').textContent = SPECTRUM_TITLE.liveStopped;

  // A Record capture writes a session folder of per-strip stems + session.json
  // (#42); offer to reveal it (#43). Paves the way for "Open in Virtual
  // Soundcheck" (epic #35); for now the action opens the folder.
  if (result && result.sessionDir) {
    lastSessionDir = result.sessionDir;
    const name = result.sessionDir.split('/').pop();
    // Build with a text node for the folder name so a path can never inject markup.
    const text = document.getElementById('rec-offer-text');
    text.textContent = 'Session saved ';
    const b = document.createElement('b');
    b.textContent = name;
    text.appendChild(b);
    text.appendChild(document.createTextNode('.'));
    document.getElementById('rec-offer').style.display = 'flex';
    hydrateIcons(document.getElementById('rec-offer'));
  }

  // #488/#261: a monitor session that accumulated at least one window builds
  // a session-level Report Card from the whole sessionWindows buffer (every
  // window tick since Start Capture — the capped liveWindows below only
  // keeps the last 10 for the rolling preview), grades it, and
  // persists it to history tagged as a live-capture source — the same
  // hook a file analysis gets. Record mode keeps its session-saved offer
  // above; the two never show together (sessionDir only exists in record
  // mode). A session too short/silent to produce usable windows degrades to
  // the "not enough data" state instead of a nonsensical grade.
  if (shouldOfferReportCard(liveMode, liveWindows.length)) {
    const sessionSrc = liveSessionReportCardSource(sessionWindows, lcStore.getState().measurementSource, channelConfig);
    if (sessionSrc) {
      anaStore.getState().setLiveSource(sessionSrc); // freeze the session card onto the Report Card tab
      window.reportCardChrome.persistSummary(sessionSrc, 'live');
      document.getElementById('rc-offer').style.display = 'flex';
      hydrateIcons(document.getElementById('rc-offer'));
    } else {
      showLiveNotEnoughData();
    }
  }
}

// Internal-only orchestration for the two call sites that stop a capture
// without going through LiveTransportControls' own Stop button (a failed
// Start, and a failed promote-to-recording) — wraps store.stopCapture() with
// the same before/after split the button itself uses via the bridge.
async function stopLive() {
  const stopPromise = lcStore.getState().stopCapture();
  onCaptureStopping();
  const result = await stopPromise;
  onCaptureStopped(result);
  return result;
}

// #261: shown in place of the report-card offer when a monitor session
// accumulated at least one window tick but not enough to grade meaningfully
// (fewer than MIN_SESSION_WINDOWS usable windows) — a clear degraded state
// rather than a crash or a confident-looking grade from a second of audio.
function showLiveNotEnoughData() {
  document.getElementById('rc-not-enough').style.display = 'flex';
}

let lastSessionDir = null;
document.getElementById('rec-offer-btn').addEventListener('click', () => {
  if (!lastSessionDir) return;
  document.getElementById('rec-offer').style.display = 'none';
  sb.revealPath(lastSessionDir);
});

document.getElementById('rc-offer-btn').addEventListener('click', () => {
  document.getElementById('rc-offer').style.display = 'none';
  document.querySelector('.mode-tab[data-mode="reportcard"]').click();
});

/* ══ Rigs — save / load / switch capture setups (#37, persisted via #36) ══
   Fully React/store-owned (RigControls.tsx/PreflightPanel.tsx,
   stores/rigStore.ts, TD-001 slice 6d, #702) except rigDialog() below, which
   stays here as shared modal infrastructure also used by out-of-scope
   channel-group naming (createChannelGroup/renameChannelGroup/
   deleteChannelGroup). */

// Small inline modal used in place of window.prompt/confirm (unavailable in the
// Electron renderer). Resolves to the entered string (input mode), true (confirm
// mode OK), or null (cancel / Esc / backdrop).
function rigDialog(opts) {
  const dlg = document.getElementById('rig-dialog');
  const input = document.getElementById('rig-dialog-input');
  const okBtn = document.getElementById('rig-dialog-ok');
  const cancelBtn = document.getElementById('rig-dialog-cancel');
  const msgEl = document.getElementById('rig-dialog-msg');
  const withInput = opts.withInput !== false;

  document.getElementById('rig-dialog-title').textContent = opts.title || '';
  if (opts.msg) { msgEl.textContent = opts.msg; msgEl.style.display = 'block'; }
  else { msgEl.textContent = ''; msgEl.style.display = 'none'; }
  input.style.display = withInput ? 'block' : 'none';
  input.value = opts.value || '';
  okBtn.textContent = opts.confirmLabel || 'OK';
  dlg.style.display = 'flex';
  if (withInput) { input.focus(); input.select(); } else { okBtn.focus(); }

  return new Promise((resolve) => {
    function cleanup() {
      dlg.style.display = 'none';
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      dlg.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
    }
    function onOk() { const v = withInput ? input.value : true; cleanup(); resolve(v); }
    function onCancel() { cleanup(); resolve(null); }
    function onBackdrop(e) { if (e.target === dlg) onCancel(); }
    function onKey(e) {
      if (e.key === 'Escape') onCancel();
      else if (e.key === 'Enter' && withInput) onOk();
    }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    dlg.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
  });
}

// A dedicated interval (not the meter-event rAF path) so the playhead
// advances even while "Connecting…" before the first meter tick, and keeps
// advancing if meter events stall (#518).
function startPlayheadTicker() {
  stopPlayheadTicker();
  playheadTimer = setInterval(renderDawPlayhead, PLAYHEAD_TICK_MS);
}
function stopPlayheadTicker() {
  if (playheadTimer) { clearInterval(playheadTimer); playheadTimer = null; }
}

// Patches the DAW shell's transport time and playhead line in place — never
// rebuilds DOM (#518).
function renderDawPlayhead() {
  const shell = document.querySelector('.daw-shell');
  if (!shell) return; // DAW toggle off or not on Live tab
  const elapsed = window.dawPlayheadState.elapsedMs(playheadState, Date.now());
  const timeEl = shell.querySelector('.daw-transport-time');
  const text = window.dawPlayheadState.formatElapsed(elapsed);
  if (timeEl && timeEl.textContent !== text) timeEl.textContent = text;
  const line = shell.querySelector('.daw-playhead');
  if (line) {
    const maxPx = Math.max(0, shell.clientWidth - DAW_TIMELINE_INSET_PX * 2);
    line.style.transform = `translateX(${window.dawPlayheadState.offsetPx(elapsed, PLAYHEAD_PX_PER_SECOND, maxPx)}px)`;
    line.classList.toggle('advancing', window.dawPlayheadState.isAdvancing(playheadState));
  }
}

// Draws one waveform lane's canvas in place — sized to its own `.daw-lane-body`
// parent, budgeted to the canvas's own drawable width so nothing is ever
// generated past its right edge (#520). Empty `pairs` leaves a cleared
// canvas (the "empty" state); silence draws a 1px hairline (min 1px tall).
function drawWaveformLane(canvas, pairs, strokeStyle) {
  const laneBody = canvas.parentElement;
  const width = laneBody.clientWidth;
  const height = laneBody.clientHeight;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (canvas.width === 0 || canvas.height === 0) return;

  const cols = window.dawWaveformState.columnPeaks(pairs, waveformBucketsPerSec, PLAYHEAD_PX_PER_SECOND, canvas.width);
  if (cols.length === 0) return;

  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = 1;

  const midY = canvas.height / 2;
  cols.forEach((col, x) => {
    const yTop = midY - col.max * midY;
    const yBottom = Math.max(yTop + 1, midY - col.min * midY); // min 1px tall — silence draws a hairline
    ctx.beginPath();
    ctx.moveTo(x + 0.5, yTop);
    ctx.lineTo(x + 0.5, yBottom);
    ctx.stroke();
  });
}

// Patches the DAW shell's waveform canvases in place — never rebuilds DOM
// (#520, #521): the mix lane plus one canvas per per-input channel lane.
function renderDawWaveform() {
  const shell = document.querySelector('.daw-shell');
  if (!shell) return; // DAW toggle off or not on Live tab
  const canvas = shell.querySelector('.daw-mix-waveform');
  if (!canvas) return;

  const captureMode = window.dawWaveformState.captureModeToken(liveRunning, liveMode);
  const strokeStyle = WAVEFORM_COLORS[captureMode] || WAVEFORM_COLORS.stopped;

  drawWaveformLane(canvas, waveformState.pairs, strokeStyle);

  shell.querySelectorAll('.daw-channel-lane').forEach((lane) => {
    const laneCanvas = lane.querySelector('.daw-channel-waveform');
    if (!laneCanvas) return;
    const state = waveformLaneStates['strip' + lane.dataset.ch];
    drawWaveformLane(laneCanvas, state ? state.pairs : [], strokeStyle);
  });
}

// Coalesces peaks-frame repaints to one per animation frame, mirroring
// scheduleLiveMeters' rAF batching — peaks frames can arrive at the meter
// cadence (up to several per second), and each repaint forces a layout read
// (clientWidth/clientHeight), so batching avoids uncoalesced, redundant
// paint work (#520).
function scheduleDawWaveformRender() {
  if (waveformRenderScheduled) return;
  waveformRenderScheduled = true;
  requestAnimationFrame(() => {
    waveformRenderScheduled = false;
    renderDawWaveform();
  });
}

/* ══ IPC event listeners ══ */
sb.onLiveEvent((data) => {
  if (!data || data.error) {
    if (data?.error) specStore.getState().setPanelState('error', `Live error: ${data.error}`);
    return;
  }

  // Mix-waveform peak frames (#520, ADR 0004) carry no channels — handle and
  // return before the meter/stats paths below, which would otherwise treat a
  // peaks frame as a channel-less (and thus useless) meter/window tick.
  if (data.type === 'peaks') {
    const lanes = window.dawWaveformState.decodeLanes(data);
    if (lanes) {
      if (lanes.mix) waveformState = window.dawWaveformState.append(waveformState, lanes.mix);
      for (const id of Object.keys(lanes)) {
        if (id === 'mix') continue;
        waveformLaneStates[id] = window.dawWaveformState.append(
          waveformLaneStates[id] || window.dawWaveformState.create(), lanes[id]);
      }
      scheduleDawWaveformRender();
    }
    return;
  }

  // Every event (fast meter ticks + slower window ticks) drives the live
  // view — lcStore.getState().bindIpcEvents() (installed once by bridge.ts)
  // owns tick ingestion into the store's lastTick/lastLiveChannels/
  // liveWindows/boardShapeVersion (single source of truth, TD-001 slice 6c,
  // #701); LiveWorkspace.tsx's live-meter-controller coalesces lastTick
  // changes into one repaint per animation frame — this listener is reduced
  // to the session-only concerns bindIpcEvents doesn't own (sessionWindows,
  // DAW waveform peaks above, live-adjustments coaching below).
  const statsCh = measurementChannel(data.channels, lcStore.getState().measurementSource);
  if (statsCh) updateLiveStatsRow(statsCh);

  // Only the heavier window ticks (which carry masking + window #) accumulate
  // to feed the report card.
  if (data.type === 'window' || typeof data.window === 'number') {
    sessionWindows.push(data); // uncapped — see the declaration above (#261)
    document.getElementById('window-badge').textContent = `Window #${data.window}`;
    lapCoaching = window.liveAdjustmentsState.advanceCoaching(
      lapCoaching,
      window.liveAdjustmentsState.allCoachingCandidates(
        liveWindows, lcStore.getState().measurementSource, lapFocusView()),
      Date.now(),
      lapObservationContext());
    syncLiveAdjustmentsPanel();
  }
});

// A batch run (#270) also triggers this pushed event on every successful
// analyze-file call — left alone, it would flip the Report Card N times
// mid-batch. Suppressed only while a batch is actually running.
sb.onAnalysisResult((data) => {
  if (window.batchAnalysis.shouldSuppressPushedResult(batchRunning)) return;
  anaStore.getState().setAnalysisFromEvent(data);
});

sb.onMenuOpenFile((fp) => {
  document.querySelector('.mode-tab[data-mode="reportcard"]').click();
  loadFile(fp);
  runFileAnalysis(fp);
});

/* ══ First-run onboarding (#69) ══
   The guided path from launch to first report card. On a genuine first launch a
   welcome overlay appears whose primary CTA analyzes a bundled demo recording
   through the normal File pipeline, then reveals the report card — no settings,
   no file picker, no audio gear. Shows exactly once, gated by window.onboardingState
   + localStorage (mirrors the trial banner's dismiss idiom). */
async function initOnboarding() {
  const dlg = document.getElementById('onboarding-dialog');
  if (!dlg || !window.onboardingState) return;
  // Dev/e2e escape hatch (SOUND_BUDDY_DISABLE_ONBOARDING): skip the overlay so
  // automated specs can drive the UI without the modal scrim in the way. The
  // overlay is display:none until here, so awaiting the flag causes no flash.
  try { if (sb.isOnboardingDisabled && (await sb.isOnboardingDisabled())) return; } catch { /* no bridge → show */ }
  if (!onboardingState.shouldShowOnboarding(window.localStorage)) return;

  const actions = document.getElementById('onboarding-actions');
  const progress = document.getElementById('onboarding-progress');
  const copy = document.getElementById('onboarding-copy');
  const runBtn = document.getElementById('onboarding-run');
  const skipBtn = document.getElementById('onboarding-skip');

  function close() {
    // Seen once — completing or skipping both retire the flow for good.
    onboardingState.markOnboardingSeen(window.localStorage);
    dlg.style.display = 'none';
  }
  function showProgress() { actions.style.display = 'none'; progress.style.display = 'flex'; }
  function showActions() { progress.style.display = 'none'; actions.style.display = 'flex'; }

  async function runFirstAnalysis() {
    showProgress();
    let demo = null;
    try { demo = await sb.getDemoAudio(); } catch { demo = null; }

    // No bundled demo (e.g. asset missing) — never dead-end: retire onboarding
    // and hand the user the normal file picker on the Report Card tab instead.
    if (!demo) {
      close();
      document.querySelector('.mode-tab[data-mode="reportcard"]').click();
      try { const fp = await sb.openFileDialog(); if (fp) { loadFile(fp); runFileAnalysis(fp); } } catch { /* user cancelled */ }
      return;
    }

    // Route through the Report Card tab so the shared analysis pipeline +
    // spectrum render fire exactly as a normal run; the overlay's spinner is
    // the progress indicator meanwhile. runFileAnalysis flips to the rendered
    // card on success.
    document.querySelector('.mode-tab[data-mode="reportcard"]').click();
    loadFile(demo);
    await runFileAnalysis(demo);

    if (!curAnalysis()) {
      // Analysis failed (error surfaced in the spectrum panel). Surface the
      // reason in the always-visible copy line (the progress row is about to
      // be hidden), relabel the CTA, and let the user retry or skip.
      if (copy) copy.textContent = 'That didn’t work — the analysis couldn’t finish. Try again, or skip for now.';
      runBtn.textContent = 'Try again';
      showActions();
      return;
    }
    close();
  }

  runBtn.addEventListener('click', () => { void runFirstAnalysis(); });
  skipBtn.addEventListener('click', close);
  // Escape / backdrop click = skip (still counts as seen — one-time by design),
  // but not while the first analysis is mid-flight.
  dlg.addEventListener('click', (e) => { if (e.target === dlg && progress.style.display === 'none') close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dlg.style.display !== 'none' && progress.style.display === 'none') close();
  });

  dlg.style.display = 'flex';
}

/* ══ Post-update "what's new" note (#271) ══
   Closes the loop opened by the in-app "Send Feedback" flow (#143/#144): after
   the user updates, a dismissible, non-blocking banner credits shipped,
   user-requested items — "You asked, we shipped: …". Bundled with the release
   and read from disk (never fetched), gated once-per-version by
   window.whatsNewState + localStorage (mirrors the onboarding "seen once"
   idiom above). Never shows for a build that ships no note or an empty one. */
async function initWhatsNew() {
  const banner = document.getElementById('whats-new-banner');
  if (!banner || !window.whatsNewState) return;
  // Dev/e2e escape hatch (SOUND_BUDDY_DISABLE_ONBOARDING): reuse the app's
  // established "suppress first-run surfaces in e2e" switch so automated
  // specs aren't disrupted by a banner appearing mid-run.
  try { if (sb.isOnboardingDisabled && (await sb.isOnboardingDisabled())) return; } catch { /* no bridge → proceed */ }

  const [version, md] = await Promise.all([
    sb.getAppVersion().catch(() => ''),
    sb.getWhatsNew().catch(() => null),
  ]);
  if (!version) return;

  // A genuine first launch shows the onboarding overlay instead — crediting
  // "shipped" changes to someone who just installed today (no prior version
  // to compare against) would be a non-sequitur competing with that overlay.
  // Mark this version seen so it doesn't retroactively appear later either.
  if (window.onboardingState && !onboardingState.hasSeenOnboarding(window.localStorage)) {
    whatsNewState.markSeen(window.localStorage, version);
    return;
  }

  const note = whatsNewState.parseNote(md);
  if (!note || whatsNewState.hasSeen(window.localStorage, version)) return;

  const text = document.getElementById('whats-new-text');
  if (text) {
    text.textContent = note.title ? `${note.title}: ${note.items.join(' • ')}` : note.items.join(' • ');
  }

  const dismissBtn = document.getElementById('whats-new-dismiss');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      whatsNewState.markSeen(window.localStorage, version);
      banner.classList.remove('show');
    });
  }

  banner.classList.add('show');
}

/* ══ Report Card ══ */
// Grading (grade/score/recommendations + recording-type + band-diff) lives in
// the pure, unit-tested grading.js module (#130); the renderer calls through
// window.grading below.

// The live-capture card's report-card source (the rolling liveWindows buffer,
// mirroring getReportCardSource()'s old live fallback) is now written into
// analysisStore.liveSource by bridge.ts's cross-store subscription wherever
// liveCaptureStore.liveWindows/measurementSource/channelConfig change (TD-001
// slice 6c, #701 — replacing this file's old syncLiveSource()/
// liveReportCardSource() glue).

// getReportCardSource()/persistSummary() are gone —
// report-card-chrome.ts#getReportCardSource/persistSummary (TD-001 slice 6e,
// #703) port them verbatim as pure/injected functions. This file's remaining
// inline consumers (the AI narrative trigger, saveMixAsTarget, the
// live-capture session persist call below) reach them via the
// window.reportCardChrome bridge (App.tsx) — same pattern as
// window.modeSwitch.

// renderRecentServices/loadHistoryEntry are gone — RecentServicesPanel.tsx
// (TD-001 slice 6e, #703) ports them verbatim (loadHistoryEntry calls
// mode-switch.ts#switchMode directly now, not a simulated tab click).

/* ══ Rough Pass / Contextual Pass toggle (#365) — workflow-phase reminder
   banner atop the Build Guide tab. Phase persists in sessionStorage (resets
   on a fresh app launch) via the pure window.passModeState module; this just
   wires the DOM. ══ */
function renderPassMode() {
  const phase = window.passModeState.loadPhase(sessionStorage);
  document.getElementById('pass-mode-toggle').innerHTML =
    window.passModeState.toggleHtml(phase, escapeHtml);
  document.getElementById('pass-mode-reminder').innerHTML =
    window.passModeState.reminderHtml(window.passModeState.getPhase(phase), escapeHtml);
}

document.getElementById('pass-mode-toggle').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-phase]');
  if (!btn) return;
  window.passModeState.savePhase(sessionStorage, btn.dataset.phase);
  renderPassMode();
});

/* ══ Channel Build-Order Guide (#367) — ordered checklist with starting-point
   EQ/comp/gate presets. Progress persists in localStorage via the pure
   window.buildOrderState module; this just wires the DOM. ══ */
function renderBuildGuide() {
  renderPassMode();
  const list = document.getElementById('build-guide-list');
  const progress = window.buildOrderState.loadProgress(localStorage);

  list.innerHTML = window.buildOrderState.STEPS
    .map((step, i) => window.buildOrderState.stepRowHtml(step, i, progress, escapeHtml))
    .join('');

  const done = window.buildOrderState.completedCount(progress);
  const total = window.buildOrderState.totalSteps();
  document.getElementById('build-guide-progress').textContent = `${done}/${total} done`;

  const complete = document.getElementById('build-complete');
  complete.innerHTML = window.buildOrderState.completeMomentHtml(progress, escapeHtml);
  complete.hidden = !window.buildOrderState.isAllComplete(progress);
  hydrateIcons(complete);
}

// Event delegation on the list (rows are re-rendered wholesale on every
// toggle, so per-row listeners would leak/duplicate) — mirrors how other
// dynamically-rendered lists in this file wire clicks.
document.getElementById('build-guide-list').addEventListener('click', (e) => {
  const row = e.target.closest('[data-step-id]');
  if (!row) return;
  const id = row.dataset.stepId;
  if (e.target.closest('.bg-check')) {
    const progress = window.buildOrderState.loadProgress(localStorage);
    const next = window.buildOrderState.toggle(progress, id);
    window.buildOrderState.saveProgress(localStorage, next);
    renderBuildGuide();
  } else if (e.target.closest('.bg-label')) {
    row.classList.toggle('expanded');
  }
});

document.getElementById('build-guide-reset').addEventListener('click', () => {
  window.buildOrderState.saveProgress(localStorage, window.buildOrderState.emptyProgress());
  renderBuildGuide();
});

// Reuses the existing Report Card tab handler so post-service review is one
// click away from the guide (#367's "links to the Report Card" criterion).
document.getElementById('build-guide-review').addEventListener('click', () => {
  document.querySelector('.mode-tab[data-mode="reportcard"]').click();
});

/* ══ Feedback Ring-Out Assistant (#366) ══
   Free, no-console-API wizard: raise gain to just-ringing, capture the
   ringing frequency (mic or manual), suggest a narrow-Q cut, optionally save
   a per-mic EQ profile. All wizard/DSP/profile logic lives in the tested
   window.feedbackRingout module (mirrors window.buildOrderState above); this
   is thin DOM glue only. */
const RINGOUT_CAPTURE_WINDOW_SECS = 3; // meter-smoothing window passed to start-live
const RINGOUT_CAPTURE_MS = 4000; // wall-clock record duration for a ring-out sample

let ringoutStepIndex = 0; // ephemeral — not persisted, unlike profiles
let ringoutCut = null; // last suggested { freq, gainDb, q }

function ringoutSetStatus(msg) {
  document.getElementById('ringout-status').textContent = msg || '';
}

function ringoutDegradeToManual(msg) {
  ringoutSetStatus(msg);
  document.getElementById('ringout-manual-input').focus();
}

function renderRingout() {
  const ro = window.feedbackRingout;
  document.getElementById('ringout-step').innerHTML = ro.stepHtml(ringoutStepIndex, escapeHtml);
  document.getElementById('ringout-prev').disabled = ro.isFirstStep(ringoutStepIndex);
  document.getElementById('ringout-next').disabled = ro.isLastStep(ringoutStepIndex);
  document.getElementById('ringout-suggestion').innerHTML = ro.suggestionHtml(ringoutCut, escapeHtml);

  const profiles = ro.loadProfiles(localStorage);
  document.getElementById('ringout-profile-list').innerHTML =
    profiles.profiles.map((p) => ro.profileRowHtml(p, escapeHtml)).join('');
}

document.getElementById('ringout-prev').addEventListener('click', () => {
  ringoutStepIndex = window.feedbackRingout.clampStep(ringoutStepIndex - 1);
  renderRingout();
});

document.getElementById('ringout-next').addEventListener('click', () => {
  ringoutStepIndex = window.feedbackRingout.clampStep(ringoutStepIndex + 1);
  renderRingout();
});

document.getElementById('ringout-manual-apply').addEventListener('click', () => {
  const ro = window.feedbackRingout;
  const input = document.getElementById('ringout-manual-input');
  const freq = ro.parseManualFrequency(input.value);
  if (freq === null) {
    ringoutSetStatus(`Enter a frequency between ${ro.MIN_FREQ_HZ} and ${ro.MAX_FREQ_HZ} Hz.`);
    return;
  }
  ringoutCut = ro.suggestCut(freq);
  ringoutSetStatus('');
  renderRingout();
});

function ringoutDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Best-effort mic capture: record a few seconds via the existing start-live/
// stop-live (record mode) pipeline, read the stem it wrote, run it through
// the existing analyze-file pipeline for a fine spectrum curve, then find the
// ring with the shared findSpectralPeaks core. Any failure (no mic, no
// entitlement, empty curve, no clear peak) degrades to manual entry — capture
// is a convenience, manual entry is the guaranteed path.
document.getElementById('ringout-capture').addEventListener('click', async () => {
  const ro = window.feedbackRingout;
  const btn = document.getElementById('ringout-capture');
  btn.disabled = true;
  try {
    const view = deviceListView(await sb.listDevices());
    if (!view.devices.length) {
      ringoutDegradeToManual('No mic detected — enter the frequency manually.');
      return;
    }

    ringoutSetStatus('Listening for the ring…');
    const started = await sb.startLive({
      windowSecs: RINGOUT_CAPTURE_WINDOW_SECS,
      mode: 'record',
    });
    if (!started.success) {
      ringoutDegradeToManual(started.error || 'Live capture unavailable — enter the frequency manually.');
      return;
    }

    await ringoutDelay(RINGOUT_CAPTURE_MS);
    const stopped = await sb.stopLive();
    if (!stopped || !stopped.sessionDir) {
      ringoutDegradeToManual('Capture failed — enter the frequency manually.');
      return;
    }

    const session = await sb.readSession(stopped.sessionDir);
    const track = session && session.success && session.manifest.tracks[0];
    if (!track) {
      ringoutDegradeToManual('Capture failed — enter the frequency manually.');
      return;
    }

    const analysis = await sb.analyzeFile({ filePath: `${stopped.sessionDir}/${track.file}` });
    const curve = analysis && analysis.success && analysis.data
      && analysis.data.spectrum && analysis.data.spectrum.curve;
    if (!curve) {
      ringoutDegradeToManual('Could not analyze the capture — enter the frequency manually.');
      return;
    }

    const ring = ro.identifyRing(curve, window.audioEngineSpectral.findSpectralPeaks);
    if (!ring) {
      ringoutDegradeToManual('No clear ring detected — try again or enter the frequency manually.');
      return;
    }

    ringoutCut = ro.suggestCut(ring.freq);
    ringoutSetStatus(`Captured ${ro.formatCut(ringoutCut)}.`);
    renderRingout();
  } finally {
    btn.disabled = false;
  }
});

// #372: launch the ring-out wizard from the report card, seeded with the
// detected ring. Reuses the mode-tab click so the transition is the exact
// navigation the user already knows (renderRingout runs inside it). Now
// reached via window.inlineDialogs.openFeedbackRingout (ReportCard.tsx's
// button, TD-001 slice 4, #422) instead of a static listener — see the
// window.inlineDialogs assignment below.
function openFeedbackRingout() {
  const ro = window.feedbackRingout;
  const feedbackPeak = rcCallouts().feedbackPeak;
  if (feedbackPeak) {
    ringoutCut = ro.suggestCut(feedbackPeak.freq);
    ringoutStepIndex = ro.stepIndexById('cut');
  }
  document.querySelector('.mode-tab[data-mode="ringout"]').click();
  ringoutSetStatus(feedbackPeak ? ro.handoffStatus(feedbackPeak.freq) : '');
}

// #545 (epic e17): forward link from the Report Card to the Build Guide —
// the mirror of #build-guide-review's Report-Card link. Reuses the mode-tab
// click so navigation is identical to the user clicking the tab. Reached via
// window.inlineDialogs.openBuildGuide (ReportCard.tsx's flag-on link).
function openBuildGuide() {
  document.querySelector('.mode-tab[data-mode="guide"]').click();
}

document.getElementById('ringout-profile-save').addEventListener('click', () => {
  const nameInput = document.getElementById('ringout-profile-name');
  const name = nameInput.value.trim();
  if (!name || !ringoutCut) return;
  const ro = window.feedbackRingout;
  ro.saveProfile(localStorage, ro.loadProfiles(localStorage), { mic: name, cuts: [ringoutCut] });
  nameInput.value = '';
  renderRingout();
});

// Event delegation on the list (re-rendered wholesale on every change) —
// mirrors the build-guide-list pattern above.
document.getElementById('ringout-profile-list').addEventListener('click', (e) => {
  const row = e.target.closest('[data-mic]');
  if (!row) return;
  const mic = row.dataset.mic;
  const ro = window.feedbackRingout;
  if (e.target.closest('.ro-profile-recall')) {
    const profile = ro.getProfile(ro.loadProfiles(localStorage), mic);
    if (profile && profile.cuts[0]) {
      ringoutCut = profile.cuts[0];
      renderRingout();
    }
  } else if (e.target.closest('.ro-profile-delete')) {
    ro.deleteProfile(localStorage, ro.loadProfiles(localStorage), mic);
    renderRingout();
  }
});

// Share prompt (#374): the Report Card is the shareable export, so the closing
// moment's "Share your grade" jumps to it — same one-click hop as the guide's
// "Review in Report Card" button.
document.getElementById('build-complete').addEventListener('click', (e) => {
  if (!e.target.closest('#build-complete-share')) return;
  document.querySelector('.mode-tab[data-mode="reportcard"]').click();
});

// renderContentType/renderProfileMatch/renderReportCardFromHistory/
// renderReportCard are gone — ReportCardIsland (React) now owns all of
// #report-card's rendering, driven by analysisStore/spectrumStore (TD-001
// slice 4, #422). The report-card toolbar buttons + the #rc-upgrade momentum
// aside are gone from this script too — ReportCardToolbar.tsx/
// UpgradeMomentum.tsx (TD-001 slice 6e, #703) own them now, both deriving
// from report-card-chrome.ts#reportCardChromeView.

// #208: while a live-capture card is showing, the file dropzone is hidden behind it
// (#rc-empty only renders when no card is present) and Clear is disabled (no file to
// release). ReportCardToolbar.tsx's Load button (visible only for the live-capture
// card) still reaches this by name — it's a 3-line function with no other
// dependents left after this migration, so it's bridged rather than ported.
async function chooseAndAnalyzeFile() {
  try {
    const fp = await sb.openFileDialog();
    if (fp) { loadFile(fp); await runFileAnalysis(fp); }
  } catch { /* user cancelled */ }
}
window.chooseAndAnalyzeFile = chooseAndAnalyzeFile;

/* ══ License (#54) ══ */
// Free/Pro state comes from licensingStore (backed by the main process's
// offline Ed25519 validation); the pure display/entitlement rules live in
// license-state.js. LicensePanel.tsx now owns the dialog itself — its
// markup, activation/removal/refresh, and the entitlement poll (TD-001
// slice 3, #421). This section renders the badge/banners/upgrade-card from
// licStore's state and wires the surfaces that open the dialog.

// Paywall-evaluation refresh trigger (#117): once per session, the first time
// we observe a subscription in its refresh window, kick the automatic check.
// The window predicate lives in license-state.js (isInRefreshWindow, shared +
// unit-tested) so it can't silently drift from the main process's own
// shouldAutoRefresh() — a polling loop isn't needed since renderLicenseUi
// runs on every licStore change.
let refreshKicked = false;

function renderLicenseUi(state) {
  if (!refreshKicked && window.licenseState.isInRefreshWindow(state)) {
    refreshKicked = true;
    // licensingStore.refreshLicense() never throws — a rejected round-trip
    // just keeps the current state (see its own comment).
    void licStore.getState().refreshLicense();
  }
  const ls = window.licenseState;
  const b = ls.badge(state);

  const badgeEl = document.getElementById('license-badge');
  // During the trial the countdown IS the badge copy (#61); the pure helper
  // owns the exact string so it can't drift from what's under test.
  const trialText = ls.trialBadgeText(state);
  badgeEl.textContent = trialText || b.label;
  badgeEl.classList.toggle('pro', b.pro);
  badgeEl.classList.toggle('grace', b.grace);
  badgeEl.classList.toggle('trial', b.trial);

  // The single gating hook: every Pro surface keys off body.not-pro in CSS.
  document.body.classList.toggle('not-pro', !b.pro);

  const banner = document.getElementById('license-banner');
  const graceText = ls.graceBannerText(state);
  if (graceText) {
    document.getElementById('license-banner-text').textContent = graceText;
    banner.classList.add('show');
  } else {
    banner.classList.remove('show');
  }

  renderTrialBanner(state);

  // UpgradeMomentum.tsx (TD-001 slice 6e, #703) reads licensingStore directly
  // via useStoreShallow — no explicit re-render trigger needed here anymore;
  // activating/removing a key mid-session hides the card reactively.
}

// The day-3 / day-11 nudge and the day-14 upgrade card (#61). Dismissals are
// per-milestone in localStorage so a nudge shows once, not every launch.
function trialDismissed(id) {
  try { return localStorage.getItem('sb-trial-dismiss-' + id) === '1'; } catch { return false; }
}
function dismissTrial(id) {
  try { localStorage.setItem('sb-trial-dismiss-' + id, '1'); } catch { /* private mode: banner just returns next launch */ }
}

function renderTrialBanner(state) {
  const el = document.getElementById('trial-banner');
  const textEl = document.getElementById('trial-banner-text');
  let msg = null;
  let id = null;
  if (state.status === 'trial') {
    const nudge = window.licenseState.trialNudge(state);
    if (nudge) { msg = nudge.text; id = nudge.milestone; }
  } else if (state.status === 'trial-expired') {
    msg = 'Your 14-day Pro trial has ended — the report card stays free. Start a subscription to reunlock live monitoring, saved rigs & virtual soundcheck.';
    id = 'expired';
  }
  if (msg && id && !trialDismissed(id)) {
    textEl.textContent = msg;
    el.dataset.dismissId = id;
    el.classList.add('show');
  } else {
    el.classList.remove('show');
  }
}

(function initLicense() {
  document.getElementById('license-badge').addEventListener('click', () => licStore.getState().openDialog());
  document.getElementById('license-banner-manage').addEventListener('click', () => licStore.getState().openDialog());
  document.getElementById('license-banner-dismiss').addEventListener('click', () =>
    document.getElementById('license-banner').classList.remove('show'));

  // Trial banner (#61): "Start subscription" opens the license dialog; the ✕
  // dismisses this milestone for good (so it doesn't nag every launch).
  document.getElementById('trial-banner-start').addEventListener('click', () => licStore.getState().openDialog());
  document.getElementById('trial-banner-dismiss').addEventListener('click', () => {
    const tb = document.getElementById('trial-banner');
    if (tb.dataset.dismissId) dismissTrial(tb.dataset.dismissId);
    tb.classList.remove('show');
  });
  document.querySelectorAll('[data-license-open]').forEach((el) =>
    el.addEventListener('click', () => licStore.getState().openDialog()));

  licStore.subscribe((s) => renderLicenseUi(s.licenseStatus || { tier: 'free', status: 'none' }));
  // Render the free-tier default immediately — LicensePanel.tsx's mount
  // effect resolves the real state asynchronously; the subscribe above
  // re-renders once it does.
  renderLicenseUi(licStore.getState().licenseStatus || { tier: 'free', status: 'none' });
})();

/* ══ Updates ══ */
(function initUpdates() {
  const banner = document.getElementById('update-banner');
  const text = document.getElementById('update-banner-text');
  const dlBtn = document.getElementById('update-download-btn');
  const progress = document.getElementById('update-progress');
  let info = null;
  let currentAction = 'download';

  function render(view) {
    text.textContent = view.text;
    if (view.primary == null) {
      dlBtn.hidden = true;
    } else {
      dlBtn.hidden = false;
      dlBtn.textContent = view.primary.label;
      currentAction = view.primary.action;
    }
    progress.hidden = !view.showProgress;
    progress.value = view.percent;
    if (view.indeterminate) {
      progress.removeAttribute('value');
    } else {
      progress.setAttribute('value', String(view.percent));
    }
  }

  sb.onUpdateAvailable((i) => {
    info = i;
    render(window.updateDownloadState.viewFor(null, info));
    banner.classList.add('show');
  });
  sb.onUpdateStatus((s) => {
    // Feedback for the manual "Check for Updates…" menu item.
    if (s.state === 'up-to-date') {
      text.textContent = `You're up to date (v${s.version}).`;
      dlBtn.hidden = true;
      progress.hidden = true;
      banner.classList.add('show');
      setTimeout(() => banner.classList.remove('show'), 4000);
    } else if (s.state === 'error') {
      text.textContent = 'Could not check for updates. Try again later.';
      dlBtn.hidden = true;
      progress.hidden = true;
      banner.classList.add('show');
      setTimeout(() => banner.classList.remove('show'), 5000);
    }
  });
  sb.onUpdateDownloadStatus((s) => {
    if (!info) return;
    render(window.updateDownloadState.viewFor(s.state === 'cancelled' ? null : s, info));
  });
  dlBtn.addEventListener('click', () => {
    if (currentAction === 'install') sb.installUpdate();
    else sb.downloadUpdate();
  });
  document.getElementById('update-dismiss-btn').addEventListener('click', () => banner.classList.remove('show'));
})();

/* ══ Settings dialog (#76, #91, #204) ══ */
// SettingsPanel.tsx now owns the whole dialog — Storage and About tabs, Save
// (TD-001 slice 3, #421; combined into one tabbed modal by #204). This
// section keeps the header gear button wired to settingsStore.

function aiEl(id) { return document.getElementById(id); }

/* ══ Feedback dialog (#144, in-app submission #472) ══ */
// Send now POSTs message + category + optional contact email via
// window.soundBuddy.submitFeedback (validated/built by window.feedbackForm,
// #472's pure logic module). The checkbox stays local-only: it reveals the
// log file in Finder at check-time so the user can attach it to a support
// email themselves — it is never uploaded automatically.
const FEEDBACK_DIAG_REVEALED_TEXT = 'Your log file is now selected in Finder. It is never uploaded — attach it to an email to support@soundbuddy.online if you’d like us to see it.';
const FEEDBACK_DIAG_MISSING_TEXT = 'No diagnostic log exists yet — try again after using the app.';
const FEEDBACK_DIAG_ERROR_TEXT = 'Could not reveal your log file — try unchecking and checking the box again.';
const FEEDBACK_SUCCESS_CLOSE_DELAY_MS = 1200;

let feedbackCategoriesPopulated = false;

function populateFeedbackCategories() {
  if (feedbackCategoriesPopulated) return;
  const select = aiEl('feedback-category');
  select.innerHTML = window.feedbackForm.CATEGORIES.map(
    (c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)}</option>`
  ).join('');
  feedbackCategoriesPopulated = true;
}

function setFeedbackStatus(text) {
  aiEl('feedback-status').textContent = text || '';
}

function openFeedbackDialog() {
  populateFeedbackCategories();
  aiEl('feedback-category').value = 'bug';
  aiEl('feedback-message').value = '';
  aiEl('feedback-email').value = '';
  aiEl('feedback-attach-diagnostics').checked = false;
  aiEl('feedback-dialog-email-instead').style.display = 'none';
  aiEl('feedback-dialog-send').disabled = false;
  const hint = aiEl('feedback-diag-hint');
  hint.style.display = 'none';
  hint.textContent = '';
  setFeedbackStatus('');
  aiEl('feedback-dialog').style.display = 'flex';
}

function closeFeedbackDialog() {
  aiEl('feedback-dialog').style.display = 'none';
}

async function onFeedbackAttachToggle() {
  const checkbox = aiEl('feedback-attach-diagnostics');
  const hint = aiEl('feedback-diag-hint');
  if (!checkbox.checked) {
    hint.style.display = 'none';
    return;
  }
  let r;
  try { r = await window.soundBuddy.revealDiagnostics(); }
  catch { r = null; }
  // The checkbox may have been unchecked again while the reveal was in flight.
  if (!checkbox.checked) return;
  // Distinguish "no log file yet" (r.missing) from an unexpected IPC/main-process
  // failure (r is null/malformed) — mislabeling the latter as "no log yet" would
  // send the user chasing app activity instead of retrying the checkbox.
  if (r && r.revealed) hint.textContent = FEEDBACK_DIAG_REVEALED_TEXT;
  else if (r && r.missing) hint.textContent = FEEDBACK_DIAG_MISSING_TEXT;
  else hint.textContent = FEEDBACK_DIAG_ERROR_TEXT;
  hint.style.display = '';
}

function feedbackEmailInstead() {
  void window.soundBuddy.openFeedback();
  closeFeedbackDialog();
}

async function sendFeedback() {
  const fb = window.feedbackForm;
  const raw = {
    message: aiEl('feedback-message').value,
    category: aiEl('feedback-category').value,
    contactEmail: aiEl('feedback-email').value,
  };

  const validation = fb.validate(raw);
  if (!validation.ok) {
    setFeedbackStatus(validation.error);
    return;
  }

  aiEl('feedback-dialog-send').disabled = true;
  aiEl('feedback-dialog-email-instead').style.display = 'none';
  setFeedbackStatus('Sending…');

  let result;
  try {
    result = await window.soundBuddy.submitFeedback(fb.buildSubmission(raw));
  } catch {
    result = {
      ok: false,
      retryable: true,
      error: 'Could not reach the feedback service — check your internet connection and try again.',
    };
  }

  if (result && result.ok) {
    setFeedbackStatus(fb.resultStatus(result).text);
    setTimeout(closeFeedbackDialog, FEEDBACK_SUCCESS_CLOSE_DELAY_MS);
    return;
  }

  const status = fb.resultStatus(result);
  setFeedbackStatus(status.text);
  aiEl('feedback-dialog-send').disabled = false;
  aiEl('feedback-dialog-email-instead').style.display = status.retryable ? 'none' : '';
}

(() => {
  aiEl('feedback-dialog-cancel').addEventListener('click', closeFeedbackDialog);
  aiEl('feedback-dialog-send').addEventListener('click', sendFeedback);
  aiEl('feedback-dialog-email-instead').addEventListener('click', feedbackEmailInstead);
  aiEl('feedback-attach-diagnostics').addEventListener('change', onFeedbackAttachToggle);
  aiEl('feedback-dialog').addEventListener('click', (e) => { if (e.target === aiEl('feedback-dialog')) closeFeedbackDialog(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && aiEl('feedback-dialog').style.display !== 'none') closeFeedbackDialog();
  });
  window.soundBuddy.onOpenFeedbackDialog(() => openFeedbackDialog());
})();

/* ══ Actionable path to grading a real service (#142, reworked #295) ══ */
function openGuideDialog() {
  aiEl('guide-paths').innerHTML = window.gradeOwnState.pathsHtml(escapeHtml);
  aiEl('guide-dialog').style.display = 'flex';
}

function closeGuideDialog() {
  aiEl('guide-dialog').style.display = 'none';
}

// Mirrors the onboarding "pick your own file" path (see runFirstAnalysis
// above): no tab switch needed here since the CTA lives in the Report Card
// toolbar, so the card is already on screen — a fresh analysis wins it by
// the #147 priority rules.
async function gradeOwnChooseFile() {
  let fp;
  try { fp = await sb.openFileDialog(); } catch { return; }
  if (!fp) return;
  closeGuideDialog();
  loadFile(fp);
  await runFileAnalysis(fp);
}

(() => {
  // grade-own-btn's listener moved to ReportCardToolbar.tsx's onClick (TD-001
  // slice 6e, #703) — window.inlineDialogs.openGradeOwnGuide bridges this
  // function for it, since the button is now a React-rendered element.
  aiEl('guide-dialog-close').addEventListener('click', closeGuideDialog);
  aiEl('guide-choose-file').addEventListener('click', gradeOwnChooseFile);
  aiEl('guide-dialog-open-site').addEventListener('click', () => {
    // openCaptureGuide returns a Promise (ipcRenderer.invoke); swallow both a
    // synchronous throw (preload missing) and an async rejection so a failed
    // open never surfaces as an unhandled rejection (mirrors openCheckout).
    try { sb.openCaptureGuide()?.catch(() => {}); } catch { /* preload missing */ }
    closeGuideDialog();
  });
  aiEl('guide-paths').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-guide-path]');
    if (!btn) return;
    const action = window.gradeOwnState.ctaAction(btn.dataset.guidePath);
    if (action === 'choose-file') {
      gradeOwnChooseFile();
    } else if (action === 'open-guide') {
      try { sb.openCaptureGuide()?.catch(() => {}); } catch { /* preload missing */ }
      closeGuideDialog();
    }
  });
  aiEl('guide-dialog').addEventListener('click', (e) => { if (e.target === aiEl('guide-dialog')) closeGuideDialog(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && aiEl('guide-dialog').style.display !== 'none') closeGuideDialog();
  });
})();

/* ══ Doubling/Phase Bug Detector guided checklist (#370) ══ */
function renderPhaseDoublingStep() {
  const { getStep, stepCount, stepHtml, progressDotsHtml, isLastStep } = window.phaseDoublingState;
  const total = stepCount();
  aiEl('phase-doubling-body').innerHTML = stepHtml(getStep(phaseDoublingStep), phaseDoublingStep, total, escapeHtml);
  aiEl('phase-doubling-progress').innerHTML = progressDotsHtml(phaseDoublingStep, total);
  aiEl('phase-doubling-back').disabled = phaseDoublingStep === 0;
  aiEl('phase-doubling-next').style.display = isLastStep(phaseDoublingStep) ? 'none' : '';
}

// Reached via window.inlineDialogs.openPhaseDoublingDialog (ReportCard.tsx's
// button, TD-001 slice 4, #422) instead of a static listener.
function openPhaseDoublingDialog() {
  phaseDoublingStep = 0;
  const src = window.reportCardChrome.getReportCardSource(curAnalysis(), anaStore.getState().liveSource);
  aiEl('phase-doubling-context').innerHTML = window.phaseDoublingState.contextLineHtml(
    src ? { filename: src.filename, detected: rcCallouts().phaseSignal } : null, escapeHtml);
  renderPhaseDoublingStep();
  aiEl('phase-doubling-dialog').style.display = 'flex';
}

function closePhaseDoublingDialog() {
  aiEl('phase-doubling-dialog').style.display = 'none';
}

// #263: one-click "save this mix's tone as your target" from the report-card
// CTA. Reuses idealProfilesStore's saveMeasured — the exact
// profileFromMeasuredCurve → upsert → persist path the "Create new curve…"
// capture button uses; no new curve logic (TD-001 slice 6b, #700). Auto-names
// the profile from the current recording (deterministic id → re-click updates it).
async function saveMixAsTarget() {
  const analysis = curAnalysis();
  if (!analysis || !hasUsableCurve(analysis.spectrum || {})) return false;
  const src = window.reportCardChrome.getReportCardSource(curAnalysis(), anaStore.getState().liveSource);
  const meta = strongMixTargetMeta(src ? src.filename : '');
  return window.rendererStores.idealProfiles.getState().saveMeasured(analysis.spectrum.curve, meta);
}

// Bridges ReportCard.tsx's phase-doubling/feedback-ringout callout buttons to
// the still-inline dialogs they open (TD-001 slice 4, #422).
// openFeedbackDialog/openGuideDialog (TD-001 slice 6e, #703) join this
// bridge for ReportCardToolbar.tsx's Send Feedback / Grade-own buttons.
window.inlineDialogs = { openPhaseDoublingDialog, openFeedbackRingout, saveMixAsTarget, openBuildGuide, openFeedbackDialog, openGradeOwnGuide: openGuideDialog };

(() => {
  aiEl('phase-doubling-close').addEventListener('click', closePhaseDoublingDialog);
  aiEl('phase-doubling-next').addEventListener('click', () => {
    phaseDoublingStep = window.phaseDoublingState.clampIndex(phaseDoublingStep + 1);
    renderPhaseDoublingStep();
  });
  aiEl('phase-doubling-back').addEventListener('click', () => {
    phaseDoublingStep = window.phaseDoublingState.clampIndex(phaseDoublingStep - 1);
    renderPhaseDoublingStep();
  });
  aiEl('phase-doubling-dialog').addEventListener('click', (e) => { if (e.target === aiEl('phase-doubling-dialog')) closePhaseDoublingDialog(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && aiEl('phase-doubling-dialog').style.display !== 'none') closePhaseDoublingDialog();
  });
})();

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
  // Experimental DAW workspace gate (#516): body class is the entry point
  // #517's workspace shell mounts against. Absent by default — the existing
  // Live Capture UI is untouched until the user opts in.
  let dawWorkspaceWasEnabled = false;
  setStore.subscribe((s) => {
    const nowEnabled = window.dawWorkspaceState.isEnabled(s.settings);
    document.body.classList.toggle('daw-workspace', nowEnabled);
    // Re-render the Live pane immediately on an actual flip so the shell swaps
    // in/out without requiring a tab switch — but not on every settings save,
    // or an unrelated save with the toggle unchanged would clobber the pane.
    if (nowEnabled !== dawWorkspaceWasEnabled && lcStore.getState().appMode === 'live') window.modeSwitch.applySpectrumForMode('live');
    dawWorkspaceWasEnabled = nowEnabled;
  });
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
  // flows from bridge.ts's settings subscription (TD-001 slice 6b, #700).
  // Reflect the effective default record folder (#482) now that settings have
  // loaded — root-markup.html's static text is only the cold-boot placeholder.
  if (!recordDir) document.getElementById('record-folder-path').textContent = defaultRecordFolderText();
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
loadDevices().then(
  window.rendererStores.rig.getState().loadRigs,
  window.rendererStores.rig.getState().loadRigs,
);

// First-run onboarding (#69): show the welcome overlay on a genuine first launch.
void initOnboarding();

// What's-new note (#271): credit shipped, user-requested items after an update.
void initWhatsNew();
