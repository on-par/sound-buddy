// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, it, expect } from 'vitest';
import { buildTrendReportRows, trendReportHtml, MIN_TREND_ENTRIES } from './trend-export';
import { reportDeltaView } from './report-card';
import type { AnalysisSummary } from '../../electron/ipc/api';

const NEWER: AnalysisSummary = {
  date: '2026-08-01T12:00:00Z', sourceFilename: 'sunday.wav', gradeLetter: 'A', score: 95,
  recordingType: 'Full Mix', topFixes: [],
};
const OLDER: AnalysisSummary = {
  date: '2026-07-25T12:00:00Z', sourceFilename: 'live-session', gradeLetter: 'C', score: 70,
  recordingType: 'Live Capture', topFixes: [],
};
const OLDEST: AnalysisSummary = {
  date: '2026-07-18T12:00:00Z', sourceFilename: 'earlier.wav', gradeLetter: 'B', score: 80,
  recordingType: 'Full Mix', topFixes: [],
};

describe('MIN_TREND_ENTRIES', () => {
  it('is 2', () => {
    expect(MIN_TREND_ENTRIES).toBe(2);
  });
});

describe('buildTrendReportRows', () => {
  it('returns an empty array for no summaries', () => {
    expect(buildTrendReportRows([])).toEqual([]);
  });

  it('returns a single null-delta row for one summary', () => {
    const rows = buildTrendReportRows([NEWER]);
    expect(rows).toEqual([{ date: NEWER.date, gradeLetter: 'A', score: 95, delta: null }]);
  });

  it('reorders newest-first input into chronological rows, computing delta vs. the immediate predecessor', () => {
    const rows = buildTrendReportRows([NEWER, OLDER]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ date: OLDER.date, gradeLetter: 'C', score: 70, delta: null });
    expect(rows[1].date).toBe(NEWER.date);
    expect(rows[1].delta).toEqual(reportDeltaView(NEWER, OLDER));
  });

  it('with 3+ summaries, each row deltas against its immediate (older) predecessor, not the first/newest', () => {
    const rows = buildTrendReportRows([NEWER, OLDER, OLDEST]);
    expect(rows.map((r) => r.date)).toEqual([OLDEST.date, OLDER.date, NEWER.date]);
    expect(rows[0].delta).toBeNull();
    expect(rows[1].delta).toEqual(reportDeltaView(OLDER, OLDEST));
    expect(rows[2].delta).toEqual(reportDeltaView(NEWER, OLDER));
  });

  it('produces a null delta for a malformed row instead of throwing', () => {
    const malformed: AnalysisSummary = { ...OLDER, gradeLetter: '' };
    const rows = buildTrendReportRows([NEWER, malformed]);
    expect(rows[1].delta).toBeNull();
  });
});

describe('trendReportHtml', () => {
  it('returns the "not enough history" message with no rows, and no table', () => {
    const html = trendReportHtml([]);
    expect(html).toContain('Not enough history yet');
    expect(html).not.toContain('<table');
  });

  it('returns the "not enough history" message with one row (MIN_TREND_ENTRIES boundary), and no table', () => {
    const rows = buildTrendReportRows([NEWER]);
    const html = trendReportHtml(rows);
    expect(html).toContain('Not enough history yet');
    expect(html).not.toContain('<table');
  });

  it('renders one <tr> per row with escaped date/grade/score/delta text for 2+ rows', () => {
    const rows = buildTrendReportRows([NEWER, OLDER]);
    const html = trendReportHtml(rows);
    expect(html.match(/<tr>\s*<td>/g)).toHaveLength(2);
    expect(html).toContain('>C<');
    expect(html).toContain('>70<');
    expect(html).toContain('>A<');
    expect(html).toContain('>95<');
    expect(html).toContain('First recorded service');
    const delta = reportDeltaView(NEWER, OLDER);
    expect(html).toContain(delta!.text);
  });

  it('does not mislabel a malformed mid-history row as "First recorded service"', () => {
    const malformedMiddle: AnalysisSummary = { ...OLDER, gradeLetter: '' };
    const rows = buildTrendReportRows([NEWER, malformedMiddle, OLDEST]);
    const html = trendReportHtml(rows);
    expect(html.match(/First recorded service/g)).toHaveLength(1);
    expect(html).toContain('No comparison available');
  });

  it('HTML-escapes a gradeLetter containing angle brackets/ampersands', () => {
    const unsafe: AnalysisSummary = { ...NEWER, gradeLetter: '<b>&' };
    const rows = buildTrendReportRows([unsafe, OLDER]);
    const html = trendReportHtml(rows);
    expect(html).not.toContain('<b>&');
    expect(html).toContain('&lt;b&gt;&amp;');
  });
});
