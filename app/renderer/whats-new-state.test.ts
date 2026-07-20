import { describe, it, expect } from 'vitest';

// whats-new-state is a plain classic script (window.whatsNewState in the
// browser, module.exports under Node) so the once-per-version gate is
// exercised without a DOM. A tiny in-memory Storage stand-in stands in for
// localStorage, mirroring onboarding-state.test.ts.
const { KEY_PREFIX, keyFor, hasSeen, markSeen, parseNote, shouldShow } = require('./whats-new-state.js') as {
  KEY_PREFIX: string;
  keyFor: (version: string) => string;
  hasSeen: (storage: unknown, version: string) => boolean;
  markSeen: (storage: unknown, version: string) => void;
  parseNote: (markdown: string | null) => { title: string | null; items: string[] } | null;
  shouldShow: (storage: unknown, version: string, markdown: string | null) => boolean;
};

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    _map: map,
  };
}

describe('keyFor', () => {
  it('builds a per-version key under KEY_PREFIX', () => {
    expect(keyFor('1.4.0')).toBe(`${KEY_PREFIX}-1.4.0`);
    expect(keyFor('1.5.0')).toBe(`${KEY_PREFIX}-1.5.0`);
  });
});

describe('parseNote', () => {
  it('returns null for falsy input', () => {
    expect(parseNote(null)).toBeNull();
    expect(parseNote('')).toBeNull();
  });

  it('returns null for whitespace-only input', () => {
    expect(parseNote('   \n  \n')).toBeNull();
  });

  it('returns null when there is a heading but no bullets', () => {
    expect(parseNote('# What\'s new\n\nJust some prose, no bullets.')).toBeNull();
  });

  it('returns null when the file is heading-only', () => {
    expect(parseNote('# What\'s new\n')).toBeNull();
  });

  it('parses "-" and "*" bullets into items', () => {
    const md = '# What\'s new\n- First item\n* Second item\n';
    expect(parseNote(md)).toEqual({ title: "What's new", items: ['First item', 'Second item'] });
  });

  it('captures the first heading (# or ##) as title, else null', () => {
    expect(parseNote('## Release notes\n- Only item')).toEqual({ title: 'Release notes', items: ['Only item'] });
    expect(parseNote('- Only item, no heading')).toEqual({ title: null, items: ['Only item, no heading'] });
  });

  it('strips bold/code markdown runs to plain text', () => {
    const md = '# What\'s new\n- **You asked, we shipped:** Recent Services `history` view.';
    expect(parseNote(md)).toEqual({
      title: "What's new",
      items: ['You asked, we shipped: Recent Services history view.'],
    });
  });

  it('ignores blank lines and HTML-comment lines', () => {
    const md = [
      '<!-- Edit before each release -->',
      '# What\'s new',
      '',
      '<!-- another comment -->',
      '- First item',
      '',
      '- Second item',
    ].join('\n');
    expect(parseNote(md)).toEqual({ title: "What's new", items: ['First item', 'Second item'] });
  });
});

describe('hasSeen / markSeen', () => {
  it('is false for empty storage', () => {
    expect(hasSeen(fakeStorage(), '1.4.0')).toBe(false);
  });

  it('round-trips: markSeen then hasSeen is true for that version only', () => {
    const s = fakeStorage();
    markSeen(s, '1.4.0');
    expect(hasSeen(s, '1.4.0')).toBe(true);
    expect(hasSeen(s, '1.5.0')).toBe(false);
    expect(s._map.get(keyFor('1.4.0'))).toBe('1');
  });

  it('hasSeen is false when storage.getItem throws', () => {
    const throwing = { getItem: () => { throw new Error('denied'); } };
    expect(hasSeen(throwing, '1.4.0')).toBe(false);
  });

  it('hasSeen is false for null/unavailable storage', () => {
    expect(hasSeen(null, '1.4.0')).toBe(false);
  });

  it('markSeen is a no-op (no throw) when storage.setItem throws', () => {
    const throwing = { setItem: () => { throw new Error('denied'); } };
    expect(() => markSeen(throwing, '1.4.0')).not.toThrow();
  });

  it('markSeen is a no-op (no throw) for null storage', () => {
    expect(() => markSeen(null, '1.4.0')).not.toThrow();
  });
});

describe('shouldShow', () => {
  const md = '# What\'s new\n- Something we shipped.';

  it('true when the note parses and the version is unseen', () => {
    expect(shouldShow(fakeStorage(), '1.4.0', md)).toBe(true);
  });

  it('false when the note is null (no bullets / absent)', () => {
    expect(shouldShow(fakeStorage(), '1.4.0', null)).toBe(false);
    expect(shouldShow(fakeStorage(), '1.4.0', '# What\'s new only, no bullets')).toBe(false);
  });

  it('false once that version has been marked seen', () => {
    const s = fakeStorage();
    markSeen(s, '1.4.0');
    expect(shouldShow(s, '1.4.0', md)).toBe(false);
  });
});
