// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Shared read-only render of a stored History summary (#147, #1521) — the
// meta/score/note/recommendations markup used by both ReportCardIsland's
// full-page HistoryCard (`rc-*` ids) and AnalyzeResultsPanel's Analyze-rail
// HistoryCard (`arc-*` ids). The grade/score are read straight from the
// record: they were frozen at analysis time, never recomputed. `idPrefix`
// keeps each mount's DOM ids distinct since ReportCardIsland stays mounted
// underneath Analyze at all times (only hidden by CSS).

import type { JSX } from 'react';
import { gradeRingHTML, recListHTML, type ReportDeltaView } from './report-card';
import type { AnalysisSummary } from '../../electron/ipc/api';

export function historySummaryCardBody(
  summary: AnalysisSummary,
  idPrefix: string,
  opts: { delta?: ReportDeltaView | null; title?: string } = {}
): JSX.Element {
  const { delta, title } = opts;
  const meta = (
    <div className="rc-meta">
      <span id={`${idPrefix}-filename`}>{summary.sourceFilename}</span>
      <span>·</span>
      <span id={`${idPrefix}-date`}>{new Date(summary.date).toLocaleString()}</span>
    </div>
  );

  return (
    <>
      {title ? (
        <div className="rc-header">
          <h1>{title}</h1>
          {meta}
        </div>
      ) : (
        meta
      )}
      <div className="rc-score">
        <div id={`${idPrefix}-ring`} dangerouslySetInnerHTML={{ __html: gradeRingHTML(summary.gradeLetter, summary.score) }} />
        <div id={`${idPrefix}-rec-type`} className="rc-rectype pill">{summary.recordingType}</div>
        {summary.gradingProfileLabel && (
          <div className="rc-rectype pill" id={`${idPrefix}-grading-profile`}>{summary.gradingProfileLabel}</div>
        )}
        {delta && <div id="rc-delta" className={`rc-delta ${delta.direction}`}>{delta.text}</div>}
      </div>
      {summary.note && <p className="rc-note-text" id={`${idPrefix}-note-text`}>{summary.note}</p>}
      <div className="rc-section" id={idPrefix === 'arc' ? 'arc-recommendations-section' : undefined}>
        <h2>Recommendations</h2>
        <div
          className="rc-recs"
          id={`${idPrefix}-recommendations`}
          dangerouslySetInnerHTML={{ __html: recListHTML(summary.topFixes || [], true) }}
        />
      </div>
    </>
  );
}
