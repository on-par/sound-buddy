// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Multi-week trend PDF export (#272) — a second, distinct export from the
// existing single-report "Export PDF" button. Packages the last N persisted
// AnalysisSummary records (already fetched by RecentServicesPanel) into a
// plain table of date/grade/score/delta so a volunteer can show a treasurer
// or pastor the trend across services, reusing #259's delta computation
// rather than re-deriving it.

import { reportDeltaView, type ReportDeltaView } from './report-card';
import { escapeHtml } from './spectrum-display';
import type { AnalysisSummary } from '../../electron/ipc/api';

export const MIN_TREND_ENTRIES = 2;

export interface TrendReportRow {
  date: string;
  gradeLetter: string;
  score: number;
  /** null for the oldest row (no prior entry) or when reportDeltaView can't compare
   *  (malformed record) — same null semantics #259 already established. */
  delta: ReportDeltaView | null;
}

export function buildTrendReportRows(summaries: AnalysisSummary[]): TrendReportRow[] {
  // summaries arrives newest-first (listAnalysisSummaries' contract) — reverse to
  // chronological so the printed trend reads oldest-to-newest, top to bottom.
  const chronological = [...summaries].reverse();
  return chronological.map((s, i) => ({
    date: s.date,
    gradeLetter: s.gradeLetter,
    score: s.score,
    delta: i === 0 ? null : reportDeltaView(s, chronological[i - 1]),
  }));
}

export function trendReportHtml(rows: TrendReportRow[]): string {
  if (rows.length < MIN_TREND_ENTRIES) {
    return '<p class="trend-report-empty">Not enough history yet — analyze at least 2 services to export a trend PDF.</p>';
  }
  const body = rows.map((r, i) => {
    // A null delta means either "this is the chronologically first row" (i === 0)
    // or "reportDeltaView rejected a malformed record further down the history" —
    // those are different facts and must not both read "First recorded service".
    const deltaText = r.delta ? r.delta.text : i === 0 ? 'First recorded service' : 'No comparison available';
    return `
    <tr>
      <td>${escapeHtml(new Date(r.date).toLocaleDateString())}</td>
      <td>${escapeHtml(r.gradeLetter)}</td>
      <td>${Math.round(r.score)}</td>
      <td>${escapeHtml(deltaText)}</td>
    </tr>`;
  }).join('');
  return `
    <h1>Sound Buddy — Service Trend</h1>
    <table class="trend-table">
      <thead><tr><th>Date</th><th>Grade</th><th>Score</th><th>vs. prior</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}
