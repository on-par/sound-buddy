// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createRequire } from 'node:module';
import ReportCard, { type GradeResult } from './ReportCard';
import {
  buildMetricRows,
  gradeRingHTML,
  recTypePillHTML,
  metricRowsHTML,
  whyGradeHTML,
  recListHTML,
  type ReportCardSource,
  type ProfileComparison,
} from './report-card';

const require = createRequire(import.meta.url);
const grading = require('../grading.js');
const { makeSrc } = require('../grading/fixtures.js');

function buildGrade(src: ReportCardSource): GradeResult {
  return {
    letter: grading.computeGrade(src),
    score: grading.computeScore(src),
    recType: grading.analyzeRecordingType(src),
    explain: grading.explainGrade(src),
    recommendations: grading.computeRecommendations(src),
    metrics: buildMetricRows(src, grading),
  };
}

function renderMarkup(props: Parameters<typeof ReportCard>[0]): string {
  return renderToString(createElement(ReportCard, props));
}

describe('ReportCard', () => {
  it('renders identically to the shared builders (markup identity)', () => {
    const src: ReportCardSource = { ...makeSrc(), filename: 'service.wav' };
    const grade = buildGrade(src);

    const html = renderMarkup({ analysis: src, grade, dateText: '1/1/2026, 12:00:00 PM' });

    expect(html).toContain(gradeRingHTML(grade.letter, grade.score));
    expect(html).toContain(recTypePillHTML(grade.recType));
    expect(html).toContain(metricRowsHTML(grade.metrics));
    expect(html).toContain(whyGradeHTML(grade.explain));
    expect(html).toContain(recListHTML(grade.recommendations, false));
  });

  it('renders mixed pill tones across metrics and an info-tone rec-type', () => {
    const src: ReportCardSource = { ...makeSrc({ clipping: true, dynamicRange: null }), filename: 'mixed.wav' };
    const grade = buildGrade(src);

    const html = renderMarkup({ analysis: src, grade, dateText: 'now' });

    expect(html).toContain('pill sm issue');
    expect(html).toContain('pill sm check');
    expect(html).toContain('pill sm good');
  });

  it('shows the profile section when both profile and comparison are given', () => {
    const src: ReportCardSource = { ...makeSrc(), filename: 'x.wav' };
    const grade = buildGrade(src);
    const profile = { label: 'Flat' };
    const comparison: ProfileComparison = { matchScore: 92, deviation: [1, -2, 0], topOver: null, topUnder: null };

    const html = renderMarkup({ analysis: src, grade, dateText: 'now', profile, comparison });

    expect(html).toContain('rc-profile-section');
    expect(html).toContain('Flat');
  });

  it('omits the profile section when comparison is null', () => {
    const src: ReportCardSource = { ...makeSrc(), filename: 'x.wav' };
    const grade = buildGrade(src);

    const html = renderMarkup({ analysis: src, grade, dateText: 'now', profile: { label: 'Flat' }, comparison: null });

    expect(html).not.toContain('rc-profile-section');
  });

  it('renders filename and dateText as escaped text content', () => {
    const src: ReportCardSource = { ...makeSrc(), filename: '<b>evil</b>.wav' };
    const grade = buildGrade(src);

    const html = renderMarkup({ analysis: src, grade, dateText: 'Jan 1, 2026' });

    expect(html).not.toContain('<b>evil</b>.wav');
    expect(html).toContain('&lt;b&gt;evil&lt;/b&gt;.wav');
    expect(html).toContain('Jan 1, 2026');
  });

  it('shows the score and /100 in the ring block', () => {
    const src: ReportCardSource = { ...makeSrc(), filename: 'x.wav' };
    const grade = buildGrade(src);

    const html = renderMarkup({ analysis: src, grade, dateText: 'now' });

    expect(html).toContain(`${grade.score}<span class="slash">/100</span>`);
  });
});
