// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure report-card rendering module (#306, epic #302): the icon set, grade
// ring + score, recording-type pill, ideal-profile match, metrics table with
// status pills, "Why this grade" breakdown, and recommendations list,
// extracted verbatim (behavior-identical) from inline-app.js's closure so the
// markup is a single, unit-tested source of truth reusable by both the
// runtime (via the `window.reportCard` bridge — see App.tsx) and
// <ReportCard>. Dependency-free except `escapeHtml`, imported from
// ./spectrum-display so both modules share one escaping implementation.
//
// Grading itself (grade/score/recommendations/recording-type/explanation)
// stays entirely in the pure, unit-tested grading.js module (#130) — this
// module only builds HTML from grading's outputs, which callers inject via
// the narrow GradingPillApi interface (constitution: deps are injected, not
// imported globally).

import { MAX_NOTE_LENGTH } from '../../electron/ipc/api';
import {
  escapeHtml, toPct, DIM_DB, HOT_DB, GRID, BAND_META,
  heatmapSVG, miniCurveSVG, fmtDur, classLabel, pickRepresentativeFrames,
  type SpectrumFrame,
} from './spectrum-display';

export type PillTone = 'good' | 'check' | 'issue' | 'info';

export interface RecordingType {
  type: string;
  label: string;
  note: string;
  tone: PillTone;
}

export interface GradeDeduction {
  rule: string;
  measured: string;
  target: string;
  letterImpact: string;
}

export interface GradeSkip {
  rule: string;
  measured: string;
  note: string;
  letterImpact: string;
}

export interface GradeExplanation {
  grade: string;
  clipping: boolean;
  deductions: GradeDeduction[];
  notMeasured: GradeSkip[];
}

export interface MetricRow {
  name: string;
  note?: string | null;
  value: string;
  unit: string;
  tone: PillTone;
  target: string | null;
}

export interface ProfileRegion {
  label: string;
  deviation: number;
}

export interface ProfileComparison {
  matchScore: number;
  deviation: number[];
  topOver?: ProfileRegion | null;
  topUnder?: ProfileRegion | null;
}

// The getReportCardSource() shape (inline-app.js:2414–2446).
export interface ReportCardSource {
  filename: string;
  rms: number;
  peak: number;
  dynamicRange: number | null;
  clipping: boolean;
  centroid: number | undefined;
  bands: Record<string, number>;
  // Per-channel band data for live-capture sources only, used to attribute a
  // band-balance recommendation to the loudest contributing channel (#262).
  // Absent on file analyses and on history entries predating this feature.
  channels?: Array<{ label?: string; name?: string; bands: Record<string, number> }>;
  curve?: unknown;
  contentType?: string | null;
  segments?: unknown;
  frames?: unknown;
  // EBU R128 loudness measurement (#134) — absent on live-capture cards and
  // history entries predating this feature.
  lufsIntegrated?: number | null;
  loudnessRange?: number | null;
  truePeakDbtp?: number | null;
}

// The narrow slice of grading.js's report-card pill classifiers this module
// needs, injected by the caller (inline-app.js via window.grading; tests via
// createRequire) rather than imported globally.
export interface GradingPillApi {
  rcPeakStatus(peak: number, clipping: boolean): PillTone;
  rcRmsStatus(rms: number): PillTone;
  rcDrStatus(dr: number | null): PillTone;
  rcCentroidStatus(centroid: number | undefined): PillTone;
  rcLufsStatus(lufs: number): PillTone;
  rcTruePeakStatus(truePeak: number): PillTone;
  rcMetricTarget(key: string): string | null;
}

/* ══ Lucide icon subset (from the design system) ══ */
const ICON_PATHS: Record<string, string> = {
  waveform: 'M2 12h2l2-7 3 15 3-11 2 6 2-3h4',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  disc: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  'file-audio': 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 15a2 2 0 0 0 2 2M14 15a2 2 0 0 1-2 2M11 13v6',
  folder: 'M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2z',
  radio: 'M12 12m-2 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0M4.9 19.1a10 10 0 0 1 0-14.2M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M19.1 4.9a10 10 0 0 1 0 14.2',
  'clipboard-check': 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 14l2 2 4-4',
  check: 'M20 6 9 17l-5-5',
  'alert-triangle': 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
  x: 'M18 6 6 18M6 6l12 12',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  play: 'M6 3l14 9-14 9z',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  square: 'M5 5h14v14H5z',
  sparkles: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 3v4M21 5h-4M5 17v4M7 19H3',
  upload: 'M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
  download: 'M12 3v12M7 10l5 5 5-5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
  'chevron-down': 'M6 9l6 6 6-6',
  settings: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  circle: 'M12 12m-9 0a9 9 0 1 0 18 0 9 9 0 1 0-18 0',
  plus: 'M12 5v14M5 12h14',
  lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 10 0v4',
  'hard-drive': 'M22 12H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11zM6 16h.01M10 16h.01',
  clock: 'M12 12m-10 0a10 10 0 1 0 20 0 10 10 0 1 0-20 0M12 6v6l4 2',
  'external-link': 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3',
};

export function iconSvg(name: string, size = 16, opts: { stroke?: string; strokeWidth?: number } = {}): string {
  const d = ICON_PATHS[name];
  if (!d) return '';
  const stroke = opts.stroke || 'currentColor';
  const sw = opts.strokeWidth || 1.75;
  const segs = d.split('M').filter(Boolean).map((s) => `<path d="M${s}"/>`).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;display:block" aria-hidden="true">${segs}</svg>`;
}

/* ══ Formatting helpers ══ */
export function fmt(n: number, d = 1): string {
  if (!isFinite(n)) return '-∞';
  return n.toFixed(d);
}

/* ══ Status pills ══
   Metric status pills read their thresholds from the shared grading CONFIG
   (#131) via the injected GradingPillApi, so the pill and the letter grade
   can never disagree — the classifiers themselves live in grading.js. */
export function pillLabel(tone: PillTone): string {
  return tone === 'good' ? 'Good' : tone === 'check' ? 'Check' : tone === 'issue' ? 'Issue' : 'Info';
}
export function pillIcon(tone: PillTone): string {
  return tone === 'good' ? 'check' : tone === 'issue' ? 'x' : tone === 'info' ? 'info' : 'alert-triangle';
}
export function statusPillHTML(tone: PillTone, label?: string): string {
  return `<span class="pill sm ${tone}">${iconSvg(pillIcon(tone), 11, { strokeWidth: 2.25 })}${label || pillLabel(tone)}</span>`;
}

/* ══ Grade ring ══ */
export const GRADE_RING_PX = 168;
export const GRADE_RING_STROKE = 8;

export function gradeRingHTML(grade: string, score: number): string {
  const px = GRADE_RING_PX, stroke = GRADE_RING_STROKE;
  const r = (px - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = Math.max(0, Math.min(100, score)) / 100 * c;
  // grade can come from a disk-stored history record (#147), not just a fresh
  // computeGrade() output — strip to letters only for the CSS custom property
  // name and escape separately for display, so a crafted record can't break
  // out of the style attribute or inject markup as element content.
  const colorKey = (grade || '').toLowerCase().replace(/[^a-z]/g, '');
  const color = `var(--grade-${colorKey})`;
  const safeGrade = escapeHtml(grade);
  return `<div class="grade-ring" style="width:${px}px;height:${px}px">
    <svg width="${px}" height="${px}">
      <circle cx="${px / 2}" cy="${px / 2}" r="${r}" fill="none" stroke="var(--surface-inset)" stroke-width="${stroke}"/>
      <circle cx="${px / 2}" cy="${px / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
        stroke-linecap="round" stroke-dasharray="${dash} ${c}"
        style="transition:stroke-dasharray var(--dur-slow) var(--ease-out);filter:drop-shadow(0 0 6px color-mix(in srgb, ${color} 40%, transparent))"/>
    </svg>
    <div class="center">
      <span class="letter" style="color:${color}">${safeGrade}</span>
      <span class="score">${score}<span class="slash">/100</span></span>
    </div>
  </div>
  <span class="rc-ring-label">Overall Grade</span>`;
}

/* ── Ideal profile match (PRD 05) ── */
export function fmtDev(d: number): string {
  return (d >= 0 ? '+' : '') + d.toFixed(1) + ' dB';
}
export function deviationMiniCurve(dev: number[]): string {
  const W = 700, H = 64, padL = 4, padT = 4;
  const plotW = W - padL * 2, mid = H / 2;
  const maxAbs = Math.max(3, ...dev.map((d) => Math.abs(d)));
  const bw = plotW / dev.length;
  const bars = dev.map((d, i) => {
    const x = padL + i * bw;
    const h = Math.abs(d) / maxAbs * (mid - padT);
    const y = d >= 0 ? mid - h : mid;
    const cls = d >= 0 ? 'devbar-over' : 'devbar-under';
    return `<rect class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${Math.max(0.5, h).toFixed(1)}"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Per-frequency deviation from the ideal target">
    <line class="zero" x1="${padL}" y1="${mid}" x2="${padL + plotW}" y2="${mid}"/>${bars}</svg>`;
}

// The string-building body of the former renderProfileMatch — `isAuto`
// replaces the idealProfileId global read (same move #305 made for
// spectrumLegendHTML's isAuto param): true when the active profile was
// auto-selected by content type rather than an explicit user pick.
export function profileMatchHTML(profile: { label: string }, cmp: ProfileComparison, isAuto: boolean): string {
  const label = escapeHtml(profile.label);
  let regions = '';
  if (cmp.topOver && cmp.topOver.deviation >= 1) regions += `<span class="rcp-region over">Over · <b>${cmp.topOver.label}</b> ${fmtDev(cmp.topOver.deviation)}</span>`;
  if (cmp.topUnder && cmp.topUnder.deviation <= -1) regions += `<span class="rcp-region under">Under · <b>${cmp.topUnder.label}</b> ${fmtDev(cmp.topUnder.deviation)}</span>`;
  if (!regions) regions = `<span class="rcp-region">Well matched across the spectrum.</span>`;
  return `
    <div class="rcp-head">
      <span class="rcp-name">Target: ${label}${isAuto ? ' <span style="color:var(--text-muted)">(auto)</span>' : ''}</span>
      <span class="rcp-score"><span class="num">${cmp.matchScore}</span><span class="cap">/100 closeness</span></span>
    </div>
    <div class="rcp-regions">${regions}</div>
    <div class="rcp-dev">${deviationMiniCurve(cmp.deviation)}</div>`;
}

/* ── Recording-type pill ── */
export function recTypePillClass(recType: RecordingType): string {
  return 'rc-rectype pill ' + recType.tone;
}
export function recTypePillHTML(recType: RecordingType): string {
  return `${iconSvg(pillIcon(recType.tone), 13)}<span class="txt">${recType.label} — ${recType.note}</span>`;
}

/* ── Metrics table ──
   Target = the config-sourced "good" range for the metric (#132), read from
   the injected g.rcMetricTarget so a threshold change moves the displayed
   target with the grade. Metrics with no target in config (Clipping), or with
   no measured value (DR/Centroid absent), get null → the row renders an
   explicit "—". */
// Whether a loudness field (#134) has a real, displayable value — measured
// values feed the row; absent/NaN values omit the row entirely so cards from
// before this feature (or a failed ffmpeg measurement) render unchanged.
// -Infinity is a legitimate loudness measurement (ffmpeg reports "-inf dBFS"
// true peak for fully-silent audio — a muted channel or pre-service silence —
// and parseEbur128Summary parses it as such rather than throwing, #134). Only
// NaN (or a missing field) means "not measured"; fmt() already renders
// -Infinity as "-∞", same as the pre-existing Peak/RMS rows.
// #135 — True Peak and Integrated Loudness now mirror the grade rules via
// rcTruePeakStatus/rcLufsStatus (good/issue, config-sourced target), the same
// #131/#132 mechanism as every other graded metric. Loudness Range has no
// grading rule (#135 non-goal) and stays a plain 'info' pill with no target.
const measured = (v: number | null | undefined): v is number => typeof v === 'number' && !Number.isNaN(v);

export function buildMetricRows(src: ReportCardSource, g: GradingPillApi): MetricRow[] {
  return [
    { name: 'Peak Level', note: 'Sample peak', value: fmt(src.peak), unit: 'dBFS', tone: g.rcPeakStatus(src.peak, src.clipping), target: g.rcMetricTarget('peak') },
    ...(measured(src.truePeakDbtp) ? [{ name: 'True Peak', note: 'Inter-sample peak (EBU R128)', value: fmt(src.truePeakDbtp), unit: 'dBTP', tone: g.rcTruePeakStatus(src.truePeakDbtp), target: g.rcMetricTarget('truePeak') }] : []),
    // #135 review fix — once lufsIntegrated is measured, computeGrade/explainGrade
    // stop judging RMS entirely (LUFS supersedes it); asserting a good/issue tone
    // off raw RMS here would then contradict the LUFS-driven grade, breaking
    // #131's invariant that the pill never disagrees with the grade. The row
    // becomes informational ('info', no target) once RMS is no longer graded —
    // the fallback (LUFS unmeasured) keeps the original rcRmsStatus behavior.
    { name: 'RMS Level', note: 'Average level (RMS)', value: fmt(src.rms), unit: 'dBFS', tone: measured(src.lufsIntegrated) ? 'info' as PillTone : g.rcRmsStatus(src.rms), target: measured(src.lufsIntegrated) ? null : g.rcMetricTarget('rms') },
    ...(measured(src.lufsIntegrated) ? [{ name: 'Integrated Loudness', note: 'Program loudness (EBU R128)', value: fmt(src.lufsIntegrated), unit: 'LUFS', tone: g.rcLufsStatus(src.lufsIntegrated), target: g.rcMetricTarget('lufs') }] : []),
    ...(measured(src.loudnessRange) ? [{ name: 'Loudness Range', note: 'LRA (EBU R128)', value: fmt(src.loudnessRange), unit: 'LU', tone: 'info' as PillTone, target: null }] : []),
    { name: 'Dynamic Range', note: src.dynamicRange != null ? null : 'Not measured for live capture', value: src.dynamicRange != null ? fmt(src.dynamicRange) : '—', unit: src.dynamicRange != null ? 'dB' : '', tone: g.rcDrStatus(src.dynamicRange), target: src.dynamicRange != null ? g.rcMetricTarget('dynamicRange') : null },
    { name: 'Clipping', value: src.clipping ? 'Yes' : 'None', unit: '', tone: src.clipping ? 'issue' : 'good', target: g.rcMetricTarget('clipping') },
    { name: 'Spectral Centroid', value: src.centroid ? Math.round(src.centroid).toLocaleString() : '—', unit: src.centroid ? 'Hz' : '', tone: g.rcCentroidStatus(src.centroid), target: src.centroid ? g.rcMetricTarget('centroid') : null },
  ];
}
// Rule strings exactly as grading.js's explainGrade emits them (grading.js's
// deduction/notMeasured builders) — presentation-layer matching by rule name
// since the grading module is frozen (issue #540 scope).
export const DEDUCTION_RULES = {
  clipping: 'Clipping',
  truePeak: 'True peak over ceiling',
  dynamicRange: 'Dynamic range too low',
  lufs: 'Integrated loudness out of band',
  rms: 'RMS out of band',
  bandImbalance: 'Band imbalance',
} as const;
export const SKIP_RULES = { dynamicRange: 'Dynamic range' } as const; // notMeasured entries

export interface ScoreRowDetail { measured: string; target: string; impact: string; }
export interface ScoreRow {
  name: string;
  note: string | null;
  value: string;
  tone: PillTone;
  hardFail: boolean;
  detail: ScoreRowDetail;
  extra: string | null;
}

// The score-circle treatment's per-metric expandable rows (#540): the same
// six metrics as buildMetricRows, but each carries its own e2-05 deduction
// detail inline (measured/target/letterImpact) instead of relying on a
// separate "Why this grade" section. Tone is derived from deduction presence,
// not by re-running thresholds, so a row can never disagree with the letter
// grade it explains (the #131 invariant, extended to this new layout).
export function buildScoreRows(
  src: ReportCardSource,
  g: GradingPillApi & BandDiffApi,
  explain: GradeExplanation,
): ScoreRow[] {
  const ded = (rule: string) => explain.deductions.find((d) => d.rule === rule) ?? null;
  const skip = (rule: string) => explain.notMeasured.find((s) => s.rule === rule) ?? null;
  const rows: ScoreRow[] = [];

  // 1. Loudness (LUFS when measured, else RMS)
  if (measured(src.lufsIntegrated)) {
    const value = fmt(src.lufsIntegrated) + ' LUFS';
    const d = ded(DEDUCTION_RULES.lufs);
    const tone: PillTone = d ? 'issue' : 'good';
    const detail: ScoreRowDetail = d
      ? { measured: d.measured, target: d.target, impact: d.letterImpact }
      : { measured: value, target: g.rcMetricTarget('lufs') ?? '—', impact: 'No impact' };
    const extra = measured(src.loudnessRange) ? 'Loudness range ' + fmt(src.loudnessRange) + ' LU' : null;
    rows.push({ name: 'Integrated Loudness', note: 'Program loudness (EBU R128)', value, tone, hardFail: false, detail, extra });
  } else {
    const value = fmt(src.rms) + ' dBFS';
    const d = ded(DEDUCTION_RULES.rms);
    const tone: PillTone = d ? 'issue' : 'good';
    const detail: ScoreRowDetail = d
      ? { measured: d.measured, target: d.target, impact: d.letterImpact }
      : { measured: value, target: g.rcMetricTarget('rms') ?? '—', impact: 'No impact' };
    const extra = measured(src.loudnessRange) ? 'Loudness range ' + fmt(src.loudnessRange) + ' LU' : null;
    rows.push({ name: 'RMS Level', note: 'Average level (RMS)', value, tone, hardFail: false, detail, extra });
  }

  // 2. Peak / True Peak
  if (measured(src.truePeakDbtp)) {
    const value = fmt(src.truePeakDbtp) + ' dBTP';
    const d = ded(DEDUCTION_RULES.truePeak);
    const tone: PillTone = d ? 'issue' : 'good';
    const detail: ScoreRowDetail = d
      ? { measured: d.measured, target: d.target, impact: d.letterImpact }
      : { measured: value, target: g.rcMetricTarget('truePeak') ?? '—', impact: 'No impact' };
    rows.push({ name: 'True Peak', note: 'Inter-sample peak (EBU R128)', value, tone, hardFail: false, detail, extra: null });
  } else {
    const value = fmt(src.peak) + ' dBFS';
    rows.push({
      name: 'Peak Level', note: 'Sample peak', value,
      tone: g.rcPeakStatus(src.peak, src.clipping), hardFail: false,
      detail: { measured: value, target: g.rcMetricTarget('peak') ?? '—', impact: 'Not graded' },
      extra: null,
    });
  }

  // 3. Dynamic Range
  if (src.dynamicRange == null) {
    const s = skip(SKIP_RULES.dynamicRange);
    const detail: ScoreRowDetail = s
      ? { measured: s.measured, target: g.rcMetricTarget('dynamicRange') ?? '—', impact: s.letterImpact }
      : { measured: 'Not measured', target: g.rcMetricTarget('dynamicRange') ?? '—', impact: 'Rule skipped — graded on fewer metrics' };
    rows.push({ name: 'Dynamic Range', note: 'Not measured for live capture', value: '—', tone: 'info', hardFail: false, detail, extra: null });
  } else {
    const value = fmt(src.dynamicRange) + ' dB';
    const d = ded(DEDUCTION_RULES.dynamicRange);
    const tone: PillTone = d ? 'issue' : 'good';
    const detail: ScoreRowDetail = d
      ? { measured: d.measured, target: d.target, impact: d.letterImpact }
      : { measured: value, target: g.rcMetricTarget('dynamicRange') ?? '—', impact: 'No impact' };
    rows.push({ name: 'Dynamic Range', note: null, value, tone, hardFail: false, detail, extra: null });
  }

  // 4. Band Balance
  {
    const maxDiff = Object.keys(src.bands).reduce((m, k) => Math.max(m, g.bandDiffFromOthers(src.bands, k)), 0);
    const value = fmtDev(maxDiff);
    const d = ded(DEDUCTION_RULES.bandImbalance);
    const tone: PillTone = d ? 'issue' : maxDiff > g.CONFIG.bandBalance.hotDiff ? 'check' : 'good';
    const detail: ScoreRowDetail = d
      ? { measured: d.measured, target: d.target, impact: d.letterImpact }
      : { measured: fmtDev(maxDiff) + ' vs. other bands', target: '≤ +' + g.CONFIG.bandBalance.severeHotDiff + ' dB vs. other bands', impact: 'No impact' };
    rows.push({ name: 'Band Balance', note: null, value, tone, hardFail: false, detail, extra: null });
  }

  // 5. Clipping
  {
    const value = src.clipping ? 'Yes' : 'None';
    const d = ded(DEDUCTION_RULES.clipping);
    const hardFail = explain.clipping;
    const tone: PillTone = d ? 'issue' : 'good';
    const detail: ScoreRowDetail = d
      ? { measured: d.measured, target: d.target, impact: d.letterImpact }
      : { measured: 'None', target: 'No clipping', impact: 'No impact' };
    const extra = hardFail ? 'Clipping forced an automatic F — the other grading rules were not evaluated.' : null;
    rows.push({ name: 'Clipping', note: null, value, tone, hardFail, detail, extra });
  }

  // 6. Spectral Centroid
  {
    const value = src.centroid ? Math.round(src.centroid).toLocaleString() + ' Hz' : '—';
    rows.push({
      name: 'Spectral Centroid', note: null, value,
      tone: g.rcCentroidStatus(src.centroid), hardFail: false,
      detail: { measured: value, target: src.centroid ? (g.rcMetricTarget('centroid') ?? '—') : '—', impact: 'Not graded' },
      extra: null,
    });
  }

  return rows;
}

// Mirrors the mockup's markup (docs/discovery/539-report-card-mockup/mockup-a-
// score-circle.html) — a native <details>/<summary> per row, collapsed by
// default (never emits `open`; the mockup's default-open row was a static-
// screenshot affordance only).
export function scoreRowsHTML(rows: ScoreRow[]): string {
  return rows.map((r) => `<details class="metric-row tone-${r.tone}${r.hardFail ? ' hard-fail' : ''}">
    <summary>
      <span class="status-dot ${r.tone}"></span>
      <span class="metric-name">${escapeHtml(r.name)}${r.note ? `<span class="metric-note">${escapeHtml(r.note)}</span>` : ''}</span>
      <span class="metric-value">${escapeHtml(r.value)}</span>
      ${statusPillHTML(r.tone)}
    </summary>
    <div class="metric-detail">
      <div class="metric-detail-row">
        <span>Measured <span class="measured${r.tone === 'issue' ? ' hot' : ''}">${escapeHtml(r.detail.measured)}</span></span>
        <span>Target ${escapeHtml(r.detail.target)}</span>
        <span class="impact">${escapeHtml(r.detail.impact)}</span>
      </div>
      ${r.extra ? `<div class="metric-extra">${escapeHtml(r.extra)}</div>` : ''}
    </div>
  </details>`).join('');
}

export function metricRowsHTML(metrics: MetricRow[]): string {
  return metrics.map((m) =>
    `<tr>
      <td><span class="mt-metric">${m.name}</span>${m.note ? `<span class="mt-note">${m.note}</span>` : ''}</td>
      <td><span class="mt-value">${m.value}${m.unit ? `<span class="unit">${m.unit}</span>` : ''}</span></td>
      <td><span class="mt-target">${m.target || '—'}</span></td>
      <td>${statusPillHTML(m.tone)}</td>
    </tr>`).join('');
}

/* ── "Why this grade" (#133) ──
   The per-deduction breakdown, straight from the pure grading module so it
   can never disagree with the letter it explains. Each deduction names the
   rule, its measured value vs. the config target, and the letter impact; an
   empty list renders an explicit positive "no deductions" state (never a
   blank box). #136 additionally discloses any grading rule that was skipped
   because its metric wasn't measured (live captures have no dynamic range) —
   rendered as a neutral "info" disclosure, not a deduction: it never dropped
   a letter, but the grade used fewer metrics and the user must be told
   rather than left to assume the DR rule ran. */
export function whyGradeHTML(explain: GradeExplanation): string {
  // Clipping is the only rule that forces an automatic F, and when it fires it
  // is the sole deduction (grading short-circuits) — so the authoritative
  // explain.clipping flag marks the forced-F row, no display-string sniffing.
  const deductionRows = explain.deductions.map((d) =>
    `<div class="rc-why-row${explain.clipping ? ' forced-f' : ''}">
      <span class="rc-why-icon">${iconSvg(explain.clipping ? 'alert-triangle' : 'info', 18)}</span>
      <span class="rc-why-body">
        <span class="rc-why-rule">${escapeHtml(d.rule)}</span>
        <span class="rc-why-detail"><span class="measured">${escapeHtml(d.measured)}</span> · target ${escapeHtml(d.target)}</span>
      </span>
      <span class="rc-why-impact">${escapeHtml(d.letterImpact)}</span>
    </div>`);
  const notMeasuredRows = explain.notMeasured.map((n) =>
    `<div class="rc-why-row rc-why-skip">
      <span class="rc-why-icon">${iconSvg('info', 18)}</span>
      <span class="rc-why-body">
        <span class="rc-why-rule">${escapeHtml(n.rule)}</span>
        <span class="rc-why-detail"><span class="measured">${escapeHtml(n.measured)}</span> · ${escapeHtml(n.note)}</span>
      </span>
      <span class="rc-why-impact">${escapeHtml(n.letterImpact)}</span>
    </div>`);
  if (deductionRows.length === 0 && notMeasuredRows.length === 0) {
    return `<div class="rc-why-none">
        <span class="rc-why-icon">${iconSvg('check', 18)}</span>
        <span class="rc-why-none-text">No deductions — this recording met every grading rule.</span>
      </div>`;
  }
  if (deductionRows.length === 0) {
    // No deductions among the rules that ran, but at least one rule was
    // skipped — lead with the honest positive, then disclose what wasn't
    // measured. Never the unqualified "met every grading rule" (a rule
    // didn't run).
    return `<div class="rc-why-none">
        <span class="rc-why-icon">${iconSvg('check', 18)}</span>
        <span class="rc-why-none-text">No deductions among the metrics that were measured.</span>
      </div>` + notMeasuredRows.join('');
  }
  return deductionRows.join('') + notMeasuredRows.join('');
}

/* ── Recommendations ──
   Unifies the history-summary path (escapes stored text) and the live
   grading path (grading output is trusted, not escaped) — the two bodies are
   identical except escapeHtml(text) vs text. */
export function recListHTML(recs: string[], escapeText: boolean): string {
  return recs.map((r) => {
    const critical = r.startsWith('CRITICAL');
    const text = critical ? r.replace(/^CRITICAL:\s*/, '') : r;
    return `<div class="rc-rec${critical ? ' critical' : ''}">
      <span class="rc-rec-icon">${iconSvg(critical ? 'alert-triangle' : 'check', 16)}</span>
      <span class="rc-rec-text">${critical ? '<span class="rc-rec-badge">Critical</span>' : ''}${escapeText ? escapeHtml(text) : text}</span>
    </div>`;
  }).join('');
}

/* ── Analysis → report-card source (getReportCardSource()'s file branch,
   inline-app.js:2354–2376) ── */
export interface AnalysisLike {
  sox?: { rmsDbfs: number; peakDbfs: number; dynamicRangeDb: number | null; clipping: boolean } | null;
  spectrum?: {
    spectralCentroid?: number;
    bands?: Record<string, number>;
    curve?: unknown;
    contentType?: string | null;
    segments?: unknown;
    frames?: unknown;
  } | null;
  ffprobe?: { format?: { filename?: string } } | null;
  loudness?: { integratedLufs?: number | null; loudnessRange?: number | null; truePeakDbtp?: number | null } | null;
}

// The analysis payload stays `unknown` at the render boundary (TD-011) — this
// narrows it to the ReportCardSource shape the card renders from, mirroring
// getReportCardSource()'s file branch. Returns null for a shape too malformed
// to build a card from (missing sox/spectrum).
export function reportCardSourceFromAnalysis(analysis: unknown): ReportCardSource | null {
  if (typeof analysis !== 'object' || analysis === null) return null;
  const a = analysis as AnalysisLike;
  if (!a.sox || !a.spectrum) return null;
  const { sox, spectrum, ffprobe, loudness } = a;
  return {
    filename: (ffprobe?.format?.filename || '').split('/').pop() || 'Untitled',
    rms: sox.rmsDbfs,
    peak: sox.peakDbfs,
    dynamicRange: sox.dynamicRangeDb,
    clipping: sox.clipping,
    centroid: spectrum.spectralCentroid,
    bands: { ...(spectrum.bands || {}) },
    curve: spectrum.curve || null,
    contentType: spectrum.contentType || null,
    segments: spectrum.segments || null,
    frames: spectrum.frames,
    lufsIntegrated: loudness ? loudness.integratedLufs ?? null : null,
    loudnessRange: loudness ? loudness.loudnessRange ?? null : null,
    truePeakDbtp: loudness ? loudness.truePeakDbtp ?? null : null,
  };
}

/* ── Content type — speech/music delineation (PRD 04) ──
   Extracted verbatim from inline-app.js's renderContentType (TD-001 slice 4,
   #422): the pill label and timeline-ribbon segment/legend HTML. Both hide
   (null label / empty ribbon HTML) when the analysis predates the classifier
   (older files, live capture) so the caller renders nothing empty. */
export interface SegmentLike {
  start: number;
  end: number;
  class?: string;
}

export const CONTENT_TYPE_LABELS: Record<string, string> = { speech: 'Speech', music: 'Music', mixed: 'Mixed', silence: 'Silence' };
export const SEG_CLASS_LABELS: Record<string, string> = { speech: 'Speech', music: 'Music', silence: 'Silence', unknown: 'Unknown' };

export function fmtClock(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export interface ContentTypeView {
  /** Raw classifier key (e.g. 'speech') — feeds the pill's modifier class. */
  contentType: string | null;
  pillLabel: string | null;
  ribbonSegmentsHTML: string;
  ribbonLegendHTML: string;
}

export function contentTypeView(contentType: string | null | undefined, segments: unknown): ContentTypeView {
  const pillLabel = contentType ? CONTENT_TYPE_LABELS[contentType] ?? null : null;

  const segs = Array.isArray(segments) ? (segments as SegmentLike[]).filter((s) => s && s.end > s.start) : [];
  const span = segs.length > 0 ? segs[segs.length - 1].end - segs[0].start : 0;
  if (segs.length === 0 || !(span > 0)) {
    return { contentType: contentType || null, pillLabel, ribbonSegmentsHTML: '', ribbonLegendHTML: '' };
  }

  const segClass = (c: string | undefined) => (c && SEG_CLASS_LABELS[c] ? c : 'unknown');
  const ribbonSegmentsHTML = segs.map((s) => {
    const cls = segClass(s.class);
    const pct = ((s.end - s.start) / span) * 100;
    return `<span class="seg seg-${cls}" style="width:${pct}%" title="${SEG_CLASS_LABELS[cls]} · ${fmtClock(s.start)}–${fmtClock(s.end)}"></span>`;
  }).join('');
  const present = [...new Set(segs.map((s) => segClass(s.class)))];
  const ribbonLegendHTML = present.map((c) =>
    `<span class="lg"><span class="sw seg-${c}"></span>${SEG_CLASS_LABELS[c]}</span>`).join('');
  return { contentType: contentType || null, pillLabel, ribbonSegmentsHTML, ribbonLegendHTML };
}

/* ── Band breakdown meter row ──
   Extracted verbatim from inline-app.js's closure (TD-001 slice 4, #422) so
   the report card's per-band breakdown rows are unit-tested; the Live-tab's
   per-channel meters (colorBy:'level') and this report-card usage share the
   same row markup, only differing in `opts`. */
export interface BandMeterOpts {
  showScale?: boolean;
  showGrid?: boolean;
  colorBy?: 'band' | 'level';
  color?: string;
  loudest?: boolean;
}

export function levelColor(db: number): string {
  return db > -24 ? 'var(--meter-good)' : db > -36 ? 'var(--meter-hot)' : 'var(--meter-idle)';
}

// One band-meter row. opts: { showScale, showGrid, colorBy:'band'|'level', color, loudest }
export function bandMeterHTML(label: string, range: string, db: number, opts: BandMeterOpts = {}): string {
  const pct = toPct(db);
  const fill = opts.colorBy === 'level' ? levelColor(db) : (opts.color || 'var(--gold-500)');
  const dim = db <= DIM_DB;
  const loud = !!opts.loudest;
  const grid = (opts.showGrid || opts.showScale)
    ? GRID.map((g) => `<span class="bm-grid" style="left:${toPct(g)}%"></span>`).join('') : '';
  const scale = opts.showScale
    ? `<div class="bm-scale">${GRID.map((g) => `<span style="left:${toPct(g)}%">${g}</span>`).join('')}</div>` : '';
  const rangeHTML = range ? `<div class="bm-range">${range}</div>` : '';
  return `<div class="bm">${scale}
    <div class="bm-row">
      <div class="bm-labelcol"><div class="bm-name${loud ? ' loud' : ''}">${label}</div>${rangeHTML}</div>
      <div class="bm-track">${grid}<div class="bm-fill${loud ? ' loud' : ''}" style="width:${pct}%;background:${fill};opacity:${dim ? 0.5 : 1}"></div></div>
      <div class="bm-val${db > HOT_DB ? ' hot' : ''}">${isFinite(db) ? db.toFixed(1) : '-∞'}</div>
    </div>
  </div>`;
}

/* ── Frequency band breakdown (report card) ──
   Extracted verbatim from renderReportCard's band-breakdown loop
   (inline-app.js:2958–2965, TD-001 slice 4, #422). The hot/quiet/balanced
   verdict thresholds are config-sourced (grading.js's CONFIG.bandBalance), so
   a threshold change moves the verdict with the grade — injected via the
   narrow BandDiffApi rather than importing grading.js globally. */
export interface BandDiffApi {
  bandDiffFromOthers(bands: Record<string, number>, key: string): number;
  // severeHotDiff (#540) is the ceiling the score-circle Band Balance row's
  // clean-target string reads — type-only widening, runtime window.grading
  // already carries it (grading.js's CONFIG.bandBalance).
  CONFIG: { bandBalance: { hotDiff: number; quietDiff: number; severeHotDiff: number } };
}

export function bandBreakdownHTML(bands: Record<string, number>, g: BandDiffApi): string {
  return BAND_META.map((b) => {
    const db = bands[b.key];
    const diff = g.bandDiffFromOthers(bands, b.key);
    let vc: 'ok' | 'hot' | 'quiet' = 'ok';
    let vt = 'Balanced';
    if (diff > g.CONFIG.bandBalance.hotDiff) { vc = 'hot'; vt = 'Too Hot'; }
    else if (diff < g.CONFIG.bandBalance.quietDiff) { vc = 'quiet'; vt = 'Too Quiet'; }
    return `<div class="rc-band-row">${bandMeterHTML(b.label, b.range, db, { colorBy: 'level' })}<span class="rc-band-verdict ${vc}">${vt}</span></div>`;
  }).join('');
}

/* ── "Spectrum Over Time" report-card section ──
   Extracted verbatim from renderReportCardFrames (inline-app.js:3085–3115,
   TD-001 slice 4, #422): a static heatmap thumbnail + start/middle/loudest
   representative frame curves. Hidden (visible:false) when the analysis has
   no frames (e.g. a live capture). */
export interface FramesSectionView {
  visible: boolean;
  heatmapHTML: string;
  curvesHTML: string;
}

export function reportCardFramesView(frames: unknown): FramesSectionView {
  if (!Array.isArray(frames) || frames.length === 0) {
    return { visible: false, heatmapHTML: '', curvesHTML: '' };
  }
  const fr = frames as SpectrumFrame[];
  const heatmapHTML = heatmapSVG(fr, { interactive: false });
  const curvesHTML = pickRepresentativeFrames(fr).map((p) => {
    const f = fr[p.i];
    return `<div class="rc-frame">
      <div class="rc-frame-head"><span class="rc-frame-tag">${p.tag}</span><span class="rc-frame-t">${fmtDur(f.t)} · ${classLabel(f.class)}</span></div>
      <div class="rc-frame-curve">${miniCurveSVG(f.db)}</div>
    </div>`;
  }).join('');
  return { visible: true, heatmapHTML, curvesHTML };
}

/* ── "vs. last time" delta (#259) ──
   Compares the current grade/score against the immediately preceding
   persisted Recent Services summary. Only ever called with two same-source
   (file-analysis) summaries — see ReportCardIsland.tsx. */
export interface ReportDeltaView {
  /** Signed, rounded point change vs. the previous summary. */
  points: number;
  direction: 'improved' | 'regressed' | 'unchanged';
  /** Full display line, e.g. "+9 pts vs. last service (B → A)". */
  text: string;
}

export function reportDeltaView(
  current: { score: number; gradeLetter: string } | null | undefined,
  previous: { score: number; gradeLetter: string } | null | undefined
): ReportDeltaView | null {
  if (!current || !previous) return null;
  if (!Number.isFinite(current.score) || !Number.isFinite(previous.score)) return null;
  if (typeof current.gradeLetter !== 'string' || !current.gradeLetter) return null;
  if (typeof previous.gradeLetter !== 'string' || !previous.gradeLetter) return null;

  const points = Math.round(current.score - previous.score);
  const direction: ReportDeltaView['direction'] = points > 0 ? 'improved' : points < 0 ? 'regressed' : 'unchanged';
  const unit = Math.abs(points) === 1 ? 'pt' : 'pts';
  const sign = points > 0 ? '+' : '';

  let text: string;
  if (points === 0) {
    text = `No change vs. last service (${current.gradeLetter})`;
  } else if (previous.gradeLetter !== current.gradeLetter) {
    text = `${sign}${points} ${unit} vs. last service (${previous.gradeLetter} → ${current.gradeLetter})`;
  } else {
    text = `${sign}${points} ${unit} vs. last service (still ${current.gradeLetter})`;
  }

  return { points, direction, text };
}

/* ── Summary-building (#146, extracted for #261) ──
   persistAnalysisSummary()/persistSummary() in inline-app.js build the
   Recent Services history-record payload from a ReportCardSource; extracted
   here so the file-analysis and live-capture-session paths share one tested
   implementation instead of inline-app.js duplicating the object literal. */
export type AnalysisSummarySource = 'file' | 'live';

// The narrow slice of grading.js this module needs to build a summary,
// injected by the caller (inline-app.js via the global `grading`, tests via
// a fake) rather than imported globally — window.grading's CONFIG is
// runtime-mutable and a second import would fork it.
export interface SummaryGradingApi {
  computeGrade(src: ReportCardSource): string;
  computeScore(src: ReportCardSource): number;
  analyzeRecordingType(src: ReportCardSource): { label: string };
  computeRecommendations(src: ReportCardSource): string[];
}

export const MAX_TOP_FIXES = 3;

export interface AnalysisSummaryInputShape {
  sourceFilename: string;
  gradeLetter: string;
  score: number;
  recordingType: string;
  topFixes: string[];
  source: AnalysisSummarySource;
}

export function buildAnalysisSummaryInput(
  src: ReportCardSource,
  grading: SummaryGradingApi,
  source: AnalysisSummarySource,
): AnalysisSummaryInputShape {
  return {
    sourceFilename: src.filename,
    gradeLetter: grading.computeGrade(src),
    score: grading.computeScore(src),
    recordingType: grading.analyzeRecordingType(src).label,
    topFixes: grading.computeRecommendations(src).slice(0, MAX_TOP_FIXES),
    source,
  };
}

/* ── Handoff note (#267) ──
   MAX_NOTE_LENGTH re-exported so callers (ReportCard.tsx's input maxLength)
   need only import this module, not reach into electron/ipc/api directly. */
export { MAX_NOTE_LENGTH };

/** The IPC payload for committing a draft note, or null when there is no
 *  freshly-saved record to patch yet (fresh save still in flight, or a
 *  historical card is loaded — the note field is add-at-save-time only). */
export function noteSubmitPayload(file: string | null, rawValue: string): { file: string; note: string } | null {
  if (!file) return null;
  return { file, note: rawValue.trim().slice(0, MAX_NOTE_LENGTH) };
}

/** Commits a draft note via the injected IPC call, swallowing/logging failure
 *  the same way the fire-and-forget saveAnalysisSummary path does — a note
 *  patch failing must never surface as an error to the user, just a warning. */
export function commitReportCardNote(
  setNote: (input: { file: string; note: string }) => Promise<{ success: boolean; error?: string }>,
  file: string | null,
  rawValue: string,
): Promise<void> {
  const payload = noteSubmitPayload(file, rawValue);
  if (!payload) return Promise.resolve();
  return setNote(payload)
    .then((res) => {
      if (!res.success) console.warn('setAnalysisSummaryNote failed', res.error);
    })
    .catch((err) => console.warn('setAnalysisSummaryNote failed', err));
}
