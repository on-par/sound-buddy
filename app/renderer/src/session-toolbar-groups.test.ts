// Copyright (c) 2026 Patrick Robinson (on-par). All rights reserved.
// Licensed under the Sound Buddy Desktop Application License (app/LICENSE).

import { describe, expect, it } from 'vitest';
import { sessionToolbarGroupHTML, SESSION_TOOLBAR_GROUP_LABELS, type SessionToolbarGroupKey } from './session-toolbar-groups';

describe('sessionToolbarGroupHTML', () => {
  it('wraps the inner markup in a labelled role="group" div for a representative key', () => {
    const html = sessionToolbarGroupHTML('tempo', '<span>x</span>');
    expect(html).toContain('class="daw-transport-group daw-transport-group--tempo"');
    expect(html).toContain('role="group"');
    expect(html).toContain(`aria-label="${SESSION_TOOLBAR_GROUP_LABELS.tempo}"`);
    expect(html).toContain('<span>x</span>');
  });

  it('returns an empty string for empty innerHTML so an absent cluster leaves no stray divider', () => {
    expect(sessionToolbarGroupHTML('session', '')).toBe('');
  });

  it('produces a distinct, non-empty label for every group key', () => {
    const keys = Object.keys(SESSION_TOOLBAR_GROUP_LABELS) as SessionToolbarGroupKey[];
    const labels = keys.map((key) => SESSION_TOOLBAR_GROUP_LABELS[key]);
    for (const label of labels) expect(label.length).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('every key produces markup carrying its own key and label', () => {
    const keys = Object.keys(SESSION_TOOLBAR_GROUP_LABELS) as SessionToolbarGroupKey[];
    for (const key of keys) {
      const html = sessionToolbarGroupHTML(key, 'x');
      expect(html).toContain(`daw-transport-group--${key}`);
      expect(html).toContain(`aria-label="${SESSION_TOOLBAR_GROUP_LABELS[key]}"`);
    }
  });
});
