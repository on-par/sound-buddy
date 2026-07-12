// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure spectrum-panel rendering module (#305, epic #302): the 7-band EQ bars,
// ideal-curve target overlay, analyzer curve SVG, legend, and centroid readout,
// extracted verbatim (behavior-identical) from inline-app.js's closure so the
// logic is a single, unit-tested source of truth reusable by both the runtime
// (via the `window.spectrumDisplay` bridge — see App.tsx) and <SpectrumDisplay>.
// Deliberately dependency-free (no DOM, no imports) so it can be lifted as-is
// for the Expo mobile port (#300/#301).

export type BandKey = 'subBass' | 'bass' | 'lowMid' | 'mid' | 'highMid' | 'presence' | 'brilliance';

export interface SpectrumCurve {
  freqs: number[];
  db: number[];
}

export interface SpectrumFrame {
  t: number;
  db: number[];
  rms?: number;
  class?: string;
}

export interface SpectrumData {
  bands?: Partial<Record<BandKey, number>>;
  curve?: SpectrumCurve;
  frames?: SpectrumFrame[];
  spectralCentroid?: number;
  contentType?: string;
}

export interface IdealProfileLike {
  id?: string;
  label: string;
  dbOffsets: number[];
}

export interface CurveComparison {
  matchScore: number;
}

interface BandMeta {
  key: BandKey;
  label: string;
  range: string;
  color: string;
  lo: number;
  hi: number;
}

export interface BarColumn {
  key: string;
  label: string;
  color: string;
  range?: string;
  left: string;
  width: string;
  center: string;
}

export interface XTick {
  f: number;
  label: string;
}

export interface SpectrumCurveSVGOpts {
  uid?: string;
  vbH?: number;
  yMin?: number;
  yMax?: number;
  wantPaths?: boolean;
}

export interface SpectrumCurvePaths {
  svg: string;
  line: string;
  area: string;
  centroidMark: string;
}

/* ══ Formatting helpers ══ */
export function escapeHtml(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
export function fmtHz(hz: number): string {
  if (hz >= 1000) return (hz / 1000).toFixed(1) + ' kHz';
  return Math.round(hz) + ' Hz';
}

/* ══ Band metadata / meter geometry ══ */
export const DB_MIN = -72, DB_MAX = -3;
export const DIM_DB = -60; // at/below: band is idle → dimmed, never counts as "loudest"
export const HOT_DB = -24; // above: numeric readout emphasized as running hot
export const GRID = [-60, -48, -36, -24, -12, -6];
export const BAND_META: BandMeta[] = [
  { key: 'subBass',    label: 'Sub Bass',   range: '20–60 Hz',    color: 'var(--band-sub)',        lo: 20,   hi: 60    },
  { key: 'bass',       label: 'Bass',        range: '60–250 Hz',   color: 'var(--band-bass)',       lo: 60,   hi: 250   },
  { key: 'lowMid',     label: 'Low Mid',     range: '250–500 Hz',  color: 'var(--band-low-mid)',    lo: 250,  hi: 500   },
  { key: 'mid',        label: 'Mid',         range: '500 Hz–2 kHz',color: 'var(--band-mid)',        lo: 500,  hi: 2000  },
  { key: 'highMid',    label: 'High Mid',    range: '2–4 kHz',     color: 'var(--band-high-mid)',   lo: 2000, hi: 4000  },
  { key: 'presence',   label: 'Presence',    range: '4–6 kHz',     color: 'var(--band-presence)',   lo: 4000, hi: 6000  },
  { key: 'brilliance', label: 'Brilliance',  range: '6–20 kHz',    color: 'var(--band-brilliance)', lo: 6000, hi: 20000 },
];

export function toPct(db: number): number {
  const c = Math.max(DB_MIN, Math.min(DB_MAX, db));
  return (c - DB_MIN) / (DB_MAX - DB_MIN) * 100;
}

// Mean of the finite entries of xs (mirrors audio-engine profiles' finiteMean).
function finiteMean(xs: number[]): number {
  let s = 0, n = 0;
  for (const x of xs) { if (Number.isFinite(x)) { s += x; n++; } }
  return n > 0 ? s / n : 0;
}

/* Level-match a profile's relative dbOffsets onto the measured curve's mean so
   the dashed target sits at the same level as the measured curve (PRD 05). */
export function levelMatchedTarget(curve: SpectrumCurve, profile: IdealProfileLike): number[] {
  const mMean = finiteMean(curve.db), tMean = finiteMean(profile.dbOffsets);
  return profile.dbOffsets.map((v) => v + (mMean - tMean));
}

/* ── EQ spectrum curve (PRD 02) ─────────────────────────────────────────────
 * A FabFilter Pro-Q–style analyzer: log-frequency X, auto-ranged dB Y, gold
 * curve with a gradient fill, band-range tints, and the centroid marker. */
export const CURVE_VB = { w: 900, h: 440, ml: 52, mr: 16, mt: 18, mb: 34 };
export const X_TICKS: XTick[] = [
  { f: 20, label: '20' }, { f: 50, label: '50' }, { f: 100, label: '100' },
  { f: 200, label: '200' }, { f: 500, label: '500' }, { f: 1000, label: '1k' },
  { f: 2000, label: '2k' }, { f: 5000, label: '5k' }, { f: 10000, label: '10k' },
  { f: 20000, label: '20k' },
];
export const CURVE_FMIN = 20, CURVE_FMAX = 20000;

// "Nice" evenly-spaced axis ticks spanning [lo, hi].
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [Math.round(lo)];
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const first = Math.ceil(lo / step) * step;
  const ticks: number[] = [];
  for (let v = first; v <= hi + step * 1e-6; v += step) ticks.push(Math.round(v * 10) / 10);
  return ticks;
}

// Catmull-Rom → cubic Bézier for a smooth curve through all points.
export function smoothPath(pts: Array<{ x: number; y: number }>): string {
  if (pts.length < 2) return pts.length ? `M${pts[0].x},${pts[0].y}` : '';
  let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += `C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

// Build the analyzer SVG from a { freqs, db } curve. `targetDb` (optional, same
// grid as curve, already level-matched) overlays a dashed ideal target (PRD 05).
// `opts` (optional) reuses the component in other contexts (live per-channel arcs):
//   uid  — suffix for the gradient/clip ids, so several instances can coexist
//   vbH  — compact viewBox height override
//   yMin/yMax — fixed dB range instead of auto-ranging (stable across live ticks);
//               points are clamped into the range (mirroring toPct) so the curve
//               hugs the plot edge instead of being cut off by the clip-path
//   wantPaths — return { svg, line, area, centroidMark } so a caller repainting
//               per tick can patch the two path `d`s + centroid in place
// Returns '' if unusable.
export function spectrumCurveSVG(
  curve: SpectrumCurve | null | undefined,
  centroid: number | undefined,
  targetDb: number[] | null | undefined,
  opts: SpectrumCurveSVGOpts = {}
): string | SpectrumCurvePaths {
  if (!curve || !Array.isArray(curve.freqs) || !Array.isArray(curve.db)) return '';
  const hasTarget = Array.isArray(targetDb) && targetDb.length >= curve.db.length;
  const n = Math.min(curve.freqs.length, curve.db.length);
  const raw: Array<{ f: number; db: number; t: number | null }> = [];
  for (let i = 0; i < n; i++) {
    const f = curve.freqs[i], db = curve.db[i];
    if (isFinite(f) && f > 0 && isFinite(db)) raw.push({ f, db, t: hasTarget ? (targetDb as number[])[i] : null });
  }
  if (raw.length < 2) return '';

  const { w, ml, mr, mt, mb } = CURVE_VB;
  const h = opts.vbH || CURVE_VB.h;
  const x0 = ml, x1 = w - mr, y0 = mt, y1 = h - mb;
  const logMin = Math.log10(CURVE_FMIN), logSpan = Math.log10(CURVE_FMAX) - logMin;
  const xForFreq = (f: number) => x0 + (Math.log10(Math.max(CURVE_FMIN, Math.min(CURVE_FMAX, f))) - logMin) / logSpan * (x1 - x0);

  // Fixed Y range when requested; otherwise auto-range to the curve (and the
  // target, so the dashed overlay never clips) with padding; widen a
  // degenerate (flat) range.
  let lo: number, hi: number;
  if (isFinite(opts.yMin as number) && isFinite(opts.yMax as number) && (opts.yMax as number) > (opts.yMin as number)) {
    lo = opts.yMin as number; hi = opts.yMax as number;
    for (const p of raw) {
      p.db = Math.max(lo, Math.min(hi, p.db));
      if (isFinite(p.t as number)) p.t = Math.max(lo, Math.min(hi, p.t as number));
    }
  } else {
    const dbs = raw.map((p) => p.db);
    if (hasTarget) for (const p of raw) if (isFinite(p.t as number)) dbs.push(p.t as number);
    let dMin = Math.min(...dbs), dMax = Math.max(...dbs);
    if (dMax - dMin < 1) { dMin -= 6; dMax += 6; }
    const pad = Math.max(3, (dMax - dMin) * 0.08);
    lo = dMin - pad; hi = dMax + pad;
  }
  const yForDb = (db: number) => y1 - (db - lo) / (hi - lo) * (y1 - y0);

  const pts = raw.map((p) => ({ x: xForFreq(p.f), y: yForDb(p.db) }));
  const targetPath = hasTarget
    ? smoothPath(raw.filter((p) => isFinite(p.t as number)).map((p) => ({ x: xForFreq(p.f), y: yForDb(p.t as number) })))
    : '';

  // Band-range tints along the x axis.
  const tints = BAND_META.map((b) => {
    const bx0 = xForFreq(b.lo), bx1 = xForFreq(b.hi);
    return `<rect class="sb-band-tint" x="${bx0.toFixed(1)}" y="${y0}" width="${(bx1 - bx0).toFixed(1)}" height="${y1 - y0}" fill="${b.color}"/>`;
  }).join('');

  // Horizontal dB gridlines + labels.
  const yGrid = niceTicks(lo, hi, 5).filter((v) => v > lo && v < hi).map((v) => {
    const y = yForDb(v).toFixed(1);
    return `<line class="sb-grid-line" x1="${x0}" y1="${y}" x2="${x1}" y2="${y}"/>`
      + `<text class="sb-y-label" x="${x0 - 8}" y="${(+y + 4).toFixed(1)}">${v}</text>`;
  }).join('');

  // Vertical frequency gridlines + labels.
  const xGrid = X_TICKS.map((t) => {
    const x = xForFreq(t.f).toFixed(1);
    return `<line class="sb-grid-line" x1="${x}" y1="${y0}" x2="${x}" y2="${y1}"/>`
      + `<text class="sb-x-label" x="${x}" y="${y1 + 22}">${t.label}</text>`;
  }).join('');

  const line = smoothPath(pts);
  const area = `${line} L${pts[pts.length - 1].x.toFixed(2)},${y1} L${pts[0].x.toFixed(2)},${y1} Z`;

  // Spectral-centroid marker.
  let centroidMark = '';
  if (isFinite(centroid as number) && (centroid as number) >= CURVE_FMIN && (centroid as number) <= CURVE_FMAX) {
    const cx = xForFreq(centroid as number).toFixed(1);
    centroidMark = `<line class="sb-centroid-line" x1="${cx}" y1="${y0}" x2="${cx}" y2="${y1}"/>`
      + `<text class="sb-centroid-label" x="${cx}" y="${y0 + 12}">${fmtHz(centroid as number)}</text>`;
  }

  const uid = opts.uid ? `-${opts.uid}` : '';
  const svg = `<svg class="sb-spectrum-curve" viewBox="0 0 ${w} ${h}" role="img" aria-label="Frequency response curve">
    <defs>
      <linearGradient id="sb-spectrum-fill${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style="stop-color:var(--gold-500)" stop-opacity="0.34"/>
        <stop offset="1" style="stop-color:var(--gold-500)" stop-opacity="0"/>
      </linearGradient>
      <clipPath id="sb-spectrum-plot${uid}"><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}"/></clipPath>
    </defs>
    ${tints}
    ${yGrid}
    ${xGrid}
    <line class="sb-axis-base" x1="${x0}" y1="${y1}" x2="${x1}" y2="${y1}"/>
    <g clip-path="url(#sb-spectrum-plot${uid})">
      <path class="sb-curve-fill" d="${area}" fill="url(#sb-spectrum-fill${uid})"/>
      ${targetPath ? `<path class="sb-target-line" d="${targetPath}"/>` : ''}
      <path class="sb-curve-line" d="${line}"/>
    </g>
    <g class="sb-centroid">${centroidMark}</g>
  </svg>`;
  return opts.wantPaths ? { svg, line, area, centroidMark } : svg;
}

// Legend + match score shown beneath the analyzer curve (PRD 05). `isAuto`
// renders the " (auto)" suffix when the active profile was chosen by content
// type rather than an explicit pick (caller passes !idealProfileId).
export function spectrumLegendHTML(profile: IdealProfileLike, cmp: CurveComparison | null | undefined, isAuto: boolean): string {
  const score = cmp ? `<span class="sl-score"><span class="num">${cmp.matchScore}</span><span class="cap">Match</span></span>` : '';
  const label = escapeHtml(profile.label);
  return `<div class="spectrum-legend">
    <span class="sl-item"><span class="sl-swatch measured"></span>Measured</span>
    <span class="sl-item"><span class="sl-swatch target"></span>Target · ${label}${isAuto ? ' (auto)' : ''}</span>
    ${score}
  </div>`;
}

/* ── Uniform-width EQ bars (AW-2, #178) ──
 * 7 equal-width columns, one per BAND_META band — unlike VEQ_BANDS (#30),
 * which sizes each bar to its band's log-frequency span so it sits under the
 * arc's tint, these columns are all the same width, like a hardware graphic
 * EQ. Shared by renderSpectrum's curve path and renderBandMeters' fallback so
 * the analysis view reads the same regardless of which data is available. */
export const EQ_GAP = 1.4; // % inset per side, mirrors #30's VEQ_GAP
export const EQ_COLS: BarColumn[] = BAND_META.map((b, i) => {
  const w = 100 / BAND_META.length;
  return { key: b.key, label: b.label, color: b.color, range: b.range, left: (i * w + EQ_GAP).toFixed(3), width: (w - 2 * EQ_GAP).toFixed(3), center: (i * w + w / 2).toFixed(3) };
});

// Bucket a fine {freqs, db} curve into 7 BAND_META band levels (mean dB of
// samples whose freq falls within [lo, hi]) — for contexts that only carry
// the full-resolution curve (scrub frames, the level-matched target) rather
// than spectrum.bands' precomputed per-band levels.
export function bandLevelsFromCurve(curve: SpectrumCurve): number[] {
  return BAND_META.map((b) => {
    let sum = 0, n = 0;
    curve.freqs.forEach((f, i) => {
      if (Number.isFinite(f) && f >= b.lo && f <= b.hi && Number.isFinite(curve.db[i])) { sum += curve.db[i]; n++; }
    });
    return n ? sum / n : -120;
  });
}
// spectrum.bands' per-band levels, floored to silence (-120) for any missing
// or non-finite entry — mirrors liveBandCurve's same guard (#30) so a stale
// or partial analysis payload degrades gracefully instead of rendering
// "NaN"/"-Infinity" or throwing inside veqBandView's db.toFixed(1).
export function bandDbFromSpectrum(spectrum: SpectrumData): number[] {
  const bands = spectrum.bands || {};
  return BAND_META.map((b) => { const v = bands[b.key]; return Number.isFinite(v) ? (v as number) : -120; });
}
// Bars + value readouts + labels shared by the Live-tab per-channel EQ (#30,
// veqChannelHTML) and these analysis-view bars — geometry (cols) and levels
// (dbArray) differ, everything else (loud/dim/hot styling, markup shape) is
// identical. cols entries with a `range` get a title tooltip on their bar.
export function veqBarsAndLabelsHTML(cols: BarColumn[], dbArray: number[], loudestIdx: number): { bars: string; labels: string } {
  const bars = cols.map((b, i) => {
    const v = veqBandView(dbArray[i]);
    const cls = 'veq-bar' + (i === loudestIdx ? ' loud' : '') + (v.dim ? ' dim' : '');
    return `<div class="${cls}" data-band="${b.key}" style="left:${b.left}%;width:${b.width}%;height:${v.pct.toFixed(2)}%;background:${b.color}"${b.range ? ` title="${b.range}"` : ''}></div>`
      + `<div class="veq-val${v.hot ? ' hot' : ''}${v.dim ? ' dim' : ''}" style="left:${b.center}%;bottom:${veqValBottom(v.pct)}%">${v.val}</div>`;
  }).join('');
  const labels = cols.map((b, i) =>
    `<span class="veq-label${i === loudestIdx ? ' loud' : ''}" style="left:${b.center}%">${b.label}</span>`).join('');
  return { bars, labels };
}
// Dashed target line connecting each band's target level at its column
// center — an SVG overlay (viewBox 0 0 100 100 matches the bar percentages
// directly) so it still reads as "the curve you're chasing" over the bars.
export function eqTargetLineSVG(targetBandDb: number[]): string {
  const pts = EQ_COLS.map((b, i) => `${b.center},${(100 - toPct(targetBandDb[i])).toFixed(2)}`);
  return `<svg class="eq-target-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <path class="sb-target-line" style="vector-effect:non-scaling-stroke" d="M${pts.join(' L')}"/>
  </svg>`;
}
export function eqCentroidHTML(spectrum: SpectrumData): string {
  return (spectrum.spectralCentroid ?? 0) > 0 ? `<div class="eq-centroid">Centroid · ${fmtHz(spectrum.spectralCentroid as number)}</div>` : '';
}
// bandDb: 7 levels in BAND_META order. targetDb (optional): same shape,
// overlaid as the dashed target line.
export function eqBarsHTML(bandDb: number[], targetDb?: number[]): string {
  const loudestIdx = veqLoudestIdx(bandDb);
  const { bars, labels } = veqBarsAndLabelsHTML(EQ_COLS, bandDb, loudestIdx);
  const grid = GRID.map((g) => `<div class="eq-grid" style="bottom:${toPct(g)}%"></div>`).join('');
  const yAxis = GRID.map((g) => `<span style="bottom:${toPct(g)}%">${g}</span>`).join('');
  const targetSvg = Array.isArray(targetDb) && targetDb.length === EQ_COLS.length ? eqTargetLineSVG(targetDb) : '';
  return `<div class="eq-yaxis">${yAxis}</div>
    <div class="eq-main">
      <div class="eq-plot">${grid}<div class="veq-bars">${bars}</div>${targetSvg}</div>
      <div class="veq-labels">${labels}</div>
    </div>`;
}

// Per-band presentation state, shared by the build and patch paths so they
// can't drift. Loudest emphasis only means something when signal is present:
// during silence (all bands idle) no bar glows.
export function veqLoudestIdx(db: number[]): number {
  const max = Math.max(...db);
  return max > DIM_DB ? db.indexOf(max) : -1;
}
export function veqBandView(db: number): { pct: number; dim: boolean; hot: boolean; val: string } {
  return { pct: toPct(db), dim: db <= DIM_DB, hot: db > HOT_DB, val: db.toFixed(1) };
}
// Readouts ride each bar's top; cap so they stay inside the plot at full scale.
export function veqValBottom(pct: number): string { return Math.min(pct, 90).toFixed(2); }
