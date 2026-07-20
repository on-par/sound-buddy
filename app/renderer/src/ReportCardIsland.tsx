// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Container island mounted into `#report-card` (TD-001 slice 4, #422):
// resolves the report-card source with today's priority — currentAnalysis
// wins, else liveSource, else historySummary, else empty — and renders one
// of three views: the empty dropzone/Analyze form, the frozen Recent-
// Services history card, or the full <ReportCard>. Reads window.grading /
// window.phaseDoublingState / window.feedbackRingout / window.audioEngineSpectral
// through typed accessors rather than importing those modules: they are
// classic boot scripts inline-app.js also reads off `window`, and grading.js's
// CONFIG can be mutated at runtime — a second ES import would risk a second,
// divergent copy.

import { useEffect, useRef, useState } from 'react';
import { compareToProfile } from '@sound-buddy/audio-engine/dist/profiles/index.js';
import type { IdealProfile } from '@sound-buddy/audio-engine/dist/profiles/index.js';
import { useElectron } from './useElectron';
import { useStoreShallow } from './stores/useStoreShallow';
import { useAnalysisStore, type AnalysisStatus } from './stores/analysisStore';
import { useSpectrumStore } from './stores/spectrumStore';
import { useSettingsStore } from './stores/settingsStore';
import { useSceneDiffStore } from './stores/sceneDiffStore';
import ReportCard, { type GradeResult } from './ReportCard';
import SceneChanges from './SceneChanges';
import { topSceneChanges } from '../../electron/scene-diff-format';
import {
  iconSvg,
  gradeRingHTML,
  recListHTML,
  buildMetricRows,
  buildScoreRows,
  reportCardSourceFromAnalysis,
  contentTypeView,
  reportCardFramesView,
  reportDeltaView,
  noteSubmitPayload,
  commitReportCardNote,
  type ReportCardSource,
  type ProfileComparison,
  type RecordingType,
  type GradeExplanation,
  type BandDiffApi,
  type GradingPillApi,
  type ReportDeltaView,
  type ScoreRow,
} from './report-card';
import type { SpectrumCurve } from './spectrum-display';

interface GradingApi extends GradingPillApi, BandDiffApi {
  computeGrade(src: ReportCardSource): string;
  computeScore(src: ReportCardSource): number;
  analyzeRecordingType(src: ReportCardSource): RecordingType;
  explainGrade(src: ReportCardSource): GradeExplanation;
  computeRecommendations(src: ReportCardSource): string[];
}

interface FeedbackPeak {
  freq: number;
  prominence: number;
}

interface FeedbackRingoutCalloutView {
  detected: boolean;
  title: string;
  sub: string;
  buttonLabel: string;
}

interface PhaseDoublingApi {
  detectPhaseSignal(input: { deviation?: number[] }): boolean;
}

interface FeedbackRingoutApi {
  detectFeedbackSignal(curve: unknown, findPeaks: unknown): FeedbackPeak | null;
  reportCardCallout(peak: FeedbackPeak | null): FeedbackRingoutCalloutView;
}

interface InlineDialogsApi {
  openPhaseDoublingDialog(): void;
  openFeedbackRingout(): void;
}

function getGrading(): GradingApi {
  return (window as unknown as { grading: GradingApi }).grading;
}
function getPhaseDoublingState(): PhaseDoublingApi {
  return (window as unknown as { phaseDoublingState: PhaseDoublingApi }).phaseDoublingState;
}
function getFeedbackRingout(): FeedbackRingoutApi {
  return (window as unknown as { feedbackRingout: FeedbackRingoutApi }).feedbackRingout;
}
function getFindSpectralPeaks(): unknown {
  return (window as unknown as { audioEngineSpectral: { findSpectralPeaks: unknown } }).audioEngineSpectral
    .findSpectralPeaks;
}
function getInlineDialogs(): InlineDialogsApi | undefined {
  return (window as unknown as { inlineDialogs?: InlineDialogsApi }).inlineDialogs;
}
function getReportFirstUxState(): { isEnabled(s: unknown): boolean } | undefined {
  return (window as unknown as { reportFirstUxState?: { isEnabled(s: unknown): boolean } }).reportFirstUxState;
}

interface HistorySummary {
  sourceFilename: string;
  date: string;
  gradeLetter: string;
  score: number;
  recordingType: string;
  topFixes: string[];
  /** Optional one-line handoff note for the next volunteer (#267). */
  note?: string;
}

// Renders a stored summary-only record (#147) — no metrics/bands/spectrum/
// frames, since that raw data was never persisted. The grade/score are read
// straight from the record: they were frozen at analysis time. Verbatim port
// of renderReportCardFromHistory (inline-app.js:2788–2831), minus the toolbar
// + upgrade-momentum side effects (chrome sync, still inline).
function HistoryCard({ summary, delta }: { summary: HistorySummary; delta?: ReportDeltaView | null }) {
  return (
    <div id="rc-content">
      <div className="rc-header">
        <h1>Sound Buddy Report Card</h1>
        <div className="rc-meta">
          <span id="rc-filename">{summary.sourceFilename}</span>
          <span>·</span>
          <span id="rc-date">{new Date(summary.date).toLocaleString()}</span>
        </div>
      </div>
      <div className="rc-score">
        <div id="rc-ring" dangerouslySetInnerHTML={{ __html: gradeRingHTML(summary.gradeLetter, summary.score) }} />
        <div id="rc-rec-type" className="rc-rectype pill">{summary.recordingType}</div>
        {delta && (
          <div id="rc-delta" className={`rc-delta ${delta.direction}`}>{delta.text}</div>
        )}
      </div>
      {summary.note && <p className="rc-note-text" id="rc-note-text">{summary.note}</p>}
      <div className="rc-section">
        <h2>Recommendations</h2>
        <div
          className="rc-recs"
          id="rc-recommendations"
          dangerouslySetInnerHTML={{ __html: recListHTML(summary.topFixes || [], true) }}
        />
      </div>
    </div>
  );
}

interface EmptyStateProps {
  visible: boolean;
  selectedFilePath: string | null;
  status: AnalysisStatus;
}

// The file-loading dropzone + Analyze button (#rc-empty). Ported from
// inline-app.js:1391–1417 (dropzone drag/drop + click) and :1406–1475
// (loadFile/runFileAnalysis DOM effects) onto the analysisStore actions —
// architecture decision 5 of the issue spec. Always mounted — `visible`
// toggles `display` rather than conditionally mounting/unmounting, matching
// today's behavior (architecture decision 4) and keeping local drag-state
// intact across a source/live-source flicker.
function EmptyState({ visible, selectedFilePath, status }: EmptyStateProps) {
  const sb = useElectron();
  const [dragOver, setDragOver] = useState(false);
  const [sceneDragOver, setSceneDragOver] = useState(false);
  // Sticks at true once a run has ever completed, so a later failed re-run
  // doesn't flip the label back to "Analyze" — mirrors inline-app.js's
  // one-way analyzeBtn.innerHTML flip (only Clear/clearAnalysis resets it).
  const everAnalyzedRef = useRef(false);
  if (status === 'idle') everAnalyzedRef.current = false;
  if (status === 'done') everAnalyzedRef.current = true;

  const loaded = !!selectedFilePath;
  const name = selectedFilePath ? selectedFilePath.split('/').pop() || selectedFilePath : '';

  const pickFile = async () => {
    const fp = await sb.openFileDialog();
    if (fp) useAnalysisStore.getState().selectFile(fp);
  };

  // Scene-file diff (#264) — the extension check lives in computeSceneDiff
  // (electron/scene-diff.ts), not here, so a wrong file gets the actionable
  // IPC error message instead of a silent no-op.
  const pickScene = async () => {
    const fp = await sb.openFileDialog();
    if (fp) void useSceneDiffStore.getState().addScenePath(fp);
  };

  return (
    <div id="rc-empty" className="rc-empty" style={{ display: visible ? 'flex' : 'none' }}>
      <div className="rc-empty-load">
        <div
          className={`dropzone${loaded ? ' loaded' : ''}${dragOver ? ' dragover' : ''}`}
          id="file-dropzone"
          onClick={() => { void pickFile(); }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer?.files?.[0] as (File & { path?: string }) | undefined;
            if (file?.path) useAnalysisStore.getState().selectFile(file.path);
          }}
        >
          <div className="dz-icon" dangerouslySetInnerHTML={{ __html: iconSvg('file-audio', 16) }} />
          {loaded ? (
            <div className="dz-body">
              <span className="dz-title">{name}</span>
              <span className="dz-meta">{selectedFilePath}</span>
            </div>
          ) : (
            <div className="dz-body">
              <span className="dz-title">Drop audio file here</span>
              <span className="dz-hint">or click to browse</span>
            </div>
          )}
        </div>
        <p className="dz-hint" style={{ textAlign: 'center' }}>
          Supports wav · aif · aiff · flac · mp3 · ogg · m4a · mp4 · mov · mkv · webm (video: audio track is extracted)
        </p>
        <button
          className="btn btn-primary full"
          id="analyze-btn"
          disabled={!selectedFilePath || status === 'analyzing'}
          onClick={() => {
            if (selectedFilePath) void useAnalysisStore.getState().startAnalysis(selectedFilePath);
          }}
        >
          <span dangerouslySetInnerHTML={{ __html: iconSvg('waveform', 16) }} />
          {everAnalyzedRef.current ? 'Re-analyze' : 'Analyze'}
        </button>
      </div>
      <div className="rc-empty-scene">
        <div
          className={`dropzone${sceneDragOver ? ' dragover' : ''}`}
          id="scene-dropzone"
          onClick={() => { void pickScene(); }}
          onDragOver={(e) => { e.preventDefault(); setSceneDragOver(true); }}
          onDragLeave={() => setSceneDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setSceneDragOver(false);
            // Unlike the audio dropzone, a single drop gesture can carry both
            // files at once (the hint text invites "drop two") — feed every
            // dropped path through addScenePath in order, awaiting each
            // before the next so the two-file window and its diffScenes
            // in-flight guard (sceneDiffStore.ts) see them one at a time
            // instead of racing.
            const files = Array.from(e.dataTransfer?.files ?? []) as Array<File & { path?: string }>;
            const paths = files.map((f) => f.path).filter((p): p is string => !!p);
            if (paths.length === 0) return;
            void (async () => {
              for (const p of paths) {
                await useSceneDiffStore.getState().addScenePath(p);
              }
            })();
          }}
        >
          <div className="dz-icon" dangerouslySetInnerHTML={{ __html: iconSvg('file-audio', 16) }} />
          <div className="dz-body">
            <span className="dz-title">Console scene (optional)</span>
            <span className="dz-hint">Drop a .scn from your M32R — drop two to compare before/after</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function hasUsableCurve(curve: unknown): curve is SpectrumCurve {
  const c = curve as SpectrumCurve | null | undefined;
  return !!(c && Array.isArray(c.freqs) && Array.isArray(c.db) && c.freqs.length === c.db.length && c.db.length >= 2);
}

export default function ReportCardIsland() {
  const sb = useElectron();
  const { currentAnalysis, selectedFilePath, historySummary, liveSource, prevSummary, status, lastSavedSummaryFile } =
    useStoreShallow(useAnalysisStore, (s) => ({
      currentAnalysis: s.currentAnalysis,
      selectedFilePath: s.selectedFilePath,
      historySummary: s.historySummary,
      liveSource: s.liveSource,
      prevSummary: s.prevSummary,
      status: s.status,
      lastSavedSummaryFile: s.lastSavedSummaryFile,
    }));
  const [noteDraft, setNoteDraft] = useState('');
  // noteDraftRef mirrors the latest draft text every render, so the flush
  // effect below can read "what the user was typing" without adding noteDraft
  // as a dependency (which would re-run it on every keystroke). prevNoteFileRef
  // is different: it's updated only inside the effect itself, so at the start
  // of each run it still holds the *previous* lastSavedSummaryFile — updating
  // it on every render (like noteDraftRef) would make "previous" and
  // "current" the same value by the time the effect reads it.
  const noteDraftRef = useRef(noteDraft);
  noteDraftRef.current = noteDraft;
  const prevNoteFileRef = useRef(lastSavedSummaryFile);
  const lastCommittedNoteRef = useRef('');
  /* c8 ignore start -- thin wiring invoked by the input's onBlur; no jsdom in
     this harness to dispatch a blur event (renderToString doesn't run DOM
     events). The logic that can actually break — payload construction,
     success/failure handling, rejection handling — is extracted into
     commitReportCardNote/noteSubmitPayload and fully covered by
     report-card.test.ts. */
  const commitNote = (value: string) => {
    lastCommittedNoteRef.current = noteSubmitPayload(lastSavedSummaryFile, value)?.note ?? lastCommittedNoteRef.current;
    void commitReportCardNote(sb.setAnalysisSummaryNote, lastSavedSummaryFile, value);
  };
  /* c8 ignore stop */
  // A new fresh-analysis save (or a return to no-file state) always starts the
  // note field blank — it's a per-record field, never carried over from the
  // previous card (#267). Flushes an uncommitted edit against the *previous*
  // file first: disabling the input as a new analysis lands force-blurs a
  // still-focused field, and that native blur fires against the already-reset
  // (null) lastSavedSummaryFile, so relying on onBlur alone silently drops the
  // in-progress edit — skip the flush once it's already been committed via a
  // normal blur (no double-write of the same value).
  /* c8 ignore start -- passive effect with no DOM/store side effect beyond
     local state; no jsdom in this harness (renderToString doesn't run
     effects, and the constitution forbids adding a new test framework) —
     exercised by the report-card e2e. */
  useEffect(() => {
    const prevFile = prevNoteFileRef.current;
    const draft = noteDraftRef.current;
    const pending = noteSubmitPayload(prevFile, draft);
    if (pending && pending.note !== lastCommittedNoteRef.current) {
      void commitReportCardNote(sb.setAnalysisSummaryNote, prevFile, draft);
    }
    prevNoteFileRef.current = lastSavedSummaryFile;
    setNoteDraft('');
    lastCommittedNoteRef.current = '';
  }, [lastSavedSummaryFile, sb]);
  /* c8 ignore stop */
  const { idealProfile, isAutoProfile } = useStoreShallow(useSpectrumStore, (s) => ({
    idealProfile: s.idealProfile,
    isAutoProfile: s.isAutoProfile,
  }));
  const { settings } = useStoreShallow(useSettingsStore, (s) => ({ settings: s.settings }));
  const { sceneStatus, sceneDiff, sceneNameA, sceneNameB, sceneError } = useStoreShallow(useSceneDiffStore, (s) => ({
    sceneStatus: s.status,
    sceneDiff: s.diff,
    sceneNameA: s.nameA,
    sceneNameB: s.nameB,
    sceneError: s.sceneError,
  }));
  const reportViewedRef = useRef(false);

  const isHistoryCard = !!historySummary && !currentAnalysis && !liveSource;
  const source: ReportCardSource | null = currentAnalysis
    ? reportCardSourceFromAnalysis(currentAnalysis)
    : ((liveSource as ReportCardSource | null) ?? null);

  let grade: GradeResult | null = null;
  let comparison: ProfileComparison | null = null;
  let phaseSignal = false;
  let feedbackPeak: FeedbackPeak | null = null;
  let feedbackCallout: FeedbackRingoutCalloutView | null = null;
  let scoreRows: ScoreRow[] | null = null;

  if (!isHistoryCard && source) {
    const grading = getGrading();
    grade = {
      letter: grading.computeGrade(source),
      score: grading.computeScore(source),
      recType: grading.analyzeRecordingType(source),
      explain: grading.explainGrade(source),
      recommendations: grading.computeRecommendations(source),
      metrics: buildMetricRows(source, grading),
    };

    scoreRows = getReportFirstUxState()?.isEnabled(settings) ? buildScoreRows(source, grading, grade.explain) : null;

    if (hasUsableCurve(source.curve) && idealProfile) {
      comparison = compareToProfile(source.curve, idealProfile as IdealProfile);
    }

    phaseSignal = getPhaseDoublingState().detectPhaseSignal({ deviation: comparison ? comparison.deviation : undefined });
    feedbackPeak = getFeedbackRingout().detectFeedbackSignal(source.curve || null, getFindSpectralPeaks());
    feedbackCallout = getFeedbackRingout().reportCardCallout(feedbackPeak);
  }

  // "vs. last time" delta (#259) — only for the fresh file-analysis card and
  // the newest history card; never for live capture (source-type gate).
  const prev = prevSummary as { score: number; gradeLetter: string } | null;
  const delta = currentAnalysis && grade
    ? reportDeltaView({ score: grade.score, gradeLetter: grade.letter }, prev)
    : isHistoryCard && historySummary
      ? reportDeltaView(historySummary as HistorySummary, prev)
      : null;

  // Seeds the inline phase-doubling/feedback-ringout dialogs, replacing
  // inline-app.js's rcFeedbackPeak/rcPhaseSignal module vars (architecture
  // decision 5 of the issue spec) — runs after every render so the dialogs
  // always open with this render's data.
  /* c8 ignore start -- passive effect writing a window bridge; no jsdom in
     this harness (renderToString doesn't run effects, and the constitution
     forbids adding a new test framework) — exercised by report-card-basics
     e2e via the phase-doubling/feedback-ringout dialogs it seeds. */
  useEffect(() => {
    (window as unknown as { rcCallouts?: unknown }).rcCallouts = { feedbackPeak, phaseSignal };
  });
  /* c8 ignore stop */

  const showEmpty = !isHistoryCard && !(source && grade);
  const cardVisible = !showEmpty || isHistoryCard;

  // report_viewed telemetry (#474): fires once per false→true visibility
  // transition, not on every render the card stays visible. Main-process
  // filtering (telemetry.ts's allowlist + usageSignalEnabled gate) means this
  // needs no renderer-side gating on the setting.
  /* c8 ignore start -- passive effect calling the telemetry IPC bridge; no
     jsdom in this harness (renderToString doesn't run effects, and the
     constitution forbids adding a new test framework) — exercised by the
     report-card e2e. */
  useEffect(() => {
    if (cardVisible && !reportViewedRef.current) {
      (window as unknown as { soundBuddy?: { recordAppEvent: (name: string) => void } }).soundBuddy?.recordAppEvent(
        'report_viewed'
      );
    }
    reportViewedRef.current = cardVisible;
  });
  /* c8 ignore stop */

  return (
    <>
      <EmptyState visible={showEmpty} selectedFilePath={selectedFilePath} status={status} />
      {isHistoryCard && historySummary ? (
        <HistoryCard summary={historySummary as HistorySummary} delta={delta} />
      ) : source && grade ? (
        <ReportCard
          analysis={source}
          profile={idealProfile}
          comparison={comparison}
          isAutoProfile={isAutoProfile}
          grade={grade}
          dateText={new Date().toLocaleString()}
          contentType={contentTypeView(source.contentType, source.segments)}
          bandDiffApi={getGrading()}
          frames={reportCardFramesView(source.frames)}
          delta={delta}
          scoreRows={scoreRows}
          phaseDoubling={{
            detected: phaseSignal,
            title: phaseSignal
              ? 'We spotted a possible phase or doubling issue'
              : 'Hearing a weird, doubled, or robotic sound?',
            sub: phaseSignal
              ? 'Your spectrum shows a comb-filter pattern — run the check to find the duplicate path.'
              : 'Walk through the common phase & routing bugs — no console access needed.',
          }}
          feedbackRingout={feedbackCallout}
          onOpenPhaseDoubling={() => getInlineDialogs()?.openPhaseDoublingDialog()}
          onOpenFeedbackRingout={() => getInlineDialogs()?.openFeedbackRingout()}
          noteValue={noteDraft}
          noteEditable={!!lastSavedSummaryFile}
          onNoteChange={setNoteDraft}
          onNoteCommit={commitNote}
        />
      ) : (
        <div id="rc-content" style={{ display: 'none' }} />
      )}
      <SceneChanges
        status={sceneStatus}
        changes={sceneDiff ? topSceneChanges(sceneDiff) : []}
        totalChanges={sceneDiff?.changes.length ?? 0}
        nameA={sceneNameA}
        nameB={sceneNameB}
        sceneError={sceneError}
      />
    </>
  );
}
