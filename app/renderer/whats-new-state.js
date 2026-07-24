// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

// Pure, framework-free gate + parser for the post-update "what's new" note
// (#271). Closes the loop opened by the in-app "Send Feedback" flow (#143/#144):
// after a user updates, a dismissible banner credits shipped, user-requested
// items — "You asked, we shipped: …" — bundled with the release and read from
// disk, never fetched from a server. It appears at most once per version,
// gated by a per-version localStorage flag (mirrors onboarding-state.js's
// "seen once" idiom), and never renders for a build that ships no note or an
// empty/heading-only one. Loaded via <script src> and read off
// window.whatsNewState, mirroring onboarding-state.js.
(function (root) {
  'use strict';

  // localStorage key prefix. Suffixed per-version so every update re-shows the
  // note once, and a build with no note never marks anything seen.
  var KEY_PREFIX = 'sb-whats-new-seen';

  /** localStorage key for a given app version. */
  function keyFor(version) {
    return KEY_PREFIX + '-' + version;
  }

  /** Has this version's note already been dismissed/seen? */
  function hasSeen(storage, version) {
    try {
      return !!(storage && typeof storage.getItem === 'function' && storage.getItem(keyFor(version)) === '1');
    } catch {
      return false;
    }
  }

  /** Mark this version's note as seen so it never reappears (idempotent, best-effort). */
  function markSeen(storage, version) {
    try {
      if (storage && typeof storage.setItem === 'function') storage.setItem(keyFor(version), '1');
    } catch {
      /* private-mode / disabled storage — nothing we can persist, so no-op */
    }
  }

  // Strips `**bold**` / `` `code` `` markers to plain text without rendering
  // arbitrary HTML — the banner only ever shows inert text.
  var MARKDOWN_EMPHASIS_RUN = /(\*\*|`)/g;
  var HEADING_LINE = /^#{1,2}\s+(.+)$/;
  var BULLET_LINE = /^[-*]\s+(.+)$/;
  // `[\s\S]` (not `.`) so the comment body still matches when it spans
  // newlines — a bare `.*` here trips CodeQL js/bad-tag-filter (incomplete
  // multiline-comment match) and could let a `<!-- ... -->` slip through.
  var HTML_COMMENT_LINE = /^<!--[\s\S]*?-->$/;

  function stripEmphasis(text) {
    return text.replace(MARKDOWN_EMPHASIS_RUN, '');
  }

  /**
   * Parses the bundled changelog markdown into a banner-ready shape, or null
   * when there's nothing to show (falsy input, or zero bullet items — a
   * heading-only or empty file must never render a broken/empty note).
   */
  function parseNote(markdown) {
    if (!markdown || !markdown.trim()) return null;

    var title = null;
    var items = [];
    var lines = markdown.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || HTML_COMMENT_LINE.test(line)) continue;

      var headingMatch = HEADING_LINE.exec(line);
      if (headingMatch) {
        if (title === null) title = stripEmphasis(headingMatch[1]).trim();
        continue;
      }

      var bulletMatch = BULLET_LINE.exec(line);
      if (bulletMatch) items.push(stripEmphasis(bulletMatch[1]).trim());
    }

    if (items.length === 0) return null;
    return { title: title, items: items };
  }

  /** Should the banner show? Only when there's a real note and this version is unseen. */
  function shouldShow(storage, version, markdown) {
    return parseNote(markdown) !== null && !hasSeen(storage, version);
  }

  var api = {
    KEY_PREFIX: KEY_PREFIX,
    keyFor: keyFor,
    hasSeen: hasSeen,
    markSeen: markSeen,
    parseNote: parseNote,
    shouldShow: shouldShow,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.whatsNewState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
