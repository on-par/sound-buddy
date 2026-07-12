// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure list logic for the Recent Services screen (#147), extracted from the
// renderer per #280/#225: sort-newest-first, truncate-to-limit, empty-state, and
// row markup. Loaded via <script src> and read off window.recentServices.
// Nothing here touches the DOM or IPC.
(function (root) {
  'use strict';

  var DEFAULT_LIMIT = 10;

  // Newest-first, truncated copy of summaries. Mirrors the comparator
  // storage.ts:listAnalysisSummaries sorts with, so the two agree given real
  // input: ISO-8601 date strings compared as strings, descending, with a
  // missing/nullish date treated as ''. Never mutates the input array.
  function normalizeSummaries(summaries, limit) {
    if (!Array.isArray(summaries)) return [];
    var max = typeof limit === 'number' && isFinite(limit) && limit >= 0 ? limit : DEFAULT_LIMIT;
    var copy = summaries.slice();
    copy.sort(function (a, b) {
      var ak = (a && a.date) || '';
      var bk = (b && b.date) || '';
      return ak < bk ? 1 : ak > bk ? -1 : 0;
    });
    return copy.slice(0, max);
  }

  function isEmpty(list) {
    return !Array.isArray(list) || list.length === 0;
  }

  // Single-row markup for a summary. escapeHtml is injected — the renderer
  // passes its existing shared escapeHtml so there is one escape implementation,
  // not a duplicate.
  function rowHtml(summary, index, escapeHtml) {
    var s = summary || {};
    var gradeClass = String(s.gradeLetter == null ? '' : s.gradeLetter)
      .toLowerCase().replace(/[^a-z]/g, '');
    var safeGrade = escapeHtml(s.gradeLetter);
    return '\n    <div class="dir-item recent-row" data-idx="' + index + '">\n' +
      '      <span class="recent-grade" style="color:var(--grade-' + gradeClass + ')">' + safeGrade + '</span>\n' +
      '      <span class="dir-name">' + escapeHtml(s.sourceFilename) + '</span>\n' +
      '      <span class="recent-date">' + escapeHtml(new Date(s.date).toLocaleString()) + '</span>\n' +
      '    </div>';
  }

  var api = {
    normalizeSummaries: normalizeSummaries,
    isEmpty: isEmpty,
    rowHtml: rowHtml,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.recentServices = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
