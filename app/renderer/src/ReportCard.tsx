// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Presentational counterpart to report-card.ts (#306, epic #302; extended
// TD-001 slice 4, #422): renders the full file/live-capture report card —
// header, grade ring + recording-type pill, content-type pill/ribbon, tonal
// balance vs target, metrics, "why this grade", band breakdown, spectrum-
// over-time frames, and recommendations — plus the phase-doubling/feedback-
// ringout launch callouts. Mounted as <ReportCardIsland>'s core (see
// ReportCardIsland.tsx); the Recent-Services "history" card (frozen,
// summary-only) is a separate, much smaller render in ReportCardIsland since
// it hides nearly every section here.
//
// Stays presentational: every section's HTML is built from data the caller
// already resolved (grade, view-model objects) — no window/DOM/store reads.
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
  scoreRowsHTML,
  recListHTML,
  bandBreakdownHTML,
  MAX_NOTE_LENGTH,
  type RecordingType,
  type GradeExplanation,
  type MetricRow,
  type ProfileComparison,
  type ReportCardSource,
  type BandDiffApi,
  type ContentTypeView,
  type FramesSectionView,
  type ReportDeltaView,
  type ScoreRow,
} from './report-card';

export interface GradeResult {
  letter: string;
  score: number;
  recType: RecordingType;
  explain: GradeExplanation;
  recommendations: string[];
  metrics: MetricRow[];
}

export interface PhaseDoublingView {
  detected: boolean;
  title: string;
  sub: string;
}

export interface FeedbackRingoutView {
  detected: boolean;
  title: string;
  sub: string;
  buttonLabel: string;
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
  /** Content-type pill + segment ribbon (PRD 04). Omitted → both hidden. */
  contentType?: ContentTypeView | null;
  /** Injected grading.js slice for the band-breakdown verdicts (#131). Omitted → section hidden. */
  bandDiffApi?: BandDiffApi | null;
  /** Spectrum-over-time heatmap + representative frame curves (PRD 03). */
  frames?: FramesSectionView | null;
  /** "vs. last time" comparison vs. the previous persisted summary (#259). Omitted/null → hidden. */
  delta?: ReportDeltaView | null;
  /** Score-circle expandable metric rows (#540, report-first-ux epic). Non-null → the flag-on
   *  treatment renders (rows replace the metric table, "Why This Grade" is dropped); null/omitted
   *  → today's markup renders unchanged. */
  scoreRows?: ScoreRow[] | null;
  phaseDoubling?: PhaseDoublingView | null;
  feedbackRingout?: FeedbackRingoutView | null;
  onOpenPhaseDoubling?: () => void;
  onOpenFeedbackRingout?: () => void;
  /** Show the "save this mix as your target" CTA (#263) — gated to A/B grades
   *  with a usable curve by the caller. */
  showSaveTarget?: boolean;
  /** True once this mix has already been saved as the active target curve — flips
   *  the CTA to a done state instead of hiding it. */
  saveTargetSaved?: boolean;
  onSaveAsTarget?: () => void;
  /** Optional one-line handoff note for the next volunteer (#267). Editable
   *  only once the underlying record has actually been written — disabled
   *  (not hidden) beforehand so the field's presence doesn't shift layout. */
  noteValue?: string;
  noteEditable?: boolean;
  onNoteChange?: (value: string) => void;
  onNoteCommit?: (value: string) => void;
}

export default function ReportCard({
  analysis,
  profile,
  comparison,
  isAutoProfile = false,
  grade,
  dateText,
  contentType,
  bandDiffApi,
  frames,
  delta,
  scoreRows,
  phaseDoubling,
  feedbackRingout,
  onOpenPhaseDoubling,
  onOpenFeedbackRingout,
  showSaveTarget = false,
  saveTargetSaved = false,
  onSaveAsTarget,
  noteValue = '',
  noteEditable = false,
  onNoteChange,
  onNoteCommit,
}: ReportCardProps) {
  const showProfile = !!(profile && comparison);
  const showContentTypePill = !!contentType?.pillLabel;
  const showRibbon = !!contentType?.ribbonSegmentsHTML;

  return (
    <div id="rc-content">
      {phaseDoubling && (
        <div className={`rc-section pd-launch${phaseDoubling.detected ? ' detected' : ''}`} id="rc-phase-doubling">
          <div className="pd-launch-body">
            <span className="pd-launch-title" id="rc-phase-doubling-title">{phaseDoubling.title}</span>
            <span className="pd-launch-sub" id="rc-phase-doubling-sub">{phaseDoubling.sub}</span>
          </div>
          <button
            type="button"
            id="rc-phase-doubling-btn"
            className="btn btn-secondary sm"
            onClick={onOpenPhaseDoubling}
          >
            Check for doubling
          </button>
        </div>
      )}
      {feedbackRingout && (
        <div className={`rc-section pd-launch${feedbackRingout.detected ? ' detected' : ''}`} id="rc-feedback-ringout">
          <div className="pd-launch-body">
            <span className="pd-launch-title" id="rc-feedback-ringout-title">{feedbackRingout.title}</span>
            <span className="pd-launch-sub" id="rc-feedback-ringout-sub">{feedbackRingout.sub}</span>
          </div>
          <button
            type="button"
            id="rc-feedback-ringout-btn"
            className="btn btn-secondary sm"
            onClick={onOpenFeedbackRingout}
          >
            <span id="rc-feedback-ringout-btn-label">{feedbackRingout.buttonLabel}</span>
          </button>
        </div>
      )}
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
        {delta && (
          <div id="rc-delta" className={`rc-delta ${delta.direction}`}>{delta.text}</div>
        )}
        <div
          className={`rc-contenttype${contentType?.contentType ? ` ${contentType.contentType}` : ''}`}
          id="rc-content-type"
          style={{ display: showContentTypePill ? 'inline-flex' : 'none' }}
        >
          {contentType?.pillLabel || ''}
        </div>
        <div className="rc-ribbon-wrap" id="rc-ribbon-wrap" style={{ display: showRibbon ? 'flex' : 'none' }}>
          <div className="rc-ribbon" id="rc-ribbon" dangerouslySetInnerHTML={{ __html: contentType?.ribbonSegmentsHTML || '' }} />
          <div className="rc-ribbon-legend" id="rc-ribbon-legend" dangerouslySetInnerHTML={{ __html: contentType?.ribbonLegendHTML || '' }} />
        </div>
      </div>
      <div className="rc-note" id="rc-note">
        <label className="rc-note-label" htmlFor="rc-note-input">
          Handoff note <span className="rc-note-optional">(optional)</span>
        </label>
        <input
          id="rc-note-input"
          className="rc-note-input"
          type="text"
          maxLength={MAX_NOTE_LENGTH}
          placeholder="Anything the next volunteer should know?"
          disabled={!noteEditable}
          value={noteValue}
          onChange={(e) => onNoteChange?.(e.target.value)}
          onBlur={(e) => onNoteCommit?.(e.target.value)}
        />
        {/* Print-only mirror of the input above (#267) — .rc-note-print-mirror keeps
            it invisible on screen even once noteValue is non-empty; the print
            stylesheet forces it visible in the exported PDF instead. */}
        <p className="rc-note-text rc-note-print-mirror" id="rc-note-text" hidden={!noteValue}>{noteValue}</p>
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
        {scoreRows ? (
          <div className="metric-rows" id="rc-metric-rows" dangerouslySetInnerHTML={{ __html: scoreRowsHTML(scoreRows) }} />
        ) : (
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
        )}
      </div>
      {!scoreRows && (
        <div className="rc-section" id="rc-why-section">
          <h2>Why This Grade</h2>
          <div className="rc-why" id="rc-why" dangerouslySetInnerHTML={{ __html: whyGradeHTML(grade.explain) }} />
        </div>
      )}
      {bandDiffApi && (
        <div className="rc-section" id="rc-bands-section">
          <h2>Frequency Band Breakdown</h2>
          <div
            className="rc-bands"
            id="rc-bands"
            dangerouslySetInnerHTML={{ __html: bandBreakdownHTML(analysis.bands, bandDiffApi) }}
          />
        </div>
      )}
      {frames?.visible && (
        <div className="rc-section" id="rc-frames-section">
          <h2>Spectrum Over Time</h2>
          <div className="rc-heatmap" id="rc-heatmap" dangerouslySetInnerHTML={{ __html: frames.heatmapHTML }} />
          <div className="rc-frame-curves" id="rc-frame-curves" dangerouslySetInnerHTML={{ __html: frames.curvesHTML }} />
        </div>
      )}
      {showSaveTarget && (
        <div className="rc-section pd-launch" id="rc-save-target">
          <div className="pd-launch-body">
            <span className="pd-launch-title" id="rc-save-target-title">
              This mix graded well — lock in its tone
            </span>
            <span className="pd-launch-sub" id="rc-save-target-sub">
              Save its tonal balance as a reusable target curve, then grade future
              services against the sound you already nailed.
            </span>
          </div>
          <button
            type="button"
            id="rc-save-target-btn"
            className="btn btn-primary sm"
            disabled={saveTargetSaved}
            onClick={onSaveAsTarget}
          >
            {saveTargetSaved ? 'Saved as a target curve ✓' : 'Save this mix’s tone as your target'}
          </button>
        </div>
      )}
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
