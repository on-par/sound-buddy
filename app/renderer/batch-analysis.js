// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure batch-analyze loop for the Directory tab (#270): runs the existing
// single-file analyze pipeline sequentially over a list of files, one row per
// result. DOM-free and IPC-free — every effect (analyzeFile, toSummaryInput,
// saveSummary, onProgress) is injected, so this is unit-testable without
// Electron. Mirrors recent-services.js's UMD shape: loaded via <script src>
// and read off window.batchAnalysis.
(function (root) {
  'use strict';

  var UNGRADEABLE_ERROR = 'Analyzed, but the result could not be graded — the file may be silent or malformed.';

  function filenameOf(filePath) {
    var parts = String(filePath || '').split(/[\\/]/);
    return parts[parts.length - 1] || String(filePath || '');
  }

  // Runs `files` through the single-file analyze pipeline one at a time
  // (strictly sequential — analyze-file's in-flight-per-renderer supersede
  // semantics would abort every run but the last if fanned out in parallel).
  // Never throws: a thrown rejection from any injected dep becomes that
  // file's own error row instead of aborting the rest of the batch.
  async function runBatch(files, deps) {
    var total = files.length;
    var results = [];

    for (var i = 0; i < total; i++) {
      var filePath = files[i];
      var filename = filenameOf(filePath);
      deps.onProgress({ index: i, total: total, filePath: filePath, status: 'running' });

      var row;
      try {
        var outcome = await deps.analyzeFile(filePath);
        if (outcome && outcome.success) {
          var input = deps.toSummaryInput(outcome.data, filePath);
          if (!input) {
            row = { filePath: filePath, filename: filename, status: 'error', error: UNGRADEABLE_ERROR };
          } else {
            row = { filePath: filePath, filename: filename, status: 'ok', gradeLetter: input.gradeLetter, score: input.score };
            try {
              await deps.saveSummary(input);
            } catch (saveErr) {
              row.saveError = String(saveErr && saveErr.message ? saveErr.message : saveErr);
            }
          }
        } else if (outcome && outcome.cancelled) {
          row = { filePath: filePath, filename: filename, status: 'cancelled' };
        } else {
          row = { filePath: filePath, filename: filename, status: 'error', error: (outcome && outcome.error) || 'Analysis failed' };
        }
      } catch (err) {
        row = { filePath: filePath, filename: filename, status: 'error', error: String(err && err.message ? err.message : err) };
      }

      results.push(row);
      // The final event per file carries the whole row (grade/score, or the
      // error/cancelled reason) — not just status — so the caller can paint
      // that file's row (batchRowHtml) as soon as it completes, without
      // waiting for the whole batch or re-deriving the row itself.
      deps.onProgress(Object.assign({ index: i, total: total }, row));
    }

    return results;
  }

  // Single-row markup for a batch result. Mirrors recentServices.rowHtml's
  // shell (dir-item recent-row / recent-grade / dir-name) so the Directory
  // tab's list inherits the same styling with no new CSS beyond
  // .batch-failed/.batch-error. All interpolation goes through the injected
  // escapeHtml — never interpolate a raw filesystem path into markup.
  function batchRowHtml(result, index, escapeHtml) {
    var r = result || {};
    var safeName = escapeHtml(r.filename);
    if (r.status === 'ok') {
      var gradeClass = String(r.gradeLetter == null ? '' : r.gradeLetter).toLowerCase().replace(/[^a-z]/g, '');
      var safeGrade = escapeHtml(r.gradeLetter);
      // A save failure must stay visible even though the analysis itself
      // succeeded — otherwise the row looks identical to a fully-persisted
      // success and the user has no way to know this one never made it
      // into history.
      var saveWarningHtml = r.saveError
        ? '\n      <div class="batch-error">Analyzed, but not saved to history: ' + escapeHtml(r.saveError) + '</div>'
        : '';
      return '\n    <div class="dir-item recent-row" data-idx="' + index + '">\n' +
        '      <span class="recent-grade" style="color:var(--grade-' + gradeClass + ')">' + safeGrade + '</span>\n' +
        '      <span class="dir-name">' + safeName + '</span>' + saveWarningHtml + '\n' +
        '    </div>';
    }
    var safeError = escapeHtml(r.error || (r.status === 'cancelled' ? 'Cancelled' : 'Analysis failed'));
    return '\n    <div class="dir-item recent-row" data-idx="' + index + '">\n' +
      '      <span class="recent-grade batch-failed">—</span>\n' +
      '      <span class="dir-name">' + safeName + '</span>\n' +
      '      <div class="batch-error">' + safeError + '</div>\n' +
      '    </div>';
  }

  // The simple per-file completion indicator the issue allows — no bespoke
  // batch-progress design (no progress bars, no per-stage rows).
  function progressText(done, total) {
    return 'Analyzed ' + done + ' of ' + total;
  }

  // e.g. "3 analyzed · 1 couldn't be read" — the second clause is omitted
  // when every file analyzed cleanly.
  function summaryText(results) {
    var list = Array.isArray(results) ? results : [];
    var ok = list.filter(function (r) { return r && r.status === 'ok'; }).length;
    var failed = list.length - ok;
    var text = ok + ' analyzed';
    if (failed > 0) text += ' · ' + failed + " couldn't be read";
    return text;
  }

  // A batch run drives analyze-file directly (not the single-file report-card
  // store), so the store's own pushed analysis-result event must not flip the
  // Report Card mid-batch — true only while a batch is actually running.
  function shouldSuppressPushedResult(batchRunning) {
    return batchRunning === true;
  }

  var DEFAULT_EMPTY_FOLDER_MESSAGE = 'No audio files in that folder — pick a folder containing your service recordings.';

  // The Directory tab's empty-state copy after a folder is chosen: a genuine
  // "this folder has no audio files" gets the generic message, but a failed
  // scan (deleted folder, permission denied, a rejected IPC call) must surface
  // its own actionable error instead of looking identical to an empty folder.
  function dirEmptyMessage(res) {
    if (res && res.success === false && res.error) return res.error;
    return DEFAULT_EMPTY_FOLDER_MESSAGE;
  }

  var api = {
    runBatch: runBatch,
    batchRowHtml: batchRowHtml,
    progressText: progressText,
    summaryText: summaryText,
    shouldSuppressPushedResult: shouldSuppressPushedResult,
    dirEmptyMessage: dirEmptyMessage,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.batchAnalysis = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
