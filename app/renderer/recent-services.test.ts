import { describe, it, expect } from 'vitest';

// recent-services is a plain classic script (window.recentServices in the
// browser, module.exports under Node) so the pure list logic is exercised
// without a DOM.
interface Summary {
  date?: string | null;
  sourceFilename?: string;
  gradeLetter?: string | null;
}

const { normalizeSummaries, isEmpty, rowHtml } = require('./recent-services.js') as {
  normalizeSummaries: (summaries: unknown, limit?: number) => Summary[];
  isEmpty: (list: unknown) => boolean;
  rowHtml: (summary: Summary, index: number, escapeHtml: (s: unknown) => string) => string;
};

function escapeHtml(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] as string));
}

describe('normalizeSummaries — sort newest-first', () => {
  it('returns records descending by date', () => {
    const input = [
      { date: '2026-01-01T00:00:00.000Z', sourceFilename: 'a' },
      { date: '2026-03-01T00:00:00.000Z', sourceFilename: 'b' },
      { date: '2026-02-01T00:00:00.000Z', sourceFilename: 'c' },
    ];
    const result = normalizeSummaries(input);
    expect(result.map((r) => r.date)).toEqual([
      '2026-03-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ]);
  });

  it('sorts a nullish/missing date last', () => {
    const input = [
      { date: '2026-01-01T00:00:00.000Z' },
      { date: null },
      { sourceFilename: 'no-date-field' },
      { date: '2026-05-01T00:00:00.000Z' },
    ];
    const result = normalizeSummaries(input);
    expect(result.map((r) => r.date)).toEqual([
      '2026-05-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
      null,
      undefined,
    ]);
  });

  it('does not mutate the input array', () => {
    const input = [
      { date: '2026-01-01T00:00:00.000Z' },
      { date: '2026-03-01T00:00:00.000Z' },
    ];
    const original = input.slice();
    normalizeSummaries(input);
    expect(input).toEqual(original);
  });
});

describe('normalizeSummaries — truncate-to-10', () => {
  const fifteen = Array.from({ length: 15 }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
    sourceFilename: `file-${i}`,
  }));

  it('caps the default result at 10 newest', () => {
    const result = normalizeSummaries(fifteen);
    expect(result).toHaveLength(10);
    expect(result[0].sourceFilename).toBe('file-14');
    expect(result[9].sourceFilename).toBe('file-5');
  });

  it('honors a custom limit', () => {
    const result = normalizeSummaries(fifteen, 3);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.sourceFilename)).toEqual(['file-14', 'file-13', 'file-12']);
  });

  it('caps at 10 when limit is undefined', () => {
    const result = normalizeSummaries(fifteen, undefined);
    expect(result).toHaveLength(10);
  });
});

describe('normalizeSummaries — empty state', () => {
  it('returns [] for an empty array', () => {
    expect(normalizeSummaries([])).toEqual([]);
  });
  it('returns [] for null', () => {
    expect(normalizeSummaries(null)).toEqual([]);
  });
  it('returns [] for a non-array', () => {
    expect(normalizeSummaries('not an array')).toEqual([]);
    expect(normalizeSummaries(undefined)).toEqual([]);
    expect(normalizeSummaries({})).toEqual([]);
  });
});

describe('isEmpty', () => {
  it('is true for an empty array', () => {
    expect(isEmpty([])).toBe(true);
  });
  it('is true for null', () => {
    expect(isEmpty(null)).toBe(true);
  });
  it('is false for a non-empty array', () => {
    expect(isEmpty([{}])).toBe(false);
  });
});

describe('rowHtml', () => {
  it('escapes hostile fields and preserves markup shape', () => {
    const summary = {
      gradeLetter: 'A"',
      sourceFilename: '<img src=x onerror=1>',
      date: '2026-01-01T00:00:00.000Z',
    };
    const html = rowHtml(summary, 2, escapeHtml);

    expect(html).toContain('class="dir-item recent-row"');
    expect(html).toContain('data-idx="2"');
    expect(html).toContain('class="recent-grade"');
    expect(html).toContain('class="dir-name"');
    expect(html).toContain('class="recent-date"');
    expect(html).not.toContain('<img src=x onerror=1>');
    expect(html).not.toContain('style="color:var(--grade-a")');
    // gradeClass strips non-letters, so the CSS var derives from 'a' only.
    expect(html).toContain('--grade-a)');
  });

  it('builds the grade CSS var from a lowercased, letters-only gradeLetter', () => {
    const html = rowHtml(
      { gradeLetter: 'B+', sourceFilename: 'file.wav', date: '2026-01-01T00:00:00.000Z' },
      0,
      escapeHtml,
    );
    expect(html).toContain('--grade-b)');
  });

  it('falls back to an empty grade class when gradeLetter is nullish', () => {
    const html = rowHtml(
      { gradeLetter: null, sourceFilename: 'file.wav', date: '2026-01-01T00:00:00.000Z' },
      0,
      escapeHtml,
    );
    expect(html).toContain('--grade-)');
  });
});
