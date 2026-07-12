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

import { escapeHtml } from './spectrum-display';

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
// values feed an `info` pill with no target (display-only until #135 wires
// them into grading); absent/NaN values omit the row entirely so cards from
// before this feature (or a failed ffmpeg measurement) render unchanged.
// -Infinity is a legitimate loudness measurement (ffmpeg reports "-inf dBFS"
// true peak for fully-silent audio — a muted channel or pre-service silence —
// and parseEbur128Summary parses it as such rather than throwing, #134). Only
// NaN (or a missing field) means "not measured"; fmt() already renders
// -Infinity as "-∞", same as the pre-existing Peak/RMS rows.
const measured = (v: number | null | undefined): v is number => typeof v === 'number' && !Number.isNaN(v);

export function buildMetricRows(src: ReportCardSource, g: GradingPillApi): MetricRow[] {
  return [
    { name: 'Peak Level', note: 'Sample peak', value: fmt(src.peak), unit: 'dBFS', tone: g.rcPeakStatus(src.peak, src.clipping), target: g.rcMetricTarget('peak') },
    ...(measured(src.truePeakDbtp) ? [{ name: 'True Peak', note: 'Inter-sample peak (EBU R128)', value: fmt(src.truePeakDbtp), unit: 'dBTP', tone: 'info' as PillTone, target: null }] : []),
    { name: 'RMS Level', note: 'Average level (RMS)', value: fmt(src.rms), unit: 'dBFS', tone: g.rcRmsStatus(src.rms), target: g.rcMetricTarget('rms') },
    ...(measured(src.lufsIntegrated) ? [{ name: 'Integrated Loudness', note: 'Program loudness (EBU R128)', value: fmt(src.lufsIntegrated), unit: 'LUFS', tone: 'info' as PillTone, target: null }] : []),
    ...(measured(src.loudnessRange) ? [{ name: 'Loudness Range', note: 'LRA (EBU R128)', value: fmt(src.loudnessRange), unit: 'LU', tone: 'info' as PillTone, target: null }] : []),
    { name: 'Dynamic Range', note: src.dynamicRange != null ? null : 'Not measured for live capture', value: src.dynamicRange != null ? fmt(src.dynamicRange) : '—', unit: src.dynamicRange != null ? 'dB' : '', tone: g.rcDrStatus(src.dynamicRange), target: src.dynamicRange != null ? g.rcMetricTarget('dynamicRange') : null },
    { name: 'Clipping', value: src.clipping ? 'Yes' : 'None', unit: '', tone: src.clipping ? 'issue' : 'good', target: g.rcMetricTarget('clipping') },
    { name: 'Spectral Centroid', value: src.centroid ? Math.round(src.centroid).toLocaleString() : '—', unit: src.centroid ? 'Hz' : '', tone: g.rcCentroidStatus(src.centroid), target: src.centroid ? g.rcMetricTarget('centroid') : null },
  ];
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
