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
  buildScoreRows,
  scoreRowsHTML,
  recListHTML,
  bandBreakdownHTML,
  contentTypeView,
  reportCardFramesView,
  reportDeltaView,
  MAX_NOTE_LENGTH,
  type ReportCardSource,
  type ProfileComparison,
  type BandDiffApi,
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
    expect(html).not.toContain('rc-metric-rows');
  });

  it('renders the score-circle metric rows instead of the table/why-section when scoreRows is passed (#540)', () => {
    const src: ReportCardSource = { ...makeSrc(), filename: 'x.wav' };
    const grade = buildGrade(src);
    const rows = buildScoreRows(src, grading, grade.explain);

    const html = renderMarkup({ analysis: src, grade, dateText: 'now', scoreRows: rows });

    expect(html).toContain('id="rc-metric-rows"');
    expect(html).toContain(scoreRowsHTML(rows));
    expect(html).not.toContain(metricRowsHTML(grade.metrics));
    expect(html).not.toContain(whyGradeHTML(grade.explain));
    expect(html).not.toContain('metric-table');
    expect(html).toContain(gradeRingHTML(grade.letter, grade.score));
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

  it('omits content-type/bands/frames/callout sections when their props are absent', () => {
    const src: ReportCardSource = { ...makeSrc(), filename: 'x.wav' };
    const grade = buildGrade(src);

    const html = renderMarkup({ analysis: src, grade, dateText: 'now' });

    expect(html).toContain('style="display:none"'); // content-type pill + ribbon both hidden
    expect(html).not.toContain('rc-bands-section');
    expect(html).not.toContain('rc-frames-section');
    expect(html).not.toContain('rc-phase-doubling');
    expect(html).not.toContain('rc-feedback-ringout');
  });

  it('shows the content-type pill + ribbon when given a populated view', () => {
    const src: ReportCardSource = { ...makeSrc(), filename: 'x.wav' };
    const grade = buildGrade(src);
    const view = contentTypeView('speech', [{ start: 0, end: 1, class: 'speech' }, { start: 1, end: 2, class: 'music' }]);

    const html = renderMarkup({ analysis: src, grade, dateText: 'now', contentType: view });

    expect(html).toContain('rc-contenttype speech');
    expect(html).toContain('>Speech<');
    expect(html).toContain('seg-speech');
    expect(html).toContain('seg-music');
  });

  it('renders the band breakdown section from bandDiffApi', () => {
    const src: ReportCardSource = { ...makeSrc(), filename: 'x.wav' };
    const grade = buildGrade(src);
    const bandDiffApi: BandDiffApi = {
      bandDiffFromOthers: () => 0,
      CONFIG: { bandBalance: { hotDiff: 5, quietDiff: -5, severeHotDiff: 15 } },
    };

    const html = renderMarkup({ analysis: src, grade, dateText: 'now', bandDiffApi });

    expect(html).toContain('rc-bands-section');
    expect(html).toContain(bandBreakdownHTML(src.bands, bandDiffApi));
  });

  it('renders the frames section when visible, omits it when not', () => {
    const src: ReportCardSource = { ...makeSrc(), filename: 'x.wav' };
    const grade = buildGrade(src);
    const framesData = [{ t: 0, db: [-20, -10], rms: -18, class: 'music' }];
    const view = reportCardFramesView(framesData);

    const shown = renderMarkup({ analysis: src, grade, dateText: 'now', frames: view });
    expect(shown).toContain('rc-frames-section');
    expect(shown).toContain(view.heatmapHTML);

    const hidden = renderMarkup({ analysis: src, grade, dateText: 'now', frames: reportCardFramesView([]) });
    expect(hidden).not.toContain('rc-frames-section');
  });

  it('renders the phase-doubling and feedback-ringout callouts, emphasized when detected', () => {
    const src: ReportCardSource = { ...makeSrc(), filename: 'x.wav' };
    const grade = buildGrade(src);

    const html = renderMarkup({
      analysis: src,
      grade,
      dateText: 'now',
      phaseDoubling: { detected: true, title: 'Possible phase issue', sub: 'Comb-filter pattern' },
      feedbackRingout: { detected: false, title: 'Fighting feedback?', sub: 'Walk through ringing out a mic', buttonLabel: 'Open the ring-out wizard' },
    });

    expect(html).toContain('rc-phase-doubling');
    expect(html).toContain('pd-launch detected');
    expect(html).toContain('Possible phase issue');
    expect(html).toContain('rc-feedback-ringout');
    expect(html).toContain('Open the ring-out wizard');
  });

  it('renders the "vs. last time" delta line when a delta prop is given (#259)', () => {
    const src: ReportCardSource = { ...makeSrc(), filename: 'x.wav' };
    const grade = buildGrade(src);
    const delta = reportDeltaView({ score: 92, gradeLetter: 'A' }, { score: 83, gradeLetter: 'B' });

    const html = renderMarkup({ analysis: src, grade, dateText: 'now', delta });

    expect(html).toContain('id="rc-delta"');
    expect(html).toContain('rc-delta improved');
    expect(html).toContain('+9 pts vs. last service (B → A)');
  });

  it('omits the delta line when the delta prop is absent or null (#259)', () => {
    const src: ReportCardSource = { ...makeSrc(), filename: 'x.wav' };
    const grade = buildGrade(src);

    const withoutProp = renderMarkup({ analysis: src, grade, dateText: 'now' });
    expect(withoutProp).not.toContain('rc-delta');

    const withNull = renderMarkup({ analysis: src, grade, dateText: 'now', delta: null });
    expect(withNull).not.toContain('rc-delta');
  });
});

describe('ReportCard — "save this mix as your target" CTA (#263)', () => {
  it('renders the CTA with the not-yet-saved label when showSaveTarget is true and saveTargetSaved is false', () => {
    const src: ReportCardSource = { ...makeSrc(), filename: 'x.wav' };
    const grade = buildGrade(src);

    const html = renderMarkup({ analysis: src, grade, dateText: 'now', showSaveTarget: true, saveTargetSaved: false });

    expect(html).toContain('id="rc-save-target"');
    expect(html).toContain('Save this mix’s tone as your target');
    expect(html).not.toContain('Saved as a target curve');
  });

  it('flips to the saved/disabled state when saveTargetSaved is true', () => {
    const src: ReportCardSource = { ...makeSrc(), filename: 'x.wav' };
    const grade = buildGrade(src);

    const html = renderMarkup({ analysis: src, grade, dateText: 'now', showSaveTarget: true, saveTargetSaved: true });

    expect(html).toContain('Saved as a target curve');
    expect(html).toMatch(/id="rc-save-target-btn"[^>]*disabled=""/);
  });

  it('omits the CTA when showSaveTarget is false or omitted', () => {
    const src: ReportCardSource = { ...makeSrc(), filename: 'x.wav' };
    const grade = buildGrade(src);

    const omitted = renderMarkup({ analysis: src, grade, dateText: 'now' });
    expect(omitted).not.toContain('id="rc-save-target"');

    const explicitFalse = renderMarkup({ analysis: src, grade, dateText: 'now', showSaveTarget: false });
    expect(explicitFalse).not.toContain('id="rc-save-target"');
  });
});

describe('ReportCard — contextual tool links (#545)', () => {
  it('flag-on + detected finding: keeps the Ring-Out callout and adds the Build Guide link', () => {
    const src: ReportCardSource = { ...makeSrc(), filename: 'x.wav' };
    const grade = buildGrade(src);

    const html = renderMarkup({
      analysis: src,
      grade,
      dateText: 'now',
      contextualLinks: true,
      feedbackRingout: {
        detected: true,
        title: 'Possible feedback ring near 2.00 kHz',
        sub: 'Ring out this frequency before it becomes a problem.',
        buttonLabel: 'Ring out this frequency',
      },
    });

    expect(html).toContain('id="rc-feedback-ringout"');
    expect(html).toContain('Ring out this frequency');
    expect(html).toContain('id="rc-build-guide-btn"');
    expect(html).toContain('Review in Build Guide');
  });

  it('flag-on + no finding: hides the Ring-Out callout but still shows the report-level Build Guide link', () => {
    const src: ReportCardSource = { ...makeSrc(), filename: 'x.wav' };
    const grade = buildGrade(src);

    const html = renderMarkup({
      analysis: src,
      grade,
      dateText: 'now',
      contextualLinks: true,
      feedbackRingout: { detected: false, title: 'Fighting feedback?', sub: 'Walk through ringing out a mic', buttonLabel: 'Open the ring-out wizard' },
    });

    expect(html).not.toContain('rc-feedback-ringout');
    expect(html).toContain('id="rc-build-guide-link"');
  });

  it('flag-off: renders today\'s always-on callout and no Build Guide link', () => {
    const src: ReportCardSource = { ...makeSrc(), filename: 'x.wav' };
    const grade = buildGrade(src);

    const html = renderMarkup({
      analysis: src,
      grade,
      dateText: 'now',
      feedbackRingout: { detected: false, title: 'Fighting feedback?', sub: 'Walk through ringing out a mic', buttonLabel: 'Open the ring-out wizard' },
    });

    expect(html).toContain('id="rc-feedback-ringout"');
    expect(html).not.toContain('rc-build-guide');
  });

  it('flag-on works alongside scoreRows (e17-01 interplay)', () => {
    const src: ReportCardSource = { ...makeSrc(), filename: 'x.wav' };
    const grade = buildGrade(src);
    const scoreRows = buildScoreRows(src, grading, grade.explain);

    const html = renderMarkup({
      analysis: src,
      grade,
      dateText: 'now',
      contextualLinks: true,
      scoreRows,
      feedbackRingout: { detected: true, title: 'Possible feedback ring', sub: 'sub', buttonLabel: 'Ring out this frequency' },
    });

    expect(html).toContain('rc-metric-rows');
    expect(html).toContain('rc-feedback-ringout');
    expect(html).toContain('rc-build-guide-btn');
  });
});

describe('ReportCard — handoff note (#267)', () => {
  const src: ReportCardSource = { ...makeSrc(), filename: 'x.wav' };
  const grade = buildGrade(src);

  it('renders the note input disabled and the print text hidden by default (no save has resolved yet)', () => {
    const html = renderMarkup({ analysis: src, grade, dateText: 'now' });

    expect(html).toContain('id="rc-note-input"');
    expect(html).toContain('disabled=""');
    expect(html).toMatch(/maxlength="200"/i);
    expect(html).toContain('id="rc-note-text"');
    expect(html).toMatch(/<p[^>]*id="rc-note-text"[^>]*hidden=""/);
  });

  it('enables the input and shows the print text once a note is editable with a value', () => {
    const html = renderMarkup({
      analysis: src,
      grade,
      dateText: 'now',
      noteEditable: true,
      noteValue: 'used the new wireless pack today',
    });

    expect(html).not.toMatch(/id="rc-note-input"[^>]*disabled=""/);
    expect(html).toContain('value="used the new wireless pack today"');
    expect(html).toContain('used the new wireless pack today</p>');
    expect(html).not.toMatch(/<p[^>]*id="rc-note-text"[^>]*hidden=""/);
  });

  it('carries a screen-only-hidden class so the print mirror never duplicates the input on screen while typing', () => {
    const html = renderMarkup({
      analysis: src,
      grade,
      dateText: 'now',
      noteEditable: true,
      noteValue: 'used the new wireless pack today',
    });

    expect(html).toMatch(/<p[^>]*class="rc-note-text rc-note-print-mirror"[^>]*id="rc-note-text"/);
  });

  it('escapes a hostile note value in the print text', () => {
    const html = renderMarkup({
      analysis: src,
      grade,
      dateText: 'now',
      noteEditable: true,
      noteValue: '<img src=x onerror=alert(1)>',
    });

    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('exposes MAX_NOTE_LENGTH as 200', () => {
    expect(MAX_NOTE_LENGTH).toBe(200);
  });
});
