// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
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
  recListHTML,
  type PillTone,
  type ProfileComparison,
} from './report-card';

const require = createRequire(import.meta.url);
const grading = require('../grading.js');
const { makeSrc } = require('../grading/fixtures.js');

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
    expect(truePeak.tone).toBe('info');
    expect(truePeak.target).toBeNull();
    expect(integrated.unit).toBe('LUFS');
    expect(integrated.value).toBe('-14.2');
    expect(integrated.tone).toBe('info');
    expect(integrated.target).toBeNull();
    expect(lra.unit).toBe('LU');
    expect(lra.value).toBe('6.3');
    expect(lra.tone).toBe('info');
    expect(lra.target).toBeNull();
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
