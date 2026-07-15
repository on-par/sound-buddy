// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

'use strict';

/* ══ Icon set + report-card renderers — extracted to report-card.ts (#306),
   bridged onto window by App.tsx like spectrumDisplay (#305). ══ */
const {
  iconSvg, fmt, gradeRingHTML, profileMatchHTML,
  recTypePillClass, recTypePillHTML, buildMetricRows, metricRowsHTML,
  whyGradeHTML, recListHTML,
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

let currentMode = 'reportcard';
let currentAnalysis = null;
let currentFilePath = null;
let liveRunning = false;
let liveWindows = [];
// A stored report-card summary loaded from the Recent Services list (#147).
// Set by loadHistoryEntry(); renderReportCard() renders it via a reduced,
// summary-only card when set and no live/file analysis is backing the card.
let historyEntry = null;
// Per-strip collapsed state (#40), keyed by strip index. In-memory only for this
// slice (persisting into the rig is deferred). Read on every repaint so an
// incoming meter window never silently re-expands a folded strip.
let liveCollapsed = new Set();
function isStripCollapsed(idx) { return window.collapseState.isCollapsed(liveCollapsed, idx); }
// Named channel groups (#41): [{ name, members:[stripIndex,…] }]. Organizational
// only — strips render under their group's header in the live board and a group
// header folds all its members. Persisted into the active rig.
let channelGroups = [];
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
let rcFeedbackPeak = null; // last render's detected feedback ring, or null (#372)
let rcPhaseSignal = false; // last render's phase/doubling detection result (#372)

/* ══ Formatting helpers ══ */
// Resolve a strip's display name: label → backend name → "Ch N" (see #39).
function stripLabel(strip, ch, index) { return window.rigReconcile.resolveStripLabel(strip, ch, index); }
const MAX_LABEL_LEN = 40; // shared cap for both label entry points (config row + live header)
// The backend live channel for a strip index (or null before any tick), so the
// label fallback resolves the same way from every call site (#39).
function liveChannelAt(idx) { return lastLiveChannels ? lastLiveChannels[idx] : null; }
function fmtDur(s) { const m = Math.floor(s / 60); const sec = (s % 60).toFixed(1).padStart(4, '0'); return `${m}:${sec}`; }

/* ══ Band metadata / meter geometry — extracted to spectrum-display.ts (#305),
   bridged onto window by App.tsx like audioEngineProfiles (#309). ══ */
const {
  DB_MIN, DB_MAX, DIM_DB, HOT_DB, GRID, BAND_META, EQ_COLS,
  CURVE_VB, CURVE_FMIN, CURVE_FMAX,
  escapeHtml, fmtHz, toPct, levelMatchedTarget, niceTicks, smoothPath,
  spectrumCurveSVG, spectrumLegendHTML, bandLevelsFromCurve, bandDbFromSpectrum,
  veqBarsAndLabelsHTML, eqTargetLineSVG, eqCentroidHTML, eqBarsHTML,
  veqLoudestIdx, veqBandView, veqValBottom,
} = window.spectrumDisplay;

/* ══ Live-capture panel rendering — extracted to live-capture-panel.ts (#307),
   bridged onto window by App.tsx like spectrumDisplay/reportCard. ══ */
const {
  LIVE_BAND_KEYS, deviceListView, deviceChannelCount,
  liveBandCurve, veqArcSVG, liveMetersHTML,
} = window.liveCapturePanel;
// Renamed to avoid colliding with the zero-arg usedChannelCount() wrapper below.
const lcUsedChannelCount = window.liveCapturePanel.usedChannelCount;

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
    if (currentAnalysis) renderSpectrum(currentAnalysis.spectrum);
    if (currentMode === 'reportcard') renderReportCard();
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
  return activeProfile(currentAnalysis && currentAnalysis.spectrum);
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
  curveEl('curve-capture-btn').disabled = !(currentAnalysis && ipHasCurve(currentAnalysis.spectrum));
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
  if (currentAnalysis) renderSpectrum(currentAnalysis.spectrum);
  if (currentMode === 'reportcard') renderReportCard();
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
  if (!(currentAnalysis && ipHasCurve(currentAnalysis.spectrum))) {
    setCurveStatus('Analyze a file with spectrum data first.', 'err');
    return;
  }
  const existing = selectedCustomProfile();
  const profile = window.idealCurves.profileFromMeasuredCurve(currentAnalysis.spectrum.curve, IP_GRID_FREQS, {
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

function levelColor(db) { return db > -24 ? 'var(--meter-good)' : db > -36 ? 'var(--meter-hot)' : 'var(--meter-idle)'; }

// One band-meter row. opts: { showScale, showGrid, colorBy:'band'|'level', color, loudest }
function bandMeterHTML(label, range, db, opts = {}) {
  const pct = toPct(db);
  const fill = opts.colorBy === 'level' ? levelColor(db) : (opts.color || 'var(--gold-500)');
  const dim = db <= DIM_DB;
  const loud = !!opts.loudest;
  const grid = (opts.showGrid || opts.showScale)
    ? GRID.map(g => `<span class="bm-grid" style="left:${toPct(g)}%"></span>`).join('') : '';
  const scale = opts.showScale
    ? `<div class="bm-scale">${GRID.map(g => `<span style="left:${toPct(g)}%">${g}</span>`).join('')}</div>` : '';
  const rangeHTML = range ? `<div class="bm-range">${range}</div>` : '';
  return `<div class="bm">${scale}
    <div class="bm-row">
      <div class="bm-labelcol"><div class="bm-name${loud ? ' loud' : ''}">${label}</div>${rangeHTML}</div>
      <div class="bm-track">${grid}<div class="bm-fill${loud ? ' loud' : ''}" style="width:${pct}%;background:${fill};opacity:${dim ? 0.5 : 1}"></div></div>
      <div class="bm-val${db > HOT_DB ? ' hot' : ''}">${isFinite(db) ? db.toFixed(1) : '-∞'}</div>
    </div>
  </div>`;
}

/* ══ Spectrum panel rendering ══ */
function setSpectrumState(state, opts = {}) {
  const body = document.getElementById('spectrum-body');
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
function renderSpectrum(spectrum) {
  const body = document.getElementById('spectrum-body');
  const title = document.getElementById('spectrum-title');
  document.getElementById('stats-row').style.display = 'flex';

  // Preferred view: uniform EQ bars (AW-2) with the selected ideal target
  // overlaid (PRD 05). The time-sampled spectrogram + scrubber sit under it
  // and redraw #spectrum-chart for the selected frame (PRD 03). Degrade
  // gracefully to the same bar view driven by spectrum.bands directly when no
  // curve is available (e.g. --no-spectrum) — see renderBandMeters.
  if (ipHasCurve(spectrum)) {
    const profile = activeProfile(spectrum);
    const target = levelMatchedTarget(spectrum.curve, profile);
    const cmp = ipCompare(spectrum.curve, profile);
    const bandDb = bandDbFromSpectrum(spectrum);
    const targetBandDb = bandLevelsFromCurve({ freqs: spectrum.curve.freqs, db: target });
    title.textContent = SPECTRUM_TITLE.curve;
    // The bar chart is the "main curve"; the legend + match score sit directly
    // beneath it, and the time-sampled spectrogram + scrubber sit under that and
    // redraw #spectrum-chart for the selected frame (PRD 03).
    body.innerHTML = `<div class="spectrum-chart" id="spectrum-chart" role="img" aria-label="Frequency band levels">${eqBarsHTML(bandDb, targetBandDb)}</div>`
      + spectrumLegendHTML(profile, cmp, !idealProfileId)
      + eqCentroidHTML(spectrum)
      + buildFramesSectionHTML(spectrum);
    updateIdealProfileVisibility(spectrum);
    if (Array.isArray(spectrum.frames) && spectrum.frames.length) initSpectrogram(spectrum);
    return;
  }
  title.textContent = SPECTRUM_TITLE.meters;
  renderBandMeters(spectrum);
}

function renderBandMeters(spectrum) {
  const body = document.getElementById('spectrum-body');
  const bandDb = bandDbFromSpectrum(spectrum);
  body.innerHTML = `<div class="spectrum-chart" id="spectrum-chart" role="img" aria-label="Frequency band levels">${eqBarsHTML(bandDb)}</div>`
    + eqCentroidHTML(spectrum);
  // No whole-file curve in the meters fallback, so the target dropdown is moot.
  const wrap = document.getElementById('ideal-profile-wrap');
  if (wrap) wrap.style.display = 'none';
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
 * The whole-file curve (PRD 02) is rendered by spectrumCurveSVG above; the
 * scrubber redraws that same #spectrum-chart for a chosen frame. */
const HEAT_MIN = -78, HEAT_MAX = -12; // spectral-level window for the heat ramp
// Continuous quiet→gold→bright ramp (dark ≈ app bg → King Midas gold → warm white).
const HEAT_STOPS = [
  [0.0,  [0x08, 0x09, 0x0b]],
  [0.4,  [0x8a, 0x5a, 0x16]],
  [0.75, [0xeb, 0xb9, 0x3c]],
  [1.0,  [0xff, 0xf2, 0xd6]],
];
function normHeat(db) { return Math.max(0, Math.min(1, (db - HEAT_MIN) / (HEAT_MAX - HEAT_MIN))); }
function heatColor(db) {
  const t = normHeat(db);
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const [t1, c1] = HEAT_STOPS[i];
    if (t <= t1) {
      const [t0, c0] = HEAT_STOPS[i - 1];
      const f = (t - t0) / (t1 - t0 || 1);
      const ch = j => Math.round(c0[j] + (c1[j] - c0[j]) * f);
      return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
    }
  }
  const last = HEAT_STOPS[HEAT_STOPS.length - 1][1];
  return `rgb(${last[0]},${last[1]},${last[2]})`;
}
const CLASS_LABEL = { speech: 'Speech', music: 'Music', silence: 'Silence', unknown: '—' };
function classLabel(c) { return CLASS_LABEL[c] || '—'; }

// time → (columns) × frequency ↑ (rows, high freq on top) heatmap of the frames.
function heatmapSVG(frames, opts = {}) {
  const interactive = opts.interactive !== false;
  const nF = frames.length;
  const nB = frames[0].db.length;
  let cells = '';
  for (let x = 0; x < nF; x++) {
    const db = frames[x].db;
    for (let y = 0; y < nB; y++) {
      const b = nB - 1 - y; // row 0 = highest frequency
      cells += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${heatColor(db[b])}" shape-rendering="crispEdges"/>`;
    }
  }
  let cols = '';
  if (interactive) {
    for (let x = 0; x < nF; x++) cols += `<rect class="hm-col" x="${x}" y="0" width="1" height="${nB}" data-i="${x}"/>`;
  }
  return `<svg viewBox="0 0 ${nF} ${nB}" preserveAspectRatio="none" role="img" aria-label="Time-frequency spectrogram">${cells}${cols}</svg>`;
}

// Compact sparkline of one frame's dB grid, for the report-card thumbnails.
// (The analysis view uses the full PRD 02 spectrumCurveSVG; these stay small.)
function miniCurveSVG(db) {
  const VW = 600, VH = 150, padT = 8, padB = 10, ih = VH - padT - padB;
  const n = db.length;
  const xf = i => (n <= 1 ? VW / 2 : (i / (n - 1)) * VW);
  const yf = v => padT + (1 - normHeat(v)) * ih;
  let line = '', area = `M0 ${padT + ih}`;
  for (let i = 0; i < n; i++) {
    const X = xf(i).toFixed(1), Y = yf(db[i]).toFixed(1);
    line += (i ? 'L' : 'M') + X + ' ' + Y + ' ';
    area += ` L${X} ${Y}`;
  }
  area += ` L${VW} ${padT + ih} Z`;
  return `<svg viewBox="0 0 ${VW} ${VH}" preserveAspectRatio="none" role="img" aria-label="Frame spectral curve">
    <path d="${area}" fill="var(--gold-tint)" stroke="none"/>
    <path d="${line}" fill="none" stroke="var(--gold-500)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

function timeAxisHTML(frames) {
  const n = frames.length;
  if (n <= 1) return `<div class="spectro-axis"><span>${fmtDur(frames[0] ? frames[0].t : 0)}</span></div>`;
  const mid = frames[Math.floor(n / 2)];
  return `<div class="spectro-axis"><span>${fmtDur(frames[0].t)}</span><span>${fmtDur(mid.t)}</span><span>${fmtDur(frames[n - 1].t)}</span></div>`;
}

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
  initPlaybackTransport(currentAnalysis && currentAnalysis.filePath);
}

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
  const fp = currentAnalysis && currentAnalysis.ffprobe && currentAnalysis.ffprobe.format;
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

// Shared by the idle workspace and the running live board (#188): one toolbar
// carries Add track + a used/total count, plus Collapse/Expand all, so the
// pane reads the same whether idle or mid-capture. Add is disabled at the
// device channel cap or while a capture is running (config is locked, #38).
function liveWorkspaceToolbarHTML() {
  const total = selectedDeviceChannels();
  const used = usedChannelCount();
  const addDisabled = !window.trackWorkspace.addEnabled(used, total, liveRunning);
  // + New group (#190): names a group via the shared dialog and pushes it onto
  // channelGroups. Disabled mid-capture like every other config control (#38).
  // Arm all / Disarm all + armed count (#191), Record mode only (JS-gated — the
  // workspace sits outside #tab-live, so CSS gating can't reach it).
  const armHTML = liveMode === 'record'
    ? `<span class="live-ws-arm">`
      + `<span class="arm-count" id="live-ws-arm-count">${armedCount()} / ${channelConfig.length} armed</span>`
      + `<button type="button" class="ghost-btn sm" id="live-ws-arm-all"${liveRunning ? ' disabled' : ''} title="Arm every track for recording">Arm all</button>`
      + `<button type="button" class="ghost-btn sm" id="live-ws-disarm-all"${liveRunning ? ' disabled' : ''} title="Disarm every track">Disarm all</button>`
      + `</span>`
    : '';
  return `<div class="live-meters-toolbar">`
    + `<button type="button" class="ghost-btn" id="live-ws-add"${addDisabled ? ' disabled' : ''}>+ Add track</button>`
    + `<button type="button" class="ghost-btn" id="live-ws-new-group"${liveRunning ? ' disabled' : ''} title="Create a named channel group">+ New group</button>`
    + `<span class="cap" id="live-ws-cap">${used} / ${total} used</span>`
    + `<button type="button" class="ghost-btn" id="live-collapse-all">Collapse all</button>`
    + `<button type="button" class="ghost-btn" id="live-expand-all">Expand all</button>`
    + armHTML
    + `</div>`;
}

function renderLiveMeters(win) {
  const body = document.getElementById('spectrum-body');
  if (!win || !win.channels || win.channels.length === 0) {
    setSpectrumState('empty', { text: 'Waiting for live audio…' });
    return;
  }
  document.getElementById('stats-row').style.display = 'flex';
  const ipWrap = document.getElementById('ideal-profile-wrap');
  if (ipWrap) ipWrap.style.display = 'none'; // no whole-file curve in live mode

  // Once real channels arrive, remember them so label fallbacks (#39) can resolve
  // the backend device name.
  lastLiveChannels = win.channels;

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
    return;
  }
  body.innerHTML = liveWorkspaceToolbarHTML()
    + `<div class="meter-card sb-live-meters">${liveMetersHTML(win.channels, win.channels.map((c, i) => stripViewAt(i, c)), livePanelView())}</div>`;
  body.querySelectorAll('.sb-live-meters .live-ch-name').forEach(wireLiveNameEdit);
  applyLiveCollapsed();
}

// Persistent idle track workspace (#188): the center pane renders
// channelConfig as track lanes the moment the Live tab is active, not only
// once capture starts. Idle lanes are synthetic all-floor channels rendered
// through the same veqChannelHTML/liveMetersHTML path the running board uses,
// so grouping (#41) and per-strip collapse (#40) keep working for free. Shares
// liveWorkspaceToolbarHTML() with renderLiveMeters so Add/remove read
// consistently whether idle or (locked) mid-capture.
function renderLiveWorkspace() {
  const body = document.getElementById('spectrum-body');
  document.getElementById('stats-row').style.display = 'none';
  const ipWrap = document.getElementById('ideal-profile-wrap');
  if (ipWrap) ipWrap.style.display = 'none';

  const toolbar = liveWorkspaceToolbarHTML();

  if (window.trackWorkspace.isEmpty(channelConfig.length)) {
    body.innerHTML = toolbar
      + `<div class="spectrum-empty live-ws-empty">${iconSvg('waveform', 44)}<p>Add your first track to get started</p></div>`;
    return;
  }

  const idleChannels = channelConfig.map(() => window.trackWorkspace.idleChannel(LIVE_BAND_KEYS));
  body.innerHTML = toolbar + `<div class="meter-card sb-live-meters idle">${liveMetersHTML(idleChannels, idleChannels.map((c, i) => stripViewAt(i, c)), livePanelView())}</div>`;
  body.querySelectorAll('.sb-live-meters .live-ch-name').forEach(wireLiveNameEdit);
  applyLiveCollapsed();
}

// Thin adapters bridging this module's mutable state (channelConfig,
// liveRunning, channelGroups, …) onto the StripView/PanelView shapes the pure
// live-capture-panel.ts functions take as parameters (#307).
function stripViewAt(idx, ch) {
  return {
    strip: channelConfig[idx] || null,
    displayName: stripLabel(channelConfig[idx], ch, idx),
    collapsed: isStripCollapsed(idx),
    armed: window.armState.isArmed(channelConfig[idx]),
    groupIndex: window.groupState.groupOf(channelGroups, idx),
  };
}
function livePanelView() {
  return { deviceChannels: selectedDeviceChannels(), liveRunning, liveMode, groups: channelGroups };
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
  });
  // A group header reads collapsed when all its members are (#41).
  wrap.querySelectorAll('.live-group-head[data-group]').forEach((head) => {
    const g = parseInt(head.dataset.group, 10);
    if (g < 0) return;
    const members = (channelGroups[g] && channelGroups[g].members) || [];
    const allCollapsed = members.length > 0 && members.every((m) => isStripCollapsed(m));
    head.classList.toggle('collapsed', allCollapsed);
    const btn = head.querySelector('.live-group-fold');
    if (btn) btn.setAttribute('aria-expanded', allCollapsed ? 'false' : 'true');
  });
}
document.getElementById('spectrum-body').addEventListener('click', (e) => {
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
  // Group header fold (#41): collapse/expand every member strip at once.
  const gfold = e.target.closest('.live-group-fold');
  if (gfold) {
    const g = parseInt(gfold.closest('.live-group-head').dataset.group, 10);
    const members = (channelGroups[g] && channelGroups[g].members) || [];
    const allCollapsed = members.length > 0 && members.every((m) => isStripCollapsed(m));
    const target = !allCollapsed; // collapse the group unless it's already fully collapsed
    members.forEach((m) => { if (isStripCollapsed(m) !== target) liveCollapsed = window.collapseState.toggle(liveCollapsed, m); });
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

// Inline track definition (#189): the header's kind toggle + source picker(s)
// fire 'change' (not 'click'), so they need their own delegated listener —
// same delegation rationale as the click handler above, so the wiring
// survives renderLiveWorkspace()/renderLiveMeters() rebuilding the pane.
// Routes through renderChannelConfig() (not a bare renderLiveWorkspace()) so
// the capture lock and the workspace stay in sync.
document.getElementById('spectrum-body').addEventListener('change', (e) => {
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

/* ══ Mode tabs ══ */
document.querySelectorAll('.mode-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const mode = tab.dataset.mode;
    if (mode === currentMode) return;
    // Live/Soundcheck replace the spectrum area with unrelated content and
    // Soundcheck has its own playback transport — don't leave the analyzed
    // file playing silently in the background with no visible control (#180).
    if (mode === 'live' || mode === 'soundcheck') pauseTransportAudio();

    document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    // Set currentMode before the mode-specific work so a throw inside it (e.g.
    // renderReportCard on an unexpected analysis shape) can't leave currentMode
    // stale and lock the user out of navigating back via the same-tab guard (#177).
    currentMode = mode;

    if (mode === 'reportcard') {
      // #177: the report card now shares the screen with the spectrum instead
      // of replacing the workspace. #workspace stays visible (CSS lays the two
      // out side by side via #stage; body.rc-active folds the Source panel
      // away so both get room). The .active toggle is retained so existing
      // DOM assertions keep holding. syncSpectrumForMode keeps the spectrum in
      // the right state beside the card — otherwise a stale Live/Soundcheck
      // spectrum (or pre-analysis empty state) would show next to the grade.
      document.body.classList.add('rc-active');
      document.getElementById('reportcard-view').classList.add('active');
      syncSpectrumForMode('reportcard');
      renderReportCard();
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
  const body = document.getElementById('spectrum-body');
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
    if (currentAnalysis) renderSpectrum(currentAnalysis.spectrum);
    else setSpectrumState('empty', { text: 'Select a recent analysis to load its report card' });
  } else if (mode === 'guide') {
    // Build Guide (#367) has no file-loading UI of its own either — mirror
    // the `recent` tailored empty state so it doesn't show the misleading
    // generic "Load a file…" copy.
    title.textContent = SPECTRUM_TITLE.curve;
    if (currentAnalysis) renderSpectrum(currentAnalysis.spectrum);
    else setSpectrumState('empty', { text: 'Follow the build order, then load a recording to grade it' });
  } else if (mode === 'dir') {
    // Directory (#293) is roadmap context until batch analysis ships in
    // v1.1 — mirror the `recent`/`guide` tailored empty state instead of
    // promising a folder analysis that can't run yet.
    title.textContent = SPECTRUM_TITLE.curve;
    if (currentAnalysis) renderSpectrum(currentAnalysis.spectrum);
    else setSpectrumState('empty', { text: 'Batch analysis is coming in v1.1 — analyze recordings from Report Card' });
  } else {
    // renderSpectrum sets the header to match what it draws (curve vs meters);
    // seed the curve label for the pre-analysis empty state.
    title.textContent = SPECTRUM_TITLE.curve;
    if (currentAnalysis) renderSpectrum(currentAnalysis.spectrum);
    else setSpectrumState('empty', { text: 'Load a file to see the spectrum' });
  }
}

/* ══ File mode ══ */
const fileDropzone = document.getElementById('file-dropzone');
// Captured before loadFile()/Clear ever swap in a filename, so Clear can restore
// this exact resting markup instead of hand-duplicating it (#206).
const fileDropzoneDefaultHTML = fileDropzone.innerHTML;
fileDropzone.addEventListener('click', async () => { const fp = await sb.openFileDialog(); if (fp) loadFile(fp); });
fileDropzone.addEventListener('dragover', (e) => { e.preventDefault(); fileDropzone.classList.add('dragover'); });
fileDropzone.addEventListener('dragleave', () => fileDropzone.classList.remove('dragover'));
fileDropzone.addEventListener('drop', (e) => {
  e.preventDefault(); fileDropzone.classList.remove('dragover');
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) loadFile(files[0].path);
});

// Global (used by smoke test + menu-open).
function loadFile(fp) {
  currentFilePath = fp;
  const name = fp.split('/').pop() || fp;
  fileDropzone.classList.add('loaded');
  fileDropzone.innerHTML =
    `<div class="dz-icon" data-icon="file-audio"></div>
     <div class="dz-body"><span class="dz-title">${name}</span><span class="dz-meta">${fp}</span></div>`;
  hydrateIcons(fileDropzone);
  document.getElementById('analyze-btn').disabled = false;
}

document.getElementById('analyze-btn').addEventListener('click', () => { if (currentFilePath) runFileAnalysis(currentFilePath); });

// Coarse stage progress (#125) — the three stages run in parallel, so this
// just checks off each stage's row as its subprocess returns. Registered
// once at module scope; setSpectrumState('loading') (re)renders the rows
// each run, so there's nothing stale to clear between runs.
sb.onAnalysisProgress((data) => {
  if (!data.stage || data.status !== 'done') return;
  const row = document.querySelector(`#spectrum-body .stage-row[data-stage="${data.stage}"]`);
  if (row) row.classList.add('done');
});

async function runFileAnalysis(fp) {
  pauseTransportAudio(); // don't let a previous file's playback bleed through the loading state (#180)
  setSpectrumState('loading');
  document.getElementById('analyze-btn').disabled = true;
  // Disable Clear while an analysis is in flight so it can't null currentAnalysis
  // mid-run and then have this continuation re-set it + flip the card back (#206).
  document.getElementById('reportcard-clear-btn').disabled = true;
  // Same reasoning for Load a file… (#208): it stays visible for the whole
  // in-flight window (isLiveCard only flips false once currentAnalysis is
  // set below), so without this a second click could fire a concurrent pick.
  document.getElementById('reportcard-load-btn').disabled = true;

  const result = await sb.analyzeFile({ filePath: fp });

  document.getElementById('analyze-btn').disabled = false;
  document.getElementById('reportcard-load-btn').disabled = false;

  if (result.cancelled) {
    // Cancelled mid-run — return to the pre-analysis idle state (no report
    // card, no stuck spinner). Keep currentFilePath so the user can retry
    // without re-picking the file; currentAnalysis is left untouched.
    setSpectrumState('empty');
    document.getElementById('reportcard-clear-btn').disabled = !currentAnalysis;
    return;
  }

  if (!result.success || !result.data) {
    setSpectrumState('error', { text: result.error || 'Analysis failed' });
    document.getElementById('reportcard-clear-btn').disabled = !currentAnalysis;
    return;
  }

  currentAnalysis = result.data;
  // A fresh analysis always wins over a loaded history entry (#147).
  historyEntry = null;
  persistAnalysisSummary();
  document.getElementById('analyze-btn').innerHTML = iconSvg('waveform', 16) + 'Re-analyze';
  updateStatsRow(currentAnalysis.sox, currentAnalysis.spectrum);
  renderSpectrum(currentAnalysis.spectrum);
  document.getElementById('reportcard-print-btn').disabled = false;
  document.getElementById('grade-own-btn').disabled = false;
  document.getElementById('reportcard-clear-btn').disabled = !currentAnalysis;
  // File input now lives in the Report Card tab's empty state (#203) — flip
  // it over to the rendered card the moment analysis succeeds instead of
  // leaving the dropzone showing behind a result nobody switched to see.
  if (currentMode === 'reportcard') renderReportCard();
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
  renderChannelConfig();
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
  channelConfig.splice(idx, 1);
  // Drop the removed strip from any group and shift higher indices down so no
  // dangling reference remains (#41).
  channelGroups = window.groupState.pruneStrip(channelGroups, idx);
  renderChannelConfig();
}

// Reset the config to the device default: first ≤2 channels as mono strips.
function resetChannelConfig() {
  const n = selectedDeviceChannels();
  channelConfig = [];
  for (let i = 0; i < Math.min(2, n); i++) channelConfig.push({ kind: 'mono', a: i, b: (i + 1) % Math.max(n, 1), armed: true });
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
}

// Lock/unlock every capture-config control while a capture runs (#38). stream.py
// is spawned with a fixed device/channels/mode/dirs set and can't honor a
// mid-session change, so freezing avoids corrupting the take. Idempotent, and
// re-selects the live-rendered workspace children each call. The rig picker has
// its own lock (setRigControlsEnabled) but is guarded here too, defensively.
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
  document.querySelectorAll('#spectrum-body .live-ch-kind, #spectrum-body .live-ch-src, #spectrum-body .live-ch-group').forEach(set);
  // Group header rename/delete controls (#190), frozen mid-capture with the rest.
  document.querySelectorAll('#spectrum-body .live-group-rename, #spectrum-body .live-group-del').forEach(set);
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
  liveWindows = [];
  // A live capture always wins over a loaded history entry (#147).
  historyEntry = null;
  setRigControlsEnabled(false);
  setCaptureControlsLocked(true); // freeze device/mode/folder/channels/sliders (#38)

  document.getElementById('rec-offer').style.display = 'none';
  document.getElementById('live-start-btn').style.display = 'none';
  document.getElementById('live-stop-btn').style.display = 'inline-flex';
  document.getElementById('live-indicator').style.display = 'flex';
  document.querySelector('#live-indicator .live-txt').textContent = liveMode === 'record' ? 'REC' : 'LIVE';
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
  });

  if (!result.success) {
    stopLive();
    setSpectrumState('error', { text: result.error || 'Failed to start live capture' });
  } else {
    const rate = Math.round(1 / intervalSecs);
    document.getElementById('live-status').textContent =
      liveMode === 'record' ? `Recording · meters ${rate}/s` : `Monitoring · meters ${rate}/s`;
    startLiveCountdown(llmIntervalSecs);
  }
});

document.getElementById('live-stop-btn').addEventListener('click', () => stopLive());

async function stopLive() {
  liveRunning = false;
  setRigControlsEnabled(true);
  setCaptureControlsLocked(false); // re-enable config (also the failed-Start path) (#38)
  clearLiveCountdown();
  const result = await sb.stopLive();
  document.getElementById('live-start-btn').style.display = 'inline-flex';
  document.getElementById('live-stop-btn').style.display = 'none';
  document.getElementById('live-indicator').style.display = 'none';
  document.getElementById('live-status').style.display = 'none';
  document.getElementById('window-badge').textContent = '';
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
}

let lastSessionDir = null;
document.getElementById('rec-offer-btn').addEventListener('click', () => {
  if (!lastSessionDir) return;
  document.getElementById('rec-offer').style.display = 'none';
  sb.revealPath(lastSessionDir);
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
  document.getElementById('record-folder-path').textContent = recordDir || '~/Music/Sound Buddy';

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

/* ══ IPC event listeners ══ */
sb.onLiveEvent((data) => {
  if (!data || data.error) {
    if (data?.error) setSpectrumState('error', { text: `Live error: ${data.error}` });
    return;
  }

  // Every event (fast meter ticks + slower window ticks) drives the live view,
  // coalesced to one repaint per animation frame.
  if (currentMode === 'live') scheduleLiveMeters(data);
  if (data.channels && data.channels.length > 0) updateLiveStatsRow(data.channels[0]);

  // Only the heavier window ticks (which carry masking + window #) accumulate as
  // LLM trend context and feed the report card.
  if (data.type === 'window' || typeof data.window === 'number') {
    liveWindows.push(data);
    if (liveWindows.length > 10) liveWindows.shift();
    document.getElementById('window-badge').textContent = `Window #${data.window}`;
  }
});

sb.onAnalysisResult((data) => { if (data.type === 'stats' && data.data) currentAnalysis = data.data; });

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

    if (!currentAnalysis) {
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
  } else if (currentAnalysis) {
    await sb.triggerLlmAnalysis({ mode: 'file', analysis: currentAnalysis });
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

function getReportCardSource() {
  if (currentAnalysis) {
    const { sox, spectrum, ffprobe, loudness } = currentAnalysis;
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
  if (liveWindows.length > 0) {
    const win = liveWindows[liveWindows.length - 1];
    const ch = win.channels && win.channels[0];
    if (ch) {
      return {
        filename: `Live capture — ${ch.name || 'Main'} (window #${win.window})`,
        rms: ch.rms, peak: ch.peak, dynamicRange: null, clipping: ch.clipping, centroid: ch.centroid,
        bands: {
          subBass: ch.bands.sub_bass, bass: ch.bands.bass, lowMid: ch.bands.low_mid, mid: ch.bands.mid,
          highMid: ch.bands.high_mid, presence: ch.bands.presence, brilliance: ch.bands.brilliance,
        },
      };
    }
  }
  return null;
}

// Persist a discrete report-card summary for the recent-services list (#147).
// Fire-and-forget: never block or fail the report card on a storage error
// (main logs and swallows). Only called from the file-analysis success path, so
// it runs once per completed analysis and never for live-capture cards.
function persistAnalysisSummary() {
  try {
    const src = getReportCardSource();
    if (!src || !currentAnalysis) return; // file analyses only
    sb.saveAnalysisSummary({
      sourceFilename: src.filename,
      gradeLetter: grading.computeGrade(src),
      score: grading.computeScore(src),
      recordingType: grading.analyzeRecordingType(src).label,
      topFixes: grading.computeRecommendations(src).slice(0, 3),
    }).catch((err) => console.warn('persistAnalysisSummary failed', err));
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
      <span class="recent-date">${escapeHtml(new Date(s.date).toLocaleString())}</span>
    </div>`;
  }).join('');

  list.querySelectorAll('.recent-row').forEach((row) => {
    row.addEventListener('click', () => loadHistoryEntry(recentSummaries[parseInt(row.dataset.idx, 10)]));
  });
}

// Loads a stored summary into the report card view without re-running any
// analysis — the row's record is all the report card ever reads (#147).
function loadHistoryEntry(summary) {
  pauseTransportAudio(); // don't leave a previous file's playback running behind the summary card
  historyEntry = summary;
  // A history entry always wins over whatever was previously on the card, so
  // the summary-only branch in renderReportCard() is guaranteed to fire
  // regardless of what was showing before this click.
  currentAnalysis = null;
  currentFilePath = null;
  if (!liveRunning) liveWindows = [];
  // Restore the file dropzone to its resting state too — otherwise it would
  // still show a previously-loaded file as "loaded" with Re-analyze enabled,
  // and clicking it would silently no-op on the now-null currentFilePath.
  fileDropzone.classList.remove('loaded');
  fileDropzone.innerHTML = fileDropzoneDefaultHTML;
  hydrateIcons(fileDropzone);
  const analyzeBtn = document.getElementById('analyze-btn');
  analyzeBtn.disabled = true;
  analyzeBtn.innerHTML = iconSvg('waveform', 16) + 'Analyze';
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
// navigation the user already knows (renderRingout runs inside it).
document.getElementById('rc-feedback-ringout-btn').addEventListener('click', () => {
  const ro = window.feedbackRingout;
  if (rcFeedbackPeak) {
    ringoutCut = ro.suggestCut(rcFeedbackPeak.freq);
    ringoutStepIndex = ro.stepIndexById('cut');
  }
  document.querySelector('.mode-tab[data-mode="ringout"]').click();
  ringoutSetStatus(rcFeedbackPeak ? ro.handoffStatus(rcFeedbackPeak.freq) : '');
});

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

/* ══ Content type — speech/music delineation (PRD 04) ══ */
const CONTENT_TYPE_LABELS = { speech: 'Speech', music: 'Music', mixed: 'Mixed', silence: 'Silence' };
const SEG_CLASS_LABELS = { speech: 'Speech', music: 'Music', silence: 'Silence', unknown: 'Unknown' };

function fmtClock(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// Populate the content-type pill + timeline ribbon. Both hide when the analysis
// predates the classifier (older files, live capture) so nothing empty renders.
function renderContentType(src) {
  const pill = document.getElementById('rc-content-type');
  const ribbonWrap = document.getElementById('rc-ribbon-wrap');
  const ribbon = document.getElementById('rc-ribbon');
  const legend = document.getElementById('rc-ribbon-legend');

  const label = src.contentType ? CONTENT_TYPE_LABELS[src.contentType] : null;
  if (!label) {
    pill.style.display = 'none';
  } else {
    pill.style.display = 'inline-flex';
    pill.className = 'rc-contenttype ' + src.contentType;
    pill.textContent = label;
  }

  const segs = Array.isArray(src.segments) ? src.segments.filter(s => s && s.end > s.start) : [];
  const span = segs.length > 0 ? segs[segs.length - 1].end - segs[0].start : 0;
  if (segs.length === 0 || !(span > 0)) {
    ribbonWrap.style.display = 'none';
    return;
  }
  ribbonWrap.style.display = 'flex';

  const segClass = (c) => (SEG_CLASS_LABELS[c] ? c : 'unknown');
  ribbon.innerHTML = segs.map(s => {
    const cls = segClass(s.class);
    const pct = ((s.end - s.start) / span) * 100;
    return `<span class="seg seg-${cls}" style="width:${pct}%" title="${SEG_CLASS_LABELS[cls]} · ${fmtClock(s.start)}–${fmtClock(s.end)}"></span>`;
  }).join('');

  const present = [...new Set(segs.map(s => segClass(s.class)))];
  legend.innerHTML = present.map(c =>
    `<span class="lg"><span class="sw seg-${c}"></span>${SEG_CLASS_LABELS[c]}</span>`).join('');
}

// Metric status pills, the grade ring, and the ideal-profile match block are
// built by the shared report-card.ts module (#306) via the window.reportCard
// bridge above; this just wires the resolved DOM node.
function renderProfileMatch(profile, cmp) {
  document.getElementById('rc-profile').innerHTML = profileMatchHTML(profile, cmp, !idealProfileId);
}

// Renders a stored summary-only record (#147) — no metrics/bands/spectrum/
// frames, since that raw data was never persisted (see AnalysisSummary). The
// grade/score are read straight from the record: they were frozen at analysis
// time, and recomputing via grading.* is impossible without the raw metrics
// (and would risk silently disagreeing with what was actually graded).
function renderReportCardFromHistory(summary) {
  const empty = document.getElementById('rc-empty');
  const content = document.getElementById('rc-content');
  const printBtn = document.getElementById('reportcard-print-btn');
  const clearBtn = document.getElementById('reportcard-clear-btn');
  const gradeOwnBtn = document.getElementById('grade-own-btn');

  empty.style.display = 'none';
  content.style.display = 'block';
  printBtn.disabled = false;
  gradeOwnBtn.disabled = false;
  // No file backs this card — there is nothing for Clear to release (#206).
  clearBtn.disabled = true;
  // A history/summary card is never a live-capture card (#208).
  document.getElementById('reportcard-load-btn').style.display = 'none';

  document.getElementById('rc-filename').textContent = summary.sourceFilename;
  document.getElementById('rc-date').textContent = new Date(summary.date).toLocaleString();
  document.getElementById('rc-ring').innerHTML = gradeRingHTML(summary.gradeLetter, summary.score);

  const rt = document.getElementById('rc-rec-type');
  rt.className = 'rc-rectype pill';
  rt.textContent = summary.recordingType;

  // These sections all need raw analysis data the stored summary doesn't have.
  document.getElementById('rc-content-type').style.display = 'none';
  document.getElementById('rc-ribbon-wrap').style.display = 'none';
  document.getElementById('rc-profile-section').style.display = 'none';
  document.getElementById('rc-metrics-section').style.display = 'none';
  document.getElementById('rc-why-section').style.display = 'none';
  document.getElementById('rc-bands-section').style.display = 'none';
  document.getElementById('rc-frames-section').style.display = 'none';
  // No deviation data on a stored summary — never emphasize/launch a check
  // we can't back with real analysis (#370).
  document.getElementById('rc-phase-doubling').style.display = 'none';
  document.getElementById('rc-feedback-ringout').style.display = 'none';
  rcFeedbackPeak = null;
  rcPhaseSignal = false;

  document.getElementById('rc-recommendations').innerHTML = recListHTML(summary.topFixes || [], true);

  lastReportGrade = summary.gradeLetter;
  renderUpgradeMomentum();
}

function renderReportCard() {
  // A history entry only ever backs the card when no live/file analysis is
  // present — a fresh analysis or a running live capture always wins (#147).
  if (historyEntry && !currentAnalysis && liveWindows.length === 0) {
    renderReportCardFromHistory(historyEntry);
    return;
  }

  const src = getReportCardSource();
  const empty = document.getElementById('rc-empty');
  const content = document.getElementById('rc-content');
  const printBtn = document.getElementById('reportcard-print-btn');
  const clearBtn = document.getElementById('reportcard-clear-btn');
  const gradeOwnBtn = document.getElementById('grade-own-btn');
  const loadBtn = document.getElementById('reportcard-load-btn');
  // Mirrors getReportCardSource()'s priority (currentAnalysis wins, else
  // liveWindows) — true exactly when the card on screen is the live-capture
  // fallback, which has no file backing it for Clear or the dropzone (#208).
  const isLiveCard = !currentAnalysis && liveWindows.length > 0;

  if (!src) {
    empty.style.display = 'flex';
    content.style.display = 'none';
    printBtn.disabled = true;
    gradeOwnBtn.disabled = true;
    clearBtn.disabled = true;
    // Empty state already shows the dropzone.
    loadBtn.style.display = 'none';
    // No analysis data to check for a phase/doubling signature (#370).
    document.getElementById('rc-phase-doubling').style.display = 'none';
    document.getElementById('rc-feedback-ringout').style.display = 'none';
    rcFeedbackPeak = null;
    rcPhaseSignal = false;
    // No card to improve on — never leave the upgrade card beside the empty
    // state (e.g. after a live capture clears the last analysis).
    lastReportGrade = null;
    renderUpgradeMomentum();
    return;
  }
  empty.style.display = 'none';
  content.style.display = 'block';
  printBtn.disabled = false;
  gradeOwnBtn.disabled = false;
  // Clear only makes sense when the card is backed by a file analysis — a
  // live-capture card (currentAnalysis null, liveWindows populated) has no
  // file to clear, so leaving Clear enabled would no-op/flicker (#206).
  clearBtn.disabled = !currentAnalysis;
  // The live-capture card hides the file dropzone behind it (#rc-empty only
  // renders when no card is showing) — surface this button as the only
  // in-window way to load a different file while it's up (#208).
  loadBtn.style.display = isLiveCard ? '' : 'none';
  // Undo any summary-only hiding a previous historyEntry render left behind
  // (#147) — a real analysis always shows every section its own data affects.
  document.getElementById('rc-metrics-section').style.display = '';
  document.getElementById('rc-why-section').style.display = '';
  document.getElementById('rc-bands-section').style.display = '';

  document.getElementById('rc-filename').textContent = src.filename;
  document.getElementById('rc-date').textContent = new Date().toLocaleString();

  const grade = grading.computeGrade(src);
  const score = grading.computeScore(src);
  document.getElementById('rc-ring').innerHTML = gradeRingHTML(grade, score);

  const recType = grading.analyzeRecordingType(src);
  const rt = document.getElementById('rc-rec-type');
  rt.className = recTypePillClass(recType);
  rt.innerHTML = recTypePillHTML(recType);

  renderContentType(src);

  // Ideal profile match (PRD 05) — only when a whole-file curve is available.
  const profSection = document.getElementById('rc-profile-section');
  let cmp = null;
  if (ipHasCurve(src)) {
    const profile = activeProfile(src);
    cmp = ipCompare(src.curve, profile);
    if (cmp) { profSection.style.display = ''; renderProfileMatch(profile, cmp); }
    else profSection.style.display = 'none';
  } else {
    profSection.style.display = 'none';
  }

  // Doubling/Phase Bug Detector launch callout (#370) — always shown on a
  // real card, visually emphasized when the deviation curve shows a
  // comb-filter signature. A real analysis always has deviation data to
  // check, unlike the history-summary/empty branches below.
  const phaseSection = document.getElementById('rc-phase-doubling');
  const phaseSignal = window.phaseDoublingState.detectPhaseSignal({ deviation: cmp ? cmp.deviation : undefined });
  rcPhaseSignal = phaseSignal;
  phaseSection.style.display = '';
  phaseSection.classList.toggle('detected', phaseSignal);
  document.getElementById('rc-phase-doubling-title').textContent = phaseSignal
    ? 'We spotted a possible phase or doubling issue'
    : 'Hearing a weird, doubled, or robotic sound?';
  document.getElementById('rc-phase-doubling-sub').textContent = phaseSignal
    ? 'Your spectrum shows a comb-filter pattern — run the check to find the duplicate path.'
    : 'Walk through the common phase & routing bugs — no console access needed.';

  // Feedback Ring-Out launch callout (#372) — mirrors the #370 phase callout:
  // always shown on a real card, emphasized + frequency-seeded when the
  // whole-file curve has a narrow resonant spike.
  rcFeedbackPeak = window.feedbackRingout.detectFeedbackSignal(
    src.curve || null, window.audioEngineSpectral.findSpectralPeaks);
  const roSection = document.getElementById('rc-feedback-ringout');
  const roCallout = window.feedbackRingout.reportCardCallout(rcFeedbackPeak);
  roSection.style.display = '';
  roSection.classList.toggle('detected', roCallout.detected);
  document.getElementById('rc-feedback-ringout-title').textContent = roCallout.title;
  document.getElementById('rc-feedback-ringout-sub').textContent = roCallout.sub;
  document.getElementById('rc-feedback-ringout-btn-label').textContent = roCallout.buttonLabel;

  // Metrics — built by the shared report-card.ts module (#306) from the
  // injected grading pill classifiers (#132), so a threshold change moves the
  // displayed target with the grade.
  document.getElementById('rc-metrics-body').innerHTML = metricRowsHTML(buildMetricRows(src, grading));

  // Why this grade (#133/#136) — the per-deduction breakdown, straight from
  // the pure grading module so it can never disagree with the letter it
  // explains; whyGradeHTML also discloses any rule skipped because its metric
  // wasn't measured (live captures have no dynamic range).
  const explain = grading.explainGrade(src);
  document.getElementById('rc-why').innerHTML = whyGradeHTML(explain);

  // Band breakdown
  document.getElementById('rc-bands').innerHTML = BAND_META.map(b => {
    const db = src.bands[b.key];
    const diff = grading.bandDiffFromOthers(src.bands, b.key);
    let vc = 'ok', vt = 'Balanced';
    if (diff > grading.CONFIG.bandBalance.hotDiff) { vc = 'hot'; vt = 'Too Hot'; }
    else if (diff < grading.CONFIG.bandBalance.quietDiff) { vc = 'quiet'; vt = 'Too Quiet'; }
    return `<div class="rc-band-row">${bandMeterHTML(b.label, b.range, db, { colorBy: 'level' })}<span class="rc-band-verdict ${vc}">${vt}</span></div>`;
  }).join('');

  // Spectrum over time (heatmap thumbnail + representative frame curves)
  renderReportCardFrames(src);

  // Recommendations
  document.getElementById('rc-recommendations').innerHTML = recListHTML(grading.computeRecommendations(src), false);

  // Post-report-card upgrade moment (#58): the "Keep improving" card is score-
  // aware, so it needs this render's grade. It manages its own visibility
  // (free-only, once-per-7-day dismissal).
  lastReportGrade = grade;
  renderUpgradeMomentum();
}

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

// Report-card "Spectrum Over Time": a static heatmap thumbnail + start/middle/
// loudest representative frame curves. Hidden when the analysis has no frames
// (e.g. a live capture), so the card still prints cleanly.
function renderReportCardFrames(src) {
  const section = document.getElementById('rc-frames-section');
  const frames = src.frames;
  if (!Array.isArray(frames) || frames.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';

  document.getElementById('rc-heatmap').innerHTML = heatmapSVG(frames, { interactive: false });

  const n = frames.length;
  let loudest = 0;
  for (let i = 1; i < n; i++) if (frames[i].rms > frames[loudest].rms) loudest = i;
  const picks = [
    { i: 0, tag: 'Start' },
    { i: Math.floor(n / 2), tag: 'Middle' },
    { i: loudest, tag: 'Loudest' },
  ];
  // Collapse duplicate indices (short files) so we never show the same frame twice.
  const seen = new Set();
  const unique = picks.filter(p => (seen.has(p.i) ? false : seen.add(p.i)));

  document.getElementById('rc-frame-curves').innerHTML = unique.map(p => {
    const f = frames[p.i];
    return `<div class="rc-frame">
      <div class="rc-frame-head"><span class="rc-frame-tag">${p.tag}</span><span class="rc-frame-t">${fmtDur(f.t)} · ${classLabel(f.class)}</span></div>
      <div class="rc-frame-curve">${miniCurveSVG(f.db)}</div>
    </div>`;
  }).join('');
}

document.getElementById('reportcard-print-btn').addEventListener('click', () => window.print());
document.getElementById('reportcard-feedback-btn').addEventListener('click', () => {
  openFeedbackDialog();
});

// #206: once a report card is showing, the file-loading dropzone is hidden
// behind it (it only lives in the empty state). Clear resets to that empty
// state so a different file can be loaded in-window — no menu navigation or
// relaunch needed.
document.getElementById('reportcard-clear-btn').addEventListener('click', () => {
  if (!currentAnalysis) return;
  // Release the <audio> element so a re-load of the SAME file starts at 0:00
  // instead of resuming at its last scrub position (ensurePlaybackAudio keys
  // on sbAudioPath === filePath).
  releasePlaybackAudio();
  sbAudioPath = null;
  sbGeneration++; // invalidate any in-flight ensurePlaybackAudio
  currentAnalysis = null;
  currentFilePath = null;
  // A finished live-capture session's rolling buffer would otherwise make
  // getReportCardSource() fall through to that stale live card instead of the
  // empty state (#206) — but leave an actively-running session's buffer alone
  // so its live meters don't blip empty.
  if (!liveRunning) liveWindows = [];
  // Restore the dropzone to its "browse for a file" resting state so the next
  // load starts from a clean slate (loadFile swaps in the loaded filename).
  fileDropzone.classList.remove('loaded');
  fileDropzone.innerHTML = fileDropzoneDefaultHTML;
  hydrateIcons(fileDropzone);
  const analyzeBtn = document.getElementById('analyze-btn');
  analyzeBtn.disabled = true;
  analyzeBtn.innerHTML = iconSvg('waveform', 16) + 'Analyze';
  setSpectrumState('empty');
  renderReportCard(); // flips #rc-content → #rc-empty (when no live card remains)
});

// #208: while a live-capture card is showing, the file dropzone is hidden behind it
// (#rc-empty only renders when no card is present) and Clear is disabled (no file to
// release). This toolbar button — visible only for the live-capture card — opens the
// picker and analyzes directly. The resulting file card replaces the live card via
// getReportCardSource() priority; liveWindows is left untouched so the Live tab's
// window history survives.
document.getElementById('reportcard-load-btn').addEventListener('click', async () => {
  try {
    const fp = await sb.openFileDialog();
    if (fp) { loadFile(fp); await runFileAnalysis(fp); }
  } catch { /* user cancelled */ }
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
  let releaseUrl = null;

  sb.onUpdateAvailable((info) => {
    releaseUrl = info.url;
    text.textContent = `Sound Buddy ${info.version} is available.`;
    banner.classList.add('show');
  });
  sb.onUpdateStatus((s) => {
    // Feedback for the manual "Check for Updates…" menu item.
    if (s.state === 'up-to-date') {
      text.textContent = `You're up to date (v${s.version}).`;
      dlBtn.style.display = 'none';
      banner.classList.add('show');
      setTimeout(() => banner.classList.remove('show'), 4000);
    } else if (s.state === 'error') {
      text.textContent = 'Could not check for updates. Try again later.';
      dlBtn.style.display = 'none';
      banner.classList.add('show');
      setTimeout(() => banner.classList.remove('show'), 5000);
    }
  });
  dlBtn.addEventListener('click', () => sb.openReleasePage(releaseUrl || undefined));
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
  closeStorageSettings();
}

(() => {
  aiEl('storage-settings-btn').addEventListener('click', openStorageSettings);
  aiEl('storage-change-btn').addEventListener('click', chooseStorageFolder);
  aiEl('storage-reset-btn').addEventListener('click', () => { storagePendingDir = ''; renderStoragePath(); });
  aiEl('storage-save-btn').addEventListener('click', saveStorageSettings);
  aiEl('storage-cancel-btn').addEventListener('click', closeStorageSettings);
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

/* ══ Feedback dialog (#144) ══ */
// The unchecked path stays byte-for-byte identical to the #143 mailto
// behavior — Send just fires openFeedback(). The checkbox reveals the log
// file in Finder at check-time (not send-time) so the drag-in instructions
// are visible before the mail client opens.
const FEEDBACK_DIAG_REVEALED_TEXT = 'Your log file is now selected in Finder — drag it into the email before sending. It never leaves your machine unless you attach it.';
const FEEDBACK_DIAG_MISSING_TEXT = 'No diagnostic log exists yet — try again after using the app.';
const FEEDBACK_DIAG_ERROR_TEXT = 'Could not reveal your log file — try unchecking and checking the box again.';

function openFeedbackDialog() {
  aiEl('feedback-attach-diagnostics').checked = false;
  const hint = aiEl('feedback-diag-hint');
  hint.style.display = 'none';
  hint.textContent = '';
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

function sendFeedback() {
  void window.soundBuddy.openFeedback();
  closeFeedbackDialog();
}

(() => {
  aiEl('feedback-dialog-cancel').addEventListener('click', closeFeedbackDialog);
  aiEl('feedback-dialog-send').addEventListener('click', sendFeedback);
  aiEl('feedback-attach-diagnostics').addEventListener('change', onFeedbackAttachToggle);
  aiEl('feedback-dialog').addEventListener('click', (e) => { if (e.target === aiEl('feedback-dialog')) closeFeedbackDialog(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && aiEl('feedback-dialog').style.display !== 'none') closeFeedbackDialog();
  });
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

function openPhaseDoublingDialog() {
  phaseDoublingStep = 0;
  const src = getReportCardSource();
  aiEl('phase-doubling-context').innerHTML = window.phaseDoublingState.contextLineHtml(
    src ? { filename: src.filename, detected: rcPhaseSignal } : null, escapeHtml);
  renderPhaseDoublingStep();
  aiEl('phase-doubling-dialog').style.display = 'flex';
}

function closePhaseDoublingDialog() {
  aiEl('phase-doubling-dialog').style.display = 'none';
}

(() => {
  aiEl('rc-phase-doubling-btn').addEventListener('click', openPhaseDoublingDialog);
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
})();

hydrateIcons(document);
setSpectrumState('empty', { text: 'Load a file to see the spectrum' });
// Load devices first so a saved rig can reconcile its device by name and clamp
// channels against the real device list; then apply the active rig (if any).
loadDevices().then(initRigs, initRigs);

// First-run onboarding (#69): show the welcome overlay on a genuine first launch.
void initOnboarding();
