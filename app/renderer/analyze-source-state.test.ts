import { describe, it, expect } from 'vitest';

// analyze-source-state is a plain classic script (window.analyzeSourceState / module.exports).
const { ANALYZE_SOURCES, isPickerEnabled, targetModeFor } = require('./analyze-source-state.js') as {
  ANALYZE_SOURCES: Array<{ id: string; label: string; hint: string; icon: string }>;
  isPickerEnabled: (enabled: unknown) => boolean;
  targetModeFor: (id: unknown) => string | null | undefined;
};

describe('ANALYZE_SOURCES', () => {
  it('has exactly 3 entries with ids file, live, soundcheck in that order', () => {
    expect(ANALYZE_SOURCES.map((s) => s.id)).toEqual(['file', 'live', 'soundcheck']);
  });

  it.each(ANALYZE_SOURCES.map((s) => s.id))('%s has a non-empty label and hint', (id) => {
    const source = ANALYZE_SOURCES.find((s) => s.id === id)!;
    expect(source.label.length).toBeGreaterThan(0);
    expect(source.hint.length).toBeGreaterThan(0);
  });
});

describe('isPickerEnabled', () => {
  it('is true only for a literal true', () => {
    expect(isPickerEnabled(true)).toBe(true);
  });

  it.each([false, undefined, null, 'true', 1])('is false for %s (strict === true check)', (value) => {
    expect(isPickerEnabled(value)).toBe(false);
  });
});

describe('targetModeFor', () => {
  it.each([
    ['file', null],
    ['live', 'live'],
    ['soundcheck', 'soundcheck'],
  ])('routes %s to %s', (id, expected) => {
    expect(targetModeFor(id)).toBe(expected);
  });

  it('returns undefined for an unknown id (fails loudly rather than silently no-op)', () => {
    expect(targetModeFor('dir')).toBeUndefined();
  });

  it('returns undefined when id is undefined', () => {
    expect(targetModeFor(undefined)).toBeUndefined();
  });
});
