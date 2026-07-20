import { describe, it, expect } from 'vitest';

// single-column-state is a plain classic script (window.singleColumnState / module.exports).
const { isSingleColumn } = require('./single-column-state.js') as {
  isSingleColumn: (enabled: unknown, mode: unknown) => boolean;
};

describe('isSingleColumn', () => {
  it.each(['recent', 'guide', 'ringout'])(
    'collapses to a single column when the flag is enabled and mode is %s',
    (mode) => {
      expect(isSingleColumn(true, mode)).toBe(true);
    }
  );

  it.each(['live', 'soundcheck', 'file', 'dir', 'reportcard'])(
    'keeps the 3-column shell for mode %s even when the flag is enabled',
    (mode) => {
      expect(isSingleColumn(true, mode)).toBe(false);
    }
  );

  it('keeps the 3-column shell when the flag is disabled', () => {
    expect(isSingleColumn(false, 'recent')).toBe(false);
  });

  it('stays false for a truthy non-boolean enabled value (strict === true check)', () => {
    expect(isSingleColumn(undefined, 'recent')).toBe(false);
    expect(isSingleColumn(null, 'recent')).toBe(false);
    expect(isSingleColumn('true', 'recent')).toBe(false);
  });

  it('stays false when mode is undefined', () => {
    expect(isSingleColumn(true, undefined)).toBe(false);
  });
});
