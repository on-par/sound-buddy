// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import {
  iconSvg,
  fmt,
  pillLabel,
  pillIcon,
  statusPillHTML,
  gradeRingHTML,
  GRADE_RING_PX,
  GRADE_RING_STROKE,
  fmtDev,
  deviationMiniCurve,
  profileMatchHTML,
  buildMetricRows,
  metricRowsHTML,
  whyGradeHTML,
  buildScoreRows,
  scoreRowsHTML,
  recListHTML,
  levelColor,
  bandMeterHTML,
  reportCardSourceFromAnalysis,
  contentTypeView,
  fmtClock,
  bandBreakdownHTML,
  reportCardFramesView,
  reportDeltaView,
  noteSubmitPayload,
  commitReportCardNote,
  buildAnalysisSummaryInput,
  MAX_TOP_FIXES,
  isStrongGrade,
  strongMixTargetMeta,
  type PillTone,
  type ProfileComparison,
  type BandDiffApi,
  type SummaryGradingApi,
  type ReportCardSource,
} from './report-card';

const require = createRequire(import.meta.url);
const grading = require('../grading.js');
const { makeSrc, flatBands } = require('../grading/fixtures.js');

describe('iconSvg', () => {
  it('renders an svg with the requested size and stroke width for a known name', () => {
    const svg = iconSvg('check', 24, { strokeWidth: 3 });
    expect(svg).toContain('width="24"');
    expect(svg).toContain('height="24"');
    expect(svg).toContain('stroke-width="3"');
  });

  it('returns an empty string for an unknown icon name', () => {
    expect(iconSvg('not-a-real-icon')).toBe('');
  });

  it('splits multi-M paths into multiple <path> elements', () => {
    const svg = iconSvg('info'); // 'M12 22a...zM12 16v-4M12 8h.01' has 3 M segments
    expect(svg.match(/<path /g)?.length).toBe(3);
  });
});

describe('fmt', () => {
  it('formats a finite number to the given decimal places', () => {
    expect(fmt(-17.25)).toBe('-17.3');
    expect(fmt(3, 0)).toBe('3');
  });
  it('falls back to -∞ for non-finite values', () => {
    expect(fmt(-Infinity)).toBe('-∞');
  });
});

describe('pillLabel / pillIcon', () => {
  it('maps every known tone to its label', () => {
    expect(pillLabel('good')).toBe('Good');
    expect(pillLabel('check')).toBe('Check');
    expect(pillLabel('issue')).toBe('Issue');
    expect(pillLabel('info')).toBe('Info');
  });
  it('falls through to Info for an unknown tone', () => {
    expect(pillLabel('bogus' as PillTone)).toBe('Info');
  });
  it('maps every known tone to its icon, including the check→alert-triangle fall-through', () => {
    expect(pillIcon('good')).toBe('check');
    expect(pillIcon('issue')).toBe('x');
    expect(pillIcon('info')).toBe('info');
    expect(pillIcon('check')).toBe('alert-triangle');
  });
});

describe('statusPillHTML', () => {
  it('contains the pill class, default label, and tone icon', () => {
    const html = statusPillHTML('good');
    expect(html).toContain('pill sm good');
    expect(html).toContain('Good');
  });
  it('accepts a custom label override', () => {
    const html = statusPillHTML('issue', 'Custom Label');
    expect(html).toContain('Custom Label');
    expect(html).not.toContain('>Issue<');
  });
});

describe('gradeRingHTML', () => {
  function expectedDash(score: number): number {
    const r = (GRADE_RING_PX - GRADE_RING_STROKE) / 2;
    const c = 2 * Math.PI * r;
    return Math.max(0, Math.min(100, score)) / 100 * c;
  }

  it('sets the dash length to the score percentage of the ring circumference', () => {
    const html = gradeRingHTML('B', 87);
    expect(html).toContain(`stroke-dasharray="${expectedDash(87)}`);
  });
  it('clamps scores above 100 and below 0', () => {
    expect(gradeRingHTML('A', 140)).toContain(`stroke-dasharray="${expectedDash(100)}`);
    expect(gradeRingHTML('F', -20)).toContain(`stroke-dasharray="${expectedDash(0)}`);
  });
  it('colors the letter via the grade CSS variable', () => {
    expect(gradeRingHTML('A', 95)).toContain('color:var(--grade-a)');
  });
  it('sanitizes a crafted grade string for the colorKey and escapes it for display', () => {
    const html = gradeRingHTML('<img>', 50);
    expect(html).not.toContain('<img');
    expect(html).toContain('var(--grade-img)');
  });
  it('shows the score over 100', () => {
    expect(gradeRingHTML('A', 87)).toContain('87<span class="slash">/100</span>');
  });
  it('degrades a falsy grade (e.g. a malformed disk record) to the base ring color, not a crash', () => {
    expect(gradeRingHTML('', 50)).toContain('var(--grade-)');
  });
});

describe('fmtDev', () => {
  it('formats positive and negative deviations with a sign and unit', () => {
    expect(fmtDev(2.1)).toBe('+2.1 dB');
    expect(fmtDev(-0.5)).toBe('-0.5 dB');
  });
});

describe('deviationMiniCurve', () => {
  it('renders devbar-over rects for positive deviations and devbar-under for negative', () => {
    const svg = deviationMiniCurve([2, -3, 0]);
    expect(svg).toContain('devbar-over');
    expect(svg).toContain('devbar-under');
  });
  it('always renders exactly one zero line', () => {
    const svg = deviationMiniCurve([1, -1, 4, -4]);
    expect(svg.match(/class="zero"/g)?.length).toBe(1);
  });
});

describe('profileMatchHTML', () => {
  const baseCmp: ProfileComparison = { matchScore: 92, deviation: [1, -1], topOver: null, topUnder: null };

  it('escapes the profile label', () => {
    const html = profileMatchHTML({ label: '<b>Flat</b>' }, baseCmp, false);
    expect(html).not.toContain('<b>Flat</b>');
    expect(html).toContain('&lt;b&gt;Flat&lt;/b&gt;');
  });
  it('shows the (auto) suffix only when isAuto is true', () => {
    expect(profileMatchHTML({ label: 'Flat' }, baseCmp, true)).toContain('(auto)');
    expect(profileMatchHTML({ label: 'Flat' }, baseCmp, false)).not.toContain('(auto)');
  });
  it('renders the Over region only when topOver.deviation >= 1', () => {
    const shown = profileMatchHTML({ label: 'Flat' }, { ...baseCmp, topOver: { label: 'Presence', deviation: 1 } }, false);
    expect(shown).toContain('rcp-region over');
    const hidden = profileMatchHTML({ label: 'Flat' }, { ...baseCmp, topOver: { label: 'Presence', deviation: 0.9 } }, false);
    expect(hidden).not.toContain('rcp-region over');
  });
  it('renders the Under region only when topUnder.deviation <= -1', () => {
    const shown = profileMatchHTML({ label: 'Flat' }, { ...baseCmp, topUnder: { label: 'Sub Bass', deviation: -1 } }, false);
    expect(shown).toContain('rcp-region under');
    const hidden = profileMatchHTML({ label: 'Flat' }, { ...baseCmp, topUnder: { label: 'Sub Bass', deviation: -0.9 } }, false);
    expect(hidden).not.toContain('rcp-region under');
  });
  it('falls back to "Well matched" when neither region qualifies', () => {
    const html = profileMatchHTML({ label: 'Flat' }, baseCmp, false);
    expect(html).toContain('Well matched across the spectrum.');
  });
  it('renders the match score with the /100 closeness caption', () => {
    const html = profileMatchHTML({ label: 'Flat' }, baseCmp, false);
    expect(html).toContain('<span class="num">92</span>');
    expect(html).toContain('/100 closeness');
  });
});

describe('buildMetricRows', () => {
  it('returns the 5 metrics in order, all "good" for a clean fixture', () => {
    const rows = buildMetricRows(makeSrc(), grading);
    expect(rows.map((r) => r.name)).toEqual(['Peak Level', 'RMS Level', 'Dynamic Range', 'Clipping', 'Spectral Centroid']);
    expect(rows.every((r) => r.tone === 'good')).toBe(true);
    expect(rows[1].target).toBe(grading.rcMetricTarget('rms'));
    expect(rows[3].target).toBeNull();
  });
  it('shows a "—" DR value with a live-capture note and null target when dynamicRange is null', () => {
    const rows = buildMetricRows(makeSrc({ dynamicRange: null }), grading);
    const dr = rows.find((r) => r.name === 'Dynamic Range')!;
    expect(dr.value).toBe('—');
    expect(dr.unit).toBe('');
    expect(dr.note).toBe('Not measured for live capture');
    expect(dr.target).toBeNull();
    expect(dr.tone).toBe('check');
  });
  it('flags clipping as an issue', () => {
    const rows = buildMetricRows(makeSrc({ clipping: true }), grading);
    const clip = rows.find((r) => r.name === 'Clipping')!;
    expect(clip.value).toBe('Yes');
    expect(clip.tone).toBe('issue');
  });
  it('shows a "—" centroid and null target when centroid is missing', () => {
    const rows = buildMetricRows(makeSrc({ centroid: undefined }), grading);
    const centroid = rows.find((r) => r.name === 'Spectral Centroid')!;
    expect(centroid.value).toBe('—');
    expect(centroid.target).toBeNull();
  });

  it('inserts True Peak / Integrated Loudness / Loudness Range rows in order when measured (#134)', () => {
    const rows = buildMetricRows(makeSrc({ lufsIntegrated: -14.2, loudnessRange: 6.3, truePeakDbtp: -1.05 }), grading);
    expect(rows.map((r) => r.name)).toEqual([
      'Peak Level', 'True Peak', 'RMS Level', 'Integrated Loudness', 'Loudness Range', 'Dynamic Range', 'Clipping', 'Spectral Centroid',
    ]);
    const truePeak = rows.find((r) => r.name === 'True Peak')!;
    const integrated = rows.find((r) => r.name === 'Integrated Loudness')!;
    const lra = rows.find((r) => r.name === 'Loudness Range')!;
    expect(truePeak.unit).toBe('dBTP');
    // fmt() is a straight toFixed(1); -1.05's nearest double is fractionally
    // below -1.05, so JS rounds it to -1.1, not -1.0 (Number.prototype.toFixed
    // is not IEEE-round-half-to-even).
    expect(truePeak.value).toBe('-1.1');
    // #135 — True Peak / Integrated Loudness now mirror the grade rules via
    // rcTruePeakStatus/rcLufsStatus instead of a fixed 'info' tone.
    expect(truePeak.tone).toBe('good'); // -1.05 ≤ -1 ceiling
    expect(truePeak.target).toBe('≤ -1 dBTP');
    expect(integrated.unit).toBe('LUFS');
    expect(integrated.value).toBe('-14.2');
    expect(integrated.tone).toBe('good'); // in the -20..-14 acceptable band
    expect(integrated.target).toBe('-20 to -14 LUFS');
    expect(lra.unit).toBe('LU');
    expect(lra.value).toBe('6.3');
    expect(lra.tone).toBe('info'); // no LRA grading rule — stays display-only
    expect(lra.target).toBeNull();
  });

  it('flags out-of-range True Peak / Integrated Loudness rows as "issue" (#135)', () => {
    const rows = buildMetricRows(makeSrc({ lufsIntegrated: -12, loudnessRange: 6.3, truePeakDbtp: -0.3 }), grading);
    const truePeak = rows.find((r) => r.name === 'True Peak')!;
    const integrated = rows.find((r) => r.name === 'Integrated Loudness')!;
    expect(truePeak.tone).toBe('issue');
    expect(integrated.tone).toBe('issue');
  });

  it('shows the RMS Level row as "info" (not graded) once LUFS supersedes it (#135 review fix)', () => {
    // computeGrade/explainGrade stop judging RMS the moment lufsIntegrated is
    // measured (#135) — the RMS row must follow, or a clean LUFS-driven A
    // grade could sit next to a red "issue" RMS pill, breaking #131's
    // invariant that the pill never contradicts the grade. Pick RMS values
    // that would read "good"/"issue" under the old unconditional rcRmsStatus
    // call to prove the row no longer asserts either.
    const rmsInBand = buildMetricRows(makeSrc({ rms: -17, lufsIntegrated: -16, truePeakDbtp: -5 }), grading);
    const rmsOutOfBand = buildMetricRows(makeSrc({ rms: -30, lufsIntegrated: -16, truePeakDbtp: -5 }), grading);
    for (const rows of [rmsInBand, rmsOutOfBand]) {
      const rmsRow = rows.find((r) => r.name === 'RMS Level')!;
      expect(rmsRow.tone).toBe('info');
      expect(rmsRow.target).toBeNull();
    }
  });

  it('keeps the RMS Level row graded via rcRmsStatus when LUFS is not measured (fallback, #135)', () => {
    const rows = buildMetricRows(makeSrc({ rms: -30 }), grading);
    const rmsRow = rows.find((r) => r.name === 'RMS Level')!;
    expect(rmsRow.tone).toBe('issue');
    expect(rmsRow.target).toBe('-20 to -14 dBFS');
  });

  it('omits the loudness rows individually when their field is null, undefined, or NaN (#134)', () => {
    const nullRows = buildMetricRows(makeSrc({ lufsIntegrated: null, loudnessRange: 6.3, truePeakDbtp: -1.05 }), grading);
    expect(nullRows.map((r) => r.name)).not.toContain('Integrated Loudness');
    expect(nullRows.map((r) => r.name)).toContain('Loudness Range');
    expect(nullRows.map((r) => r.name)).toContain('True Peak');

    const undefinedRows = buildMetricRows(makeSrc({ lufsIntegrated: -14.2, loudnessRange: undefined, truePeakDbtp: -1.05 }), grading);
    expect(undefinedRows.map((r) => r.name)).not.toContain('Loudness Range');
    expect(undefinedRows.map((r) => r.name)).toContain('Integrated Loudness');
    expect(undefinedRows.map((r) => r.name)).toContain('True Peak');

    const nanRows = buildMetricRows(makeSrc({ lufsIntegrated: -14.2, loudnessRange: 6.3, truePeakDbtp: NaN }), grading);
    expect(nanRows.map((r) => r.name)).not.toContain('True Peak');
    expect(nanRows.map((r) => r.name)).toContain('Integrated Loudness');
    expect(nanRows.map((r) => r.name)).toContain('Loudness Range');
  });

  it('still shows the True Peak row as "-∞" for fully-silent audio, where ffmpeg genuinely reports -Infinity (#134)', () => {
    // parseEbur128Summary parses ffmpeg's "-inf dBFS" into -Infinity rather than
    // throwing (a muted channel or pre-service silence is a real, common case) —
    // buildMetricRows must not then treat that legitimate -Infinity measurement
    // as "not measured" and hide the row, which would defeat the point of that fix.
    const rows = buildMetricRows(makeSrc({ lufsIntegrated: -70, loudnessRange: 0, truePeakDbtp: -Infinity }), grading);
    const truePeak = rows.find((r) => r.name === 'True Peak')!;
    expect(truePeak).toBeDefined();
    expect(truePeak.value).toBe('-∞');
    expect(truePeak.tone).toBe('good'); // -Infinity ≤ ceiling
  });
});

describe('metricRowsHTML', () => {
  it('renders 5 rows', () => {
    const rows = buildMetricRows(makeSrc(), grading);
    const html = metricRowsHTML(rows);
    expect(html.match(/<tr>/g)?.length).toBe(5);
  });
  it('renders "—" for a null target', () => {
    const rows = buildMetricRows(makeSrc(), grading);
    rows[0].target = null;
    expect(metricRowsHTML([rows[0]])).toContain('<span class="mt-target">—</span>');
  });
  it('renders a note span only when a note is present', () => {
    const withNote = metricRowsHTML([{ name: 'X', note: 'a note', value: '1', unit: '', tone: 'good', target: null }]);
    expect(withNote).toContain('mt-note');
    const withoutNote = metricRowsHTML([{ name: 'X', note: null, value: '1', unit: '', tone: 'good', target: null }]);
    expect(withoutNote).not.toContain('mt-note');
  });
  it('renders a unit span only when the unit is non-empty', () => {
    const withUnit = metricRowsHTML([{ name: 'X', value: '1', unit: 'dB', tone: 'good', target: null }]);
    expect(withUnit).toContain('class="unit"');
    const withoutUnit = metricRowsHTML([{ name: 'X', value: '1', unit: '', tone: 'good', target: null }]);
    expect(withoutUnit).not.toContain('class="unit"');
  });
});

describe('buildScoreRows', () => {
  it('returns 6 rows in order, every graded row "good"/"No impact" and Peak/Centroid "Not graded" for a clean fixture', () => {
    const src = makeSrc();
    const rows = buildScoreRows(src, grading, grading.explainGrade(src));
    expect(rows.map((r) => r.name)).toEqual([
      'RMS Level', 'Peak Level', 'Dynamic Range', 'Band Balance', 'Clipping', 'Spectral Centroid',
    ]);
    const gradedNames = ['RMS Level', 'Dynamic Range', 'Band Balance', 'Clipping'];
    expect(rows.filter((r) => gradedNames.includes(r.name)).every((r) => r.tone === 'good')).toBe(true);
    expect(rows.filter((r) => gradedNames.includes(r.name)).every((r) => r.detail.impact === 'No impact')).toBe(true);
    expect(rows.find((r) => r.name === 'Peak Level')!.detail.impact).toBe('Not graded');
    expect(rows.find((r) => r.name === 'Spectral Centroid')!.detail.impact).toBe('Not graded');
  });

  it('marks the Loudness row "issue" with the deduction\'s exact strings for an out-of-band RMS (golden case)', () => {
    const src = makeSrc({ rms: -22 });
    const explain = grading.explainGrade(src);
    const rows = buildScoreRows(src, grading, explain);
    const row = rows.find((r) => r.name === 'RMS Level')!;
    const ded = explain.deductions.find((d: { rule: string }) => d.rule === 'RMS out of band');
    expect(row.tone).toBe('issue');
    expect(row.detail).toEqual({ measured: ded.measured, target: ded.target, impact: ded.letterImpact });
  });

  it('shows the LUFS variant of the Loudness row with the LRA extra line when loudness is measured', () => {
    const src = makeSrc({ lufsIntegrated: -25, loudnessRange: 6 });
    const rows = buildScoreRows(src, grading, grading.explainGrade(src));
    const row = rows.find((r) => r.name === 'Integrated Loudness')!;
    expect(row).toBeDefined();
    expect(row.value).toBe('-25.0 LUFS');
    expect(row.tone).toBe('issue');
    expect(row.extra).toBe('Loudness range 6.0 LU');
  });

  it('shows the True Peak variant of the Peak row when true peak is measured, good in-band and issue over ceiling', () => {
    const goodSrc = makeSrc({ truePeakDbtp: -1.05 });
    const goodRow = buildScoreRows(goodSrc, grading, grading.explainGrade(goodSrc)).find((r) => r.name === 'True Peak')!;
    expect(goodRow.tone).toBe('good');
    expect(goodRow.detail.impact).toBe('No impact');

    const issueSrc = makeSrc({ truePeakDbtp: -0.3 });
    const explain = grading.explainGrade(issueSrc);
    const issueRow = buildScoreRows(issueSrc, grading, explain).find((r) => r.name === 'True Peak')!;
    const ded = explain.deductions.find((d: { rule: string }) => d.rule === 'True peak over ceiling');
    expect(issueRow.tone).toBe('issue');
    expect(issueRow.detail).toEqual({ measured: ded.measured, target: ded.target, impact: ded.letterImpact });
  });

  it('marks Clipping hardFail with the forced-F sentence and "Automatic F" impact', () => {
    const src = makeSrc({ clipping: true });
    const rows = buildScoreRows(src, grading, grading.explainGrade(src));
    const row = rows.find((r) => r.name === 'Clipping')!;
    expect(row.hardFail).toBe(true);
    expect(row.detail.impact).toBe('Automatic F');
    expect(row.extra).toBe('Clipping forced an automatic F — the other grading rules were not evaluated.');

    const html = scoreRowsHTML(rows);
    expect(html).toContain('hard-fail');
    expect(html).toContain('Automatic F');
    expect(html).toContain('Clipping forced an automatic F');
  });

  it('marks Dynamic Range "info" with the skipped-rule detail for a live capture', () => {
    const src = makeSrc({ dynamicRange: null });
    const rows = buildScoreRows(src, grading, grading.explainGrade(src));
    const row = rows.find((r) => r.name === 'Dynamic Range')!;
    expect(row.tone).toBe('info');
    expect(row.value).toBe('—');
    expect(row.detail.impact).toBe('Rule skipped — graded on fewer metrics');
  });

  it('marks Band Balance "issue" over severeHotDiff and "check" between hotDiff and severeHotDiff', () => {
    const hotSrc = makeSrc({ bands: { ...flatBands(-30), mid: -8 } }); // diff +22, > severeHotDiff (15)
    const hotRow = buildScoreRows(hotSrc, grading, grading.explainGrade(hotSrc)).find((r) => r.name === 'Band Balance')!;
    expect(hotRow.tone).toBe('issue');
    expect(hotRow.detail.target).toBe('≤ +15 dB vs. other bands');

    const mildSrc = makeSrc({ bands: { ...flatBands(-30), mid: -17 } }); // diff +13, > hotDiff (12), <= severeHotDiff (15)
    const mildRow = buildScoreRows(mildSrc, grading, grading.explainGrade(mildSrc)).find((r) => r.name === 'Band Balance')!;
    expect(mildRow.tone).toBe('check');
  });
});

describe('scoreRowsHTML', () => {
  it('renders one collapsed <details> per row, reusing statusPillHTML for the pill', () => {
    const src = makeSrc();
    const rows = buildScoreRows(src, grading, grading.explainGrade(src));
    const html = scoreRowsHTML(rows);
    expect(html.match(/<details /g)?.length).toBe(6);
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html).toContain('pill sm good');
    expect(html).toContain('status-dot good');
  });
});

describe('whyGradeHTML', () => {
  it('renders the clean "met every grading rule" state', () => {
    const explain = grading.explainGrade(makeSrc());
    expect(whyGradeHTML(explain)).toContain('No deductions — this recording met every grading rule.');
  });
  it('renders a single forced-f row for clipping', () => {
    const explain = grading.explainGrade(makeSrc({ clipping: true }));
    const html = whyGradeHTML(explain);
    expect(html).toContain('forced-f');
    expect(html).toContain(iconSvg('alert-triangle', 18));
    expect(html.match(/rc-why-row/g)?.length).toBe(1);
  });
  it('renders an RMS-out-of-band deduction row with escaped fields', () => {
    const explain = grading.explainGrade(makeSrc({ rms: -30 }));
    const html = whyGradeHTML(explain);
    expect(html).toContain('rc-why-rule');
    expect(html).toContain('measured');
  });
  it('renders the "measured but no deductions" lead plus a skip row when a rule is unmeasured', () => {
    const explain = grading.explainGrade(makeSrc({ dynamicRange: null }));
    const html = whyGradeHTML(explain);
    expect(html).toContain('No deductions among the metrics that were measured.');
    expect(html).toContain('rc-why-skip');
  });
});

describe('recListHTML', () => {
  it('strips the CRITICAL prefix into a badge with an alert-triangle icon', () => {
    const html = recListHTML(['CRITICAL: Clipping is destroying your mix'], false);
    expect(html).toContain('rc-rec critical');
    expect(html).toContain('rc-rec-badge');
    expect(html).not.toContain('CRITICAL:');
    expect(html).toContain(iconSvg('alert-triangle', 16));
  });
  it('renders a plain recommendation with a check icon and no badge', () => {
    const html = recListHTML(['Levels look great'], false);
    expect(html).not.toContain('rc-rec-badge');
    expect(html).toContain(iconSvg('check', 16));
  });
  it('escapes text when escapeText is true, passes it through when false', () => {
    const escaped = recListHTML(['<b>bold</b>'], true);
    expect(escaped).toContain('&lt;b&gt;bold&lt;/b&gt;');
    // Live recs come from grading.js output, not user input, so the runtime
    // passes escapeText=false for them (mirrors today's history/live split).
    const raw = recListHTML(['<b>bold</b>'], false);
    expect(raw).toContain('<b>bold</b>');
  });
});

describe('levelColor', () => {
  it('grades hot/good/idle bands by dB thresholds', () => {
    expect(levelColor(-10)).toBe('var(--meter-good)');
    expect(levelColor(-30)).toBe('var(--meter-hot)');
    expect(levelColor(-50)).toBe('var(--meter-idle)');
  });
});

describe('bandMeterHTML', () => {
  it('renders the label, range, and formatted dB value', () => {
    const html = bandMeterHTML('Bass', '60–250 Hz', -18.456);
    expect(html).toContain('Bass');
    expect(html).toContain('60–250 Hz');
    expect(html).toContain('-18.5');
  });

  it('colors by level when colorBy is "level", falls back to a fixed color otherwise', () => {
    const byLevel = bandMeterHTML('Bass', '', -10, { colorBy: 'level' });
    expect(byLevel).toContain('var(--meter-good)');
    const byBand = bandMeterHTML('Bass', '', -10, { color: 'var(--band-bass)' });
    expect(byBand).toContain('var(--band-bass)');
  });

  it('dims the fill at/below DIM_DB and marks the value hot above HOT_DB', () => {
    const dimmed = bandMeterHTML('Sub', '', -65);
    expect(dimmed).toContain('opacity:0.5');
    const hot = bandMeterHTML('Sub', '', -10);
    expect(hot).toContain('bm-val hot');
  });

  it('omits the grid/scale by default and includes them when requested', () => {
    const plain = bandMeterHTML('Bass', '', -18);
    expect(plain).not.toContain('bm-scale');
    expect(plain).not.toContain('bm-grid');
    const withScale = bandMeterHTML('Bass', '', -18, { showScale: true });
    expect(withScale).toContain('bm-scale');
    expect(withScale).toContain('bm-grid');
  });

  it('renders -∞ for a non-finite dB value', () => {
    expect(bandMeterHTML('Bass', '', -Infinity)).toContain('-∞');
  });

  it('marks the loudest band with the "loud" class', () => {
    const html = bandMeterHTML('Bass', '', -18, { loudest: true });
    expect(html).toContain('bm-name loud');
    expect(html).toContain('bm-fill loud');
  });
});

describe('reportCardSourceFromAnalysis', () => {
  const analysis = {
    sox: { rmsDbfs: -18, peakDbfs: -6, dynamicRangeDb: 12, clipping: false },
    spectrum: {
      spectralCentroid: 1200,
      bands: { bass: -18, mid: -16 },
      curve: { freqs: [100], db: [-10] },
      contentType: 'speech',
      segments: [{ start: 0, end: 1, class: 'speech' }],
      frames: [{ t: 0, db: [-10], rms: -18 }],
    },
    ffprobe: { format: { filename: '/fake/path/silence.wav' } },
    loudness: { integratedLufs: -20, loudnessRange: 5, truePeakDbtp: -1 },
  };

  it('maps a well-formed analysis onto the report-card source shape', () => {
    const src = reportCardSourceFromAnalysis(analysis);
    expect(src).toEqual({
      filename: 'silence.wav',
      rms: -18,
      peak: -6,
      dynamicRange: 12,
      clipping: false,
      centroid: 1200,
      bands: { bass: -18, mid: -16 },
      curve: { freqs: [100], db: [-10] },
      contentType: 'speech',
      segments: [{ start: 0, end: 1, class: 'speech' }],
      frames: [{ t: 0, db: [-10], rms: -18 }],
      lufsIntegrated: -20,
      loudnessRange: 5,
      truePeakDbtp: -1,
    });
  });

  it('defaults loudness fields to null when the analysis has no loudness block', () => {
    const src = reportCardSourceFromAnalysis({ ...analysis, loudness: null });
    expect(src?.lufsIntegrated).toBeNull();
    expect(src?.loudnessRange).toBeNull();
    expect(src?.truePeakDbtp).toBeNull();
  });

  it('falls back to "Untitled" when ffprobe carries no filename', () => {
    const src = reportCardSourceFromAnalysis({ ...analysis, ffprobe: { format: {} } });
    expect(src?.filename).toBe('Untitled');
  });

  it.each([null, undefined, 42, {}, { sox: analysis.sox }, { spectrum: analysis.spectrum }])(
    'returns null for a malformed analysis: %j',
    (bad) => {
      expect(reportCardSourceFromAnalysis(bad)).toBeNull();
    }
  );
});

describe('contentTypeView', () => {
  it('resolves the pill label from a known content type', () => {
    expect(contentTypeView('speech', null).pillLabel).toBe('Speech');
    expect(contentTypeView('mixed', null).pillLabel).toBe('Mixed');
  });

  it('hides the pill for an absent or unknown content type', () => {
    expect(contentTypeView(null, null).pillLabel).toBeNull();
    expect(contentTypeView('bogus', null).pillLabel).toBeNull();
  });

  it('hides the ribbon when there are no usable segments', () => {
    expect(contentTypeView('speech', null)).toMatchObject({ ribbonSegmentsHTML: '', ribbonLegendHTML: '' });
    expect(contentTypeView('speech', []).ribbonSegmentsHTML).toBe('');
    expect(contentTypeView('speech', [{ start: 1, end: 1 }]).ribbonSegmentsHTML).toBe('');
  });

  it('renders proportional segments + a de-duplicated legend', () => {
    const segments = [
      { start: 0, end: 5, class: 'speech' },
      { start: 5, end: 10, class: 'music' },
      { start: 10, end: 20, class: 'speech' },
    ];
    const view = contentTypeView('mixed', segments);
    expect(view.ribbonSegmentsHTML).toContain('seg-speech');
    expect(view.ribbonSegmentsHTML).toContain('seg-music');
    expect(view.ribbonSegmentsHTML.match(/class="seg /g)).toHaveLength(3);
    expect(view.ribbonLegendHTML.match(/class="lg"/g)).toHaveLength(2); // deduped
  });

  it('falls back an unrecognized segment class to "unknown"', () => {
    const view = contentTypeView('speech', [{ start: 0, end: 1, class: 'bogus' }]);
    expect(view.ribbonSegmentsHTML).toContain('seg-unknown');
    expect(view.ribbonLegendHTML).toContain('Unknown');
  });
});

describe('bandBreakdownHTML', () => {
  const g: BandDiffApi = {
    bandDiffFromOthers: (bands, key) => bands[key] - -20,
    CONFIG: { bandBalance: { hotDiff: 5, quietDiff: -5, severeHotDiff: 15 } },
  };

  it('renders one row per BAND_META band with a balanced/hot/quiet verdict', () => {
    const bands = { subBass: -20, bass: -10, lowMid: -30, mid: -20, highMid: -20, presence: -20, brilliance: -20 };
    const html = bandBreakdownHTML(bands, g);
    expect(html.match(/rc-band-row/g)).toHaveLength(7);
    expect(html).toContain('rc-band-verdict hot');
    expect(html).toContain('Too Hot');
    expect(html).toContain('rc-band-verdict quiet');
    expect(html).toContain('Too Quiet');
    expect(html).toContain('rc-band-verdict ok');
    expect(html).toContain('Balanced');
  });
});

describe('reportCardFramesView', () => {
  it('is hidden when there are no frames', () => {
    expect(reportCardFramesView(undefined)).toEqual({ visible: false, heatmapHTML: '', curvesHTML: '' });
    expect(reportCardFramesView([])).toEqual({ visible: false, heatmapHTML: '', curvesHTML: '' });
  });

  it('renders a heatmap + start/middle/loudest frame curves when frames are present', () => {
    const frames = Array.from({ length: 5 }, (_, i) => ({ t: i, db: [-20, -10], rms: -30 + i, class: 'music' }));
    const view = reportCardFramesView(frames);
    expect(view.visible).toBe(true);
    expect(view.heatmapHTML).toContain('<svg');
    expect(view.curvesHTML.match(/rc-frame-tag/g)).toHaveLength(3);
    expect(view.curvesHTML).toContain('Start');
    expect(view.curvesHTML).toContain('Middle');
    expect(view.curvesHTML).toContain('Loudest');
  });
});

describe('fmtClock', () => {
  it('formats seconds as m:ss', () => {
    expect(fmtClock(65)).toBe('1:05');
    expect(fmtClock(5)).toBe('0:05');
  });
  it('falls back to 0:00 for non-finite or negative values', () => {
    expect(fmtClock(-1)).toBe('0:00');
    expect(fmtClock(NaN)).toBe('0:00');
    expect(fmtClock(Infinity)).toBe('0:00');
  });
});

describe('reportDeltaView', () => {
  it('reports an improved score with a letter change', () => {
    const view = reportDeltaView({ score: 92, gradeLetter: 'A' }, { score: 83, gradeLetter: 'B' });
    expect(view).toEqual({ points: 9, direction: 'improved', text: '+9 pts vs. last service (B → A)' });
  });

  it('reports a regressed score with a letter change', () => {
    const view = reportDeltaView({ score: 79, gradeLetter: 'B' }, { score: 83, gradeLetter: 'A' });
    expect(view).toMatchObject({ points: -4, direction: 'regressed' });
    expect(view?.text).toBe('-4 pts vs. last service (A → B)');
  });

  it('reports no change for an identical score and letter', () => {
    const view = reportDeltaView({ score: 83, gradeLetter: 'B' }, { score: 83, gradeLetter: 'B' });
    expect(view).toEqual({ points: 0, direction: 'unchanged', text: 'No change vs. last service (B)' });
  });

  it('shows the numeric change when the letter is the same (AC3)', () => {
    const view = reportDeltaView({ score: 86, gradeLetter: 'B' }, { score: 83, gradeLetter: 'B' });
    expect(view).toEqual({ points: 3, direction: 'improved', text: '+3 pts vs. last service (still B)' });
  });

  it('uses the singular "pt" unit for a one-point change', () => {
    const view = reportDeltaView({ score: 84, gradeLetter: 'B' }, { score: 83, gradeLetter: 'B' });
    expect(view).toEqual({ points: 1, direction: 'improved', text: '+1 pt vs. last service (still B)' });
  });

  it('returns null when there is no previous summary (first-ever analysis, AC2)', () => {
    expect(reportDeltaView({ score: 92, gradeLetter: 'A' }, null)).toBeNull();
    expect(reportDeltaView({ score: 92, gradeLetter: 'A' }, undefined)).toBeNull();
  });

  it('returns null when current is nullish', () => {
    expect(reportDeltaView(null, { score: 83, gradeLetter: 'B' })).toBeNull();
    expect(reportDeltaView(undefined, { score: 83, gradeLetter: 'B' })).toBeNull();
  });

  it('defends against a malformed previous summary read off disk', () => {
    expect(reportDeltaView({ score: 92, gradeLetter: 'A' }, { score: NaN, gradeLetter: 'B' })).toBeNull();
    expect(reportDeltaView({ score: 92, gradeLetter: 'A' }, { score: 83, gradeLetter: '' })).toBeNull();
    expect(reportDeltaView({ score: 92, gradeLetter: 'A' }, { score: 83, gradeLetter: undefined as unknown as string })).toBeNull();
  });

  it('defends against a malformed current value', () => {
    expect(reportDeltaView({ score: NaN, gradeLetter: 'A' }, { score: 83, gradeLetter: 'B' })).toBeNull();
    expect(reportDeltaView({ score: 92, gradeLetter: '' }, { score: 83, gradeLetter: 'B' })).toBeNull();
  });
});

/* ── Handoff note (#267) ── */
describe('noteSubmitPayload', () => {
  it('returns null (no IPC call) when there is no lastSavedSummaryFile', () => {
    expect(noteSubmitPayload(null, 'anything')).toBeNull();
  });

  it('trims whitespace before dispatch', () => {
    expect(noteSubmitPayload('x.json', '  used the new wireless pack  ')).toEqual({
      file: 'x.json',
      note: 'used the new wireless pack',
    });
  });

  it('clamps the note to MAX_NOTE_LENGTH before dispatch', () => {
    const result = noteSubmitPayload('x.json', 'x'.repeat(500));
    expect(result?.note).toHaveLength(200);
  });

  it('dispatches an empty payload for a whitespace-only note (clears the saved note)', () => {
    expect(noteSubmitPayload('x.json', '   ')).toEqual({ file: 'x.json', note: '' });
  });
});

describe('commitReportCardNote', () => {
  it('does not call setNote when there is no lastSavedSummaryFile', async () => {
    const setNote = vi.fn();
    await commitReportCardNote(setNote, null, 'anything');
    expect(setNote).not.toHaveBeenCalled();
  });

  it('calls setNote with the trimmed/clamped payload and resolves on success', async () => {
    const setNote = vi.fn().mockResolvedValue({ success: true });
    await commitReportCardNote(setNote, 'x.json', '  board tech was out  ');
    expect(setNote).toHaveBeenCalledWith({ file: 'x.json', note: 'board tech was out' });
  });

  it('warns without throwing when setNote resolves { success: false }', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const setNote = vi.fn().mockResolvedValue({ success: false, error: 'disk full' });
    await commitReportCardNote(setNote, 'x.json', 'note text');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('warns without throwing when setNote rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const setNote = vi.fn().mockRejectedValue(new Error('IPC down'));
    await commitReportCardNote(setNote, 'x.json', 'note text');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

/* ── "Save this mix as your target" CTA (#263) ── */
describe('isStrongGrade', () => {
  it('returns true for A and B', () => {
    expect(isStrongGrade('A')).toBe(true);
    expect(isStrongGrade('B')).toBe(true);
  });
  it('returns false for C, D, F, and an empty string', () => {
    expect(isStrongGrade('C')).toBe(false);
    expect(isStrongGrade('D')).toBe(false);
    expect(isStrongGrade('F')).toBe(false);
    expect(isStrongGrade('')).toBe(false);
  });
});

describe('strongMixTargetMeta', () => {
  it('derives an id/label from a simple filename', () => {
    expect(strongMixTargetMeta('silence.wav')).toEqual({
      id: 'strongmix-silence',
      label: 'Target from silence',
      description: 'Saved from a strong-grading mix',
    });
  });

  it('strips the extension and slugifies spaces/mixed case', () => {
    const meta = strongMixTargetMeta('My Sunday Mix.flac');
    expect(meta.id).toBe('strongmix-my-sunday-mix');
    expect(meta.label).toBe('Target from My Sunday Mix');
  });

  it('falls back to "Saved mix" for an empty or whitespace-only filename', () => {
    expect(strongMixTargetMeta('')).toEqual({
      id: 'strongmix-saved-mix',
      label: 'Target from Saved mix',
      description: 'Saved from a strong-grading mix',
    });
    expect(strongMixTargetMeta('   ')).toEqual({
      id: 'strongmix-saved-mix',
      label: 'Target from Saved mix',
      description: 'Saved from a strong-grading mix',
    });
  });

  it('caps the label at 60 characters for a very long base name', () => {
    const meta = strongMixTargetMeta('a'.repeat(100) + '.wav');
    expect(meta.label.length).toBe(60);
    expect(meta.label.startsWith('Target from ')).toBe(true);
  });
});

/* ── Summary-building (#261) ── */
describe('buildAnalysisSummaryInput', () => {
  function fakeGrading(overrides: Partial<SummaryGradingApi> = {}): SummaryGradingApi {
    return {
      computeGrade: vi.fn().mockReturnValue('B'),
      computeScore: vi.fn().mockReturnValue(83),
      analyzeRecordingType: vi.fn().mockReturnValue({ label: 'Live service mix' }),
      computeRecommendations: vi.fn().mockReturnValue(['fix one', 'fix two']),
      ...overrides,
    };
  }

  const src = makeSrc({ filename: 'service.wav' }) as ReportCardSource;

  it('maps grading output and the source filename into the summary shape', () => {
    const g = fakeGrading();
    const input = buildAnalysisSummaryInput(src, g, 'file');
    expect(input).toEqual({
      sourceFilename: 'service.wav',
      gradeLetter: 'B',
      score: 83,
      recordingType: 'Live service mix',
      topFixes: ['fix one', 'fix two'],
      source: 'file',
    });
    expect(g.computeGrade).toHaveBeenCalledWith(src);
    expect(g.computeScore).toHaveBeenCalledWith(src);
    expect(g.analyzeRecordingType).toHaveBeenCalledWith(src);
    expect(g.computeRecommendations).toHaveBeenCalledWith(src);
  });

  it(`truncates topFixes to MAX_TOP_FIXES (${MAX_TOP_FIXES})`, () => {
    expect(MAX_TOP_FIXES).toBe(3);
    const g = fakeGrading({ computeRecommendations: vi.fn().mockReturnValue(['a', 'b', 'c', 'd', 'e']) });
    const input = buildAnalysisSummaryInput(src, g, 'file');
    expect(input.topFixes).toEqual(['a', 'b', 'c']);
  });

  it('passes through source "live"', () => {
    const input = buildAnalysisSummaryInput(src, fakeGrading(), 'live');
    expect(input.source).toBe('live');
  });

  it('passes through source "file"', () => {
    const input = buildAnalysisSummaryInput(src, fakeGrading(), 'file');
    expect(input.source).toBe('file');
  });
});
