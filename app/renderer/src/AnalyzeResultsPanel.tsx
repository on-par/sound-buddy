// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The Analyze results rail (#1487) — folds a file- or live-derived analysis's
// grade, recording-type pill, handoff note, and recommendations directly into
// Analyze chrome, so a result never requires bouncing to the separate Report
// Card tab. Rendered as a plain leaf inside AnalyzeLiveEqPanel.tsx's stage
// (never its own portal — ReportCard.tsx is nested the same way inside
// ReportCardIsland.tsx), beside the room EQ. Reuses gradeRingHTML/
// recTypePillHTML/recListHTML/commitReportCardNote verbatim (no forked
// grading math or markup, per the issue's AC2) but every DOM id here is
// `arc-*`, never `rc-*` — ReportCardIsland stays mounted at all times (only
// hidden by body.analyze-listening's CSS), so an `rc-*` id here would
// duplicate an existing one and break its e2e selectors.

import { useEffect, useRef, useState, type JSX } from 'react';
import { useElectron } from './useElectron';
import { useStoreShallow } from './stores/useStoreShallow';
import { useAnalysisStore } from './stores/analysisStore';
import { useAnalyzeEntryStore } from './stores/analyzeEntryStore';
import { analyzeResultsView, type AnalyzeResultsGradingApi } from './analyze-results';
import {
  gradeRingHTML,
  recTypePillClass,
  recTypePillHTML,
  recListHTML,
  commitReportCardNote,
  MAX_NOTE_LENGTH,
} from './report-card';
import type { AnalysisSummary } from '../../electron/ipc/api';

function getGrading(): AnalyzeResultsGradingApi {
  return (window as unknown as { grading: AnalyzeResultsGradingApi }).grading;
}

// Read-only render of a stored History summary (#1521) — no note input
// (nothing new to save) and no re-grading, matching ReportCardIsland's
// HistoryCard: the letter/score are frozen at analysis time, not recomputed.
function HistoryCard({ summary }: { summary: AnalysisSummary }): JSX.Element {
  return (
    <div className="analyze-results-rail" id="arc-content">
      <div className="rc-meta">
        <span id="arc-filename">{summary.sourceFilename}</span>
        <span>·</span>
        <span id="arc-date">{new Date(summary.date).toLocaleString()}</span>
      </div>
      <div className="rc-score">
        <div id="arc-ring" dangerouslySetInnerHTML={{ __html: gradeRingHTML(summary.gradeLetter, summary.score) }} />
        <div id="arc-rec-type" className="rc-rectype pill">{summary.recordingType}</div>
        {summary.gradingProfileLabel && (
          <div className="rc-rectype pill" id="arc-grading-profile">{summary.gradingProfileLabel}</div>
        )}
      </div>
      {summary.note && <p className="rc-note-text" id="arc-note-text">{summary.note}</p>}
      <div className="rc-section" id="arc-recommendations-section">
        <h2>Recommendations</h2>
        <div
          className="rc-recs"
          id="arc-recommendations"
          dangerouslySetInnerHTML={{ __html: recListHTML(summary.topFixes || [], true) }}
        />
      </div>
    </div>
  );
}

export default function AnalyzeResultsPanel(): JSX.Element {
  const { currentAnalysis, liveSource, historySummary, lastSavedSummaryFile } = useStoreShallow(useAnalysisStore, (s) => ({
    currentAnalysis: s.currentAnalysis,
    liveSource: s.liveSource,
    historySummary: s.historySummary,
    lastSavedSummaryFile: s.lastSavedSummaryFile,
  }));
  const listening = useStoreShallow(useAnalyzeEntryStore, (s) => s.listening);
  const sb = useElectron();

  const [noteDraft, setNoteDraft] = useState('');
  const prevNoteFileRef = useRef(lastSavedSummaryFile);
  // A new fresh-analysis save always starts the note field blank, mirroring
  // ReportCardIsland's own per-record reset (#267) — it's the same
  // lastSavedSummaryFile field, just a second, independent draft.
  /* c8 ignore start -- passive effect with no DOM/store side effect beyond
     local state; no jsdom in this harness (renderToString doesn't run
     effects) — exercised by the Analyze e2e. */
  useEffect(() => {
    if (prevNoteFileRef.current !== lastSavedSummaryFile) {
      prevNoteFileRef.current = lastSavedSummaryFile;
      setNoteDraft('');
    }
  }, [lastSavedSummaryFile]);
  /* c8 ignore stop */

  const view = analyzeResultsView(currentAnalysis, liveSource, historySummary, listening, getGrading());

  if (view.kind === 'history') {
    return <HistoryCard summary={view.summary} />;
  }

  if (view.kind === 'empty') {
    return (
      <div className="analyze-results-rail" id="arc-empty">
        <div className="eq-pane-section eq-pane-empty">
          <div className="eq-pane-header">Results</div>
          <div className="eq-pane-empty-hint">
            {view.state === 'listening'
              ? 'Listening — your grade, pills, and recommendations appear here once the room measurement settles.'
              : 'Load a file or start listening to see your grade, pills, and recommendations here.'}
          </div>
        </div>
      </div>
    );
  }

  const { grade } = view;

  return (
    <div className="analyze-results-rail" id="arc-content">
      <div className="rc-score">
        <div id="arc-ring" dangerouslySetInnerHTML={{ __html: gradeRingHTML(grade.letter, grade.score) }} />
        <div
          id="arc-rec-type"
          className={recTypePillClass(grade.recType)}
          dangerouslySetInnerHTML={{ __html: recTypePillHTML(grade.recType) }}
        />
        <div className="rc-rectype pill" id="arc-grading-profile">{grade.gradingProfileLabel}</div>
      </div>
      <div className="rc-note" id="arc-note">
        <label className="rc-note-label" htmlFor="arc-note-input">
          Handoff note <span className="rc-note-optional">(optional)</span>
        </label>
        <input
          id="arc-note-input"
          className="rc-note-input"
          type="text"
          maxLength={MAX_NOTE_LENGTH}
          placeholder="Anything the next volunteer should know?"
          disabled={!lastSavedSummaryFile}
          value={noteDraft}
          /* c8 ignore start -- change/blur dispatch, no jsdom in this harness
             (renderToString doesn't run DOM events); commitReportCardNote/
             noteSubmitPayload's actual logic is covered by
             report-card.test.ts. */
          onChange={(e) => setNoteDraft(e.target.value)}
          onBlur={(e) => { void commitReportCardNote(sb.setAnalysisSummaryNote, lastSavedSummaryFile, e.target.value); }}
          /* c8 ignore stop */
        />
      </div>
      <div className="rc-section" id="arc-recommendations-section">
        <h2>Recommendations</h2>
        <div
          className="rc-recs"
          id="arc-recommendations"
          dangerouslySetInnerHTML={{ __html: recListHTML(grade.recommendations, false) }}
        />
      </div>
    </div>
  );
}

