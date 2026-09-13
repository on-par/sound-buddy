import { describe, it, expect } from 'vitest';

// single-column-state is a plain classic script (window.singleColumnState / module.exports).
const { isSingleColumn } = require('./single-column-state.js') as {
  isSingleColumn: (simpleMode: unknown, mode: unknown) => boolean;
};

describe('isSingleColumn', () => {
  it('collapses to a single column in Simple-mode History', () => {
    expect(isSingleColumn(true, 'recent')).toBe(true);
  });

  it.each(['guide', 'ringout', 'live', 'soundcheck', 'file', 'dir', 'reportcard'])(
    'keeps the 3-column shell for mode %s even in Simple mode',
    (mode) => {
      expect(isSingleColumn(true, mode)).toBe(false);
    }
  );

  it('keeps the 3-column shell when Simple mode is disabled', () => {
    expect(isSingleColumn(false, 'recent')).toBe(false);
  });

  it('stays false for a truthy non-boolean Simple-mode value (strict === true check)', () => {
    expect(isSingleColumn(undefined, 'recent')).toBe(false);
    expect(isSingleColumn(null, 'recent')).toBe(false);
    expect(isSingleColumn('true', 'recent')).toBe(false);
  });

  it('stays false when mode is undefined', () => {
    expect(isSingleColumn(true, undefined)).toBe(false);
  });
});
