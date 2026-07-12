// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Presentational counterpart to report-card.ts (#306, epic #302): renders the
// same markup renderReportCard builds imperatively in inline-app.js, from the
// shared module's functions, so there is one source of truth for the report
// card's HTML. NOT mounted into the running app yet — inline-app.js still
// drives #rc-content at runtime via the window.reportCard bridge (see
// App.tsx). Wiring this component into the live tree is a later epic slice,
// same as <SpectrumDisplay>. Content-type pill/ribbon, band breakdown,
// spectrum-over-time frames, and the upgrade card are out of scope for this
// component — they depend on playback/live-view helpers and license state
// that stay with the imperative renderer, per the issue's In-scope list.
//
// Assumes a single instance per page (it reuses today's rc-* ids so CSS
// applies unchanged).

import {
  gradeRingHTML,
  recTypePillClass,
  recTypePillHTML,
  profileMatchHTML,
  metricRowsHTML,
  whyGradeHTML,
  recListHTML,
  type RecordingType,
  type GradeExplanation,
  type MetricRow,
  type ProfileComparison,
  type ReportCardSource,
} from './report-card';

export interface GradeResult {
  letter: string;
  score: number;
  recType: RecordingType;
  explain: GradeExplanation;
  recommendations: string[];
  metrics: MetricRow[];
}

export interface ReportCardProps {
  analysis: ReportCardSource;
  /** Active ideal profile (with comparison → match section). */
  profile?: { label: string } | null;
  comparison?: ProfileComparison | null;
  isAutoProfile?: boolean;
  grade: GradeResult;
  /** Caller formats the date — keeps the component pure (no `new Date()`). */
  dateText: string;
}

export default function ReportCard({
  analysis,
  profile,
  comparison,
  isAutoProfile = false,
  grade,
  dateText,
}: ReportCardProps) {
  const showProfile = !!(profile && comparison);

  return (
    <div id="rc-content">
      <div className="rc-header">
        <h1>Sound Buddy Report Card</h1>
        <div className="rc-meta">
          <span id="rc-filename">{analysis.filename}</span>
          <span>·</span>
          <span id="rc-date">{dateText}</span>
        </div>
      </div>
      <div className="rc-score">
        <div id="rc-ring" dangerouslySetInnerHTML={{ __html: gradeRingHTML(grade.letter, grade.score) }} />
        <div
          id="rc-rec-type"
          className={recTypePillClass(grade.recType)}
          dangerouslySetInnerHTML={{ __html: recTypePillHTML(grade.recType) }}
        />
      </div>
      {showProfile && (
        <div className="rc-section" id="rc-profile-section">
          <h2>Tonal balance vs target</h2>
          <div
            className="rc-profile"
            id="rc-profile"
            dangerouslySetInnerHTML={{ __html: profileMatchHTML(profile!, comparison!, isAutoProfile) }}
          />
        </div>
      )}
      <div className="rc-section" id="rc-metrics-section">
        <h2>Metrics</h2>
        <table className="metric-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Value</th>
              <th>Target</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody id="rc-metrics-body" dangerouslySetInnerHTML={{ __html: metricRowsHTML(grade.metrics) }} />
        </table>
      </div>
      <div className="rc-section" id="rc-why-section">
        <h2>Why This Grade</h2>
        <div className="rc-why" id="rc-why" dangerouslySetInnerHTML={{ __html: whyGradeHTML(grade.explain) }} />
      </div>
      <div className="rc-section">
        <h2>Recommendations</h2>
        <div
          className="rc-recs"
          id="rc-recommendations"
          dangerouslySetInnerHTML={{ __html: recListHTML(grade.recommendations, false) }}
        />
      </div>
    </div>
  );
}
