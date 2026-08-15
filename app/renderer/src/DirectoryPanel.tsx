// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// The Directory tab's batch-analyze panel (TD-001 slice 6h, #711) — portaled
// by App.tsx onto the (now empty) static #tab-dir node, like
// RecentServicesPanel. Renders the same ids/classes root-markup.html used to
// define (#dir-choose-btn/#dir-path/#dir-analyze-btn/#dir-progress/
// #dir-results/#dir-empty) from directoryStore state, so the batch flow and
// the batch-directory e2e spec stay byte-identical to the inline-app.js
// version it replaces. Row markup comes from window.batchAnalysis's
// batchRowHtml (pure classic script), exactly like the old inline render.

import type { JSX } from 'react';
import { useStoreShallow } from './stores/useStoreShallow';
import { useDirectoryStore, type BatchRow } from './stores/directoryStore';
import { escapeHtml } from './spectrum-display';
import { iconSvg } from './report-card';

interface BatchAnalysisApi {
  batchRowHtml(result: BatchRow, index: number, escapeHtml: (s: string) => string): string;
}
function getBatchAnalysis(): BatchAnalysisApi {
  return (window as unknown as { batchAnalysis: BatchAnalysisApi }).batchAnalysis;
}

export default function DirectoryPanel(): JSX.Element {
  const { path, files, rows, progress, emptyMessage, running } = useStoreShallow(useDirectoryStore, (s) => ({
    path: s.path,
    files: s.files,
    rows: s.rows,
    progress: s.progress,
    emptyMessage: s.emptyMessage,
    running: s.running,
  }));

  const resultsHTML = rows.map((r, i) => getBatchAnalysis().batchRowHtml(r, i, escapeHtml)).join('');
  // Mirrors the old renderDirEmptyState: hidden until a folder has actually
  // been chosen (path set) and the scan found no audio files.
  const showEmpty = files.length === 0 && path !== '';

  return (
    <>
      <button
        type="button"
        className="btn btn-primary"
        id="dir-choose-btn"
        disabled={running}
        /* c8 ignore next -- click dispatch, no jsdom */
        onClick={() => { void useDirectoryStore.getState().chooseFolder(); }}
        dangerouslySetInnerHTML={{ __html: iconSvg('folder', 16) + 'Choose a folder&hellip;' }}
      />
      <div className="dir-path" id="dir-path">{path}</div>
      <button
        type="button"
        className="btn btn-primary"
        id="dir-analyze-btn"
        disabled={running || files.length === 0}
        /* c8 ignore next -- click dispatch, no jsdom */
        onClick={() => { void useDirectoryStore.getState().analyze(); }}
      >
        Analyze all
      </button>
      <div className="dir-progress" id="dir-progress">{progress}</div>
      <div className="dir-list" id="dir-results" dangerouslySetInnerHTML={{ __html: resultsHTML }} />
      <div className="dir-empty" id="dir-empty" style={{ display: showEmpty ? 'block' : 'none' }}>{emptyMessage}</div>
    </>
  );
}
