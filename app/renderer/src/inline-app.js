// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

'use strict';

/* ══ Icon set + report-card renderers — extracted to report-card.ts (#306),
   bridged onto window by App.tsx like spectrumDisplay (#305). ══ */
const {
  iconSvg, fmt, gradeRingHTML, profileMatchHTML,
  recTypePillClass, recTypePillHTML, buildMetricRows, metricRowsHTML,
  whyGradeHTML, recListHTML, reportCardSourceFromAnalysis,
} = window.reportCard;

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
// The measurement-source selection (#456) lives in liveCaptureStore; this
// script reads/writes it through the store instead of a module-level var.
const lcStore = window.rendererStores.liveCapture;

let currentMode = 'reportcard';
let liveRunning = false;
let liveWindows = [];
// Focused input for the per-input instrument-aware adjustment candidates
// (#525) — ephemeral, per-session only, never persisted.
let focusedInputIndex = null;
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
// Per-strip collapsed state (#40), keyed by strip index. In-memory only for this
// slice (persisting into the rig is deferred). Read on every repaint so an
// incoming meter window never silently re-expands a folded strip.
let liveCollapsed = new Set();
function isStripCollapsed(idx) { return window.collapseState.isCollapsed(liveCollapsed, idx); }
// Named channel groups (#41, #483): [{ name, members:[stripIndex,…], collapsed? }].
// Organizational only — strips render under their group's header in the live
// board; a group header collapses to a compact live-summary row (#483), and
// both group order and per-group member order are drag/keyboard-reorderable.
// Persisted per-device in settings.json (#483, mirroring #482's channelLabels)
// and also saved into rigs (Pro) via captureCurrentRig/applyRig.
let channelGroups = [];
// Drag-reorder source (#483): { type:'group'|'strip', index } set on dragstart,
// cleared on drop/dragend. Module-level because dragover/drop fire on whatever
// element is currently under the pointer, not the element that started the drag.
let liveDragSrc = null;
let lastLiveChannels = null;   // channels from the most recent meter tick (for #39 label fallbacks)
let liveCountdownTimer = null;
let liveCountdownSecs = 0;
let liveDevices = [];          // last device list (for channel-count lookup)
let liveMode = 'monitor';      // 'monitor' | 'record'
let recordDir = '';            // chosen recording folder ('' = default ~/Music/Sound Buddy)
let channelConfig = [];        // configured strips: { kind:'mono'|'stereo', a:idx, b:idx }
let llmRunning = false;
let aiStreamStarted = false;
let idealProfileId = ''; // active ideal EQ profile; '' = auto by content type (PRD 05)
let customIdealProfiles = [];
let curveEditorId = null;
let curveEditorBands = null;
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
  DB_MIN, DB_MAX, BAND_META, EQ_COLS,
  CURVE_VB, CURVE_FMIN, CURVE_FMAX,
  escapeHtml, fmtHz, levelMatchedTarget, niceTicks, smoothPath,
  spectrumCurveSVG, spectrumLegendHTML, bandLevelsFromCurve, bandDbFromSpectrum,
  veqBarsAndLabelsHTML, eqTargetLineSVG, eqCentroidHTML, eqBarsHTML,
  veqLoudestIdx, veqBandView, veqValBottom,
  heatmapSVG, miniCurveSVG, fmtDur, timeAxisHTML, classLabel,
} = window.spectrumDisplay;

/* ══ Live-capture panel rendering — extracted to live-capture-panel.ts (#307),
   bridged onto window by App.tsx like spectrumDisplay/reportCard. ══ */
const {
  LIVE_BAND_KEYS, deviceListView, deviceChannelCount,
  liveBandCurve, veqArcSVG, liveMetersHTML,
  groupSummary, groupSummaryText, shouldOfferReportCard,
  normalizeMeasurementSource, measurementSourceAfterRemove, measurementSourceOptionsHTML,
  measurementChannel, measurementSourceBadgeText,
  liveReportCardSource: lcLiveReportCardSource,
} = window.liveCapturePanel;
// Renamed to avoid colliding with the zero-arg usedChannelCount() wrapper below.
const lcUsedChannelCount = window.liveCapturePanel.usedChannelCount;

/* ══ Opt-in crash reporting (#473) — extracted to crash-hooks.ts, bridged onto
   window by App.tsx like spectrumDisplay/reportCard/liveCapturePanel. Only
   installed when the main process exposes reportRendererError (older mock
   bridges in e2e may not), so a stubbed bridge never breaks. ══ */
const { installCrashHooks } = window.crashHooks;
if (sb.reportRendererError) installCrashHooks(window, (input) => sb.reportRendererError(input));

/* ══ Ideal EQ profiles + comparison (PRD 05) ══
   Data and comparison logic come from @sound-buddy/audio-engine's profiles module
   (packages/audio-engine/src/profiles/index.ts) via the `window.audioEngineProfiles`
   bridge App.tsx sets before these boot scripts run — see #309. This is a classic
   `?raw` script and can't `import`, so it reads the bridge instead of mirroring the
   data by hand. Comparison is level-invariant (mean-subtraction). */
const AE = window.audioEngineProfiles;
const IP_GRID_FREQS = AE.GRID_FREQS;
const IP_PROFILES = AE.PROFILES;
const IP_BY_ID = new Map(IP_PROFILES.map(p => [p.id, p]));
const ipCompare = AE.compareToProfile;
const ipDefaultForContentType = AE.defaultProfileForContentType;
function customProfileId(value) { return String(value || '').startsWith('custom:') ? String(value).slice(7) : ''; }
/** Resolve the profile to compare against: an explicit pick, else auto by content type. */
function activeProfile(spectrum) {
  const customId = customProfileId(idealProfileId);
  if (customId) {
    const custom = customIdealProfiles.find(p => p.id === customId);
    if (custom) return { ...custom, source: 'custom' };
  }
  const id = idealProfileId || ipDefaultForContentType(spectrum && spectrum.contentType);
  return IP_BY_ID.get(id) || IP_BY_ID.get('flat');
}
function ipHasCurve(spectrum) {
  const c = spectrum && spectrum.curve;
  return !!(c && Array.isArray(c.db) && Array.isArray(c.freqs) && c.freqs.length === c.db.length && c.db.length >= 2);
}

// Writes the resolved active profile into spectrumStore so ReportCardIsland
// and SpectrumPanel (React) re-render with it (TD-001 slice 4, #422) —
// replaces the renderSpectrum()/renderReportCard() calls the profile-select
// change handler and curve editor used to make directly.
function syncIdealProfile() {
  const analysis = curAnalysis();
  specStore.getState().setIdealProfile(activeProfile(analysis && analysis.spectrum), !idealProfileId);
}

/* Populate + wire the ideal-profile dropdown (once, at boot). */
function initIdealProfileSelect() {
  const sel = document.getElementById('ideal-profile-select');
  if (!sel) return;
  const customOptions = customIdealProfiles.length
    ? `<optgroup label="Custom">${customIdealProfiles.map(p => `<option value="custom:${escapeHtml(p.id)}">${escapeHtml(p.label)}</option>`).join('')}</optgroup>`
    : '';
  sel.innerHTML =
    `<option value="">Auto (by content)</option>` +
    IP_PROFILES.map(p => `<option value="${p.id}">${p.label}</option>`).join('') +
    customOptions +
    `<option value="__new">Create new curve…</option>`;
  sel.value = idealProfileId;
  if (sel.value !== idealProfileId) {
    idealProfileId = '';
    sel.value = '';
  }
  sel.addEventListener('change', async () => {
    if (sel.value === '__new') { sel.value = idealProfileId; openCurveEditor(); return; }
    idealProfileId = sel.value;
    try { await sb.updateSettings({ idealProfile: idealProfileId }); } catch { /* non-fatal */ }
    syncIdealProfile();
  });
}

/* Show the header dropdown only when a curve is on screen (file/dir mode). */
function updateIdealProfileVisibility(spectrum) {
  const wrap = document.getElementById('ideal-profile-wrap');
  if (!wrap) return;
  wrap.style.display = (ipHasCurve(spectrum) && currentMode !== 'live') ? 'flex' : 'none';
  const sel = document.getElementById('ideal-profile-select');
  if (sel) sel.value = idealProfileId;
}

function refreshIdealProfileSelect() {
  const sel = document.getElementById('ideal-profile-select');
  if (!sel) return;
  const old = sel.cloneNode(false);
  sel.replaceWith(old);
  initIdealProfileSelect();
}

function curveEl(id) { return document.getElementById(id); }
function selectedCustomProfile() {
  const id = customProfileId(idealProfileId);
  return id ? customIdealProfiles.find(p => p.id === id) || null : null;
}

function curveEditorProfileBase() {
  const custom = selectedCustomProfile();
  if (custom) return custom;
  if (idealProfileId && IP_BY_ID.has(idealProfileId)) return IP_BY_ID.get(idealProfileId);
  return activeProfile(curAnalysis() && curAnalysis().spectrum);
}

function setCurveStatus(text, kind) {
  const el = curveEl('curve-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'ai-status' + (kind ? ` ${kind}` : '');
}

function setCurveEditorBands(values) {
  curveEditorBands = values.map(v => window.idealCurves.clampDb(v));
  curveEditorBands.forEach((v, i) => {
    const range = document.querySelector(`.curve-band-range[data-i="${i}"]`);
    const num = document.querySelector(`.curve-band-num[data-i="${i}"]`);
    if (range) range.value = String(v);
    if (num) num.value = v.toFixed(1);
  });
}

function renderCurveEditorRows() {
  const grid = curveEl('curve-editor-grid');
  if (!grid || !window.idealCurves) return;
  grid.innerHTML = BAND_META.map((b, i) => `
    <div class="curve-row">
      <label for="curve-band-${i}">${escapeHtml(b.label)}</label>
      <input id="curve-band-${i}" class="sb-slider curve-band-range" data-i="${i}" type="range" min="-12" max="12" step="0.5" />
      <input class="curve-band-num" data-i="${i}" type="number" min="-12" max="12" step="0.5" aria-label="${escapeHtml(b.label)} offset dB" />
    </div>`).join('');
  grid.querySelectorAll('.curve-band-range').forEach((input) => {
    input.addEventListener('input', (e) => {
      const i = parseInt(e.target.dataset.i, 10);
      curveEditorBands[i] = window.idealCurves.clampDb(e.target.value);
      const num = document.querySelector(`.curve-band-num[data-i="${i}"]`);
      if (num) num.value = curveEditorBands[i].toFixed(1);
    });
  });
  grid.querySelectorAll('.curve-band-num').forEach((input) => {
    input.addEventListener('input', (e) => {
      const i = parseInt(e.target.dataset.i, 10);
      curveEditorBands[i] = window.idealCurves.clampDb(e.target.value);
      const range = document.querySelector(`.curve-band-range[data-i="${i}"]`);
      if (range) range.value = String(curveEditorBands[i]);
    });
  });
}

function openCurveEditor() {
  if (!window.idealCurves) return;
  renderCurveEditorRows();
  const custom = selectedCustomProfile();
  const base = curveEditorProfileBase();
  curveEditorId = custom ? custom.id : null;
  curveEl('curve-dialog-title').textContent = custom ? 'Edit Ideal Curve' : 'Create Ideal Curve';
  curveEl('curve-name').value = custom ? custom.label : `Copy of ${base ? base.label : 'Flat / neutral'}`;
  curveEl('curve-delete-btn').disabled = !custom;
  curveEl('curve-capture-btn').disabled = !(curAnalysis() && ipHasCurve(curAnalysis().spectrum));
  setCurveStatus('', '');
  setCurveEditorBands(window.idealCurves.bandOffsetsFromProfile(base, IP_GRID_FREQS));
  curveEl('curve-dialog').style.display = 'flex';
  curveEl('curve-name').focus();
  curveEl('curve-name').select();
}

function closeCurveEditor() {
  curveEl('curve-dialog').style.display = 'none';
}

async function persistCustomIdealProfiles(nextProfiles, nextIdealProfile) {
  customIdealProfiles = window.idealCurves.normalizeProfiles(nextProfiles, IP_GRID_FREQS);
  idealProfileId = nextIdealProfile;
  try {
    await sb.updateSettings({ customIdealProfiles, idealProfile: idealProfileId });
  } catch {
    setCurveStatus('Could not save curve settings.', 'err');
    return false;
  }
  refreshIdealProfileSelect();
  syncIdealProfile();
  return true;
}

async function saveCurveEditor() {
  const name = curveEl('curve-name').value.trim();
  if (!name) {
    setCurveStatus('Name the curve first.', 'err');
    curveEl('curve-name').focus();
    return;
  }
  const existing = selectedCustomProfile();
  const profile = window.idealCurves.profileFromBands(curveEditorBands, IP_GRID_FREQS, {
    id: curveEditorId || (existing && existing.id),
    label: name,
    description: 'Custom ideal curve',
    createdAt: existing && existing.createdAt,
  });
  const next = window.idealCurves.upsertProfile(customIdealProfiles, profile);
  if (await persistCustomIdealProfiles(next, `custom:${profile.id}`)) closeCurveEditor();
}

async function captureCurrentCurveAsIdeal() {
  const name = curveEl('curve-name').value.trim() || 'Current analysis target';
  if (!(curAnalysis() && ipHasCurve(curAnalysis().spectrum))) {
    setCurveStatus('Analyze a file with spectrum data first.', 'err');
    return;
  }
  const existing = selectedCustomProfile();
  const profile = window.idealCurves.profileFromMeasuredCurve(curAnalysis().spectrum.curve, IP_GRID_FREQS, {
    id: curveEditorId || (existing && existing.id),
    label: name,
    createdAt: existing && existing.createdAt,
  });
  if (!profile) {
    setCurveStatus('This analysis cannot be used as a target.', 'err');
    return;
  }
  setCurveEditorBands(window.idealCurves.bandOffsetsFromProfile(profile, IP_GRID_FREQS));
  const next = window.idealCurves.upsertProfile(customIdealProfiles, profile);
  if (await persistCustomIdealProfiles(next, `custom:${profile.id}`)) closeCurveEditor();
}

async function deleteCurveEditor() {
  const custom = selectedCustomProfile();
  if (!custom) return;
  const next = window.idealCurves.deleteProfile(customIdealProfiles, custom.id);
  if (await persistCustomIdealProfiles(next, '')) closeCurveEditor();
}

/* ══ Spectrum panel rendering ══
   The analysis curve/bars view is now React's SpectrumPanel, driven by
   spectrumStore (TD-001 slice 4, #422); this section keeps driving
   #spectrum-imperative for the empty/loading/error/live-tab states and the
   panel chrome (title/stats/ideal-profile visibility, island toggle) React
   doesn't own — see syncSpectrumChrome below. */
function setSpectrumState(state, opts = {}) {
  const body = document.getElementById('spectrum-imperative');
  // Every setSpectrumState call takes over the panel imperatively — hide the
  // React island (even if spectrumStore still holds a prior analysis's data)
  // so a loading/error/empty/live state never shows a stale curve beside or
  // instead of it. Only syncSpectrumChrome() (a completed analysis or a
  // mode switch back to a data-backed tab) can show the island again.
  body.style.display = '';
  document.getElementById('spectrum-island').style.display = 'none';
  const statsRow = document.getElementById('stats-row');
  statsRow.style.display = state === 'populated' ? 'flex' : 'none';
  const ipWrap = document.getElementById('ideal-profile-wrap');
  if (ipWrap) ipWrap.style.display = 'none';

  if (state === 'empty') {
    body.innerHTML = `<div class="spectrum-empty">${iconSvg('waveform', 44)}<p>${opts.text || 'Load a file to see the spectrum'}</p></div>`;
  } else if (state === 'loading') {
    const stageRow = (stage, label) =>
      `<div class="stage-row" data-stage="${stage}">
        <span class="stage-icon"><span class="stage-spin"></span><span class="stage-check">${iconSvg('check', 14)}</span></span>
        <span class="stage-label">${label}</span>
      </div>`;
    body.innerHTML = `<div class="spectrum-empty">
      <p>Analyzing audio…</p>
      <div class="stage-stepper">
        ${stageRow('reading', 'Reading file')}
        ${stageRow('levels', 'Measuring levels')}
        ${stageRow('spectrum', 'Analyzing spectrum')}
      </div>
      <button type="button" id="analysis-cancel-btn" class="btn btn-secondary sm" data-icon="x">Cancel</button>
    </div>`;
    hydrateIcons(body);
    document.getElementById('analysis-cancel-btn').addEventListener('click', () => { void sb.cancelAnalysis(); });
  } else if (state === 'error') {
    body.innerHTML = `<div class="spectrum-empty" style="color:var(--issue-text)">${iconSvg('alert-triangle', 40)}<p>Analysis failed</p><p class="sub" style="max-width:340px;color:var(--text-tertiary)">${opts.text || 'Couldn’t decode the audio stream.'}</p></div>`;
  }
}

// Panel-header labels. The static markup seeds `curve`; the render paths below
// keep the header in sync with what's actually drawn (curve vs. fallback meters).
const SPECTRUM_TITLE = { curve: 'Spectrum · Curve', meters: 'Spectrum · Meters', live: 'Spectrum · Live EQ', liveStopped: 'Spectrum · Live EQ · Stopped' };

// Shows the analysis spectrum island (React's SpectrumPanel, driven by
// spectrumStore) vs the imperative #spectrum-imperative container based on
// the current tab mode + whether there's spectrum data to show, and keeps
// the title/stats-row/ideal-profile-wrap chrome around the island in sync —
// replaces what renderSpectrum() used to set directly (TD-001 slice 4,
// #422). Idempotent: safe to call from a mode-tab switch, a completed
// analysis, or an ideal-profile change.
function syncSpectrumChrome() {
  const spectrum = specStore.getState().spectrumData;
  const island = document.getElementById('spectrum-island');
  const imperative = document.getElementById('spectrum-imperative');
  const showIsland = !!spectrum && currentMode !== 'live' && currentMode !== 'soundcheck';
  island.style.display = showIsland ? '' : 'none';
  imperative.style.display = showIsland ? 'none' : '';
  if (!showIsland) return;
  document.getElementById('stats-row').style.display = 'flex';
  document.getElementById('spectrum-title').textContent = ipHasCurve(spectrum) ? SPECTRUM_TITLE.curve : SPECTRUM_TITLE.meters;
  updateIdealProfileVisibility(spectrum);
}

// Patch existing bar/value/label DOM in place (the update-time counterpart of
// veqBarsAndLabelsHTML above) — shared by the Live-tab per-channel patch
// (patchLiveChannel) and the playback-band repaint (renderPlaybackBands, AW-4)
// so height/value transitions animate via CSS instead of restarting on every
// repaint, and the two paint paths can't drift out of sync with each other.
function patchBarsAndLabels(container, dbArray) {
  const loudestIdx = veqLoudestIdx(dbArray);
  const vals = container.querySelectorAll('.veq-val');
  container.querySelectorAll('.veq-bar').forEach((bar, i) => {
    const v = veqBandView(dbArray[i]);
    bar.style.height = v.pct.toFixed(2) + '%';
    bar.classList.toggle('loud', i === loudestIdx);
    bar.classList.toggle('dim', v.dim);
    const val = vals[i];
    if (val) {
      val.textContent = v.val;
      val.style.bottom = veqValBottom(v.pct) + '%';
      val.classList.toggle('hot', v.hot);
      val.classList.toggle('dim', v.dim);
    }
  });
  container.querySelectorAll('.veq-label').forEach((lb, i) => lb.classList.toggle('loud', i === loudestIdx));
}
// e2e/legacy compat shim — report-card-grading.spec.ts's "missing spectrum
// curve degrades…" test calls window.renderSpectrum(spectrum) directly to
// drive the no-curve fallback. Routes the raw spectrum object through
// spectrumStore so React's SpectrumPanel renders it (curve-with-target when
// usable, the uniform-bars fallback otherwise — SpectrumDisplay.tsx already
// degrades gracefully, reproducing this function's old two-branch body) and
// refreshes the panel chrome the same way a real analysis landing would.
function renderSpectrum(spectrum) {
  specStore.getState().setSpectrumFromAnalysis({ spectrum });
  syncIdealProfile();
  syncSpectrumChrome();
}

// Coalesce live renders: meter ticks arrive up to ~20/s (and a window tick can
// land in the same burst), but the meter panel only needs to repaint once per
// animation frame. Keep the latest event and rebuild at most once per frame.
let pendingLiveWin = null;
let liveRenderScheduled = false;
function scheduleLiveMeters(win) {
  pendingLiveWin = win;
  if (liveRenderScheduled) return;
  liveRenderScheduled = true;
  requestAnimationFrame(() => {
    liveRenderScheduled = false;
    const w = pendingLiveWin;
    pendingLiveWin = null;
    if (w && currentMode === 'live') renderLiveMeters(w);
  });
}

/* ── Time-sampled spectrum: spectrogram heatmap + scrubber (PRD 03) ──
 * heatmapSVG/miniCurveSVG/timeAxisHTML/classLabel are now bridged in from
 * spectrum-display.ts (see the window.spectrumDisplay destructure above,
 * TD-001 slice 4, #422) — the scrubber itself (below) stays inline and
 * consumes them, same as before. */

// The spectrogram strip + scrubber under the curve. Empty string when frames are
// absent, so the curve renders alone without error.
function buildFramesSectionHTML(spectrum) {
  const frames = spectrum.frames;
  if (!Array.isArray(frames) || frames.length === 0) return '';
  const single = frames.length === 1;
  return `<div class="spectro-scrub">
    <div class="spectro-head">
      <span class="spectro-title">Spectrogram · time →</span>
      <span id="scrub-readout" class="scrub-readout">Whole-file average</span>
      <span class="spectro-hint">${single ? 'single frame — short file' : 'click a column to scrub'}</span>
      <button id="scrub-reset" class="scrub-reset" type="button">${iconSvg('play', 11)}Average</button>
    </div>
    <div class="spectro-transport">
      <button id="spectro-play-btn" class="spectro-play-btn" type="button" aria-label="Play">${iconSvg('play', 13)}</button>
      <span id="spectro-time" class="spectro-time">0:00 / 0:00</span>
    </div>
    <div id="spectrum-heatmap" class="spectro-heat">${heatmapSVG(frames)}<div id="spectro-playhead" class="spectro-playhead"></div></div>
    ${timeAxisHTML(frames)}
  </div>`;
}

/* Scrubber state — redraws the PRD 02 curve (#spectrum-chart) for a frame. */
let sgState = null;
function initSpectrogram(spectrum) {
  // Preserve the scrubbed frame across DOM rebuilds of the SAME analysis (e.g.
  // leaving the file tab and returning). A new analysis resets to the average.
  const carry = sgState && sgState.spectrum === spectrum
    && sgState.selected != null && sgState.selected < spectrum.frames.length
    ? sgState.selected : null;
  sgState = { spectrum, frames: spectrum.frames, selected: carry };
  const heat = document.getElementById('spectrum-heatmap');
  if (heat) heat.addEventListener('click', (e) => {
    const box = heat.getBoundingClientRect();
    if (box.width <= 0) return;
    const nF = sgState.frames.length;
    const i = Math.max(0, Math.min(nF - 1, Math.floor(((e.clientX - box.left) / box.width) * nF)));
    seekPlayback(sgState.frames[i].t);
    // Only pin a static frame when playback isn't actively driving the bars
    // (AW-4, #179) — while playing, renderPlaybackBands already reflects
    // wherever the seek landed on its very next tick, and pinning here too
    // would leave a stale sgState.selected that's wrong the moment playback
    // later advances past it and the user pauses.
    if (!sbAudio || sbAudio.paused) selectFrame(i);
  });
  const reset = document.getElementById('scrub-reset');
  if (reset) reset.addEventListener('click', () => selectFrame(null));
  if (carry != null) renderScrub(); // restore a carried scrub; the average curve is already drawn
  initPlaybackTransport(curAnalysis() && curAnalysis().filePath);
}

// Bridges SpectrumPanel's (React) frames-host effect to the still-inline
// spectrogram scrubber + playback transport (TD-001 slice 4, #422): fills
// the stable #spectrum-frames-host with the scrubber markup and (re)inits it.
window.inlineSpectrum = {
  renderFrames(spectrum) {
    const host = document.getElementById('spectrum-frames-host');
    if (!host) return;
    host.innerHTML = buildFramesSectionHTML(spectrum);
    if (Array.isArray(spectrum.frames) && spectrum.frames.length) initSpectrogram(spectrum);
  },
};

/* ── Playback transport (#180) — HTML5 <audio> over the analyzed file, driving
 * a moving playhead + elapsed/total readout on the spectrogram strip. `sbAudio`
 * persists across re-renders of the SAME file (ideal-profile changes, tab
 * switches) so playback isn't interrupted by unrelated DOM rebuilds. */
let sbAudio = null;
let sbAudioPath = null;
// Bumped on every ensurePlaybackAudio call so a call superseded by a newer one
// (e.g. two analyses started in quick succession) can't win the toFileUrl race
// and stomp sbAudio/sbAudioPath with a stale file's data after a fresher call
// already committed.
let sbGeneration = 0;
async function ensurePlaybackAudio(filePath) {
  if (sbAudioPath === filePath) return sbAudio;
  const gen = ++sbGeneration;
  // toFileUrl is IPC-backed (sandboxed preload can't reach Node's pathToFileURL
  // directly), so this crosses a round-trip before the <audio> element exists.
  const url = await sb.toFileUrl(filePath);
  if (gen !== sbGeneration) return sbAudio; // superseded — a newer call already won
  releasePlaybackAudio();
  // Null when the file is gone (moved/deleted since analysis) — leave sbAudio
  // unset rather than pointing <audio> at a dead path.
  sbAudio = url ? new Audio(url) : null;
  sbAudioPath = filePath;
  if (sbAudio) {
    sbAudio.addEventListener('timeupdate', updatePlaybackReadout);
    sbAudio.addEventListener('loadedmetadata', updatePlaybackReadout);
    sbAudio.addEventListener('play', updateTransportButton);
    sbAudio.addEventListener('play', startPlaybackBandLoop);
    sbAudio.addEventListener('pause', updateTransportButton);
    sbAudio.addEventListener('pause', stopPlaybackBandLoop);
    sbAudio.addEventListener('ended', onPlaybackEnded);
    // An undecodable source (e.g. some AIFF variants sox/ffprobe accept but
    // Chromium's <audio> can't) fails quietly instead of an uncaught rejection.
    sbAudio.addEventListener('error', updateTransportButton);
  }
  return sbAudio;
}
function pauseTransportAudio() {
  if (sbAudio && !sbAudio.paused) sbAudio.pause();
}
// Shared "let go of the current <audio> element" step used both when swapping
// to a new file (ensurePlaybackAudio) and when clearing back to no file (#206),
// so the pause+src-clear+null teardown only lives in one place.
function releasePlaybackAudio() {
  if (sbAudio) { sbAudio.pause(); sbAudio.src = ''; }
  sbAudio = null;
}
async function initPlaybackTransport(filePath) {
  if (!filePath || !document.getElementById('spectro-play-btn')) return;
  await ensurePlaybackAudio(filePath);
  const btn = document.getElementById('spectro-play-btn'); // re-query: DOM may have rebuilt while awaiting
  if (!btn) return;
  // Reads the live sbAudio/sbAudioPath at click time rather than closing over
  // this call's result, so a superseded call's listener still controls
  // whichever file actually won ensurePlaybackAudio's race.
  btn.addEventListener('click', () => {
    if (!sbAudio) return;
    if (sbAudio.paused) sbAudio.play().catch(() => updateTransportButton());
    else sbAudio.pause();
  });
  updateTransportButton();
  updatePlaybackReadout();
}
function updateTransportButton() {
  const btn = document.getElementById('spectro-play-btn');
  if (!btn || !sbAudio) return;
  const playing = !sbAudio.paused && !sbAudio.ended;
  btn.innerHTML = iconSvg(playing ? 'pause' : 'play', 13);
  btn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  btn.classList.toggle('playing', playing);
}
function playbackDuration() {
  if (sbAudio && isFinite(sbAudio.duration) && sbAudio.duration > 0) return sbAudio.duration;
  const fp = curAnalysis() && curAnalysis().ffprobe && curAnalysis().ffprobe.format;
  return (fp && fp.durationSeconds) || 0;
}
function updatePlaybackReadout() {
  if (!sbAudio) return;
  const total = playbackDuration();
  const timeEl = document.getElementById('spectro-time');
  if (timeEl) timeEl.textContent = `${scTime(sbAudio.currentTime)} / ${scTime(total)}`;
  const playhead = document.getElementById('spectro-playhead');
  if (playhead) {
    playhead.style.left = `${total > 0 ? Math.max(0, Math.min(1, sbAudio.currentTime / total)) * 100 : 0}%`;
    playhead.style.display = 'block';
  }
}
function onPlaybackEnded() {
  if (!sbAudio) return;
  sbAudio.currentTime = 0;
  updatePlaybackReadout();
  updateTransportButton();
  stopPlaybackBandLoop(); // some UAs fire 'pause' too, but don't rely on it — this is idempotent
}
function seekPlayback(t) {
  if (!sbAudio) return;
  // Clamp below the real duration: setting currentTime AT duration reads back
  // as "reached the end" to Chromium, which re-fires 'ended' and immediately
  // snaps back to 0 — seeking near the final frame would silently undo itself.
  const duration = playbackDuration();
  sbAudio.currentTime = duration > 0 ? Math.min(t, Math.max(0, duration - 0.05)) : t;
  updatePlaybackReadout();
}
function selectFrame(i) {
  if (!sgState) return;
  sgState.selected = i;
  renderScrub();
}
function renderScrub() {
  if (!sgState) return;
  const { spectrum, frames, selected } = sgState;
  const isAvg = selected == null;
  // Redraw the AW-2 bars: average = spectrum.bands (same values the initial
  // render used); a frame buckets its own db onto the whole-file freq grid.
  const bandDb = isAvg ? bandDbFromSpectrum(spectrum)
    : bandLevelsFromCurve({ freqs: spectrum.curve.freqs, db: frames[selected].db });
  const chart = document.getElementById('spectrum-chart');
  if (chart) {
    // Keep the ideal target overlaid (PRD 05) while scrubbing. The target stays
    // level-matched to the whole-file curve so it reads as a fixed reference the
    // per-frame measured bars move against.
    const target = levelMatchedTarget(spectrum.curve, activeProfile(spectrum));
    const targetBandDb = bandLevelsFromCurve({ freqs: spectrum.curve.freqs, db: target });
    chart.innerHTML = eqBarsHTML(bandDb, targetBandDb);
  }
  const readout = document.getElementById('scrub-readout');
  if (readout) {
    if (isAvg) readout.textContent = 'Whole-file average';
    else {
      const f = frames[selected];
      readout.textContent = `t = ${fmtDur(f.t)} · ${classLabel(f.class)} · RMS ${fmt(f.rms)} dB`;
    }
  }
  const reset = document.getElementById('scrub-reset');
  if (reset) reset.classList.toggle('active', !isAvg);
  const heat = document.getElementById('spectrum-heatmap');
  if (heat) heat.querySelectorAll('.hm-col').forEach(c =>
    c.classList.toggle('sel', !isAvg && parseInt(c.dataset.i, 10) === selected));
}

/* ── Realtime band values during playback (AW-4, #179) ──
 * Sourced entirely from spectrum.frames — the same per-window data the
 * spectrogram/scrubber already carry — so nothing is re-analyzed. Driven by a
 * dedicated rAF loop (started on 'play', stopped on 'pause'/'ended') rather
 * than the audio element's 'timeupdate' (which Chromium throttles to a few
 * Hz), so the loop itself is naturally capped at one repaint per animation
 * frame — the same guarantee scheduleLiveMeters/renderLiveMeters give the
 * Live tab, just achieved by controlling the paint cadence directly instead
 * of coalescing bursty external ticks. */
const PLAYBACK_AVG_WINDOW_SEC = 0.5; // trailing window for the "window avg" readout

// Nearest frame for a playback position — the same t→x proportion the
// heatmap playhead uses (updatePlaybackReadout), so the animated bars always
// match the frame the playhead is currently over.
function frameIndexAtTime(frames, t, total) {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(frames.length - 1, Math.floor((t / total) * frames.length)));
}
// Mean of frame.rms over the trailing [t - windowSec, t] window — "the
// average level over the current playback window" — reusing each frame's
// already-computed RMS rather than deriving a new figure.
function windowAverageRms(frames, t, windowSec) {
  let sum = 0, n = 0;
  for (const f of frames) if (f.t <= t && f.t > t - windowSec && Number.isFinite(f.rms)) { sum += f.rms; n++; }
  return n ? sum / n : null;
}
// Last frame index actually painted by renderPlaybackBands — skips repaint
// work on ticks where the playhead hasn't crossed into a new frame yet
// (frames are typically 100ms+ apart, so most of the ~60/s rAF ticks would
// otherwise recompute and repatch identical output). Reset to -1 whenever a
// playback session (re)starts, so the first tick after a stopPlaybackBandLoop
// repaint (e.g. resuming right where a previous session left off, landing on
// the same frame index) always repaints instead of trusting a stale match.
let lastRenderedFrameIndex = -1;
function renderPlaybackBands(t) {
  if (!sgState || !sgState.frames || !sgState.frames.length) return;
  const { spectrum, frames } = sgState;
  const i = frameIndexAtTime(frames, t, playbackDuration());
  if (i === lastRenderedFrameIndex) return;
  lastRenderedFrameIndex = i;
  const chart = document.getElementById('spectrum-chart');
  if (!chart) return;
  patchBarsAndLabels(chart, bandLevelsFromCurve({ freqs: spectrum.curve.freqs, db: frames[i].db }));
  const avg = windowAverageRms(frames, t, PLAYBACK_AVG_WINDOW_SEC);
  const readout = document.getElementById('scrub-readout');
  if (readout) readout.textContent = classLabel(frames[i].class) + (avg != null ? ` · Window avg ${fmt(avg)} dB` : '');
  const heat = document.getElementById('spectrum-heatmap');
  if (heat) heat.querySelectorAll('.hm-col').forEach(c => c.classList.toggle('sel', parseInt(c.dataset.i, 10) === i));
}
let playbackAnimHandle = null;
function startPlaybackBandLoop() {
  if (playbackAnimHandle != null || !sbAudio || !sgState || !sgState.frames || !sgState.frames.length) return;
  lastRenderedFrameIndex = -1;
  const tick = () => {
    if (!sbAudio || sbAudio.paused || sbAudio.ended) { playbackAnimHandle = null; return; }
    renderPlaybackBands(sbAudio.currentTime);
    playbackAnimHandle = requestAnimationFrame(tick);
  };
  playbackAnimHandle = requestAnimationFrame(tick);
}
function stopPlaybackBandLoop(evt) {
  // 'pause' fires asynchronously (a queued task per the HTML media spec), so
  // the outgoing sbAudio.pause() in ensurePlaybackAudio can still deliver its
  // event after a newer file's Audio instance has already become the global
  // sbAudio and started its own loop. Ignore stale instances' events so they
  // can't cancel a newer file's live loop out from under it (evt is absent
  // for the direct calls from onPlaybackEnded/tick, which always mean it now).
  if (evt && evt.target !== sbAudio) return;
  if (playbackAnimHandle != null) { cancelAnimationFrame(playbackAnimHandle); playbackAnimHandle = null; }
  renderScrub(); // whole-file (or carried scrub) state — dismisses the realtime overlay
}

// Update one channel's existing DOM in place: bars/readouts keep their nodes
// so the CSS transitions actually animate, and the arc SVG keeps its static
// grid/tint/label nodes — only the curve path `d`s and the centroid change.
function patchLiveChannel(el, ch, idx) {
  // Re-assert collapsed state on every patch so a new window keeps folded strips
  // folded (#40). The header — name, RMS/peak, clip — is never hidden, so a
  // collapsed strip still reflects live level and clipping below.
  const collapsed = isStripCollapsed(idx);
  el.classList.toggle('collapsed', collapsed);
  el.classList.toggle('idle', !!ch.idle); // a real tick landing on a prior idle placeholder graduates it
  const foldBtn = el.querySelector('.live-ch-fold');
  if (foldBtn) foldBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  const curve = liveBandCurve(ch.bands);
  const name = el.querySelector('.live-ch-name');
  // Don't clobber the field while the engineer is renaming it in place (#39);
  // the live tick keeps flowing but their caret/text stays put until they commit.
  if (document.activeElement !== name) name.textContent = stripLabel(channelConfig[idx], ch, idx);
  name.classList.toggle('clip', !!ch.clipping);
  el.querySelector('.live-ch-meta').textContent = ch.idle ? 'Idle' : `RMS ${fmt(ch.rms)} · Peak ${fmt(ch.peak)} dBFS`;
  const removeBtn = el.querySelector('.live-ch-x');
  if (removeBtn) removeBtn.disabled = liveRunning;
  const clipEl = el.querySelector('.live-ch-clip');
  // Insert just before the remove button (#188) so CLIP lands in the same spot
  // whether it was there on the first tick (static template order) or shows up
  // later — .live-ch-x carries the head's margin-left:auto right-alignment.
  if (ch.clipping && !clipEl) removeBtn.insertAdjacentHTML('beforebegin', '<span class="live-ch-clip">CLIP</span>');
  else if (!ch.clipping && clipEl) clipEl.remove();

  const arc = veqArcSVG(curve, ch.centroid, idx, true);
  const chart = el.querySelector('.veq-chart');
  const lineEl = chart.querySelector('.sb-curve-line');
  if (arc && lineEl) {
    lineEl.setAttribute('d', arc.line);
    chart.querySelector('.sb-curve-fill').setAttribute('d', arc.area);
    chart.querySelector('.sb-centroid').innerHTML = arc.centroidMark;
  } else {
    chart.innerHTML = arc ? arc.svg : '';
  }

  patchBarsAndLabels(el, curve.db);
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
    + (advanced ? `<button type="button" class="ghost-btn" id="live-collapse-all">Collapse all</button>` : '')
    + (advanced ? `<button type="button" class="ghost-btn" id="live-expand-all">Expand all</button>` : '')
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
  if (window.dawWorkspaceState.showShell(setStore.getState().settings, currentMode)) { renderDawShell(); return; }
  const body = document.getElementById('spectrum-imperative');
  if (!win || !win.channels || win.channels.length === 0) {
    setSpectrumState('empty', { text: 'Waiting for live audio…' });
    return;
  }
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
      if (el) patchLiveChannel(el, ch, i);
    });
    // Refresh each group header's live summary (#483) so a collapsed group still
    // reflects current level/clip without touching collapse state — that's
    // applyLiveCollapsed's job — or rebuilding the DOM.
    channelGroups.forEach((grp, g) => {
      const summaryEl = body.querySelector(`.sb-live-meters .live-group-head[data-group="${g}"] .live-group-summary`);
      if (!summaryEl) return;
      const summary = groupSummary(win.channels, grp.members);
      summaryEl.textContent = groupSummaryText(summary);
      if (summary.clipping) summaryEl.insertAdjacentHTML('beforeend', '<span class="live-ch-clip">CLIP</span>');
    });
    syncLiveAdjustmentsPanel();
    return;
  }
  body.innerHTML = liveWorkspaceToolbarHTML()
    + `<div class="meter-card sb-live-meters">${liveMetersHTML(win.channels, win.channels.map((c, i) => stripViewAt(i, c)), livePanelView())}</div>`;
  body.querySelectorAll('.sb-live-meters .live-ch-name').forEach(wireLiveNameEdit);
  applyLiveCollapsed();
  syncLiveAdjustmentsPanel();
}

// Persistent idle track workspace (#188): the center pane renders
// channelConfig as track lanes the moment the Live tab is active, not only
// once capture starts. Idle lanes are synthetic all-floor channels rendered
// through the same veqChannelHTML/liveMetersHTML path the running board uses,
// so grouping (#41) and per-strip collapse (#40) keep working for free. Shares
// liveWorkspaceToolbarHTML() with renderLiveMeters so Add/remove read
// consistently whether idle or (locked) mid-capture.
function renderLiveWorkspace() {
  if (window.dawWorkspaceState.showShell(setStore.getState().settings, currentMode)) { renderDawShell(); return; }
  const body = document.getElementById('spectrum-imperative');
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
  applyLiveCollapsed();
  syncLiveAdjustmentsPanel();
}

// Experimental live adjustments area (#522): ensure the placeholder panel's
// presence in the Live pane matches the toggle. Called from every Live
// render path — including the patch-in-place branches, so a mid-capture
// settings flip adds/removes the panel without a rebuild.
function syncLiveAdjustmentsPanel() {
  const body = document.getElementById('spectrum-imperative');
  const html = window.liveAdjustmentsState.panelHTML(
    setStore.getState().settings, currentMode, liveWindows, lcStore.getState().measurementSource, lapFocusView());
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
  const body = document.getElementById('spectrum-imperative');
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
    collapsed: isStripCollapsed(idx),
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

// Collapse controls (#40). One delegated listener on #spectrum-body survives the
// meter card's rebuilds and covers the per-strip chevrons plus the toolbar's
// Collapse all / Expand all. Toggling only rewrites .collapsed on the existing
// DOM (no full re-render), so it's instant and doesn't disturb the rAF repaint.
function applyLiveCollapsed() {
  const wrap = document.querySelector('#spectrum-body .sb-live-meters');
  if (!wrap) return;
  wrap.querySelectorAll('.live-ch').forEach((el) => {
    const idx = parseInt(el.dataset.ch, 10);
    const collapsed = isStripCollapsed(idx);
    el.classList.toggle('collapsed', collapsed);
    const btn = el.querySelector('.live-ch-fold');
    if (btn) btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    // A collapsed GROUP hides the member strip entirely (#483) — distinct from
    // the per-strip fold above, which only compacts its own header.
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
    channelConfig[idx].armed = !window.armState.isArmed(channelConfig[idx]);
    hideArmHint();
    renderChannelConfig();
    return;
  }
  // Workspace Arm all / Disarm all (#191).
  if (e.target.closest('#live-ws-arm-all')) {
    channelConfig = window.armState.setAllArmed(channelConfig, true);
    hideArmHint();
    renderChannelConfig();
    return;
  }
  if (e.target.closest('#live-ws-disarm-all')) {
    channelConfig = window.armState.setAllArmed(channelConfig, false);
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
    channelGroups = window.groupState.setGroupCollapsed(channelGroups, g, !window.groupState.isGroupCollapsed(channelGroups, g));
    persistChannelGroups();
    applyLiveCollapsed();
    return;
  }
  const fold = e.target.closest('.live-ch-fold');
  if (fold) {
    const idx = parseInt(fold.closest('.live-ch').dataset.ch, 10);
    liveCollapsed = window.collapseState.toggle(liveCollapsed, idx);
    applyLiveCollapsed();
    return;
  }
  if (e.target.closest('#live-collapse-all')) {
    // Count the strips actually on screen (#188) rather than lastLiveChannels,
    // which stays null/stale in the idle workspace until a real tick lands.
    const n = document.querySelectorAll('#spectrum-body .sb-live-meters .live-ch').length;
    liveCollapsed = window.collapseState.collapseAll(Array.from({ length: n }, (_, i) => i));
    applyLiveCollapsed();
  } else if (e.target.closest('#live-expand-all')) {
    liveCollapsed = window.collapseState.expandAll();
    applyLiveCollapsed();
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
    if (head && to >= 0) channelGroups = window.groupState.moveGroup(channelGroups, src.index, to);
  } else {
    const strip = e.target.closest('.live-ch');
    if (strip) {
      const g = window.groupState.groupOf(channelGroups, src.index);
      const members = (channelGroups[g] && channelGroups[g].members) || [];
      const from = members.indexOf(src.index);
      const to = members.indexOf(parseInt(strip.dataset.ch, 10));
      if (g !== -1 && from !== -1 && to !== -1) channelGroups = window.groupState.moveMember(channelGroups, g, from, to);
    }
  }
  persistChannelGroups();
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
  if (liveRunning || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
  const dir = e.key === 'ArrowUp' ? -1 : 1;
  const groupHandle = e.target.closest('.live-group-drag');
  if (groupHandle) {
    e.preventDefault();
    const g = parseInt(groupHandle.closest('.live-group-head').dataset.group, 10);
    const to = g + dir;
    if (to < 0 || to >= channelGroups.length) return;
    channelGroups = window.groupState.moveGroup(channelGroups, g, to);
    persistChannelGroups();
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
    channelGroups = window.groupState.moveMember(channelGroups, g, from, to);
    persistChannelGroups();
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
    channelConfig[idx] = window.rigKind.switchKind(channelConfig[idx], e.target.value, selectedDeviceChannels());
    renderChannelConfig();
    return;
  }
  const srcSel = e.target.closest('.live-ch-src');
  if (srcSel) {
    const idx = parseInt(srcSel.dataset.idx, 10);
    if (!channelConfig[idx]) return;
    channelConfig[idx][srcSel.dataset.field] = parseInt(e.target.value, 10);
    renderChannelConfig();
    return;
  }
  // Per-track group assignment (#190): write through groupState with its
  // exclusive-membership rules, then re-render the workspace.
  const grpSel = e.target.closest('.live-ch-group');
  if (grpSel) {
    const idx = parseInt(grpSel.dataset.idx, 10);
    channelGroups = window.groupState.assign(channelGroups, idx, parseInt(e.target.value, 10));
    persistChannelGroups();
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
    strip.label = nameEl.textContent.trim().slice(0, MAX_LABEL_LEN);
    // Persist the label (#482) so it survives across monitor/live sessions,
    // keyed by device + strip token (mono "0" / stereo "2-3").
    const all = (setStore.getState().settings || {}).channelLabels || {};
    const next = window.channelLabels.recordLabel(
      all, selectedDeviceName(), window.armState.stripToken(strip), strip.label,
    );
    setStore.getState().updateSettings({ channelLabels: next });
    // Reflect the resolved name (empty label falls back to the device name /
    // Ch N) and refresh the config row inputs to match.
    nameEl.textContent = stripLabel(strip, liveChannelAt(idx), idx);
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
function updateLiveStatsRow(ch) {
  setStat('stat-rms', fmt(ch.rms), ch.rms > -6 ? 'check' : '');
  setStat('stat-peak', fmt(ch.peak), ch.peak > -1 ? 'issue' : '');
  setStat('stat-dr', '—', '');
  setStat('stat-clip', ch.clipping ? 'CLIP' : 'No', ch.clipping ? 'issue' : '');
  document.getElementById('stat-centroid').textContent = ch.centroid ? Math.round(ch.centroid).toLocaleString() : '—';
}

// #541: docks the AI Engineer panel inline in the report card (report-first-ux)
// or restores the standing rail. Moving the node (not cloning) keeps every
// listener and getElementById wiring intact; placement() decides, never DOM state.
function syncAiDock() {
  const panel = document.getElementById('ai-panel');
  const where = window.aiDockState.placement(
    window.reportFirstUxState.isEnabled(setStore.getState().settings), currentMode);
  const dockBody = document.getElementById('rc-ai-dock-body');
  if (where === 'docked' && panel.parentElement !== dockBody) dockBody.appendChild(panel);
  // The rail slot is #workspace's last child — appendChild restores it exactly.
  else if (where === 'rail' && panel.parentElement === dockBody) document.getElementById('workspace').appendChild(panel);
}

// #542 (epic e17): Recent / Build Guide / Ring-Out have no spectrum and no
// per-analysis narrative — collapse the workspace to one full-width column
// for them when the report-first-ux flag is on. CSS does the layout; this
// only owns the branch point.
function syncSingleColumn() {
  document.body.classList.toggle('single-column', window.singleColumnState.isSingleColumn(
    window.reportFirstUxState.isEnabled(setStore.getState().settings), currentMode));
}

// #543 (epic e17): the unified "Analyze" source picker — opened from the
// Report Card toolbar (see the reportcard-load-btn handler above), never on
// launch, so there's no full-screen overlay for e2e specs to trip over.
function openAnalyzeSourcePicker() {
  document.getElementById('analyze-source-picker').hidden = false;
  document.querySelector('[data-analyze-source]').focus();
}
function closeAnalyzeSourcePicker() {
  document.getElementById('analyze-source-picker').hidden = true;
}
// Routing is a simulated tab click — the same idiom used throughout this file
// (e.g. #dir-goto-reportcard, #rc-offer-btn) — so Live/Soundcheck reach their
// destination through the real mode-tab handler: Pro gating, transport
// pausing, spectrum sync, syncAiDock(), syncSingleColumn() all fire exactly
// as if the user had clicked the tab themselves.
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

/* ══ Mode tabs ══ */
document.querySelectorAll('.mode-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const mode = tab.dataset.mode;
    if (mode === currentMode) return;
    // Opt-in crash reporting (#473): the current screen is a safe breadcrumb
    // (a name, never content) a crash payload includes as `route`. No-op
    // when reporting is off or unavailable (main process ignores it either way).
    sb.recordAppEvent?.('screen.' + (mode === 'reportcard' ? 'reportcard' : mode));
    // Live/Soundcheck replace the spectrum area with unrelated content and
    // Soundcheck has its own playback transport — don't leave the analyzed
    // file playing silently in the background with no visible control (#180).
    if (mode === 'live' || mode === 'soundcheck') pauseTransportAudio();

    document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    // Set currentMode before the mode-specific work so a throw inside it
    // can't leave currentMode stale and lock the user out of navigating back
    // via the same-tab guard (#177).
    currentMode = mode;

    if (mode === 'reportcard') {
      // #177: the report card now shares the screen with the spectrum instead
      // of replacing the workspace. #workspace stays visible (CSS lays the two
      // out side by side via #stage; body.rc-active folds the Source panel
      // away so both get room). The .active toggle is retained so existing
      // DOM assertions keep holding. syncSpectrumForMode keeps the spectrum in
      // the right state beside the card — otherwise a stale Live/Soundcheck
      // spectrum (or pre-analysis empty state) would show next to the grade.
      // ReportCardIsland (React) always renders from the live store state —
      // no explicit render call needed here (TD-001 slice 4, #422).
      document.body.classList.add('rc-active');
      document.getElementById('reportcard-view').classList.add('active');
      syncSpectrumForMode('reportcard');
    } else {
      document.body.classList.remove('rc-active');
      document.getElementById('reportcard-view').classList.remove('active');
      document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
      document.getElementById(`tab-${mode}`).classList.add('active');
      syncSpectrumForMode(mode);
      // Reload on every visit (not just once) so a just-completed analysis
      // shows up without an app restart (#147).
      if (mode === 'recent') renderRecentServices();
      if (mode === 'guide') renderBuildGuide();
      if (mode === 'ringout') renderRingout();
    }
    syncAiDock();
    syncSingleColumn();
  });
});

/* ── Virtual Soundcheck (#46) ── */
let scManifest = null;      // loaded session.json manifest
let scSessionDir = null;    // chosen session folder
let scRoutes = [];          // per-track output channel arrays ([c] mono / [l,r] stereo)
let scDeviceChannels = 0;   // channel count of the selected output device (0 = default)
let scDevicesLoaded = false;
let scPlaying = false;

function scTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}
function scShowStatus(msg) { const s = document.getElementById('sc-status'); s.textContent = msg; s.style.display = 'block'; }
function scHideStatus() { document.getElementById('sc-status').style.display = 'none'; }

async function scLoadDevices() {
  const sel = document.getElementById('sc-device-select');
  try {
    const result = await sb.listOutputDevices();
    const devices = (result && result.devices) || [];
    sel.innerHTML = '<option value="">Default output</option>'
      + devices.map((d) => `<option value="${d.index}" data-ch="${d.channels}">${escapeHtml(d.name)} (${d.channels}ch)</option>`).join('');
  } catch (err) {
    sel.innerHTML = '<option value="">Default output</option>';
  }
  scDevicesLoaded = true;
  scSyncDeviceChannels();
}
function scSyncDeviceChannels() {
  const sel = document.getElementById('sc-device-select');
  const opt = sel.options[sel.selectedIndex];
  scDeviceChannels = opt && opt.dataset.ch ? parseInt(opt.dataset.ch, 10) : 0;
  scRenderTracks();
  scUpdateMixdownNotice();
  scUpdateGuard();
}

async function scChooseSession() {
  const dir = await sb.openDirDialog();
  if (!dir) return;
  const result = await sb.readSession(dir);
  if (!result || !result.success) { scShowStatus((result && result.error) || 'Could not read that session.'); return; }
  scHideStatus();
  scSessionDir = dir;
  scManifest = result.manifest;
  scRoutes = window.playbackRouting.defaultRoutes(scManifest.tracks);
  const nameEl = document.getElementById('sc-session-name');
  nameEl.textContent = dir.split('/').pop();
  nameEl.style.display = 'block';
  scRenderTracks();
  scUpdateMixdownNotice();
  scUpdateGuard();
}

// Output-channel options up to the device's channel count (min 2 so a
// default-output session can still address a stereo pair before enumeration).
function scChannelOptions(selectedBase, kind) {
  const max = Math.max(scDeviceChannels || 2, kind === 'stereo' ? 2 : 1);
  let html = '';
  if (kind === 'stereo') {
    for (let c = 0; c + 1 < max; c++) html += `<option value="${c}"${c === selectedBase ? ' selected' : ''}>Ch ${c + 1}-${c + 2}</option>`;
  } else {
    for (let c = 0; c < max; c++) html += `<option value="${c}"${c === selectedBase ? ' selected' : ''}>Ch ${c + 1}</option>`;
  }
  return html;
}

function scRenderTracks() {
  const wrap = document.getElementById('sc-tracks');
  if (!scManifest || !scManifest.tracks || !scManifest.tracks.length) {
    wrap.innerHTML = '<div class="sc-empty">Choose a session folder to load its tracks.</div>';
    return;
  }
  wrap.innerHTML = scManifest.tracks.map((t, i) => {
    const stereo = t.kind === 'stereo';
    const r = scRoutes[i] || [0];
    const label = t.label || `Track ${i + 1}`;
    return `<div class="sc-track" data-idx="${i}">
      <span class="sc-track-name" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
      <span class="sc-badge">${stereo ? 'Stereo' : 'Mono'}</span>
      <select class="sc-route" data-idx="${i}" data-kind="${stereo ? 'stereo' : 'mono'}"${scPlaying ? ' disabled' : ''}>${scChannelOptions(r[0], t.kind)}</select>
    </div>`;
  }).join('');
  wrap.querySelectorAll('.sc-route').forEach((sel) => {
    sel.addEventListener('change', (e) => {
      const i = parseInt(e.target.dataset.idx, 10);
      const base = parseInt(e.target.value, 10);
      scRoutes[i] = e.target.dataset.kind === 'stereo' ? [base, base + 1] : [base];
      scUpdateMixdownNotice();
      scUpdateGuard();
    });
  });
}

function scUpdateMixdownNotice() {
  const notice = document.getElementById('sc-mixdown-notice');
  if (!scManifest) { notice.style.display = 'none'; return; }
  const master = document.getElementById('sc-master-toggle').checked;
  // Default output (unknown channel count) → let the backend decide and report a
  // `mixdown` event; only pre-warn when a concrete device is too small, or master.
  const tooSmall = scDeviceChannels > 0 && window.playbackRouting.needsMixdown(scRoutes, scDeviceChannels, false);
  if (master || tooSmall) {
    const req = window.playbackRouting.requiredChannels(scRoutes);
    notice.textContent = master
      ? 'Playing a stereo master mixdown.'
      : `The selected output has ${scDeviceChannels} channels but the routing needs ${req} — playback folds to a stereo master mixdown.`;
    notice.style.display = 'block';
  } else {
    notice.style.display = 'none';
  }
}

function scUpdateGuard() {
  document.getElementById('sc-play-btn').disabled = !(scManifest && scDevicesLoaded && !scPlaying);
}

async function scPlay() {
  if (!scManifest) return;
  scHideStatus();
  const master = document.getElementById('sc-master-toggle').checked;
  const deviceVal = document.getElementById('sc-device-select').value;
  const result = await sb.startPlayback({
    sessionDir: scSessionDir,
    device: deviceVal || undefined,
    route: window.playbackRouting.routeSpec(scRoutes),
    master: master || undefined,
  });
  if (result && result.success === false) { scShowStatus(result.error || 'Could not start playback.'); return; }
  scPlaying = true;
  document.getElementById('sc-play-btn').style.display = 'none';
  document.getElementById('sc-stop-btn').style.display = 'inline-flex';
  const el = document.getElementById('sc-elapsed');
  el.style.display = 'block'; el.textContent = '0:00 / 0:00';
  scRenderTracks(); // disable routing selects while playing
  scUpdateGuard();
  setSpectrumState('empty', { text: 'Buffering…' });
}

async function scStop() {
  await sb.stopPlayback();
  scResetTransport();
}

function scResetTransport() {
  scPlaying = false;
  document.getElementById('sc-play-btn').style.display = 'inline-flex';
  document.getElementById('sc-stop-btn').style.display = 'none';
  document.getElementById('sc-elapsed').style.display = 'none';
  scRenderTracks();
  scUpdateGuard();
  if (currentMode === 'soundcheck') setSpectrumState('empty', { text: 'Load a session and press Play to see per-track meters' });
}

function scRenderMeters(tracks) {
  const body = document.getElementById('spectrum-imperative');
  body.innerHTML = '<div class="meter-card sb-live-meters">' + (tracks || []).map((t) => {
    const rms = Number.isFinite(t.rms) ? t.rms : -120;
    const pct = Math.max(0, Math.min(100, (rms + 60) / 60 * 100));
    return `<div class="sc-meter${t.clipping ? ' clip' : ''}">
      <div class="sc-meter-head">
        <span class="sc-meter-name">${escapeHtml(t.label || 'Track')}</span>
        <span class="sc-meter-val">RMS ${fmt(t.rms)} · Peak ${fmt(t.peak)} dBFS</span>
        ${t.clipping ? '<span class="sc-meter-clip">CLIP</span>' : ''}
      </div>
      <div class="sc-meter-bar"><div class="sc-meter-fill" style="width:${pct.toFixed(1)}%"></div></div>
    </div>`;
  }).join('') + '</div>';
}

document.getElementById('sc-choose-btn').addEventListener('click', scChooseSession);
document.getElementById('sc-device-select').addEventListener('change', scSyncDeviceChannels);
document.getElementById('sc-master-toggle').addEventListener('change', scUpdateMixdownNotice);
document.getElementById('sc-play-btn').addEventListener('click', scPlay);
document.getElementById('sc-stop-btn').addEventListener('click', scStop);

sb.onPlaybackEvent((data) => {
  if (!data) return;
  if (data.error) { scShowStatus(String(data.error)); scResetTransport(); return; }
  if (data.type === 'mixdown') {
    if (data.active) {
      const notice = document.getElementById('sc-mixdown-notice');
      notice.textContent = `Stereo master mixdown — routing needed ${data.requiredChannels} channels, device has ${data.outputChannels}.`;
      notice.style.display = 'block';
    }
  } else if (data.type === 'progress') {
    if (currentMode === 'soundcheck' && scPlaying) document.getElementById('sc-elapsed').textContent = `${scTime(data.elapsed)} / ${scTime(data.duration)}`;
  } else if (data.type === 'level') {
    if (currentMode === 'soundcheck' && scPlaying) scRenderMeters(data.tracks);
  } else if (data.type === 'ended') {
    scResetTransport();
  }
});

scLoadDevices(); // populate the output picker at startup

function syncSpectrumForMode(mode) {
  const title = document.getElementById('spectrum-title');
  if (mode === 'live') {
    title.textContent = SPECTRUM_TITLE.live;
    // Persistent track workspace (#188): the pane renders channelConfig as
    // track rows the moment the Live tab is shown, idle or capturing — the
    // running board only takes over once real windows have actually arrived.
    if (liveRunning && liveWindows.length > 0) renderLiveMeters(liveWindows[liveWindows.length - 1]);
    else renderLiveWorkspace();
    renderPreflight(); // repaint the checklist whenever the Live tab becomes visible
  } else if (mode === 'soundcheck') {
    title.textContent = 'Soundcheck · Meters';
    if (!scPlaying) setSpectrumState('empty', { text: 'Load a session and press Play to see per-track meters' });
  } else if (mode === 'recent') {
    // Recent (#147) has no file-loading UI of its own — a tailored message
    // instead of the generic "Load a file…" copy the fallback branch below
    // would otherwise show (misleading here, since there's nothing to load).
    title.textContent = SPECTRUM_TITLE.curve;
    if (!curAnalysis()) setSpectrumState('empty', { text: 'Select a recent analysis to load its report card' });
  } else if (mode === 'guide') {
    // Build Guide (#367) has no file-loading UI of its own either — mirror
    // the `recent` tailored empty state so it doesn't show the misleading
    // generic "Load a file…" copy.
    title.textContent = SPECTRUM_TITLE.curve;
    if (!curAnalysis()) setSpectrumState('empty', { text: 'Follow the build order, then load a recording to grade it' });
  } else if (mode === 'dir') {
    // Directory (#293) is roadmap context until batch analysis ships in
    // v1.1 — mirror the `recent`/`guide` tailored empty state instead of
    // promising a folder analysis that can't run yet.
    title.textContent = SPECTRUM_TITLE.curve;
    if (!curAnalysis()) setSpectrumState('empty', { text: 'Batch analysis is coming in v1.1 — analyze recordings from Report Card' });
  } else {
    // syncSpectrumChrome (below) sets the header to match what's drawn (curve
    // vs meters) once there's data; seed the curve label for the pre-analysis
    // empty state.
    title.textContent = SPECTRUM_TITLE.curve;
    if (!curAnalysis()) setSpectrumState('empty', { text: 'Load a file to see the spectrum' });
  }
  // Shows/hides the React spectrum island vs #spectrum-imperative for this
  // mode and refreshes its title/stats/ideal-profile chrome (TD-001 slice 4,
  // #422) — a no-op when there's no spectrum data yet.
  syncSpectrumChrome();
}

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
// once at module scope; setSpectrumState('loading') (re)renders the rows
// each run, so there's nothing stale to clear between runs.
sb.onAnalysisProgress((data) => {
  if (!data.stage || data.status !== 'done') return;
  const row = document.querySelector(`#spectrum-body .stage-row[data-stage="${data.stage}"]`);
  if (row) row.classList.add('done');
});

// Replaces runFileAnalysis's DOM side effects — a single analysisStore
// subscription reacting to `status` transitions (TD-001 slice 4, #422).
// Installed at boot (see the Init section at the bottom of this file).
function syncReportCardChrome(state, prevState) {
  const clearBtn = document.getElementById('reportcard-clear-btn');
  const loadBtn = document.getElementById('reportcard-load-btn');
  const printBtn = document.getElementById('reportcard-print-btn');
  const gradeOwnBtn = document.getElementById('grade-own-btn');
  // Mirrors ReportCardIsland's own source priority (currentAnalysis wins,
  // else liveSource, else historySummary, else no card at all) — computed
  // here too so the toolbar/upgrade-card chrome (outside #report-card) stays
  // in sync with whatever the island is actually showing.
  const isHistoryCard = !!state.historySummary && !state.currentAnalysis && !state.liveSource;
  const isLiveCard = !state.currentAnalysis && !!state.liveSource;
  const chromeSource = state.currentAnalysis
    ? reportCardSourceFromAnalysis(state.currentAnalysis)
    : (state.liveSource || null);
  const hasCard = isHistoryCard || !!chromeSource;

  if (state.status !== prevState.status) {
    if (state.status === 'analyzing') {
      pauseTransportAudio(); // don't let a previous file's playback bleed through the loading state (#180)
      setSpectrumState('loading');
    } else if (state.status === 'error') {
      setSpectrumState('error', { text: state.analysisError || 'Analysis failed' });
    } else if (state.status === 'cancelled') {
      // Return to the pre-analysis idle state (no report card, no stuck
      // spinner). selectedFilePath is left untouched by cancelAnalysis, so
      // the user can retry without re-picking the file.
      setSpectrumState('empty');
    } else if (state.status === 'done') {
      // File input now lives in the Report Card tab's empty state (#203) —
      // the card flips over the moment analysis succeeds; #spectrum-imperative
      // clears in favor of the React island (syncSpectrumChrome shows it).
      document.getElementById('spectrum-imperative').innerHTML = '';
      syncSpectrumChrome();
      updateStatsRow(state.currentAnalysis.sox, state.currentAnalysis.spectrum);
      syncIdealProfile();
      persistAnalysisSummary();
    }
  }

  // Print/Grade-own just mirror whether a card (file, live, or history) is
  // showing — a re-analysis in flight still has the prior card on screen to
  // print/grade, same as before this migration (runFileAnalysis never
  // disabled these two while re-analyzing). Clear/Load DO disable in flight
  // so they can't swap the source out from under the run and have this
  // continuation flip the card back over a stale reference (#206/#208).
  printBtn.disabled = !hasCard;
  gradeOwnBtn.disabled = !hasCard;
  loadBtn.disabled = state.status === 'analyzing';
  loadBtn.style.display = isLiveCard ? '' : 'none';
  // Clear only makes sense when the card is backed by a file analysis — a
  // live-capture (or history) card has no file to clear, and it never makes
  // sense mid-flight either (#206).
  clearBtn.disabled = state.status === 'analyzing' || !state.currentAnalysis;

  // Post-report-card upgrade moment (#58): score-aware, so it needs the
  // latest grade. lastReportGrade/renderUpgradeMomentum stay inline (they own
  // the imperative #rc-upgrade aside, a React-island sibling, #58/#296).
  if (isHistoryCard) {
    lastReportGrade = state.historySummary.gradeLetter;
  } else if (chromeSource) {
    lastReportGrade = grading.computeGrade(chromeSource);
  } else {
    lastReportGrade = null;
  }
  renderUpgradeMomentum();
}

/* ══ Directory mode (#293): roadmap card only — batch analysis lands in v1.1.
   The single action routes to the supported path via the real tab click so
   the transition is identical to the user clicking the Report Card tab. ══ */
document.getElementById('dir-goto-reportcard').addEventListener('click', () => {
  document.querySelector('.mode-tab[data-mode="reportcard"]').click();
});

/* ══ Live mode ══ */
document.getElementById('window-secs').addEventListener('input', (e) => {
  document.getElementById('window-secs-label').textContent = parseFloat(e.target.value).toFixed(1) + 's';
});
document.getElementById('llm-interval').addEventListener('input', (e) => {
  const v = parseInt(e.target.value);
  document.getElementById('llm-interval-label').textContent = v === 0 ? 'Off' : v + 's';
});
document.getElementById('meter-interval').addEventListener('input', (e) => {
  const ms = parseInt(e.target.value);
  document.getElementById('interval-label').textContent = `${ms} ms · ${Math.round(1000 / ms)}/s`;
});

/* ── Monitor / Record toggle ── */
// Apply a capture mode to the UI (used by both the toggle and applyRig, so the
// two paths can't diverge).
function setLiveMode(mode) {
  liveMode = mode === 'record' ? 'record' : 'monitor';
  document.querySelectorAll('#live-mode button').forEach((x) => x.classList.toggle('active', x.dataset.mode === liveMode));
  document.getElementById('record-folder-row').style.display = liveMode === 'record' ? 'flex' : 'none';
  // Arm controls (#43) are only meaningful in Record mode.
  document.getElementById('tab-live').classList.toggle('capture-record', liveMode === 'record');
  hideArmHint();
  renderChannelConfig();
  hydrateIcons(document.getElementById('live-mode'));
}
// Inline "arm at least one strip" hint near the Start button (#43).
function showArmHint(msg) { const h = document.getElementById('arm-hint'); h.textContent = msg; h.style.display = 'block'; }
function hideArmHint() { const h = document.getElementById('arm-hint'); if (h) h.style.display = 'none'; }
document.querySelectorAll('#live-mode button').forEach((b) => {
  b.addEventListener('click', () => setLiveMode(b.dataset.mode));
});
// Name a new group via the shared dialog and push it onto channelGroups (#41).
// Called from the workspace toolbar's #live-ws-new-group (#190).
async function createChannelGroup() {
  const name = await rigDialog({ title: 'New group', value: '', confirmLabel: 'Create', withInput: true });
  const trimmed = (name || '').trim();
  if (!trimmed) return;
  channelGroups = window.groupState.addGroup(channelGroups, trimmed.slice(0, 40));
  persistChannelGroups();
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
  channelGroups = window.groupState.renameGroup(channelGroups, g, trimmed.slice(0, 40));
  persistChannelGroups();
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
  channelGroups = window.groupState.removeGroup(channelGroups, g);
  persistChannelGroups();
  renderChannelConfig();
}

// The effective default recording folder to show when no folder is explicitly
// chosen (#482): the configured storageDir setting (#91), falling back to the
// platform default — mirrors ipc/shared.ts's defaultRecordDir().
function defaultRecordFolderText() {
  const s = setStore.getState().settings;
  return (s && s.storageDir && s.storageDir.trim()) || '~/Music/Sound Buddy';
}

document.getElementById('record-folder-btn').addEventListener('click', async () => {
  const dir = await sb.openDirDialog();
  if (dir) {
    recordDir = dir;
    document.getElementById('record-folder-path').textContent = dir;
  }
});

/* ── Channel configuration ── */
// The selected device's max input channels (0 = default device / unknown).
function selectedDeviceChannels() {
  return deviceChannelCount(document.getElementById('device-select').value, liveDevices);
}

// The selected device's name, resolved from liveDevices ('' = Default Device),
// mirroring captureCurrentRig's device-by-name resolution below.
function selectedDeviceName() {
  const val = document.getElementById('device-select').value;
  if (val === '') return '';
  const dev = liveDevices.find((d) => String(d.index) === val);
  return dev ? dev.name : '';
}

// The persisted channel labels (#482) saved for the currently selected device.
function savedLabelsForDevice() {
  return ((setStore.getState().settings || {}).channelLabels || {})[selectedDeviceName()] || {};
}

// The persisted instrument-profile overrides (#524) saved for the currently
// selected device, mirroring savedLabelsForDevice above (#482).
function savedInstrumentProfilesForDevice() {
  return ((setStore.getState().settings || {}).inputInstrumentProfiles || {})[selectedDeviceName()] || {};
}

// Overlay saved labels onto channelConfig for the current device (#482) —
// never clobbers a label already present (e.g. loaded from a rig).
function applySavedLabels() {
  channelConfig = window.channelLabels.applyLabels(
    channelConfig,
    window.armState.allTokens(channelConfig),
    savedLabelsForDevice(),
  );
}

// The persisted channel groups (#483) saved for the currently selected device,
// mirroring savedLabelsForDevice above (#482).
function savedGroupsForDevice() {
  return ((setStore.getState().settings || {}).channelGroups || {})[selectedDeviceName()] || [];
}

// Hydrate channelGroups from settings.json for the current device (#483).
// Called from resetChannelConfig() right after applySavedLabels() so a device
// switch (or app restart) restores both labels and group layout together.
function hydrateChannelGroups() {
  channelGroups = savedGroupsForDevice().map((g) => ({
    name: g.name, members: (g.members || []).slice(), collapsed: !!g.collapsed,
  }));
}

// Persist channelGroups (#483) as a full-map replace keyed by device — mirrors
// channelLabels' write path (#482) exactly. Called from every group mutator
// (create/rename/delete/assign/reorder/collapse) and from applyRig.
function persistChannelGroups() {
  const all = (setStore.getState().settings || {}).channelGroups || {};
  const next = Object.assign({}, all, {
    [selectedDeviceName()]: channelGroups.map((g) => ({ name: g.name, members: g.members.slice(), collapsed: !!g.collapsed })),
  });
  setStore.getState().updateSettings({ channelGroups: next });
}

// Total device channels consumed by the current config (mono=1, stereo=2).
function usedChannelCount() {
  return lcUsedChannelCount(channelConfig);
}

// Push a new mono strip onto channelConfig and re-render (#188). Called from
// the workspace's #live-ws-add.
function addChannelStrip() {
  const n = selectedDeviceChannels();
  const next = Math.min(usedChannelCount(), n - 1);
  channelConfig.push({ kind: 'mono', a: next, b: Math.min(next + 1, n - 1), armed: true });
  renderChannelConfig();
}

// Remove a strip and re-render (#188). Called from the workspace's .live-ch-x;
// callers may drive this down to zero strips so the workspace empty state
// stays reachable.
function removeChannelStrip(idx) {
  // Reindex/clear the measurement source (#456) before the splice, using the
  // pre-removal selection.
  lcStore.getState().setMeasurementSource(measurementSourceAfterRemove(lcStore.getState().measurementSource, idx));
  // Same reindex/clear semantics apply to the focused input (#525).
  focusedInputIndex = measurementSourceAfterRemove(focusedInputIndex, idx);
  channelConfig.splice(idx, 1);
  // Drop the removed strip from any group and shift higher indices down so no
  // dangling reference remains (#41).
  channelGroups = window.groupState.pruneStrip(channelGroups, idx);
  persistChannelGroups();
  renderChannelConfig();
}

// Reset the config to the device default: first ≤2 channels as mono strips,
// then overlay any saved labels and groups for this device (#482, #483) —
// covers device switches and refresh.
function resetChannelConfig() {
  const n = selectedDeviceChannels();
  channelConfig = [];
  for (let i = 0; i < Math.min(2, n); i++) channelConfig.push({ kind: 'mono', a: i, b: (i + 1) % Math.max(n, 1), armed: true });
  applySavedLabels();
  hydrateChannelGroups();
  // Config is rebuilt on a device switch — old measurement-source indices are
  // meaningless (#456).
  lcStore.getState().setMeasurementSource(null);
  // Same reasoning applies to the focused input (#525) — it never dangles
  // across a device swap.
  focusedInputIndex = null;
  renderChannelConfig();
}

// Config changed: re-sync the center-pane track workspace and re-assert the
// capture lock. The channel list, add, group, and arm controls now live solely
// in the workspace (#192); this is the shared "config changed" entry point that
// every mutator (add/remove/kind/source/group/arm/mode/rig) routes through.
function renderChannelConfig() {
  // Re-assert the capture lock (#38): a running capture keeps the workspace frozen.
  if (liveRunning) setCaptureControlsLocked(true);
  // Keep the persistent idle workspace in sync. A running capture owns the pane
  // via renderLiveMeters on the rAF tick, so only re-render when idle.
  if (currentMode === 'live' && !liveRunning) renderLiveWorkspace();
  // Preflight checklist (#373) reads channelConfig/device state, so it rides
  // the same "config changed" entry point as the workspace.
  renderPreflight();
  renderMeasurementSource();
}

// Refresh the measurement-source picker (#456) from the current strip config
// and store selection — rides the same "config changed" entry point as the
// workspace/preflight so it stays in sync whenever strips or labels change.
function renderMeasurementSource() {
  document.getElementById('measurement-source').innerHTML =
    measurementSourceOptionsHTML(channelConfig, lcStore.getState().measurementSource);
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
// its own lock (setRigControlsEnabled) but is guarded here too, defensively.
// measurement-source is excluded (#457): it's a renderer-side selection into
// already-streaming tick data, not a stream.py argument, so switching it
// mid-capture is safe and is the point of #457's second AC.
function setCaptureControlsLocked(locked) {
  const set = (el) => { if (el) { el.disabled = locked; el.setAttribute('aria-disabled', String(locked)); } };
  ['device-select', 'device-refresh-btn', 'record-folder-btn',
    'meter-interval', 'window-secs', 'llm-interval', 'rig-select',
    'live-ws-add', 'live-ws-new-group',
    'live-ws-arm-all', 'live-ws-disarm-all'].forEach((id) => set(document.getElementById(id)));
  document.querySelectorAll('#live-mode button').forEach(set);
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

async function loadDevices() {
  const sel = document.getElementById('device-select');
  const btn = document.getElementById('device-refresh-btn');
  if (btn) btn.disabled = true;
  sel.innerHTML = '<option value="">Scanning…</option>';
  setDeviceHint('');

  const result = await sb.listDevices();
  sel.innerHTML = '';

  const view = deviceListView(result);
  liveDevices = view.devices;
  for (const opt of view.options) {
    // document.createElement('option') (not innerHTML) so a device name can
    // never inject markup into the picker.
    const el = document.createElement('option');
    el.value = opt.value;
    el.textContent = opt.label;
    sel.appendChild(el);
  }
  setDeviceHint(view.hint ? view.hint.text : '', view.hint ? view.hint.isError : false);
  if (btn) btn.disabled = false;

  // Seed the channel picker from the (default) device's channel count — only
  // once devices were actually found (mirrors the original early returns that
  // skipped this on every non-happy branch).
  if (view.devices.length) resetChannelConfig();
}

document.getElementById('device-refresh-btn').addEventListener('click', () => loadDevices());
// Switching devices re-seeds the channel config to that device's channel count.
document.getElementById('device-select').addEventListener('change', () => resetChannelConfig());
// Measurement source picker (#456): normalize against the current strip count
// so a stale selection ('' -> null, an index -> the resolved strip) never
// lands in the store.
document.getElementById('measurement-source').addEventListener('change', (e) => {
  const value = e.target.value === '' ? null : parseInt(e.target.value, 10);
  lcStore.getState().setMeasurementSource(normalizeMeasurementSource(value, channelConfig.length));
  renderMeasurementBadge();
});

document.getElementById('live-start-btn').addEventListener('click', async () => {
  const device = document.getElementById('device-select').value || undefined;
  const windowSecs = parseFloat(document.getElementById('window-secs').value);
  const intervalSecs = parseInt(document.getElementById('meter-interval').value) / 1000;
  // When AI is off, force the LLM interval to 0 so no countdown or auto-analysis
  // is armed (the backend also refuses to arm it — belt and suspenders).
  const llmIntervalSecs = (setStore.getState().settings || {}).aiEnabled ? parseInt(document.getElementById('llm-interval').value) : 0;
  const channels = channelTokens();

  // No configured tracks (#188): the workspace remove can drive channelConfig
  // to zero, but stream.py silently falls back to its first device channels
  // when given an empty channel list — block Start rather than start a
  // capture the UI just showed as empty.
  if (channelConfig.length === 0) {
    showArmHint('Add at least one track before starting capture.');
    return;
  }
  // Record mode with nothing armed would spawn an empty session — block it (#43).
  if (liveMode === 'record' && armedCount() === 0) {
    showArmHint('Arm at least one strip to record.');
    return;
  }
  hideArmHint();

  liveRunning = true;
  // Overwriting the previous state is the reset — the next capture starts
  // from zero (#518).
  playheadState = window.dawPlayheadState.start(Date.now());
  startPlayheadTicker();
  // Clear the previous capture's waveform and align the bucket rate to this
  // capture's meter interval (#520).
  waveformState = window.dawWaveformState.create();
  waveformBucketsPerSec = window.dawWaveformState.bucketsPerSecond(intervalSecs);
  waveformLaneStates = {};
  liveWindows = [];
  syncLiveSource();
  syncLiveAdjustmentsPanel();
  // A live capture always wins over a loaded history entry (#147).
  anaStore.getState().setHistorySummary(null);
  setRigControlsEnabled(false);
  setCaptureControlsLocked(true); // freeze device/mode/folder/channels/sliders (#38)

  document.getElementById('rec-offer').style.display = 'none';
  document.getElementById('rc-offer').style.display = 'none';
  document.getElementById('live-rc-cue').style.display = 'none';
  document.getElementById('live-start-btn').style.display = 'none';
  document.getElementById('live-stop-btn').style.display = 'inline-flex';
  document.getElementById('live-indicator').style.display = 'flex';
  document.querySelector('#live-indicator .live-txt').textContent = liveMode === 'record' ? 'REC' : 'LIVE';
  renderMeasurementBadge();
  document.getElementById('live-status').style.display = 'block';
  document.getElementById('live-status').textContent = 'Connecting…';
  document.getElementById('spectrum-title').textContent = SPECTRUM_TITLE.live;
  // Keep the persistent workspace up (#188) rather than blanking the pane —
  // it now reads read-only (Add/remove locked) until the first real window
  // arrives and the running board takes over.
  renderLiveWorkspace();

  const result = await sb.startLive({
    device, channels, windowSecs, intervalSecs, llmIntervalSecs,
    mode: liveMode, recordDir: recordDir || undefined,
    // Record mode: capture only the armed strips as session stems (#43).
    arm: liveMode === 'record' ? armedTokens() : undefined,
    // Record mode: carry display labels into stem filenames + session.json (#482).
    labels: liveMode === 'record' ? channelConfig.map((s) => (s.label || '').trim()) : undefined,
  });

  if (!result.success) {
    stopLive();
    setSpectrumState('error', { text: result.error || 'Failed to start live capture' });
  } else {
    const rate = Math.round(1 / intervalSecs);
    document.getElementById('live-status').textContent =
      liveMode === 'record' ? `Recording · meters ${rate}/s` : `Monitoring · meters ${rate}/s`;
    startLiveCountdown(llmIntervalSecs);
    // Guided first-use setup (#294): starting a capture completes setup
    // permanently. Remove any rendered banner immediately rather than calling
    // renderChannelConfig(), which early-outs while liveRunning — the running
    // board takes the pane over on the first tick anyway.
    window.liveSetupState.markSetupComplete(window.localStorage);
    const b = document.querySelector('#spectrum-body .live-setup-banner');
    if (b) b.remove();
  }
});

document.getElementById('live-stop-btn').addEventListener('click', () => stopLive());

async function stopLive() {
  liveRunning = false;
  // The failed-Start path also routes through here, so this covers both a
  // normal stop and a start that never got going (#518).
  playheadState = window.dawPlayheadState.stop(playheadState, Date.now());
  stopPlayheadTicker();
  renderDawPlayhead(); // paint the frozen time
  setRigControlsEnabled(true);
  setCaptureControlsLocked(false); // re-enable config (also the failed-Start path) (#38)
  clearLiveCountdown();
  const result = await sb.stopLive();
  document.getElementById('live-start-btn').style.display = 'inline-flex';
  document.getElementById('live-stop-btn').style.display = 'none';
  document.getElementById('live-indicator').style.display = 'none';
  document.getElementById('live-status').style.display = 'none';
  document.getElementById('live-rc-cue').style.display = 'block';
  document.getElementById('window-badge').textContent = '';
  document.getElementById('measurement-badge').textContent = '';
  // "Stopped" distinguishes the frozen EQ from a running one; guard the mode so
  // a tab switch during the stop-live await isn't clobbered.
  if (currentMode === 'live') document.getElementById('spectrum-title').textContent = SPECTRUM_TITLE.liveStopped;

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

  // #488: a monitor session that accumulated at least one window built a live
  // Report Card (it's already on the Report Card tab) — say so and offer the
  // jump. Record mode keeps its session-saved offer above; the two never
  // show together (sessionDir only exists in record mode).
  if (shouldOfferReportCard(liveMode, liveWindows.length)) {
    document.getElementById('rc-offer').style.display = 'flex';
    hydrateIcons(document.getElementById('rc-offer'));
  }
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

/* ══ Rigs — save / load / switch capture setups (#37, persisted via #36) ══ */
let rigList = []; // last-loaded CaptureRig[]

// Show (or clear) the muted status line under the Start button.
function setLiveStatus(text) {
  const ls = document.getElementById('live-status');
  if (!ls) return;
  if (!text) { ls.style.display = 'none'; ls.textContent = ''; return; }
  ls.textContent = text;
  ls.style.display = 'block';
}

// Rig persistence can reject (settings.json unwritable — writeSettingsFile
// rethrows), so every CRUD call routes failures here rather than leaving the
// picker silently out of sync with an unhandled rejection.
function rigError(action, err) {
  console.error(`rig ${action} failed:`, err);
  setLiveStatus(`Could not ${action} rig — check that Sound Buddy can write its settings.`);
}

// Lock the rig picker while a capture is running: applyRig mutates the device,
// channels, mode and sliders, which would desync the UI from the live stream.
function setRigControlsEnabled(enabled) {
  document.getElementById('rig-select').disabled = !enabled;
  document.getElementById('rig-save-btn').disabled = !enabled;
  document.getElementById('rig-saveas-btn').disabled = !enabled;
  if (enabled) {
    updateRigButtons();
  } else {
    document.getElementById('rig-rename-btn').disabled = true;
    document.getElementById('rig-delete-btn').disabled = true;
  }
}

// Set a slider's value programmatically and refresh its label by replaying the
// same 'input' event its listener already handles — no duplicated label logic.
function setSliderVal(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = value;
  el.dispatchEvent(new Event('input'));
}

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

function populateRigSelect(rigs, selectedId) {
  const sel = document.getElementById('rig-select');
  sel.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = rigs.length ? 'Unsaved setup' : 'No saved rigs';
  sel.appendChild(placeholder);
  for (const r of rigs) {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.name;
    sel.appendChild(opt);
  }
  sel.value = selectedId || '';
}

function updateRigButtons() {
  const hasSel = document.getElementById('rig-select').value !== '';
  document.getElementById('rig-rename-btn').disabled = !hasSel;
  document.getElementById('rig-delete-btn').disabled = !hasSel;
}

// Snapshot the current Live-tab setup into a CaptureRig. Device is stored BY
// NAME (from the selected liveDevices entry) so it survives index reordering;
// '' means the Default Device. Any per-channel label (#39) is preserved.
// upsertRig persists whatever object this returns as a full replace of the
// stored rig (not a merge, see settings.ts), so an existing saved preflight
// baseline (#373) is carried forward here — otherwise the plain rig Save
// button would silently delete it every time.
function captureCurrentRig(name, id) {
  const rig = {
    name: name,
    deviceName: selectedDeviceName(),
    channelConfig: channelConfig.map((s) => {
      const strip = { kind: s.kind, a: s.a, b: s.b };
      // Normalize the label once, at the persistence boundary, so both entry
      // points (config row + inline header) round-trip an identical stored value
      // and an all-whitespace label is dropped rather than saved (#39).
      const label = typeof s.label === 'string' ? s.label.trim().slice(0, MAX_LABEL_LEN) : '';
      if (label) strip.label = label;
      return strip;
    }),
    // Named channel groups (#41) — organizational only; members are strip indices.
    groups: channelGroups.map((g) => ({ name: g.name, members: g.members.slice() })),
    // The selected measurement source (#456) — a strip index, or null for the
    // default (first track).
    measurementSource: lcStore.getState().measurementSource,
    mode: liveMode,
    recordDir: recordDir,
    intervalMs: parseInt(document.getElementById('meter-interval').value, 10),
    windowSecs: parseFloat(document.getElementById('window-secs').value),
    llmIntervalMs: parseInt(document.getElementById('llm-interval').value, 10) * 1000,
  };
  if (id) {
    rig.id = id;
    const existing = rigList.find((r) => r.id === id);
    if (existing && existing.baseline) rig.baseline = existing.baseline;
  }
  return rig;
}

// Restore a rig into the Live tab: mode, folder, sliders, then reconcile the
// device by name and clamp channels to whatever the resolved device exposes.
// Surfaces a non-fatal notice in #live-status and never auto-starts capture.
function applyRig(rig) {
  if (!rig) return;

  setLiveMode(rig.mode);

  recordDir = rig.recordDir || '';
  document.getElementById('record-folder-path').textContent = recordDir || defaultRecordFolderText();

  setSliderVal('meter-interval', rig.intervalMs);
  setSliderVal('window-secs', rig.windowSecs);
  setSliderVal('llm-interval', Math.round((rig.llmIntervalMs || 0) / 1000));

  const rec = window.rigReconcile.reconcileRigDevice(rig.deviceName, liveDevices);
  document.getElementById('device-select').value = rec.index;
  let notice = rec.found ? '' : `Rig device "${rig.deviceName}" not found — select a device.`;

  const clamp = window.rigReconcile.clampChannelConfig(rig.channelConfig || [], selectedDeviceChannels());
  channelConfig = clamp.config.length ? clamp.config : [{ kind: 'mono', a: 0, b: 0 }];
  // Hydrate named groups (#41), dropping any member index beyond the (possibly
  // clamped) strip count so no group references a strip that isn't there.
  channelGroups = (rig.groups || []).map((g) => ({
    name: g.name, members: (g.members || []).filter((m) => m < channelConfig.length),
  }));
  // Old rigs without the field resolve to null (default) (#456).
  lcStore.getState().setMeasurementSource(normalizeMeasurementSource(rig.measurementSource, channelConfig.length));
  // The applied rig becomes this device's current layout (#483).
  persistChannelGroups();
  renderChannelConfig();
  if (clamp.adjusted) {
    notice = notice
      ? notice + ' Some channels were out of range and were clamped.'
      : 'Some rig channels were out of range for this device and were clamped.';
  }
  setLiveStatus(notice);
}

// Preflight checklist (#373): compare the live channel routing against the
// active rig's saved baseline and render the green/amber/red rows + banner.
function currentActiveRig() {
  const id = document.getElementById('rig-select').value;
  return id ? rigList.find((r) => r.id === id) : null;
}

function relativeTime(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function renderPreflight() {
  const list = document.getElementById('preflight-list');
  if (!list) return; // not booted yet
  const rig = currentActiveRig();
  // Reconcile the device actually selected in the dropdown — the one Start
  // Capture will use — not the rig's stored deviceName; those two can diverge
  // (e.g. the engineer changes the dropdown without saving), and validating
  // the wrong one would let a stale "Ready for service" mask an unvalidated
  // capture device.
  const rec = window.rigReconcile.reconcileRigDevice(selectedDeviceName(), liveDevices);
  const device = { found: rec.found, name: rec.deviceName || 'Default Device', channels: selectedDeviceChannels() };
  const current = window.preflight.snapshotRig(channelConfig, selectedDeviceName());
  const baseline = (rig && rig.baseline) || null;
  const items = window.preflight.buildChecklist({ baseline, current, device });
  const summary = window.preflight.checklistSummary(items);

  document.getElementById('preflight-saved').textContent = baseline
    ? `Baseline saved ${relativeTime(baseline.savedAt)}`
    : 'No baseline saved';

  const banner = document.getElementById('preflight-banner');
  banner.textContent = summary.ready ? 'Ready for service' : 'Not ready — resolve the items below';
  banner.className = 'pf-banner ' + (summary.ready ? 'pf-ready' : 'pf-not-ready');

  list.innerHTML = items.map((item) => `
    <li class="pf-row pf-${item.status}">
      <span class="pf-dot" aria-hidden="true"></span>
      <span class="pf-row-body">
        <span class="pf-row-label">${escapeHtml(item.label)}</span>
        <span class="pf-row-detail">${escapeHtml(item.detail)}</span>
      </span>
    </li>`).join('');
}

// Save baseline: snapshot the live routing, stamp it, and persist it onto the
// active rig — seeding a new rig first if none is selected yet, reusing the
// same capture path as the rig Save button (#373). Pro-gated exactly like the
// existing rig save path: the IPC handler throws rather than the renderer
// crashing, so the message surfaces as a status notice instead.
async function saveBaseline() {
  const rig = currentActiveRig();
  const baseline = window.preflight.snapshotRig(channelConfig, selectedDeviceName());
  baseline.savedAt = new Date().toISOString();
  const payload = Object.assign(captureCurrentRig(rig ? rig.name : 'Rig', rig ? rig.id : undefined), { baseline: baseline });
  const prevIds = new Set(rigList.map((r) => r.id));
  try {
    const settings = await sb.saveRig(payload);
    rigList = settings.rigs || [];
    let savedId = rig ? rig.id : '';
    if (!savedId) {
      const created = rigList.find((r) => !prevIds.has(r.id));
      savedId = created ? created.id : '';
    }
    if (savedId) await sb.setActiveRig(savedId);
    populateRigSelect(rigList, savedId || document.getElementById('rig-select').value);
    updateRigButtons();
    setLiveStatus('Baseline saved.');
  } catch (err) {
    console.error('save baseline failed:', err);
    const msg = err && err.message ? String(err.message) : '';
    setLiveStatus(/Pro license/i.test(msg)
      ? 'Saving a baseline requires a Pro license.'
      : 'Could not save baseline — check that Sound Buddy can write its settings.');
  }
  renderPreflight();
}
document.getElementById('preflight-save-btn').addEventListener('click', saveBaseline);

// Prompt for a name, capture the current setup as a NEW rig, and select it.
async function rigSaveAs() {
  const name = await rigDialog({ title: 'Save rig as…', value: '', confirmLabel: 'Save', withInput: true });
  if (name == null) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  const prevIds = new Set(rigList.map((r) => r.id));
  try {
    const settings = await sb.saveRig(captureCurrentRig(trimmed));
    rigList = settings.rigs || [];
    const created = rigList.find((r) => !prevIds.has(r.id));
    const newId = created ? created.id : (rigList.find((r) => r.name === trimmed) || {}).id || '';
    if (newId) await sb.setActiveRig(newId);
    populateRigSelect(rigList, newId);
    updateRigButtons();
    setLiveStatus(`Saved "${trimmed}".`);
  } catch (err) { rigError('save', err); }
  // populateRigSelect sets the <select> value programmatically, which doesn't
  // fire 'change' — repaint the checklist explicitly so it doesn't keep
  // showing whatever rig/baseline was active before this Save As (#373).
  renderPreflight();
}

async function initRigs() {
  let activeRigId = null;
  try {
    // getSettings() already returns both the saved rigs and the active id, so a
    // single read seeds the picker (one IPC round trip, and a failure can't wipe
    // an already-loaded list).
    const settings = await sb.getSettings();
    rigList = (settings && settings.rigs) || [];
    activeRigId = settings && settings.activeRigId ? settings.activeRigId : null;
  } catch { rigList = []; }
  const active = rigList.some((r) => r.id === activeRigId) ? activeRigId : '';
  populateRigSelect(rigList, active);
  updateRigButtons();
  if (active) applyRig(rigList.find((r) => r.id === active));
  // Re-apply saved labels (#482): loadDevices() may have seeded channelConfig
  // before settingsStore.loadSettings() resolved, so re-overlay now that the
  // store's settings are available.
  applySavedLabels();
  renderChannelConfig();
}

// Selecting a rig restores it and records it as active; the placeholder clears
// the active selection without touching the current setup.
document.getElementById('rig-select').addEventListener('change', async (e) => {
  const id = e.target.value;
  updateRigButtons();
  try {
    await sb.setActiveRig(id || null);
  } catch (err) { rigError('select', err); return; }
  if (!id) { renderPreflight(); return; } // deselecting still needs the checklist re-read (applyRig won't fire)
  const rig = rigList.find((r) => r.id === id);
  if (rig) applyRig(rig);
});

// Save: update the selected rig in place; with nothing selected, fall back to
// Save As so the button is never a no-op.
document.getElementById('rig-save-btn').addEventListener('click', async () => {
  const id = document.getElementById('rig-select').value;
  if (!id) { await rigSaveAs(); return; }
  const existing = rigList.find((r) => r.id === id);
  try {
    const settings = await sb.saveRig(captureCurrentRig(existing ? existing.name : 'Rig', id));
    rigList = settings.rigs || [];
    await sb.setActiveRig(id);
    populateRigSelect(rigList, id);
    updateRigButtons();
    setLiveStatus(`Saved "${existing ? existing.name : 'rig'}".`);
  } catch (err) { rigError('save', err); }
});

document.getElementById('rig-saveas-btn').addEventListener('click', () => rigSaveAs());

// Rename changes only the name, leaving the captured setup untouched.
document.getElementById('rig-rename-btn').addEventListener('click', async () => {
  const id = document.getElementById('rig-select').value;
  if (!id) return;
  const existing = rigList.find((r) => r.id === id);
  if (!existing) return;
  const name = await rigDialog({ title: 'Rename rig', value: existing.name, confirmLabel: 'Rename', withInput: true });
  if (name == null) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  try {
    const settings = await sb.saveRig({ ...existing, name: trimmed });
    rigList = settings.rigs || [];
    populateRigSelect(rigList, id);
    updateRigButtons();
  } catch (err) { rigError('rename', err); }
});

// Delete removes the rig; the backend clears activeRigId if it was the active
// one, so the picker falls back to the placeholder (no rig applied).
document.getElementById('rig-delete-btn').addEventListener('click', async () => {
  const id = document.getElementById('rig-select').value;
  if (!id) return;
  const existing = rigList.find((r) => r.id === id);
  const ok = await rigDialog({
    title: 'Delete rig',
    msg: `Delete "${existing ? existing.name : 'this rig'}"? This can't be undone.`,
    confirmLabel: 'Delete',
    withInput: false,
  });
  if (!ok) return;
  try {
    const settings = await sb.deleteRig(id);
    rigList = settings.rigs || [];
    populateRigSelect(rigList, settings.activeRigId || '');
    updateRigButtons();
  } catch (err) { rigError('delete', err); }
  // Same "programmatic <select> update doesn't fire 'change'" gap as Save As
  // above — without this the checklist would keep showing the deleted rig's
  // stale baseline/status (#373).
  renderPreflight();
});

function startLiveCountdown(intervalSecs) {
  if (intervalSecs <= 0) { document.getElementById('ai-countdown').textContent = ''; return; }
  liveCountdownSecs = intervalSecs;
  clearLiveCountdown();
  liveCountdownTimer = setInterval(() => {
    liveCountdownSecs--;
    const cd = document.getElementById('ai-countdown');
    if (liveCountdownSecs <= 0) {
      liveCountdownSecs = intervalSecs;
      cd.textContent = 'AI analyzing…';
    } else {
      cd.innerHTML = `Next AI analysis in <span class="cd-num">${liveCountdownSecs}s</span>`;
    }
  }, 1000);
}
function clearLiveCountdown() {
  if (liveCountdownTimer) { clearInterval(liveCountdownTimer); liveCountdownTimer = null; }
  document.getElementById('ai-countdown').textContent = '';
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
    if (data?.error) setSpectrumState('error', { text: `Live error: ${data.error}` });
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

  // Every event (fast meter ticks + slower window ticks) drives the live view,
  // coalesced to one repaint per animation frame.
  if (currentMode === 'live') scheduleLiveMeters(data);
  const statsCh = measurementChannel(data.channels, lcStore.getState().measurementSource);
  if (statsCh) updateLiveStatsRow(statsCh);

  // Only the heavier window ticks (which carry masking + window #) accumulate as
  // LLM trend context and feed the report card.
  if (data.type === 'window' || typeof data.window === 'number') {
    liveWindows.push(data);
    if (liveWindows.length > 10) liveWindows.shift();
    document.getElementById('window-badge').textContent = `Window #${data.window}`;
    syncLiveSource();
    syncLiveAdjustmentsPanel();
  }
});

sb.onAnalysisResult((data) => anaStore.getState().setAnalysisFromEvent(data));

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

sb.onLlmDelta((text) => aiAppend(text));
sb.onLlmDone(() => {
  llmRunning = false;
  const btn = document.getElementById('ai-analyze-btn');
  btn.disabled = false;
  btn.innerHTML = iconSvg('sparkles', 16) + 'Re-analyze with AI';
  aiAppend('\n');
});

/* ══ AI panel ══ */
function aiAppend(text) {
  const out = document.getElementById('ai-output');
  if (!aiStreamStarted) { out.classList.remove('placeholder'); out.textContent = ''; aiStreamStarted = true; }
  out.textContent += text;
  out.scrollTop = out.scrollHeight;
}

document.getElementById('ai-analyze-btn').addEventListener('click', async () => {
  if (llmRunning) return;
  llmRunning = true;

  const btn = document.getElementById('ai-analyze-btn');
  btn.disabled = true;
  btn.innerHTML = iconSvg('sparkles', 16) + 'Analyzing…';

  const out = document.getElementById('ai-output');
  if (aiStreamStarted && out.textContent) aiAppend('\n\n' + '─'.repeat(36) + '\n\n');

  if (currentMode === 'live' && liveWindows.length > 0) {
    await sb.triggerLlmAnalysis({ mode: 'live', windows: liveWindows });
  } else if (curAnalysis()) {
    await sb.triggerLlmAnalysis({ mode: 'file', analysis: curAnalysis() });
  } else {
    aiAppend('[No analysis data — load a file or start live capture first]');
    llmRunning = false;
    btn.disabled = false;
    btn.innerHTML = iconSvg('sparkles', 16) + 'Analyze with AI';
  }
});

/* ══ Report Card ══ */
// Grading (grade/score/recommendations + recording-type + band-diff) lives in
// the pure, unit-tested grading.js module (#130); the renderer calls through
// window.grading below.

// Builds the live-capture card's report-card source shape from the rolling
// liveWindows buffer — mirrors getReportCardSource()'s old live fallback.
// Written into analysisStore.liveSource wherever liveWindows changes (TD-001
// slice 4, #422) so React (ReportCardIsland) can render it.
function liveReportCardSource() {
  return lcLiveReportCardSource(liveWindows, lcStore.getState().measurementSource, channelConfig);
}
function syncLiveSource() {
  anaStore.getState().setLiveSource(liveReportCardSource());
}

// getReportCardSource() survives only for its remaining inline consumers (the
// AI narrative trigger, persistAnalysisSummary) — reads curAnalysis()/liveSource
// from the stores instead of the old currentAnalysis/liveWindows module vars.
function getReportCardSource() {
  const analysis = curAnalysis();
  if (analysis) {
    const { sox, spectrum, ffprobe, loudness } = analysis;
    return {
      filename: (ffprobe.format.filename || '').split('/').pop() || 'Untitled',
      rms: sox.rmsDbfs, peak: sox.peakDbfs, dynamicRange: sox.dynamicRangeDb,
      clipping: sox.clipping, centroid: spectrum.spectralCentroid,
      bands: { ...spectrum.bands },
      // Whole-file curve (PRD 05) + speech/music delineation (PRD 04) — absent on
      // older analyses / live capture.
      curve: spectrum.curve || null,
      contentType: spectrum.contentType || null,
      segments: spectrum.segments || null,
      // Time-sampled snapshots (PRD 03) for the "Spectrum Over Time" section.
      frames: spectrum.frames,
      // EBU R128 loudness measurement (#134) — null when ffmpeg was unavailable
      // or its output couldn't be parsed; the report card falls back to the
      // RMS-based rows only.
      lufsIntegrated: loudness ? loudness.integratedLufs : null,
      loudnessRange: loudness ? loudness.loudnessRange : null,
      truePeakDbtp: loudness ? loudness.truePeakDbtp : null,
    };
  }
  return anaStore.getState().liveSource;
}

// Guards persistAnalysisSummary's async chain against out-of-order resolution
// (#267): each call gets the next generation number, and a chain only applies
// its resolved state if it's still the newest call — otherwise a slower older
// run finishing after a newer re-analysis would stamp the wrong prevSummary/
// lastSavedSummaryFile onto the card that's actually on screen.
let persistGeneration = 0;

// Persist a discrete report-card summary for the recent-services list (#147).
// Fire-and-forget: never block or fail the report card on a storage error
// (main logs and swallows). Only called from the file-analysis success path, so
// it runs once per completed analysis and never for live-capture cards.
function persistAnalysisSummary() {
  try {
    const src = getReportCardSource();
    if (!src || !curAnalysis()) return; // file analyses only
    const summary = {
      sourceFilename: src.filename,
      gradeLetter: grading.computeGrade(src),
      score: grading.computeScore(src),
      recordingType: grading.analyzeRecordingType(src).label,
      topFixes: grading.computeRecommendations(src).slice(0, 3),
    };
    const generation = ++persistGeneration;
    // The handoff note field (#267) is add-at-save-time only — disabled until
    // this run's own save resolves with the record it wrote.
    anaStore.getState().setLastSavedSummaryFile(null);
    // Read the previous newest entry BEFORE saving this run, so summaries[0]
    // is genuinely "last time" and never the record we are about to write (#259).
    sb.listAnalysisSummaries()
      .then((res) => {
        if (generation !== persistGeneration) return; // superseded by a newer analysis
        const prev = res && res.success && Array.isArray(res.summaries) && res.summaries[0] ? res.summaries[0] : null;
        anaStore.getState().setPrevSummary(prev);
      })
      .catch(() => {
        if (generation === persistGeneration) anaStore.getState().setPrevSummary(null);
      })
      .then(() => sb.saveAnalysisSummary(summary))
      .then((r) => {
        if (generation !== persistGeneration) return; // superseded by a newer analysis
        anaStore.getState().setLastSavedSummaryFile(r && r.success ? r.file || null : null);
      })
      .catch((err) => console.warn('persistAnalysisSummary failed', err));
  } catch (err) {
    console.warn('persistAnalysisSummary failed', err);
  }
}

/* ══ Recent Services (#147) — last 10 persisted summaries ══ */
// The summaries backing the currently-rendered #recent-list, indexed the same
// as the rows, so a row click reads its record straight from here instead of
// re-fetching.
let recentSummaries = [];

async function renderRecentServices() {
  const list = document.getElementById('recent-list');
  const empty = document.getElementById('recent-empty');

  let res;
  try {
    res = await sb.listAnalysisSummaries();
  } catch (err) {
    console.warn('listAnalysisSummaries failed', err);
    res = null;
  }

  // Main already caps this list to 10 (listAnalysisSummaries); slice defensively
  // so the renderer never shows more even if that contract changes.
  recentSummaries = (res && res.success && Array.isArray(res.summaries)) ? res.summaries.slice(0, 10) : [];

  if (recentSummaries.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  list.innerHTML = recentSummaries.map((s, i) => {
    // gradeLetter is read back off a disk-stored record (#147) — escape it even
    // in this attribute position, not just as text content, so a crafted record
    // (e.g. a shared/synced storage folder written to by another install)
    // can't break out of the style attribute and inject markup.
    const safeGrade = escapeHtml(s.gradeLetter);
    return `
    <div class="dir-item recent-row" data-idx="${i}">
      <span class="recent-grade" style="color:var(--grade-${(s.gradeLetter || '').toLowerCase().replace(/[^a-z]/g, '')})">${safeGrade}</span>
      <span class="dir-name">${escapeHtml(s.sourceFilename)}</span>
      <span class="recent-date">${escapeHtml(new Date(s.date).toLocaleString())}</span>${s.note ? `<div class="recent-note">${escapeHtml(s.note)}</div>` : ''}
    </div>`;
  }).join('');

  list.querySelectorAll('.recent-row').forEach((row) => {
    row.addEventListener('click', () => {
      const i = parseInt(row.dataset.idx, 10);
      loadHistoryEntry(recentSummaries[i], i === 0 ? recentSummaries[1] || null : null);
    });
  });
}

// Loads a stored summary into the report card view without re-running any
// analysis — the row's record is all the report card ever reads (#147).
// prevSummary (#259) feeds the "vs. last time" delta — only the newest
// history entry (i === 0) gets one, compared against the second-newest.
function loadHistoryEntry(summary, prevSummary) {
  pauseTransportAudio(); // don't leave a previous file's playback running behind the summary card
  anaStore.getState().setHistorySummary(summary);
  // A history entry always wins over whatever was previously on the card
  // (ReportCardIsland's priority: currentAnalysis, else liveSource, else
  // historySummary) — clearAnalysis() also resets selectedFilePath/status, so
  // the empty-state dropzone/Analyze button reset themselves (#206).
  anaStore.getState().clearAnalysis();
  anaStore.getState().setPrevSummary(prevSummary || null);
  if (!liveRunning) { liveWindows = []; syncLiveSource(); document.getElementById('rc-offer').style.display = 'none'; }
  document.querySelector('.mode-tab[data-mode="reportcard"]').click();
}

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
      llmIntervalSecs: 0,
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
// slice 4, #422). syncReportCardChrome (above) + renderUpgradeMomentum
// (below) are what's left for this script to keep in sync: the toolbar
// buttons and the #rc-upgrade momentum aside, both outside #report-card.

/* ══ "Keep improving" momentum card (#58) ══
   Beside the finished free report card, never over it. Copy/tone come from the
   pure window.upgradeMomentum module; this owns only the DOM + dismissal store.
   Shown when: a report card has rendered, the user is free (non-Pro), and no
   "Maybe later" dismissal is active for the 7-day conversion window. */
const RCU_DISMISS_KEY = 'sb-upgrade-momentum-dismissed-at';
// Records that a report card has been shown to a free user once (#296) — its
// absence marks this install's first-value moment, when the upsell holds back.
const RCU_FIRST_SEEN_KEY = 'sb-first-report-seen-at';
let lastReportGrade = null;
let rcuRevealTimer = null; // pending first-result reveal
let rcuHoldUntil = 0; // ms epoch the first-result hold expires (session)

function upgradeMomentumDismissedAt() {
  try { return localStorage.getItem(RCU_DISMISS_KEY); } catch { return null; }
}
function dismissUpgradeMomentum() {
  try { localStorage.setItem(RCU_DISMISS_KEY, String(Date.now())); }
  catch { /* private mode: the card simply returns next launch */ }
}

function upgradeMomentumFirstSeenAt() {
  try { return localStorage.getItem(RCU_FIRST_SEEN_KEY); } catch { return null; }
}
function markUpgradeMomentumFirstSeen() {
  try { localStorage.setItem(RCU_FIRST_SEEN_KEY, String(Date.now())); }
  catch { /* private mode: the card just shows undelayed */ }
}

function renderUpgradeMomentum() {
  const el = document.getElementById('rc-upgrade');
  const um = window.upgradeMomentum;
  // Guard the module load (sibling onboarding code guards likewise) and wait
  // for the license to resolve — never flash the card before we know the tier.
  if (!el || !um) return;
  const licenseStatus = licStore.getState().licenseStatus;
  const show = lastReportGrade !== null
    && licenseStatus !== null
    && um.shouldShowForLicense(licenseStatus)
    && !um.isDismissed(upgradeMomentumDismissedAt());
  if (!show) {
    // A mid-hold Pro activation, dismissal, or report clear must cancel the
    // pending reveal (the timer callback re-enters this function anyway —
    // this is belt-and-braces against a stale timer resurfacing the card).
    clearTimeout(rcuRevealTimer);
    rcuRevealTimer = null;
    el.hidden = true;
    return;
  }

  // First-result softened reveal (#296): hold the card back so the grade owns
  // the screen, then ease it in as a follow-on invitation. The first-seen
  // flag is only written once the card actually shows below — not merely
  // when the hold is scheduled — so quitting mid-hold or clearing the report
  // doesn't silently burn the flag and skip the soft reveal on the next real
  // sighting. It's also only written on this show===true path, so a Pro/trial
  // user's first analysis never burns it — their first *free-tier* card (e.g.
  // after trial expiry) still gets the softened reveal.
  const delay = um.revealDelayMs(upgradeMomentumFirstSeenAt());
  if (delay > 0 && !rcuHoldUntil) rcuHoldUntil = Date.now() + delay; // once per session
  if (Date.now() < rcuHoldUntil) {
    el.hidden = true;
    clearTimeout(rcuRevealTimer);
    rcuRevealTimer = setTimeout(renderUpgradeMomentum, rcuHoldUntil - Date.now());
    return;
  }
  if (upgradeMomentumFirstSeenAt() == null) markUpgradeMomentumFirstSeen();

  const tone = um.toneForGrade(lastReportGrade);
  document.getElementById('rcu-heading').textContent = tone.heading;
  document.getElementById('rcu-sub').textContent = tone.sub;

  document.getElementById('rcu-actions').innerHTML = um.ACTIONS.map(a =>
    `<li class="rcu-action">
      <span class="rcu-lock">${iconSvg('lock', 15)}</span>
      <span class="rcu-atext">
        <span class="rcu-atitle">${escapeHtml(a.title)}</span>
        <span class="rcu-ahint">${escapeHtml(a.hint)}</span>
      </span>
    </li>`).join('');

  const cta = document.getElementById('rcu-cta');
  cta.innerHTML = um.PLANS.map(p =>
    `<button type="button" class="btn ${p.primary ? 'btn-primary' : 'btn-secondary'} rcu-btn" data-checkout-plan="${escapeHtml(p.plan)}">${escapeHtml(p.label)}</button>`
  ).join('');
  cta.querySelectorAll('[data-checkout-plan]').forEach((btn) =>
    btn.addEventListener('click', () => {
      // openCheckout returns a Promise (ipcRenderer.invoke); swallow both a
      // synchronous throw (preload missing) and an async rejection so a failed
      // open never surfaces as an unhandled rejection.
      try { sb.openCheckout(btn.dataset.checkoutPlan)?.catch(() => {}); } catch { /* preload missing */ }
    }));

  document.getElementById('rcu-trust').textContent = um.TRUST_COPY;
  el.hidden = false;
}

document.getElementById('rcu-later').addEventListener('click', () => {
  dismissUpgradeMomentum();
  document.getElementById('rc-upgrade').hidden = true;
});

// renderReportCardFrames is gone — ReportCard.tsx renders "Spectrum Over
// Time" from reportCardFramesView (report-card.ts), TD-001 slice 4, #422.

document.getElementById('reportcard-print-btn').addEventListener('click', () => window.print());
document.getElementById('reportcard-feedback-btn').addEventListener('click', () => {
  openFeedbackDialog();
});

// #206: once a report card is showing, the file-loading dropzone is hidden
// behind it (it only lives in the empty state). Clear resets to that empty
// state so a different file can be loaded in-window — no menu navigation or
// relaunch needed.
document.getElementById('reportcard-clear-btn').addEventListener('click', () => {
  if (!curAnalysis()) return;
  // Release the <audio> element so a re-load of the SAME file starts at 0:00
  // instead of resuming at its last scrub position (ensurePlaybackAudio keys
  // on sbAudioPath === filePath).
  releasePlaybackAudio();
  sbAudioPath = null;
  sbGeneration++; // invalidate any in-flight ensurePlaybackAudio
  // clearAnalysis() nulls currentAnalysis/selectedFilePath and resets status
  // to 'idle' — ReportCardIsland flips #rc-content → #rc-empty reactively,
  // and the dropzone/Analyze button reset themselves from the cleared store.
  anaStore.getState().clearAnalysis();
  // A finished live-capture session's rolling buffer would otherwise make
  // getReportCardSource() fall through to that stale live card instead of the
  // empty state (#206) — but leave an actively-running session's buffer alone
  // so its live meters don't blip empty.
  if (!liveRunning) { liveWindows = []; syncLiveSource(); document.getElementById('rc-offer').style.display = 'none'; }
  setSpectrumState('empty');
});

// #208: while a live-capture card is showing, the file dropzone is hidden behind it
// (#rc-empty only renders when no card is present) and Clear is disabled (no file to
// release). This toolbar button — visible only for the live-capture card — opens the
// picker and analyzes directly. The resulting file card replaces the live card via
// getReportCardSource() priority; liveWindows is left untouched so the Live tab's
// window history survives.
async function chooseAndAnalyzeFile() {
  try {
    const fp = await sb.openFileDialog();
    if (fp) { loadFile(fp); await runFileAnalysis(fp); }
  } catch { /* user cancelled */ }
}

// #543 (epic e17): with report-first-ux on, "Load a file…" is the entry point
// to the unified source picker rather than straight to the OS file dialog.
// Flag off, the behavior is byte-identical to before.
document.getElementById('reportcard-load-btn').addEventListener('click', () => {
  if (window.analyzeSourceState.isPickerEnabled(
        window.reportFirstUxState.isEnabled(setStore.getState().settings))) {
    openAnalyzeSourcePicker();
  } else {
    chooseAndAnalyzeFile();
  }
});

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

  // Activating/removing a key mid-session flips whether the upgrade card belongs
  // on the report (#58) — re-evaluate so it hides the instant a user goes Pro.
  renderUpgradeMomentum();
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
  const cancelBtn = document.getElementById('update-cancel-btn');
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
    cancelBtn.hidden = !view.showCancel;
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
      cancelBtn.hidden = true;
      progress.hidden = true;
      banner.classList.add('show');
      setTimeout(() => banner.classList.remove('show'), 4000);
    } else if (s.state === 'error') {
      text.textContent = 'Could not check for updates. Try again later.';
      dlBtn.hidden = true;
      cancelBtn.hidden = true;
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
    if (currentAction === 'reveal') sb.revealUpdateDownload();
    else sb.downloadUpdate();
  });
  cancelBtn.addEventListener('click', () => sb.cancelUpdateDownload());
  document.getElementById('update-dismiss-btn').addEventListener('click', () => banner.classList.remove('show'));
})();

/* ══ AI provider settings (#76) ══ */
// SettingsPanel.tsx now owns the dialog itself — tabs, provider fields, Test
// connection, Save (TD-001 slice 3, #421). This section keeps the header gear
// button wired to settingsStore and mirrors its state onto the surfaces that
// stay inline: the model chip and the body.ai-disabled gate.

function aiEl(id) { return document.getElementById(id); }

function updateModelChip(cfg) {
  const el = aiEl('model-chip-text');
  if (!el) return;
  el.textContent = cfg && cfg.provider ? `${cfg.provider} · ${cfg.model || 'default model'}` : 'your provider';
}

/* ══ Storage settings (#91) ══ */
// Sound Buddy has no usage caps — this dialog just lets the user pick where
// recordings live and shows disk usage informationally. State (never DOM
// read-back) drives what's shown: `storageDefaultPath` is the platform default
// reported by main, and `storagePendingDir` is the folder chosen this session
// before Save — null = unchanged, '' = reset to default, a path = a custom
// folder. `effectiveStoragePath()` folds those into the one path to display; the
// reset action is offered whenever that path isn't the default. Reuses `aiEl`.
let storagePendingDir = null;
let storageDefaultPath = '~/Music/Sound Buddy';
let storageLoadedPath = storageDefaultPath; // path persisted before this session

function effectiveStoragePath() {
  if (storagePendingDir === '') return storageDefaultPath;
  if (storagePendingDir) return storagePendingDir;
  return storageLoadedPath;
}

function renderStoragePath() {
  const current = effectiveStoragePath();
  aiEl('storage-path').textContent = current;
  aiEl('storage-reset-btn').style.display = current === storageDefaultPath ? 'none' : '';
}

async function openStorageSettings() {
  storagePendingDir = null;
  storageLoadedPath = storageDefaultPath;
  aiEl('storage-usage').textContent = 'Calculating disk usage…';
  renderStoragePath();
  // Read live from settingsStore (dual-write bridge, TD-001 slice 3, #421)
  // rather than a module-level cache — settingsStore.loadSettings() already
  // fetched this at boot.
  aiEl('usage-signal-toggle').checked = !!(setStore.getState().settings || {}).usageSignalEnabled;
  aiEl('crash-reporting-toggle').checked = !!(setStore.getState().settings || {}).crashReportingEnabled;
  aiEl('daw-workspace-toggle').checked = !!(setStore.getState().settings || {}).dawWorkspaceEnabled;
  aiEl('live-adjustments-toggle').checked = !!(setStore.getState().settings || {}).liveAdjustmentsEnabled;
  aiEl('weekly-reminder-toggle').checked = !!(setStore.getState().settings || {}).weeklyReminderEnabled;
  aiEl('weekly-reminder-day').value = String((setStore.getState().settings || {}).weeklyReminderServiceDay ?? 0);
  renderWeeklyReminderDayRow();
  aiEl('storage-dialog').style.display = 'flex';
  try {
    const u = await sb.getStorageUsage();
    if (u) {
      if (u.defaultPath) storageDefaultPath = u.defaultPath;
      storageLoadedPath = u.path || storageDefaultPath;
      aiEl('storage-usage').textContent = u.exists
        ? `Using ${u.human} on this Mac — no limit.`
        : 'Nothing recorded yet — no limit on how much you can store.';
      renderStoragePath();
    } else {
      aiEl('storage-usage').textContent = '';
    }
  } catch {
    aiEl('storage-usage').textContent = '';
  }
}

function closeStorageSettings() {
  aiEl('storage-dialog').style.display = 'none';
}

function renderWeeklyReminderDayRow() {
  aiEl('weekly-reminder-day-row').style.display = aiEl('weekly-reminder-toggle').checked ? '' : 'none';
}

async function chooseStorageFolder() {
  const dir = await sb.openDirDialog();
  if (!dir) return;
  storagePendingDir = dir;
  renderStoragePath();
}

async function saveStorageSettings() {
  // settingsStore.updateSettings() never throws (a failed round-trip parks
  // the reason in settingsError) — same non-fatal contract these saves had
  // before, now dual-written through the store so its cached `settings`
  // never goes stale (TD-001 slice 3, #421).
  if (storagePendingDir !== null) {
    await setStore.getState().updateSettings({ storageDir: storagePendingDir });
  }
  const usageChecked = aiEl('usage-signal-toggle').checked;
  const usageLoaded = !!(setStore.getState().settings || {}).usageSignalEnabled;
  if (usageChecked !== usageLoaded) {
    await setStore.getState().updateSettings({ usageSignalEnabled: usageChecked });
  }
  const crashReportingChecked = aiEl('crash-reporting-toggle').checked;
  const crashReportingLoaded = !!(setStore.getState().settings || {}).crashReportingEnabled;
  if (crashReportingChecked !== crashReportingLoaded) {
    await setStore.getState().updateSettings({ crashReportingEnabled: crashReportingChecked });
  }
  const dawChecked = aiEl('daw-workspace-toggle').checked;
  const dawLoaded = !!(setStore.getState().settings || {}).dawWorkspaceEnabled;
  if (dawChecked !== dawLoaded) {
    await setStore.getState().updateSettings({ dawWorkspaceEnabled: dawChecked });
  }
  const liveAdjChecked = aiEl('live-adjustments-toggle').checked;
  const liveAdjLoaded = !!(setStore.getState().settings || {}).liveAdjustmentsEnabled;
  if (liveAdjChecked !== liveAdjLoaded) {
    await setStore.getState().updateSettings({ liveAdjustmentsEnabled: liveAdjChecked });
  }
  const reminderChecked = aiEl('weekly-reminder-toggle').checked;
  const reminderDay = Number(aiEl('weekly-reminder-day').value);
  const loaded = setStore.getState().settings || {};
  const patch = {};
  if (reminderChecked !== !!loaded.weeklyReminderEnabled) patch.weeklyReminderEnabled = reminderChecked;
  if (reminderDay !== (loaded.weeklyReminderServiceDay ?? 0)) patch.weeklyReminderServiceDay = reminderDay;
  if (Object.keys(patch).length > 0) await setStore.getState().updateSettings(patch);
  closeStorageSettings();
}

(() => {
  aiEl('storage-settings-btn').addEventListener('click', openStorageSettings);
  aiEl('storage-change-btn').addEventListener('click', chooseStorageFolder);
  aiEl('storage-reset-btn').addEventListener('click', () => { storagePendingDir = ''; renderStoragePath(); });
  aiEl('storage-save-btn').addEventListener('click', saveStorageSettings);
  aiEl('storage-cancel-btn').addEventListener('click', closeStorageSettings);
  aiEl('weekly-reminder-toggle').addEventListener('change', renderWeeklyReminderDayRow);
  aiEl('storage-dialog').addEventListener('click', (e) => { if (e.target === aiEl('storage-dialog')) closeStorageSettings(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && aiEl('storage-dialog').style.display !== 'none') closeStorageSettings();
  });
})();

(() => {
  curveEl('ideal-curve-edit-btn').addEventListener('click', openCurveEditor);
  curveEl('curve-save-btn').addEventListener('click', saveCurveEditor);
  curveEl('curve-capture-btn').addEventListener('click', captureCurrentCurveAsIdeal);
  curveEl('curve-delete-btn').addEventListener('click', deleteCurveEditor);
  curveEl('curve-reset-btn').addEventListener('click', () => setCurveEditorBands(BAND_META.map(() => 0)));
  curveEl('curve-cancel-btn').addEventListener('click', closeCurveEditor);
  curveEl('curve-dialog').addEventListener('click', (e) => { if (e.target === curveEl('curve-dialog')) closeCurveEditor(); });
  curveEl('curve-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveCurveEditor();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && curveEl('curve-dialog').style.display !== 'none') closeCurveEditor();
  });
})();

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
  document.getElementById('grade-own-btn').addEventListener('click', openGuideDialog);
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
  const src = getReportCardSource();
  aiEl('phase-doubling-context').innerHTML = window.phaseDoublingState.contextLineHtml(
    src ? { filename: src.filename, detected: rcCallouts().phaseSignal } : null, escapeHtml);
  renderPhaseDoublingStep();
  aiEl('phase-doubling-dialog').style.display = 'flex';
}

function closePhaseDoublingDialog() {
  aiEl('phase-doubling-dialog').style.display = 'none';
}

// Bridges ReportCard.tsx's phase-doubling/feedback-ringout callout buttons to
// the still-inline dialogs they open (TD-001 slice 4, #422).
window.inlineDialogs = { openPhaseDoublingDialog, openFeedbackRingout };

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
  aiEl('ai-settings-btn').addEventListener('click', () => setStore.getState().openDialog());
  // Model chip + the AI-panel visibility gate both just mirror settingsStore
  // (SettingsPanel.tsx owns everything else about the dialog, TD-001 slice 3,
  // #421); loadSettings() in the boot IIFE below fires these on first load.
  setStore.subscribe((s) => updateModelChip(s.llmConfig));
  setStore.subscribe((s) => document.body.classList.toggle('ai-disabled', !(s.settings && s.settings.aiEnabled)));
  // Report-first-ux epic gate (#538): the body class is the branch point the
  // e17 slices mount against. Absent by default — with the flag off the
  // existing tab bar and 3-column workspace render exactly as before.
  setStore.subscribe((s) => document.body.classList.toggle('report-first-ux', window.reportFirstUxState.isEnabled(s.settings)));
  // #541: re-dock/re-rail the AI Engineer panel whenever the flag (or mode)
  // changes — both directions, since appendChild restores the exact original
  // #workspace slot.
  setStore.subscribe(() => syncAiDock());
  // #542: re-fold the workspace to a single column whenever the flag (or
  // mode) changes, so toggling it in Settings while on Recent reflows
  // immediately — same rationale as the AI dock re-sync above.
  setStore.subscribe(() => syncSingleColumn());
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
    if (nowEnabled !== dawWorkspaceWasEnabled && currentMode === 'live') syncSpectrumForMode('live');
    dawWorkspaceWasEnabled = nowEnabled;
  });
  // Experimental live adjustments gate (#522): re-sync the Live pane on an
  // actual flip so the area appears/disappears without a tab switch.
  let liveAdjustmentsWasEnabled = false;
  setStore.subscribe((s) => {
    const nowEnabled = window.liveAdjustmentsState.isEnabled(s.settings);
    if (nowEnabled !== liveAdjustmentsWasEnabled && currentMode === 'live') syncSpectrumForMode('live');
    liveAdjustmentsWasEnabled = nowEnabled;
  });
})();

/* ══ Init ══ */
// AI is off by default. Body starts with .ai-disabled (no flash of the AI
// panel); the settingsStore subscriber above reveals AI affordances once
// loadSettings() resolves. The AI code stays fully wired in — this only
// toggles UI visibility.
(async () => {
  await setStore.getState().loadSettings();
  const s = setStore.getState().settings;
  if (s && typeof s.idealProfile === 'string') idealProfileId = s.idealProfile;
  customIdealProfiles = window.idealCurves
    ? window.idealCurves.normalizeProfiles(s && s.customIdealProfiles, IP_GRID_FREQS)
    : [];
  initIdealProfileSelect();
  syncIdealProfile();
  // Reflect the effective default record folder (#482) now that settings have
  // loaded — root-markup.html's static text is only the cold-boot placeholder.
  if (!recordDir) document.getElementById('record-folder-path').textContent = defaultRecordFolderText();
})();

// Drives the report-card toolbar (Clear/Load/Print/Grade-own) + the
// #rc-upgrade momentum aside from analysisStore — ReportCardIsland (React)
// owns #report-card itself (TD-001 slice 4, #422).
anaStore.subscribe(syncReportCardChrome);
syncReportCardChrome(anaStore.getState(), anaStore.getState());
// #541: dock the AI Engineer panel correctly on first paint if the flag is
// already on when settings resolve (the subscribe above only fires on change).
syncAiDock();
// #542: same rationale — a flag-already-on first paint on Recent / Guide /
// Ring-Out must render single-column without requiring a tab click.
syncSingleColumn();

hydrateIcons(document);
setSpectrumState('empty', { text: 'Load a file to see the spectrum' });
// Load devices first so a saved rig can reconcile its device by name and clamp
// channels against the real device list; then apply the active rig (if any).
loadDevices().then(initRigs, initRigs);

// First-run onboarding (#69): show the welcome overlay on a genuine first launch.
void initOnboarding();
