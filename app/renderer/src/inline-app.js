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
// Focused input (#525) + coaching stability state (#612) moved onto
// liveCaptureStore by slice 6g (#710) so the React adjustments panel reads/
// writes them through store actions (setFocusedInputIndex/advanceLapCoaching/
// applyLapAction/resetLapCoaching).
// ReportCardToolbar.tsx's Clear button (TD-001 slice 6e, #703) needs to reset
// lapCoaching — the bridge now delegates to the store (slice 6g, #710).
window.liveCoaching = { reset: () => lcStore.getState().resetLapCoaching() };
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
// #776: set by window.liveCaptureRuntime.onResumeMonitoringStart() immediately
// before the automatic monitor-resume that follows a record stop. onCaptureStarting
// consumes it: a resume must preserve the just-shown post-record session offers
// (rec-offer/rc-offer/rc-not-enough/live-rc-cue) instead of clearing them the way
// a fresh user-initiated session does.
let resumeMonitoringStart = false;

// #776: the just-frozen session report-card source (onCaptureStopped's
// anaStore.setLiveSource(sessionSrc)), stashed only across an auto-resume.
// The resume's startCapture() synchronously resets liveCaptureStore.liveWindows
// to [], which fires bridge.ts's cross-store subscription and re-derives
// analysisStore.liveSource from that now-empty rolling buffer — clobbering the
// frozen card before the user ever sees it. onCaptureStarting's resume branch
// restores this right after that clobber. Consumed once, like resumeMonitoringStart.
let frozenLiveSourceForResume = null;

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

  // #710: the board/EQ/stats surface is React-rendered now (LiveCapturePanel/
  // LiveEqPane/LiveStatsRow subscribe to the store's discrete fields), so the
  // old synchronous renderWorkspace repaint branch is gone.
}
syncLiveCaptureMirror(lcStore.getState());
lcStore.subscribe(syncLiveCaptureMirror);

// rcFeedbackPeak/rcPhaseSignal used to be module vars set by renderReportCard();
// ReportCardIsland (React) now computes them each render and seeds
// window.rcCallouts from a passive effect (TD-001 slice 4, #422) — read that
// instead (see openFeedbackRingout below).
function rcCallouts() { return window.rcCallouts || { feedbackPeak: null, phaseSignal: false }; }

/* ══ Formatting helpers ══ */
// (#710) stripLabel() moved to live-board.ts (resolveStripName) — the inline
// name-edit wiring that used it moved to LiveCapturePanel.tsx. liveChannelAt()
// stays: the window-tick handler's coaching focus view still resolves names.
// The backend live channel for a strip index (or null before any tick), so the
// label fallback resolves the same way from every call site (#39).
function liveChannelAt(idx) { return lastLiveChannels ? lastLiveChannels[idx] : null; }
// fmtDur is now bridged from spectrum-display.ts (see the window.spectrumDisplay
// destructure below) — extracted alongside heatmapSVG/miniCurveSVG/timeAxisHTML
// (TD-001 slice 4, #422).

/* ══ Band metadata / meter geometry — extracted to spectrum-display.ts (#305),
   bridged onto window by App.tsx like audioEngineProfiles (#309). ══ */
// (#710) Most of spectrumDisplay's bindings moved out with the deleted
// renderers (per-strip charts, EQ pane, stats row, DAW shell) — only what
// remains is destructured.
const {
  escapeHtml, hasUsableCurve,
} = window.spectrumDisplay;

// SPECTRUM_TITLE (TD-001 slice 6a, #695) — inline-app.js still writes
// #spectrum-title directly for the not-yet-migrated live/soundcheck meter
// modes; spectrum-chrome.ts's spectrumChromeView owns it everywhere else.
const { SPECTRUM_TITLE } = window.spectrumChrome;

/* ══ Live-capture panel rendering — extracted to live-capture-panel.ts (#307),
   bridged onto window by App.tsx like spectrumDisplay/reportCard. ══ */
// (#710) The board/EQ-pane/stats HTML builders (liveMetersHTML/eqPaneHTML/
// veqArcSVG/…) moved out with the deleted renderers — the pure view + patch
// modules (live-capture-panel.ts/live-board.ts) own them now.
const {
  deviceChannelCount,
  shouldOfferReportCard,
  normalizeMeasurementSource, measurementSourceAfterRemove,
  measurementSourceOptionLabel,
  liveSessionReportCardSource,
  clampEqPaneWidth, EQ_PANE_RESIZE_STEP,
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
// LiveWorkspace.tsx's live-meter-controller (TD-001 slice 6c, #701, extended
// #710), driven by liveCaptureStore's lastTick rather than this file's own
// rAF batching — its patch() drives live-board.ts's patch appliers directly.

// patchLiveChannel (the per-strip DOM applier) is now the pure version bridged
// in from live-capture-panel.ts (#668) — strips no longer carry their own
// chart, so there's nothing left for this file's copy to do that the pure
// module doesn't already cover via stripViewAt's `selected`/level-fill fields.

// ══ Live-workspace board + docked EQ pane + stats row (slice 6g, #710) ══
// renderLiveWorkspace/renderLiveMeters/renderEqPane/patchEqPaneSection/
// currentEqPaneChannels/liveWorkspaceToolbarHTML/liveSetupStepsHTML/
// liveSetupStepsView/renderDawShell/stripViewAt/livePanelView/lapFocusView/
// lapObservationContext/applyLiveGroupCollapsed/selectStrip/wireLiveNameEdit/
// setStat/updateStatsRow/updateLiveStatsRow and the live-adjustments-panel + window.liveWorkspaceRuntime wiring all moved to the React components +
// live-board.ts (LiveCapturePanel/LiveEqPane/LiveStatsRow, driven by
// liveCaptureStore; per-tick values patched by live-board.ts's appliers on
// LiveWorkspace's live-meter-controller, ADR-0005). This script keeps the
// capture-config CRUD handlers (add/remove/arm/group/kind/source/reorder) and
// the capture lifecycle (6i), DAW playhead/waveform (6j), and secondary-room
// badge (6k) — but no inline listener drives the board/EQ/stats surface.

document.getElementById('spectrum-body').addEventListener('click', (e) => {
  // #710: the #live-setup-skip dismiss, [data-lap-action] dispositions, and
  // strip-selection branches moved to LiveCapturePanel's delegated handlers.
  // Workspace Add track (#188). Delegated (rather than re-wired per render) so
  // it survives the React board re-renders below.
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
  // row (replaces #41's collapse-every-member behavior). (#710) The collapse
  // classes are React-rendered from channelGroups (liveMetersHTML already
  // encodes header .collapsed/aria-expanded + member .group-collapsed), so the
  // old imperative applyLiveGroupCollapsed() applier is gone.
  const gfold = e.target.closest('.live-group-fold');
  if (gfold) {
    const g = parseInt(gfold.closest('.live-group-head').dataset.group, 10);
    lcStore.getState().toggleGroupCollapse(g);
    return;
  }
  // (#710) Strip selection (#668) moved to LiveCapturePanel's delegated click
  // handler (the board does not subscribe to selectedChannel).
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
// (#710) Strip selection via keyboard (Enter/Space) moved to
// LiveCapturePanel's delegated keydown handler.
document.getElementById('spectrum-body').addEventListener('keydown', (e) => {
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
// survives the React board re-renders. Routes through renderChannelConfig()
// (not a bare re-render) so the capture lock and the workspace stay in sync.
// (#710) The .lap-focus-select focused-input branch moved to LiveCapturePanel.
document.getElementById('spectrum-body').addEventListener('change', (e) => {
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

// (#710) wireLiveNameEdit + the stats-row writers (setStat/updateStatsRow/
// updateLiveStatsRow + window.updateStatsRow) moved to LiveCapturePanel.tsx +
// live-board.ts (LiveStatsRow renders the cells; live-board.ts's patchStatsRow
// patches them at meter cadence).

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
   session can be recorded again. Both store writes are picked up by
   syncLiveCaptureMirror's subscription (board repaint) — no inline wrapper
   function is called from here anymore. */
// Inline "arm at least one strip" hint near the Start button (#43).
function showArmHint(msg) { const h = document.getElementById('arm-hint'); h.textContent = msg; h.style.display = 'block'; }
function hideArmHint() { const h = document.getElementById('arm-hint'); if (h) h.style.display = 'none'; }

// The header #live-indicator (LIVE/REC pill) + #live-status text, driven by
// window.liveTransitionState's pure phase model (#458) from the raw
// liveRunning/liveMode/capturePromoting flags. The TRANSPORT BUTTON itself is
// React-owned now (RecordButton.tsx + record-transport.ts, #729) and derives
// the same phase independently; this keeps the two remaining out-of-scope
// pieces (the header pill, sitting outside #tab-live; the status line, shared
// with rig-error text) in sync.
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
// platform default — mirrors ipc/shared.ts's defaultRecordDir(). LiveSourceSettings.tsx
// carries its own copy of this same logic for its React-owned #record-folder-path
// rendering (#727); this one is still used by the boot sequence
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
// atomically — focusedInputIndex (#525, store-owned since #710) needs the same
// reindex here.
function removeChannelStrip(idx) {
  lcStore.getState().setFocusedInputIndex(measurementSourceAfterRemove(lcStore.getState().focusedInputIndex, idx));
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
  lcStore.getState().setFocusedInputIndex(null);
  // A stale lastLiveChannels from the previous device must not leak into the
  // EQ pane (#668) — it has to be cleared here too.
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
  // #460: the badge reads the Room feed — the board strip by default, the
  // secondary mic when the experimental source is active. roomFeed() returns
  // the board badge unchanged when the flag is off, so this is byte-identical.
  document.getElementById('measurement-badge').textContent = roomFeed().badge;
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
// device-refresh-btn/record-folder-btn are React-owned now
// (LiveSourceSettings.tsx) and derive `disabled` from isCapturing directly —
// not swept here (#727) — #meter-interval/#window-secs are React-owned now
// (CaptureCadenceControls.tsx, #725) and derive `disabled` from isCapturing
// directly — not swept here either — and the old #live-mode buttons are gone
// entirely (#757).
function setCaptureControlsLocked(locked) {
  const set = (el) => { if (el) { el.disabled = locked; el.setAttribute('aria-disabled', String(locked)); } };
  ['rig-select',
    'live-ws-add', 'live-ws-new-group'].forEach((id) => set(document.getElementById(id)));
  // Workspace track rows (#188): Add track (above) + each row's remove, read-only
  // while a capture is running.
  document.querySelectorAll('#spectrum-body .live-ch-x').forEach(set);
  // Workspace per-track arm toggle + Arm all / Disarm all (#191, #757):
  // record-enable stays LIVE while a MONITOR session runs — the tab is
  // always-monitoring and arming only matters at promote time, so an engineer
  // who pressed Record with nothing armed (promote blocked, #arm-hint) can
  // arm and press again without being stuck. The arm controls freeze only once
  // the session is actually RECORDING (promoteToRecording re-asserts the lock
  // right after flipping liveMode to 'record'). The workspace sits outside
  // #tab-live, so this explicit sweep is required either way.
  const armLocked = locked && liveMode === 'record';
  ['live-ws-arm-all', 'live-ws-disarm-all'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) { el.disabled = armLocked; el.setAttribute('aria-disabled', String(armLocked)); }
  });
  document.querySelectorAll('#spectrum-body .live-ch-arm').forEach((el) => {
    el.disabled = armLocked;
    el.setAttribute('aria-disabled', String(armLocked));
  });
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

// Device <select>/refresh button/hint are React-owned now (LiveSourceSettings.tsx,
// #727) — this fetches the list and hands it to the store
// (which itself seeds channelConfig/channelGroups for the resolved device),
// then re-runs the inline-only remainder of the old reset (lastLiveChannels/
// preflight — see resetChannelConfig).
async function loadDevices() {
  await lcStore.getState().loadDevices();
  // Seed the channel picker from the (default) device's channel count — only
  // once devices were actually found (mirrors the original early returns that
  // skipped this on every non-happy branch).
  if (lcStore.getState().devices.length) resetChannelConfig();
}

// Bridged runtime powering LiveSourceSettings.tsx's device/measurement-source/
// record-folder controls and RecordButton.tsx's recordCapture/stopLiveCapture
// (TD-001 slice 6c #701, #727, #729; #757 removed the mode/start-stop controls
// this used to power) — the heavier orchestration (validation, playhead/
// waveform/rig-lock/lapCoaching/session-offer side effects) stays here rather
// than moving into React, since it's still tightly coupled to the
// not-yet-migrated DAW shell/live-adjustments/preflight/rig surfaces (see the
// ADR in the #701 plan).
window.liveCaptureRuntime = {
  loadDevices,
  selectDevice(value) {
    void value; // store.selectDevice (called by LiveSourceSettings itself) already reseeds channelConfig/channelGroups reactively
    lcStore.getState().setFocusedInputIndex(null);
    lcStore.getState().clearLastLiveChannels();
    // PreflightSettings.tsx recomputes reactively off liveCaptureStore's
    // selectedDevice/channelConfig/devices — no imperative repaint needed
    // here (TD-001 slice 6d, #702).
  },
  // Measurement source picker (#456): normalize against the current strip
  // count so a stale selection ('' -> null, an index -> the resolved strip)
  // never lands in the store.
  // Measurement source picker (#456): normalize against the current strip
  // count so a stale selection ('' -> null, an index -> the resolved strip)
  // never lands in the store. (#710) The EQ pane re-renders reactively from
  // measurementSource (LiveEqPane) — no renderEqPane call.
  changeMeasurementSource(value) {
    const parsed = value === '' ? null : parseInt(value, 10);
    lcStore.getState().setMeasurementSource(normalizeMeasurementSource(parsed, channelConfig.length));
    renderMeasurementBadge();
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
  onResumeMonitoringStart() { resumeMonitoringStart = true; },
  promoteToRecording,
  afterSecondaryMeasurementChange: afterSecondaryStateChange,
};

// (#710) window.liveWorkspaceRuntime is gone: the board/EQ/stats surface is
// React-rendered (LiveCapturePanel/LiveEqPane/LiveStatsRow) and LiveWorkspace's
// live-meter-controller drives live-board.ts's patch appliers directly. This
// one bridge stays for the React DAW-shell branch's post-render repaint (the
// 6j playhead/waveform renderers stay here).
window.liveDawShellRepaint = () => { renderDawPlayhead(); renderDawWaveform(); };

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

// The capture transport is React-owned now (#729, #757): RecordButton.tsx's
// top-bar Record button is the sole control — an idle press routes through
// recordCapture() (LiveControls.tsx), which starts monitoring first then
// promotes (#458); a Recording press routes through stopLiveCapture(). Both
// delegate the payload+IPC round trip (which already builds the exact same
// request this file's old inline handler did — device/channels/mode/
// recordDir/arm/labels — from store state) and the surrounding side effects
// to the beforeStartCapture/onCaptureStarting/onCaptureStarted/
// onCaptureStopping/onCaptureStopped functions below via the
// window.liveCaptureRuntime bridge (see LiveControls.tsx's
// startLiveCapture()/stopLiveCapture() for the exact call ordering — it
// mirrors this file's old liveRunning=true-then-await-then-handle-result
// shape precisely, since store.startCapture()/stopCapture() flip isCapturing
// synchronously before their own await point).

// No configured tracks (#188): the workspace remove can drive channelConfig
// to zero, but stream.py silently falls back to its first device channels
// when given an empty channel list — block Start rather than start a
// capture the UI just showed as empty. Record mode with nothing armed would
// spawn an empty session — block that too (#43). (#757) The arm branch is
// now unreachable through the Record button's monitor-start path (recordCapture
// normalizes liveMode to 'monitor' before starting, so this always reads the
// monitor branch), but it stays as a harmless defensive guard for direct
// startLiveCapture callers (auto-start, tests).
function beforeStartCapture() {
  if (channelConfig.length === 0) {
    const reason = 'Add at least one track before starting listening.';
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
  const intervalSecs = lcStore.getState().meterIntervalMs / 1000;
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
  // A new capture must not inherit the previous session's cooldowns or active
  // card (#612) — the store reset re-renders the React adjustments panel.
  lcStore.getState().resetLapCoaching();
  // A live capture always wins over a loaded history entry (#147).
  anaStore.getState().setHistorySummary(null);
  window.rendererStores.rig.getState().setLocked(true);
  setCaptureControlsLocked(true); // freeze device/mode/folder/channels/sliders (#38)

  // #776: a resume (the monitor-restart that follows a record stop) must keep
  // the just-shown post-record session offers on screen — only a fresh
  // user-initiated session clears them. The flag is one-way: consumed here on
  // the first capture start, then back to false.
  if (resumeMonitoringStart) {
    resumeMonitoringStart = false;
    // #776: LiveControls.tsx's startLiveCapture() already called store.startCapture()
    // (liveWindows: []) before invoking this hook — that synchronously fired
    // bridge.ts's cross-store subscription and re-derived (clobbered)
    // analysisStore.liveSource from the now-empty rolling buffer. Undo it.
    if (frozenLiveSourceForResume) {
      anaStore.getState().setLiveSource(frozenLiveSourceForResume);
      frozenLiveSourceForResume = null;
    }
  } else {
    document.getElementById('rec-offer').style.display = 'none';
    document.getElementById('rc-offer').style.display = 'none';
    document.getElementById('rc-not-enough').style.display = 'none';
    document.getElementById('live-rc-cue').style.display = 'none';
  }
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
    specStore.getState().setPanelState('error', (result && result.error) || 'Failed to start live listening');
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
// bridged function (RecordButton's Record press calls it via recordCapture)
// since its guard/backend-swap/failure-recovery shape doesn't decompose into
// the same before/starting/started split Start does.
//
// #757: a bad Record press is blocked INLINE by the preflight checklist first
// (device connected / channel routing in range / baseline match — the same
// pure window.preflight rules the Settings → Audio PreflightSettings panel
// renders), surfacing the failing items' detail strings through #arm-hint.
// With the mode toggle gone there's no separate "record preview" screen to
// catch these, so the guard is the last line of defense before promoting.
function preflightBlockReason() {
  const rigState = window.rendererStores.rig.getState();
  const activeRig = rigState.rigs.find((r) => r.id === rigState.activeRigId) || null;
  const rec = window.rigReconcile.reconcileRigDevice(selectedDeviceName(), liveDevices);
  const items = window.preflight.buildChecklist({
    baseline: activeRig ? activeRig.baseline : null,
    current: window.preflight.snapshotRig(channelConfig, rec.deviceName),
    device: { found: rec.found, name: rec.deviceName, channels: selectedDeviceChannels() },
  });
  const summary = window.preflight.checklistSummary(items);
  if (summary.ready) return null;
  return items.filter((i) => i.status === 'fail').map((i) => i.detail).join(' ');
}

async function promoteToRecording() {
  const preflightReason = preflightBlockReason();
  if (preflightReason) {
    showArmHint(preflightReason);
    return;
  }
  const guard = window.liveTransitionState.canPromoteToRecording({
    liveRunning, liveMode, promoting: capturePromoting, armedCount: armedCount(),
  });
  if (!guard.ok) {
    showArmHint(guard.reason);
    return;
  }
  hideArmHint();

  // #776: promoting an already-running monitor session to a recording never
  // routes through onCaptureStarting() (that path is only for an idle→monitor
  // start) — but since #776's stop-demotes-to-monitoring change, a monitor
  // session can now be running with a PREVIOUS record's stale session offers
  // still on screen (deliberately preserved across that auto-resume). A user-
  // initiated promote is a genuinely new session, so clear them here too.
  document.getElementById('rec-offer').style.display = 'none';
  document.getElementById('rc-offer').style.display = 'none';
  document.getElementById('rc-not-enough').style.display = 'none';
  document.getElementById('live-rc-cue').style.display = 'none';

  lcStore.getState().setPromoting(true);
  lcStore.getState().setLiveMode('record');
  syncCaptureControls();
  // #757: arming stays live while monitoring, so the lock has to be re-
  // asserted here — the monitor start locked config but deliberately left the
  // arm controls enabled; flipping to 'record' is what freezes them.
  setCaptureControlsLocked(true);

  const device = lcStore.getState().selectedDevice || undefined;
  const windowSecs = lcStore.getState().windowSecs;
  const intervalSecs = lcStore.getState().meterIntervalMs / 1000;
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
    specStore.getState().setPanelState('error', result.error || 'Could not start recording. Monitoring stopped — press the Record button to start again.');
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
// for those two internal callers — RecordButton's own Stop press calls
// stopCapture() itself and this/onCaptureStopped via the bridge, see
// LiveControls.tsx's stopLiveCapture()).
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

  // #488/#261: a session that accumulated at least one window builds a
  // session-level Report Card from the whole sessionWindows buffer (every
  // window tick since Start Capture — the capped liveWindows below only
  // keeps the last 10 for the rolling preview), grades it, and persists it
  // to history tagged as a live-capture source — the same hook a file
  // analysis gets. (#757) The old monitor-mode-only gate is gone: with the
  // mode toggle removed, every user-initiated stop is a record session, so a
  // record session's "Session saved" offer (sessionDir above) shows together
  // with this report-card offer — keeping #488/#261 reachable. A session too
  // short/silent to produce usable windows degrades to the "not enough data"
  // state instead of a nonsensical grade.
  if (shouldOfferReportCard(liveWindows.length)) {
    const sessionSrc = liveSessionReportCardSource(sessionWindows, lcStore.getState().measurementSource, channelConfig);
    if (sessionSrc) {
      anaStore.getState().setLiveSource(sessionSrc); // freeze the session card onto the Report Card tab
      frozenLiveSourceForResume = sessionSrc; // #776: survive the auto-resume's liveWindows reset (see onCaptureStarting)
      window.reportCardChrome.persistSummary(sessionSrc, 'live');
      document.getElementById('rc-offer').style.display = 'flex';
      hydrateIcons(document.getElementById('rc-offer'));
    } else {
      showLiveNotEnoughData();
    }
  }
}

// Internal-only orchestration for the two call sites that stop a capture
// without going through RecordButton's own Stop press (a failed
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
  // (#710) The room-analysis stats row is patched by live-board.ts's
  // patchStatsRow on the controller path — no updateLiveStatsRow here.

  // Only the heavier window ticks (which carry masking + window #) accumulate
  // to feed the report card. The coaching advance routes through the store so
  // the React adjustments panel re-renders (the focus view is rebuilt here —
  // lapFocusView moved to live-board.ts, and inline-app.js can't import it).
  if (data.type === 'window' || typeof data.window === 'number') {
    sessionWindows.push(data); // uncapped — see the declaration above (#261)
    document.getElementById('window-badge').textContent = `Window #${data.window}`;
    const ms = lcStore.getState().measurementSource;
    const idx = ms == null ? 0 : ms;
    const focusView = {
      focusedIndex: lcStore.getState().focusedInputIndex,
      inputs: channelConfig.map((strip, i) => ({
        index: i,
        name: window.rigReconcile.resolveStripLabel(strip, liveChannelAt(i), i),
        profile: window.instrumentProfiles.profileById(
          window.instrumentProfiles.effectiveProfileId(
            savedInstrumentProfilesForDevice(), window.armState.stripToken(strip), strip && strip.label)),
      })),
    };
    const candidates = window.liveAdjustmentsState.allCoachingCandidates(liveWindows, ms, focusView);
    const context = window.liveAdjustmentsState.observationContext(
      liveWindows, ms, focusView, measurementSourceOptionLabel(channelConfig[idx], idx));
    lcStore.getState().advanceLapCoaching(candidates, Date.now(), context);
  }
});

/* ══ Secondary measurement device (#460, ADR 0003) ══
   Experimental, default-off room-mic source metered on a SECOND stream.py
   process, fully independent of the board capture. All decision logic lives in
   the pure window.measurementDeviceState module. With the flag off,
   secondaryMeasurementActive() is always false and roomFeed()/
   secondaryRoomOverride() return the board values unchanged, so the app
   renders byte-identically to today (the #602 parity guard). When active, the
   secondary mic owns the Room everywhere: badge, room stats, the graded live
   report-card source, AND the EQ pane's Room slot (the once-deferred visual
   swap — see secondaryRoomOverride below). The device picker, status/warning
   text, and the reconnect-poll scheduling are now React-owned
   (SecondaryMeasurementPanel.tsx, #724) — this block keeps only the
   still-imperative Room-consumer glue. */

// Is a secondary room mic actively measuring (selected, streaming, has data)?
function secondaryMeasurementActive() {
  const s = lcStore.getState();
  return s.secondaryMeasurement.status === 'active' && s.secondaryWindows.length > 0;
}

// The Room feed the badge and live report-card source read: the board strip by
// default, the secondary mic channel 0 when active. Board values when off.
function roomFeed() {
  const s = lcStore.getState();
  return window.measurementDeviceState.roomFeed(
    secondaryMeasurementActive(),
    s.secondaryWindows,
    s.secondaryMeasurement.deviceName,
    liveWindows,
    s.measurementSource,
    channelConfig,
  );
}

// (#710) The EQ pane's Room-slot override (secondaryRoomOverride) moved to
// live-board.ts's patchEqPane/LiveEqPane — no inline renderEqPane call site
// remains.

// Repaint the still-imperative Room badge after a secondary state change
// (device selection/start/stop/reconnect). Status text/warning and the
// reconnect-poll scheduling are now React-owned (SecondaryMeasurementPanel.tsx,
// #724), reading directly off the store — exposed to it via
// window.liveCaptureRuntime.afterSecondaryMeasurementChange. (#710) The EQ
// pane re-renders reactively from secondaryMeasurement (LiveEqPane) +
// patchEqPane on the controller path — no renderEqPane call.
function afterSecondaryStateChange() {
  renderMeasurementBadge();
}

// Bind the store's measurement-event folding, then a thin repaint handler on
// the same channel (registered after the store so state is already updated).
lcStore.getState().bindMeasurementEvents();
sb.onMeasurementEvent((data) => {
  if (!data) return;
  // A disconnect (or any status-carrying event) repaints the badge — status
  // text/reconnect scheduling are React-owned now (#724).
  if (data.measurementEnded) { afterSecondaryStateChange(); return; }
  if (!secondaryMeasurementActive()) return;
  // Active: the secondary mic owns the Room. Refresh the badge on every tick;
  // the room stats row + the EQ pane's Room slot are patched by
  // patchStatsRow/patchEqPane on the controller path (the store's
  // lastMeasurementChannels/secondaryWindows changes they read fire the
  // controller's coalesced patch) — no inline writers here (#710).
  renderMeasurementBadge();
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

// First-run onboarding (#69) is gone — stores/onboardingStore.ts +
// OnboardingDialog.tsx (TD-001 slice 6f, #704) port initOnboarding verbatim.

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

// #372: launch the ring-out wizard from the report card, seeded with the
// detected ring. Reuses the mode-tab click so the transition is the exact
// navigation the user already knows. Reached via
// window.inlineDialogs.openFeedbackRingout (ReportCard.tsx's button,
// TD-001 slice 4, #422) instead of a static listener — see the
// window.inlineDialogs assignment below.
function openFeedbackRingout() {
  const feedbackPeak = rcCallouts().feedbackPeak;
  window.rendererStores.ringout.getState().start(feedbackPeak ? feedbackPeak.freq : null);
  document.querySelector('.mode-tab[data-mode="ringout"]').click();
}

// #545 (epic e17): forward link from the Report Card to the Build Guide —
// the mirror of #build-guide-review's Report-Card link. Reuses the mode-tab
// click so navigation is identical to the user clicking the tab. Reached via
// window.inlineDialogs.openBuildGuide (ReportCard.tsx's flag-on link).
function openBuildGuide() {
  document.querySelector('.mode-tab[data-mode="guide"]').click();
}

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

// Bridges ReportCard.tsx's feedback-ringout callout button to the still-inline
// dialog it opens (TD-001 slice 4, #422); saveMixAsTarget/openBuildGuide join
// it for the report card's other two remaining inline-app.js call sites.
window.inlineDialogs = { openFeedbackRingout, saveMixAsTarget, openBuildGuide };

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

// First-run onboarding (#69) is now App.tsx's
// `void useOnboardingStore.getState().init();` boot call (TD-001 slice 6f, #704).

// What's-new note (#271): credit shipped, user-requested items after an update.
void initWhatsNew();
