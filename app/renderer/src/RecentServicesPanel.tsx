// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The #tab-recent history list (#147, TD-001 slice 6e, #703) — portaled by
// App.tsx onto #tab-recent, replacing inline-app.js's renderRecentServices/
// loadHistoryEntry with a component driven by liveCaptureStore.appMode.
// Component-local state (no new store) — nothing else needs this list.

import { useEffect, useState, type JSX } from 'react';
import { useElectron } from './useElectron';
import { useStoreShallow } from './stores/useStoreShallow';
import { useLiveCaptureStore } from './stores/liveCaptureStore';
import { useAnalysisStore } from './stores/analysisStore';
import { spectrumTransport } from './spectrum-transport';
import { switchMode } from './mode-switch';
import { iconSvg } from './report-card';
import { buildTrendReportRows, trendReportHtml, MIN_TREND_ENTRIES } from './trend-export';
import type { AnalysisSummary } from '../../electron/ipc/api';

// CSS-custom-property-safe grade class — verbatim port of the inline
// expression in renderRecentServices (inline-app.js).
function gradeColorVar(gradeLetter: string): string {
  return `var(--grade-${(gradeLetter || '').toLowerCase().replace(/[^a-z]/g, '')})`;
}

// Loads a stored summary into the report card view without re-running any
// analysis — the row's record is all the report card ever reads (#147).
// prevSummary (#259) feeds the "vs. last time" delta — only the newest
// history entry (index 0) gets one, compared against the second-newest.
// Verbatim port of loadHistoryEntry (inline-app.js), calling switchMode()
// directly instead of simulating a .mode-tab click — this is React calling
// a real TS function now, no DOM indirection needed.
export function loadHistoryEntry(summary: AnalysisSummary, prevSummary: AnalysisSummary | null): void {
  spectrumTransport.pauseIfPlaying(); // don't leave a previous file's playback running behind the summary card
  useAnalysisStore.getState().setHistorySummary(summary);
  // A history entry always wins over whatever was previously on the card
  // (ReportCardIsland's priority: currentAnalysis, else liveSource, else
  // historySummary) — clearAnalysis() also resets selectedFilePath/status.
  useAnalysisStore.getState().clearAnalysis();
  useAnalysisStore.getState().setPrevSummary(prevSummary || null);
  if (!useLiveCaptureStore.getState().isCapturing) {
    useLiveCaptureStore.getState().clearLiveWindows();
    // #710: resetLapCoaching() replaces the deleted window.liveCoaching bridge.
    useLiveCaptureStore.getState().resetLapCoaching();
    const rcOffer = document.getElementById('rc-offer');
    const rcNotEnough = document.getElementById('rc-not-enough');
    if (rcOffer) rcOffer.style.display = 'none';
    if (rcNotEnough) rcNotEnough.style.display = 'none';
  }
  switchMode('reportcard');
}

// Writes the trend PDF's HTML into the always-present, normally-hidden
// #trend-report node, toggles body.print-trend so the print CSS swaps which
// of #report-card/#trend-report is visible, then triggers the browser print
// dialog — a second, distinct export action from the report card's own
// #reportcard-print-btn (#272).
export function exportTrendPdf(summaries: AnalysisSummary[]): void {
  const container = document.getElementById('trend-report');
  if (!container) return;
  container.innerHTML = trendReportHtml(buildTrendReportRows(summaries));
  document.body.classList.add('print-trend');
  window.print(); // blocks until the print dialog closes (same assumption reportcard-print-btn's window.print() call relies on)
  document.body.classList.remove('print-trend');
}

// Pure render of the fetched list — split out from the default export so
// it's directly testable via renderToString against an explicit
// `summaries` array, without needing the fetch effect (no jsdom) to run.
export function RecentServicesList({ summaries }: { summaries: AnalysisSummary[] }): JSX.Element {
  const hasSummaries = summaries.length > 0;
  const hasTrendHistory = summaries.length >= MIN_TREND_ENTRIES;
  return (
    <>
      <div className="rs-head">
        <span className="section-label">Recent Services</span>
        <button
          type="button"
          className="btn btn-secondary sm"
          id="recent-trend-export-btn"
          disabled={!hasTrendHistory}
          dangerouslySetInnerHTML={{ __html: iconSvg('download', 16) + 'Export trend PDF' }}
          /* c8 ignore next -- click dispatch, no jsdom, mirrors reportcard-print-btn */
          onClick={() => exportTrendPdf(summaries)}
        />
      </div>
      {!hasTrendHistory && (
        <p className="dz-hint" id="trend-export-hint">
          {summaries.length === 0
            ? 'Export trend PDF needs at least 2 services in your history — analyze 2 services to unlock it.'
            : 'Export trend PDF needs at least 2 services in your history — analyze one more to unlock it.'}
        </p>
      )}
      <div className="dir-list" id="recent-list">
        {summaries.map((s, i) => (
          <div
            className="dir-item recent-row"
            key={`${s.date}-${i}`}
            /* c8 ignore next -- click dispatch, no jsdom */
            onClick={() => loadHistoryEntry(s, i === 0 ? summaries[1] || null : null)}
          >
            <span className="recent-grade" style={{ color: gradeColorVar(s.gradeLetter) }}>{s.gradeLetter}</span>
            {s.source === 'live' && <span className="recent-source recent-source-live">Live</span>}
            <span className="dir-name">{s.sourceFilename}</span>
            <span className="recent-date">{new Date(s.date).toLocaleString()}</span>
            {s.note && <div className="recent-note">{s.note}</div>}
          </div>
        ))}
      </div>
      <p className="dz-hint recent-empty" id="recent-empty" style={{ display: hasSummaries ? 'none' : 'block' }}>
        No analyses yet — analyze a file to build your history.
      </p>
    </>
  );
}

export default function RecentServicesPanel(): JSX.Element {
  const api = useElectron();
  const appMode = useStoreShallow(useLiveCaptureStore, (s) => s.appMode);
  const [summaries, setSummaries] = useState<AnalysisSummary[]>([]);

  /* c8 ignore start -- IPC round trip, no jsdom in this harness; exercised
     by tests/e2e/report-first-ux.spec.ts and live-capture-workspace.spec.ts.
     RecentServicesList's rendering is unit-tested directly above. */
  useEffect(() => {
    if (appMode !== 'recent') return;
    let cancelled = false;
    api.listAnalysisSummaries()
      .then((res) => {
        if (cancelled) return;
        // Main already caps this list to 10; slice defensively so the
        // renderer never shows more even if that contract changes.
        setSummaries(res && res.success && Array.isArray(res.summaries) ? res.summaries.slice(0, 10) : []);
      })
      .catch((err: unknown) => {
        console.warn('listAnalysisSummaries failed', err);
        if (!cancelled) setSummaries([]);
      });
    return () => { cancelled = true; };
  }, [appMode, api]);
  /* c8 ignore stop */

  return <RecentServicesList summaries={summaries} />;
}
